/**
 * Analysis Processor - Extracted from analysis-worker.ts
 * Processes analysis queue messages and sends results to webhook queue
 */

import { AnalysisQueueMessage, GazetteAnalysis, AnalysisConfig } from '../types';
import type { D1DatabaseEnv } from '../services/database';
import { AnalysisOrchestrator } from '../services/analysis-orchestrator';
import { logger } from '../utils';
import {
  getDatabase,
  TelemetryService,
  AnalysisRepository,
  ConcursoRepository,
  ErrorTracker,
  schema,
} from '../services/database';
import { sql, eq, and } from 'drizzle-orm';

export interface AnalysisProcessorEnv extends D1DatabaseEnv {
  ANALYSIS_RESULTS: KVNamespace;
  OCR_RESULTS?: KVNamespace;
  WEBHOOK_QUEUE?: Queue;
  WEBHOOK_SUBSCRIPTIONS?: KVNamespace;
  OPENAI_API_KEY: string;
}

/**
 * Process a batch of analysis queue messages
 */
export async function processAnalysisBatch(
  batch: MessageBatch<AnalysisQueueMessage>,
  env: AnalysisProcessorEnv
): Promise<void> {
  logger.info(`Analysis Processor: Processing batch of ${batch.messages.length} messages`);

  // Create analysis configuration
  const config: AnalysisConfig = {
    analyzers: {
      keyword: {
        enabled: true,
        priority: 1,
        timeout: 10000,
      },
      entity: {
        enabled: false,
        priority: 2,
        timeout: 15000,
      },
      concurso: {
        enabled: true,
        priority: 1.5,
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
  const databaseClient = getDatabase(env);
  const db = databaseClient.getDb();
  const telemetry = new TelemetryService(databaseClient);
  const analysisRepo = new AnalysisRepository(databaseClient);
  const concursoRepo = new ConcursoRepository(databaseClient);
  const errorTracker = new ErrorTracker(databaseClient);
  
  // Import and initialize deduplicator
  const { FindingDeduplicator } = await import('../services/finding-deduplicator');
  const deduplicator = new FindingDeduplicator(databaseClient);

  // Collect webhook messages
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
        deduplicator
      );
      
      if (webhookMessages && webhookMessages.length > 0) {
        allWebhookMessages.push(...webhookMessages);
      }

      const executionTimeMs = Date.now() - startTime;

      // Track analysis completion
      await telemetry.trackCityStep(
        crawlJobId,
        message.body.territoryId,
        message.body.spiderId || 'analysis',
        'analysis_end',
        'completed',
        undefined,
        executionTimeMs
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
      await telemetry.trackCityStep(
        crawlJobId,
        message.body.territoryId,
        message.body.spiderId || 'analysis',
        'analysis_end',
        'failed',
        undefined,
        executionTimeMs,
        errorMessage
      );

      await errorTracker.trackCriticalError(
        'goodfellow-analysis', 
        'analysis_processing', 
        error as Error, 
        {
          jobId: message.body.jobId,
          ocrJobId: message.body.ocrJobId,
          territoryId: message.body.territoryId,
          crawlJobId,
          executionTimeMs,
        }
      );

      // Retry logic
      if (message.attempts < 3) {
        message.retry();
      } else {
        logger.error('Max retries reached, moving to DLQ', new Error('Max retries reached'), {
          jobId: message.body.jobId,
          crawlJobId,
        });

        await errorTracker.trackCriticalError(
          'goodfellow-analysis',
          'max_retries_reached',
          new Error(`Max retries reached for analysis job ${message.body.jobId}`),
          {
            jobId: message.body.jobId,
            crawlJobId,
            attempts: message.attempts,
          }
        );

        message.ack();
      }
    }
  }

  // Send all webhook messages in batch
  if (allWebhookMessages.length > 0 && env.WEBHOOK_QUEUE && env.WEBHOOK_SUBSCRIPTIONS) {
    try {
      const { WebhookSenderService } = await import('../services/webhook-sender');
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
}

/**
 * Process a single analysis message
 */
async function processAnalysisMessage(
  message: Message<AnalysisQueueMessage>,
  orchestrator: AnalysisOrchestrator,
  env: AnalysisProcessorEnv,
  telemetry: TelemetryService,
  analysisRepo: AnalysisRepository,
  concursoRepo: ConcursoRepository,
  deduplicator: any
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
    'analysis',
    'analysis_start',
    'started'
  );

  // Check if already analyzed by OCR job ID to prevent duplicates
  const databaseClient = getDatabase(env);
  const db = databaseClient.getDb();
  const existingAnalysisByOcr = await db.select({
    id: schema.analysisResults.id,
    job_id: schema.analysisResults.jobId
  })
  .from(schema.analysisResults)
  .where(eq(schema.analysisResults.ocrJobId, ocrJobId))
  .limit(1);
  
  if (existingAnalysisByOcr.length > 0) {
    logger.info(`Analysis already exists for OCR job ${ocrJobId}, skipping duplicate`, {
      jobId,
      ocrJobId,
      existingAnalysisId: existingAnalysisByOcr[0].id,
      existingJobId: existingAnalysisByOcr[0].job_id,
      crawlJobId,
    });

    await telemetry.trackCityStep(
      crawlJobId,
      territoryId,
      'analysis',
      'analysis_end',
      'skipped'
    );

    return [];
  }

  // Also check by job ID for backwards compatibility
  const existingAnalysis = await analysisRepo.analysisExists(jobId);
  if (existingAnalysis) {
    logger.info(`Analysis already exists for job ${jobId}`, {
      jobId,
      ocrJobId,
      crawlJobId,
    });

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
    crawlJobId,
  });

  // Perform analysis
  let analysis = await orchestrator.analyze(ocrResult, territoryId);

  // Apply deduplication to findings
  try {
    const dedupeResult = await deduplicator.deduplicateFindings(analysis, 24);
    
    if (dedupeResult.duplicates.length > 0) {
      logger.info(`Deduplication removed ${dedupeResult.duplicates.length} duplicate findings`, {
        jobId: analysis.jobId,
        originalCount: analysis.summary.totalFindings,
        uniqueCount: dedupeResult.uniqueFindings.length,
        duplicatesRemoved: dedupeResult.duplicates.length,
        crawlJobId,
      });

      // Update analysis with deduplicated findings
      const uniqueFindingTypes = new Set(dedupeResult.uniqueFindings.map(f => f.type));
      analysis = {
        ...analysis,
        analyses: analysis.analyses.map(a => ({
          ...a,
          findings: a.findings.filter(f => 
            dedupeResult.uniqueFindings.some(uf => 
              uf.type === f.type && 
              uf.confidence === f.confidence &&
              JSON.stringify(uf.data) === JSON.stringify(f.data)
            )
          )
        })),
        summary: {
          ...analysis.summary,
          totalFindings: dedupeResult.uniqueFindings.length,
          deduplicationApplied: true,
          duplicatesRemoved: dedupeResult.duplicates.length,
        }
      };
    }
  } catch (error) {
    logger.error('Deduplication failed, continuing with original findings', error as Error, {
      jobId: analysis.jobId,
      crawlJobId,
    });
  }

  // Store results in database
  await analysisRepo.storeAnalysis(analysis);
  logger.info(`Analysis stored in database`, {
    jobId: analysis.jobId,
    totalFindings: analysis.summary.totalFindings,
    crawlJobId,
  });

  // Store concurso findings
  const concursoFindings = analysis.analyses
    .flatMap((a) => a.findings)
    .filter((f) => f.type === 'concurso');

  for (const finding of concursoFindings) {
    try {
      // Add territory ID to finding data before storing
      const findingWithTerritory = {
        ...finding,
        data: {
          ...finding.data,
          territoryId: analysis.territoryId
        }
      };
      await concursoRepo.storeConcursoFinding(findingWithTerritory as any, analysis.jobId);
      } catch (concursoError) {
        logger.error('Failed to store concurso finding', concursoError as Error, {
          jobId: analysis.jobId,
          crawlJobId,
        });
      }
  }

  // Store in KV for backwards compatibility
  await storeAnalysisResults(analysis, env);

  // Send to webhooks if configured
  if (env.WEBHOOK_QUEUE && env.WEBHOOK_SUBSCRIPTIONS) {
    try {
      const { WebhookSenderService } = await import('../services/webhook-sender');
      const webhookSender = new WebhookSenderService(
        env.WEBHOOK_QUEUE,
        env.WEBHOOK_SUBSCRIPTIONS
      );

      const webhookMessages = await webhookSender.processAnalysisForWebhooks(analysis, crawlJobId, territoryId);

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
      return [];
    }
  }

  return [];
}

/**
 * Store analysis results in KV
 */
async function storeAnalysisResults(
  analysis: GazetteAnalysis,
  env: AnalysisProcessorEnv
): Promise<void> {
  const key = `analysis:${analysis.ocrJobId}`;

  await env.ANALYSIS_RESULTS.put(key, JSON.stringify(analysis), {
    metadata: {
      territoryId: analysis.territoryId,
      publicationDate: analysis.publicationDate,
      totalFindings: analysis.summary.totalFindings,
      categories: analysis.summary.categories,
    },
  });

  // Store index by territory and date
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
