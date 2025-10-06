/**
 * Analysis Worker - Processes OCR results and performs analysis
 */

import { AnalysisQueueMessage, GazetteAnalysis, AnalysisConfig } from './types';
import { AnalysisOrchestrator } from './services/analysis-orchestrator';
import { logger } from './utils';

export interface Env {
  ANALYSIS_QUEUE: Queue<AnalysisQueueMessage>;
  ANALYSIS_RESULTS: KVNamespace;
  OCR_RESULTS?: KVNamespace; // Access to OCR results stored by OCR worker
  WEBHOOK_QUEUE?: Queue;
  WEBHOOK_SUBSCRIPTIONS?: KVNamespace;
  OPENAI_API_KEY: string;
}

export default {
  async queue(
    batch: MessageBatch<AnalysisQueueMessage>,
    env: Env
  ): Promise<void> {
    logger.info(`Processing analysis batch`, {
      batchSize: batch.messages.length,
    });

    // Create analysis configuration - focus on keywords for webhook efficiency
    const config: AnalysisConfig = {
      analyzers: {
        keyword: {
          enabled: true,
          priority: 1,
          timeout: 10000,
        },
        entity: {
          enabled: false, // Disabled - not needed for webhook keyword filtering
          priority: 2,
          timeout: 15000,
        },
        ai: {
          enabled: !!env.OPENAI_API_KEY,
          priority: 3,
          timeout: 30000,
          apiKey: env.OPENAI_API_KEY,
        },
      },
    };

    const orchestrator = new AnalysisOrchestrator(config);

    // Process messages and collect webhook messages
    const allWebhookMessages: any[] = [];
    
    for (const message of batch.messages) {
      try {
        const webhookMessages = await processAnalysisMessage(message, orchestrator, env);
        if (webhookMessages && webhookMessages.length > 0) {
          allWebhookMessages.push(...webhookMessages);
        }
        message.ack();
      } catch (error: any) {
        logger.error('Failed to process analysis message', error, {
          jobId: message.body.jobId,
        });
        
        // Retry logic
        if (message.attempts < 3) {
          message.retry();
        } else {
          logger.error('Max retries reached, moving to DLQ', {
            jobId: message.body.jobId,
          });
          message.ack(); // Acknowledge to remove from queue
        }
      }
    }
    
    // Send all webhook messages in batch
    if (allWebhookMessages.length > 0 && env.WEBHOOK_QUEUE && env.WEBHOOK_SUBSCRIPTIONS) {
      try {
        const { WebhookSenderService } = await import('./services/webhook-sender');
        const webhookSender = new WebhookSenderService(
          env.WEBHOOK_QUEUE,
          env.WEBHOOK_SUBSCRIPTIONS
        );
        
        await webhookSender.sendWebhookBatch(allWebhookMessages);
        
        logger.info(`Sent ${allWebhookMessages.length} webhook messages in batch`, {
          totalCount: allWebhookMessages.length,
        });
      } catch (error: any) {
        logger.error('Failed to send webhook batch', error);
      }
    }
  },
};

/**
 * Process a single analysis message and return webhook messages
 */
async function processAnalysisMessage(
  message: Message<AnalysisQueueMessage>,
  orchestrator: AnalysisOrchestrator,
  env: Env
): Promise<any[]> {
  const { jobId, ocrJobId, territoryId } = message.body;

  logger.info(`Processing analysis for job ${jobId}`, {
    jobId,
    ocrJobId,
    territoryId,
  });

  // Fetch OCR result from KV storage
  const ocrResultData = await env.OCR_RESULTS?.get(`ocr:${ocrJobId}`);
  if (!ocrResultData) {
    throw new Error(`OCR result not found in KV storage for job: ${ocrJobId}`);
  }

  const ocrResult = JSON.parse(ocrResultData);
  logger.info(`Retrieved OCR result from KV storage`, {
    jobId,
    ocrJobId,
    textLength: ocrResult.extractedText?.length || 0,
  });

  // Check if already analyzed
  const existingKey = `analysis:${ocrJobId}`;
  const existing = await env.ANALYSIS_RESULTS.get(existingKey);
  
  if (existing) {
    logger.info(`Analysis already exists for job ${ocrJobId}`, {
      jobId,
      ocrJobId,
    });
    return [];
  }

  // Perform analysis - pass territoryId from message since ocrResult doesn't have it
  const analysis = await orchestrator.analyze(ocrResult, territoryId);

  // Store results
  await storeAnalysisResults(analysis, env);

  // Send to webhooks if configured
  if (env.WEBHOOK_QUEUE && env.WEBHOOK_SUBSCRIPTIONS) {
    try {
      const { WebhookSenderService } = await import('./services/webhook-sender');
      const webhookSender = new WebhookSenderService(
        env.WEBHOOK_QUEUE,
        env.WEBHOOK_SUBSCRIPTIONS
      );
      
      const webhookMessages = await webhookSender.processAnalysisForWebhooks(analysis);
      
      if (webhookMessages.length > 0) {
        logger.info(`Prepared ${webhookMessages.length} webhook message(s)`, {
          jobId,
          messageCount: webhookMessages.length,
        });
      }
      
      return webhookMessages;
    } catch (error: any) {
      logger.error('Failed to prepare webhooks', error, {
        jobId,
      });
      // Don't fail the analysis if webhook preparation fails
      return [];
    }
  } else {
    // No webhook configuration
    return [];
  }

  logger.info(`Analysis completed and stored for job ${jobId}`, {
    jobId,
    ocrJobId,
    totalFindings: analysis.summary.totalFindings,
    categories: analysis.summary.categories,
  });
  
  return [];
}

/**
 * Store analysis results in KV
 */
async function storeAnalysisResults(
  analysis: GazetteAnalysis,
  env: Env
): Promise<void> {
  const key = `analysis:${analysis.ocrJobId}`;
  
  // Store full analysis
  await env.ANALYSIS_RESULTS.put(key, JSON.stringify(analysis), {
    metadata: {
      territoryId: analysis.territoryId,
      publicationDate: analysis.publicationDate,
      totalFindings: analysis.summary.totalFindings,
      categories: analysis.summary.categories,
    },
  });

  // Store index by territory and date for querying
  const indexKey = `index:${analysis.territoryId}:${analysis.publicationDate}`;
  await env.ANALYSIS_RESULTS.put(indexKey, analysis.jobId, {
    metadata: {
      totalFindings: analysis.summary.totalFindings,
    },
  });

  logger.info(`Stored analysis results`, {
    key,
    indexKey,
    jobId: analysis.jobId,
  });
}
