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
  GazetteRepository,
} from '../services/database';

/**
 * Generate a consistent KV cache key from PDF URL
 * Uses base64 encoding to create a URL-safe key
 */
function generateOcrCacheKey(pdfUrl: string): string {
  // Base64 encode the URL and make it URL-safe for KV
  const base64 = btoa(pdfUrl)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return `ocr:${base64}`;
}

/**
 * Generate analysis cache key based on deduplication logic
 * Uses territoryId + gazetteId + configHash (same as database deduplication)
 */
function generateAnalysisCacheKey(
  territoryId: string,
  gazetteId: string,
  configHash: string
): string {
  return `analysis:dedup:${territoryId}:${gazetteId}:${configHash}`;
}

/**
 * Generate deterministic jobId from deduplication key
 * Same inputs always produce the same jobId, enabling database-level deduplication
 */
function generateDeterministicJobId(
  territoryId: string,
  gazetteId: string,
  configHash: string
): string {
  const input = `${territoryId}:${gazetteId}:${configHash}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  
  // Simple hash (matches configHash generation style)
  const hash = Array.from(data)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .substring(0, 16); // 16 chars sufficient for uniqueness
  
  return `analysis-${hash}`;
}

/**
 * Reconstruct GazetteAnalysis from database record for caching
 */
function reconstructAnalysisFromRecord(
  record: any,
  ocrJobId: string
): GazetteAnalysis {
  return {
    jobId: record.jobId,
    ocrJobId: ocrJobId || record.jobId,
    territoryId: record.territoryId,
    publicationDate: record.publicationDate,
    analyzedAt: record.analyzedAt,
    
    // OCR data - reconstruct from metadata if available
    extractedText: '',
    textLength: record.metadata?.quality?.textLength || 0,
    pdfUrl: record.metadata?.sourceInfo?.pdfUrl,
    
    // Analysis results - simplified reconstruction
    analyses: [],
    
    // Aggregated findings
    summary: record.summary,
    
    // Metadata
    metadata: {
      spiderId: record.metadata?.sourceInfo?.spiderId || 'unknown',
      editionNumber: record.metadata?.sourceInfo?.editionNumber,
      power: record.metadata?.sourceInfo?.power,
      isExtraEdition: record.metadata?.sourceInfo?.isExtraEdition,
    }
  };
}

export interface AnalysisProcessorEnv extends D1DatabaseEnv {
  ANALYSIS_RESULTS: KVNamespace;
  OCR_RESULTS?: KVNamespace;
  WEBHOOK_QUEUE?: Queue;
  WEBHOOK_SUBSCRIPTIONS?: KVNamespace;
  OPENAI_API_KEY: string;
  R2_PUBLIC_URL?: string;
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
        deduplicator,
        config,
        databaseClient
      );
      
      if (webhookMessages && webhookMessages.length > 0) {
        allWebhookMessages.push(...webhookMessages);
      }

      const executionTimeMs = Date.now() - startTime;

      // Track analysis completion
      await telemetry.trackCityStep(
        crawlJobId,
        message.body.territoryId,
        message.body.metadata?.spiderId || 'unknown',
        'analysis_end',
        'completed',
        undefined,
        executionTimeMs,
        undefined,
        message.body.metadata?.spiderType
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
        message.body.metadata?.spiderId || 'unknown',
        'analysis_end',
        'failed',
        undefined,
        executionTimeMs,
        errorMessage,
        message.body.metadata?.spiderType
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
        logger.error('Max retries reached for analysis', new Error('Max retries'), {
          jobId: message.body.jobId,
          crawlJobId,
        });

        // Update gazette_crawl status to failed
        try {
          const { gazetteCrawlId } = message.body;
          if (gazetteCrawlId) {
            const gazetteRepo = new GazetteRepository(databaseClient);
            await gazetteRepo.updateGazetteCrawlStatus(gazetteCrawlId, 'failed');
          }
        } catch (statusError) {
          logger.error('Failed to update gazette crawl status', statusError as Error);
        }

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
      const { WebhookRepository, GazetteRepository } = await import('../services/database');
      const webhookRepo = new WebhookRepository(databaseClient);
      const gazetteRepo = new GazetteRepository(databaseClient);
      
      const webhookSender = new WebhookSenderService(
        env.WEBHOOK_QUEUE,
        env.WEBHOOK_SUBSCRIPTIONS,
        webhookRepo,
        env.R2_PUBLIC_URL,
        gazetteRepo
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
 * Helper function to process webhooks for an analysis
 */
async function processWebhooksForAnalysis(
  analysis: GazetteAnalysis,
  env: AnalysisProcessorEnv,
  crawlJobId: string,
  territoryId: string,
  telemetry: TelemetryService,
  jobId: string,
  databaseClient: ReturnType<typeof getDatabase>,
  gazetteId?: string
): Promise<any[]> {
  // Send to webhooks if configured
  if (env.WEBHOOK_QUEUE && env.WEBHOOK_SUBSCRIPTIONS) {
    try {
      const { WebhookSenderService } = await import('../services/webhook-sender');
      const { WebhookRepository, GazetteRepository } = await import('../services/database');
      const webhookRepo = new WebhookRepository(databaseClient);
      const gazetteRepo = new GazetteRepository(databaseClient);
      
      const webhookSender = new WebhookSenderService(
        env.WEBHOOK_QUEUE,
        env.WEBHOOK_SUBSCRIPTIONS,
        webhookRepo,
        env.R2_PUBLIC_URL,
        gazetteRepo
      );

      const webhookMessages = await webhookSender.processAnalysisForWebhooks(
        analysis, 
        crawlJobId, 
        territoryId,
        telemetry,
        gazetteId
      );

      if (webhookMessages.length > 0) {
        logger.info(`Prepared ${webhookMessages.length} webhook message(s)`, {
          jobId,
          messageCount: webhookMessages.length,
        });
        
        // Track webhook preparation success
        await telemetry.trackCityStep(
          crawlJobId,
          territoryId,
          'webhook',
          'webhook_sent',
          'started',
          webhookMessages.length,
          undefined,
          undefined,
          'unknown'
        );
      }

      return webhookMessages;
    } catch (error: any) {
      logger.error('Failed to prepare webhooks', error, {
        jobId,
      });
      
      // Track webhook preparation failure
      if (crawlJobId !== 'unknown') {
        await telemetry.trackCityStep(
          crawlJobId,
          territoryId,
          'webhook',
          'webhook_sent',
          'failed',
          undefined,
          undefined,
          `Webhook preparation error: ${error.message}`,
          'unknown'
        );
      }
      
      return [];
    }
  }

  return [];
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
  deduplicator: any,
  config: AnalysisConfig,
  databaseClient: ReturnType<typeof getDatabase>
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
    message.body.metadata?.spiderId || 'unknown',
    'analysis_start',
    'started',
    undefined,
    undefined,
    undefined,
    message.body.metadata?.spiderType
  );

  // Extract context from message
  const { gazetteCrawlId, gazetteId } = message.body;
  
  // Validate required fields
  if (!gazetteId) {
    throw new Error(`gazetteId missing in analysis message for job ${jobId}`);
  }
  if (!gazetteCrawlId) {
    logger.warn('gazetteCrawlId missing; will skip crawl status updates', { 
      jobId, 
      gazetteId, 
      crawlJobId 
    });
  }

  // Generate config signature for this analysis
  const configSignature = orchestrator.generateConfigSignature(config, territoryId);

  // Generate deterministic jobId for database-level deduplication
  // Same inputs (territoryId + gazetteId + configHash) always produce the same jobId
  const deterministicJobId = generateDeterministicJobId(
    territoryId, 
    gazetteId, 
    configSignature.configHash
  );

  // 1. Try KV cache first (fast path - no database query)
  const cacheKey = generateAnalysisCacheKey(territoryId, gazetteId, configSignature.configHash);
  const cachedAnalysis = await env.ANALYSIS_RESULTS.get(cacheKey);

  if (cachedAnalysis) {
    const analysis = JSON.parse(cachedAnalysis) as GazetteAnalysis;
    logger.info('Cache hit: Reusing cached analysis', {
      jobId,
      ocrJobId,
      gazetteCrawlId,
      gazetteId,
      cacheKey,
      configHash: configSignature.configHash,
      territoryId,
      crawlJobId,
      totalFindings: analysis.summary.totalFindings,
    });

    // Link to gazette_crawl and update status (if crawl ID present)
    const gazetteRepo = new GazetteRepository(databaseClient);
    if (gazetteCrawlId) {
      // Need to get analysisId from database for linking
      const existingAnalysisId = await analysisRepo.findExistingAnalysis(
        territoryId,
        gazetteId,
        configSignature.configHash
      );
      
      if (existingAnalysisId) {
        await gazetteRepo.linkAnalysisToGazetteCrawl(gazetteCrawlId, existingAnalysisId);
        await gazetteRepo.updateGazetteCrawlStatus(gazetteCrawlId, 'success');
      }
    } else {
      logger.warn('Skipping crawl link/status update: missing gazetteCrawlId', { 
        jobId, 
        gazetteId, 
        cacheKey 
      });
    }

    // Process webhooks for cached analysis
    const webhookMessages = await processWebhooksForAnalysis(
      analysis,
      env,
      crawlJobId,
      territoryId,
      telemetry,
      jobId,
      databaseClient,
      gazetteId
    );

    await telemetry.trackCityStep(
      crawlJobId,
      territoryId,
      message.body.metadata?.spiderId || 'unknown',
      'analysis_end',
      'completed',
      undefined,
      undefined,
      undefined,
      message.body.metadata?.spiderType
    );

    return webhookMessages;
  }

  // 2. Cache miss - check database
  // NOTE: This is now a performance optimization to avoid re-running analysis.
  // Primary deduplication is enforced by deterministic jobId + database unique constraint.
  const existingAnalysisId = await analysisRepo.findExistingAnalysis(
    territoryId,
    gazetteId,
    configSignature.configHash
  );

  if (existingAnalysisId) {
    logger.info('Database hit: Found existing analysis, populating cache', {
      jobId,
      ocrJobId,
      gazetteCrawlId,
      gazetteId,
      existingAnalysisId,
      configHash: configSignature.configHash,
      territoryId,
      crawlJobId,
    });

    // 3. Fetch full analysis from database and populate cache
    const dbAnalysis = await analysisRepo.getAnalysisById(existingAnalysisId);
    
    let reconstructedAnalysis: GazetteAnalysis | null = null;
    
    if (dbAnalysis) {
      // Reconstruct GazetteAnalysis and store in cache
      reconstructedAnalysis = reconstructAnalysisFromRecord(dbAnalysis, ocrJobId);
      
      await env.ANALYSIS_RESULTS.put(
        cacheKey,
        JSON.stringify(reconstructedAnalysis),
        {
          expirationTtl: 24 * 60 * 60, // 24 hours
          metadata: {
            territoryId: reconstructedAnalysis.territoryId,
            publicationDate: reconstructedAnalysis.publicationDate,
            totalFindings: reconstructedAnalysis.summary.totalFindings,
            cachedAt: new Date().toISOString(),
          },
        }
      );
      
      logger.info('Populated KV cache from database', {
        cacheKey,
        analysisId: existingAnalysisId,
        expiresIn: '24h',
      });
    }

    // Link existing analysis to this gazette_crawl (if crawl ID present)
    const gazetteRepo = new GazetteRepository(databaseClient);
    if (gazetteCrawlId) {
      await gazetteRepo.linkAnalysisToGazetteCrawl(gazetteCrawlId, existingAnalysisId);
      
      // Update status to success (analysis reused)
      await gazetteRepo.updateGazetteCrawlStatus(gazetteCrawlId, 'success');
    } else {
      logger.warn('Skipping crawl link/status update: missing gazetteCrawlId', { 
        jobId, 
        gazetteId, 
        existingAnalysisId 
      });
    }

    // Process webhooks for database-cached analysis
    let webhookMessages: any[] = [];
    if (reconstructedAnalysis) {
      webhookMessages = await processWebhooksForAnalysis(
        reconstructedAnalysis,
        env,
        crawlJobId,
        territoryId,
        telemetry,
        jobId,
        databaseClient,
        gazetteId
      );
    }

    await telemetry.trackCityStep(
      crawlJobId,
      territoryId,
      message.body.metadata?.spiderId || 'unknown',
      'analysis_end',
      'completed',
      undefined,
      undefined,
      undefined,
      message.body.metadata?.spiderType
    );

    return webhookMessages;
  }

  // 4. No cache, no database - proceed with new analysis

  // Try to fetch OCR result: KV cache first, DB fallback, with cache repopulation
  const gazetteRepo = new GazetteRepository(databaseClient);
  let ocrResult = null;

  // STEP 1: Try KV cache (hot path)
  if (env.OCR_RESULTS && message.body.pdfUrl) {
    const cacheKey = generateOcrCacheKey(message.body.pdfUrl);
    const ocrResultData = await env.OCR_RESULTS.get(cacheKey);
    if (ocrResultData) {
      ocrResult = JSON.parse(ocrResultData);
      logger.info(`Retrieved OCR result from KV cache`, {
        jobId,
        ocrJobId,
        cacheKey,
        pdfUrl: message.body.pdfUrl,
        textLength: ocrResult.extractedText?.length || 0,
        crawlJobId,
      });
    }
  }

  // STEP 2: Fallback to database if cache miss
  if (!ocrResult && gazetteId) {
    logger.info('KV cache miss, falling back to database', {
      jobId,
      ocrJobId,
      gazetteId,
      crawlJobId,
    });

    const { OcrRepository } = await import('../services/database');
    const ocrRepo = new OcrRepository(databaseClient);
    const existingOcr = await ocrRepo.getOcrResultByGazetteId(gazetteId);
    
    if (existingOcr) {
      ocrResult = {
        jobId: ocrJobId,
        status: 'success',
        extractedText: existingOcr.extractedText,
        pdfUrl: message.body.pdfUrl || '',
        territoryId: message.body.territoryId,
        publicationDate: message.body.gazetteDate,
        editionNumber: undefined,
        spiderId: message.body.metadata?.spiderId,
        processingTimeMs: (existingOcr.metadata?.processingTimeMs as number) || undefined,
        completedAt: existingOcr.createdAt,
        metadata: message.body.metadata,
      };
      
      // STEP 3: Repopulate cache (cache-aside pattern)
      if (env.OCR_RESULTS && message.body.pdfUrl) {
        const cacheKey = generateOcrCacheKey(message.body.pdfUrl);
        await env.OCR_RESULTS.put(
          cacheKey,
          JSON.stringify(ocrResult),
          { expirationTtl: 86400 }
        );
        logger.info('Repopulated KV cache from database', {
          jobId,
          cacheKey,
          gazetteId,
          crawlJobId,
        });
      }
    }
  }

  // If still not found, throw descriptive error
  if (!ocrResult) {
    throw new Error(
      `OCR result not found in cache or database. PDF: ${message.body.pdfUrl}, gazetteId: ${gazetteId}`
    );
  }

  // Perform analysis with deterministic jobId
  // This enables database-level deduplication via the unique constraint on job_id
  let analysis = await orchestrator.analyze(ocrResult, territoryId, deterministicJobId);

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
      analysis = {
        ...analysis,
        analyses: analysis.analyses.map(a => ({
          ...a,
          findings: a.findings.filter((f: any) => 
            dedupeResult.uniqueFindings.some((uf: any) => 
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
  const analysisId = await analysisRepo.storeAnalysis(analysis, gazetteId, configSignature);
  
  // Link analysis to gazette_crawl and update status (if crawl ID present)
  if (gazetteCrawlId) {
    await gazetteRepo.linkAnalysisToGazetteCrawl(gazetteCrawlId, analysisId);
    
    // Update status to success (analysis complete)
    await gazetteRepo.updateGazetteCrawlStatus(gazetteCrawlId, 'success');
  } else {
    logger.warn('Analysis stored but no gazetteCrawlId to link/status', { 
      jobId: analysis.jobId, 
      analysisId, 
      gazetteId 
    });
  }
  
  logger.info('Analysis stored and linked to gazette crawl', {
    jobId: analysis.jobId,
    analysisId,
    gazetteCrawlId,
    gazetteId,
    configHash: configSignature.configHash,
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

  // Store in KV cache with deduplication key
  await storeAnalysisResults(analysis, env, gazetteId, configSignature.configHash);

  // Process webhooks for new analysis
  return await processWebhooksForAnalysis(
    analysis,
    env,
    crawlJobId,
    territoryId,
    telemetry,
    jobId,
    databaseClient,
    gazetteId
  );
}

/**
 * Store analysis results in KV cache with deduplication key
 */
async function storeAnalysisResults(
  analysis: GazetteAnalysis,
  env: AnalysisProcessorEnv,
  gazetteId: string,
  configHash: string
): Promise<void> {
  const cacheKey = generateAnalysisCacheKey(
    analysis.territoryId,
    gazetteId,
    configHash
  );

  await env.ANALYSIS_RESULTS.put(cacheKey, JSON.stringify(analysis), {
    expirationTtl: 24 * 60 * 60, // 24 hours
    metadata: {
      territoryId: analysis.territoryId,
      publicationDate: analysis.publicationDate,
      totalFindings: analysis.summary.totalFindings,
      cachedAt: new Date().toISOString(),
    },
  });

  logger.info('Stored analysis in KV cache', {
    cacheKey,
    jobId: analysis.jobId,
    expiresIn: '24h',
  });
}
