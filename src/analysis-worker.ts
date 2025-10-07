/**
 * Analysis Worker - Processes OCR results and performs analysis
 */

import { AnalysisQueueMessage, GazetteAnalysis, AnalysisConfig } from './types';
import { AnalysisOrchestrator } from './services/analysis-orchestrator';
import { logger } from './utils';
import { 
  getDatabase, 
  TelemetryService, 
  AnalysisRepository,
  ConcursoRepository,
  ErrorTracker,
  DatabaseEnv 
} from './services/database';

export interface Env extends DatabaseEnv {
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
        concurso: {
          enabled: true,
          priority: 1.5, // High priority for concurso detection
          timeout: 20000,
          useAIExtraction: !!env.OPENAI_API_KEY,
          apiKey: env.OPENAI_API_KEY,
          model: 'gpt-4o-mini',
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

    // Initialize database services
    const db = getDatabase(env);
    const telemetry = new TelemetryService(db);
    const analysisRepo = new AnalysisRepository(db);
    const concursoRepo = new ConcursoRepository(db);
    const errorTracker = new ErrorTracker(db);

    // Process messages and collect webhook messages
    const allWebhookMessages: any[] = [];
    
    for (const message of batch.messages) {
      const startTime = Date.now();
      const crawlJobId = message.body.metadata?.crawlJobId || 'unknown';
      
      try {
        const webhookMessages = await processAnalysisMessage(
          message, 
          orchestrator, 
          env,
          telemetry,
          analysisRepo,
          concursoRepo,
          errorTracker
        );
        if (webhookMessages && webhookMessages.length > 0) {
          allWebhookMessages.push(...webhookMessages);
        }

        const executionTimeMs = Date.now() - startTime;
        
        // Track analysis completion
        await telemetry.trackCityStep(
          crawlJobId,
          message.body.territoryId,
          'analysis',
          'analysis',
          'analysis_end',
          'completed',
          {
            executionTimeMs,
          }
        );
        
        message.ack();
      } catch (error: any) {
        const executionTimeMs = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        logger.error('Failed to process analysis message', error, {
          jobId: message.body.jobId,
          crawlJobId,
        });

        // Track analysis failure
        try {
          await telemetry.trackCityStep(
            crawlJobId,
            message.body.territoryId,
            'analysis',
            'analysis',
            'analysis_end',
            'failed',
            {
              executionTimeMs,
              errorMessage,
            }
          );
        } catch (telemetryError) {
          logger.error('Failed to track analysis failure', telemetryError as Error, { 
            crawlJobId 
          });
        }

        // Track the critical error that stopped analysis
        await errorTracker.trackCriticalError(
          'analysis-worker',
          'analysis_processing',
          error as Error,
          {
            jobId: message.body.jobId,
            ocrJobId: message.body.ocrJobId,
            territoryId: message.body.territoryId,
            crawlJobId,
            executionTimeMs
          }
        ).catch(() => {});
        
        // Retry logic
        if (message.attempts < 3) {
          message.retry();
        } else {
          logger.error('Max retries reached, moving to DLQ', new Error('Max retries reached'), {
            jobId: message.body.jobId,
            crawlJobId,
          });

          // Track max retries as critical error
          await errorTracker.trackCriticalError(
            'analysis-worker',
            'max_retries_reached',
            new Error(`Max retries reached for analysis job ${message.body.jobId}`),
            {
              jobId: message.body.jobId,
              crawlJobId,
              attempts: message.attempts
            }
          ).catch(() => {});
          
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
 * Process a single analysis message with database integration
 */
async function processAnalysisMessage(
  message: Message<AnalysisQueueMessage>,
  orchestrator: AnalysisOrchestrator,
  env: Env,
  telemetry: TelemetryService,
  analysisRepo: AnalysisRepository,
  concursoRepo: ConcursoRepository,
  errorTracker?: ErrorTracker
): Promise<any[]> {
  const { jobId, ocrJobId, territoryId } = message.body;
  const crawlJobId = message.body.metadata?.crawlJobId || 'unknown';

  logger.info(`Processing analysis for job ${jobId}`, {
    jobId,
    ocrJobId,
    territoryId,
    crawlJobId,
  });

  // Track analysis start
  await telemetry.trackCityStep(
    crawlJobId,
    territoryId,
    'analysis', // use generic spider ID for analysis
    'analysis',
    'analysis_start',
    'started'
  );

  // Check if already analyzed in database
  const existingAnalysis = await analysisRepo.analysisExists(jobId);
  if (existingAnalysis) {
    logger.info(`Analysis already exists for job ${jobId}`, {
      jobId,
      ocrJobId,
      crawlJobId,
    });
    
    // Track completion for existing analysis
    await telemetry.trackCityStep(
      crawlJobId,
      territoryId,
      'analysis',
      'analysis',
      'analysis_end',
      'skipped'
    );
    
    return [];
  }

  // Fetch OCR result from KV storage (fast cache)
  const ocrResultData = await env.OCR_RESULTS?.get(`ocr:${ocrJobId}`);
  if (!ocrResultData) {
    throw new Error(`OCR result not found in KV storage for job: ${ocrJobId}`);
  }

  const ocrResult = JSON.parse(ocrResultData);
  logger.info(`Retrieved OCR result from KV storage`, {
    jobId,
    ocrJobId,
    textLength: ocrResult.extractedText?.length || 0,
    crawlJobId,
  });

  // Perform analysis - pass territoryId from message since ocrResult doesn't have it
  const analysis = await orchestrator.analyze(ocrResult, territoryId);

  // Store results in database (permanent storage)
  await analysisRepo.storeAnalysis(analysis);
  logger.info(`Analysis stored in database`, {
    jobId: analysis.jobId,
    totalFindings: analysis.summary.totalFindings,
    crawlJobId,
  });

  // Store concurso findings in specialized table
  const concursoFindings = analysis.analyses
    .flatMap(a => a.findings)
    .filter(f => f.type === 'concurso');
    
  for (const finding of concursoFindings) {
    try {
      await concursoRepo.storeConcursoFinding(finding as any, analysis.jobId);
    } catch (concursoError) {
      logger.error('Failed to store concurso finding', {
        jobId: analysis.jobId,
        error: concursoError,
        crawlJobId,
      });
    }
  }

  // Also store in KV for backwards compatibility (cache)
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
