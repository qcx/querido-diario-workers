/**
 * Analysis Worker - Processes OCR results and performs analysis
 */

import { AnalysisQueueMessage, GazetteAnalysis, AnalysisConfig } from './types';
import { AnalysisOrchestrator } from './services/analysis-orchestrator';
import { logger } from './utils';

export interface Env {
  ANALYSIS_QUEUE: Queue<AnalysisQueueMessage>;
  ANALYSIS_RESULTS: KVNamespace;
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

    // Create analysis configuration
    const config: AnalysisConfig = {
      analyzers: {
        keyword: {
          enabled: true,
          priority: 1,
          timeout: 10000,
        },
        entity: {
          enabled: true,
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

    // Process messages
    for (const message of batch.messages) {
      try {
        await processAnalysisMessage(message, orchestrator, env);
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
  },
};

/**
 * Process a single analysis message
 */
async function processAnalysisMessage(
  message: Message<AnalysisQueueMessage>,
  orchestrator: AnalysisOrchestrator,
  env: Env
): Promise<void> {
  const { jobId, ocrResult } = message.body;

  logger.info(`Processing analysis for job ${jobId}`, {
    jobId,
    ocrJobId: ocrResult.jobId,
    territoryId: ocrResult.territoryId,
  });

  // Check if already analyzed
  const existingKey = `analysis:${ocrResult.jobId}`;
  const existing = await env.ANALYSIS_RESULTS.get(existingKey);
  
  if (existing) {
    logger.info(`Analysis already exists for job ${ocrResult.jobId}`, {
      jobId,
      ocrJobId: ocrResult.jobId,
    });
    return;
  }

  // Perform analysis
  const analysis = await orchestrator.analyze(ocrResult);

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
      
      const sentCount = await webhookSender.processAnalysis(analysis);
      
      if (sentCount > 0) {
        logger.info(`Sent analysis to ${sentCount} webhook(s)`, {
          jobId,
          sentCount,
        });
      }
    } catch (error: any) {
      logger.error('Failed to send webhooks', error, {
        jobId,
      });
      // Don't fail the analysis if webhook sending fails
    }
  }

  logger.info(`Analysis completed and stored for job ${jobId}`, {
    jobId,
    ocrJobId: ocrResult.jobId,
    totalFindings: analysis.summary.totalFindings,
    categories: analysis.summary.categories,
  });
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
