/**
 * OCR Queue Handler - V2 Architecture
 * Orchestrates OCR workflow with callback pattern for analysis queue
 */

import { DatabaseClient, getDatabase, schema, GazetteRegistryRepository, CrawlJobsRepository } from '../db';
import { DrizzleD1Database } from 'drizzle-orm/d1';
import { MistralService, MistralOcrConfig } from './mistral-service';
import { eq, and, sql } from 'drizzle-orm';

/**
 * Message sent to OCR queue for processing
 */
export interface OcrQueueMessage {
  jobId: string;
  gazetteCrawl: typeof schema.gazetteCrawls.$inferSelect;
  gazette: typeof schema.gazetteRegistry.$inferSelect;
  crawlJobId: string;
  queuedAt: string;
}

/**
 * Internal OCR result structure
 */
interface OcrResult {
  extractedText: string;
  pagesProcessed: number;
  pdfR2Key?: string;
  processingTimeMs: number;
}

export interface OcrQueueHandlerEnv {
  DB: D1Database;
  MISTRAL_API_KEY: string;
  GAZETTE_PDFS?: R2Bucket;
  R2_PUBLIC_URL?: string;
  OCR_RESULTS?: KVNamespace;
}

interface OcrCallbackMessage {
  jobId: string;
  ocrJobId: string; // Reference to OCR result in KV storage
  gazetteCrawlId: string; // Which crawl triggered this
  gazetteId: string; // Which gazette to analyze
  territoryId: string;
  gazetteDate: string;
  pdfUrl?: string;
  analyzers?: string[]; // Specific analyzers to run, or all if undefined
  queuedAt: string;
  metadata?: {
    crawlJobId?: string;
    spiderId?: string;
    spiderType?: string;
    configSignature?:  {
      version: string;              // Config version (e.g., "1.0.0")
      enabledAnalyzers: string[];   // Which analyzers are enabled (sorted)
      customKeywords?: string[];    // Territory-specific keywords (sorted)
      configHash: string;           // Hash for quick comparison
    };
    [key: string]: any;
  };
}

/**
 * OCR Queue Handler
 * Follows the same pattern as CrawlQueueHandler with callback-based architecture
 */
export class OcrQueueHandler {
  private databaseClient!: DatabaseClient;
  private db!: DrizzleD1Database<typeof schema>;
  private gazetteRegistryRepository!: GazetteRegistryRepository;
  private crawlJobsRepository!: CrawlJobsRepository;
  private mistralService!: MistralService;
  private r2Bucket?: R2Bucket;
  private r2PublicUrl?: string;
  private kvCache?: KVNamespace;

  constructor(private env: OcrQueueHandlerEnv) {
    this.databaseClient = getDatabase(this.env);
    this.db = this.databaseClient.getDb();
    this.gazetteRegistryRepository = new GazetteRegistryRepository(this.databaseClient);
    this.crawlJobsRepository = new CrawlJobsRepository(this.databaseClient);
    
    // Initialize Mistral service
    const mistralConfig: MistralOcrConfig = {
      apiKey: this.env.MISTRAL_API_KEY,
    };
    this.mistralService = new MistralService(mistralConfig);
    
    this.r2Bucket = this.env.GAZETTE_PDFS;
    this.r2PublicUrl = this.env.R2_PUBLIC_URL;
    this.kvCache = this.env.OCR_RESULTS;
  }

  /**
   * Process a batch of OCR messages with callback for analysis queue
   */
  async batchHandler(
    batch: MessageBatch<OcrQueueMessage>,
    analysisCallback: (message: OcrCallbackMessage) => Promise<void>
  ): Promise<void> {
    
    for (const message of batch.messages) {
      await this.handle(message, analysisCallback);
    }
  }

  /**
   * Handle a single OCR message
   */
  private async handle(
    message: Message<OcrQueueMessage>,
    analysisCallback: (message: OcrCallbackMessage) => Promise<void>
  ): Promise<void> {
    const startTime = Date.now();
    const ocrMessage = message.body;
    const { gazette, gazetteCrawl, crawlJobId, jobId } = ocrMessage;

    try {
      // STEP 1: Check gazette status and determine action
      if (gazette.status === 'ocr_success') {
        // Already processed - check for cached result
        const cachedResult = await this.getCachedOcrResult(gazette.pdfUrl, gazette.id);
        
        if (cachedResult) {
          // Check if R2 key is missing and retry upload
          if (!gazette.pdfR2Key && this.r2Bucket) {
            await this.tryR2Upload(gazette.pdfUrl, gazette.id, jobId);
          }

          // Update crawl status and send to analysis
          await this.gazetteRegistryRepository.updateCrawlsStatus(gazetteCrawl.id, 'analysis_pending');
          await this.sendToAnalysis(ocrMessage, analysisCallback);
          message.ack();
          return;
        }
      } else if (gazette.status === 'ocr_processing' || gazette.status === 'ocr_retrying') {

        message.retry();
        return;
      } else if (gazette.status === 'ocr_failure') {

        await this.updateGazetteStatus(gazette.id, 'ocr_retrying');
      } else {
        // Status is pending or uploaded - try to claim for processing
        const claimed = await this.claimGazetteForProcessing(gazette.id);
        if (!claimed) {

          message.retry();
          return;
        }
      }

      // STEP 2: Check KV cache for existing OCR result
      const cachedResult = await this.getCachedOcrResult(gazette.pdfUrl, gazette.id);
      if (cachedResult) {
        
        // Store in database and update status
        await this.storeOcrResult(gazette.id, cachedResult);
        await this.updateGazetteStatus(gazette.id, 'ocr_success');
        await this.gazetteRegistryRepository.updateCrawlsStatus(gazetteCrawl.id, 'analysis_pending');
        
        // Track completion
        const executionTimeMs = Date.now() - startTime;
        await this.crawlJobsRepository.trackProgress({
          crawlJobId,
          territoryId: gazetteCrawl.territoryId,
          spiderId: gazetteCrawl.spiderId,
          spiderType: 'unknown',
          step: 'ocr_end',
          status: 'completed',
          executionTimeMs
        });
        
        await this.sendToAnalysis(ocrMessage, analysisCallback);
        message.ack();
        return;
      }

      // STEP 3: Try R2 upload (best effort - don't fail OCR if this fails)
      let pdfUrlForOcr = gazette.pdfUrl;
      let pdfR2Key: string | undefined;
      
      if (this.r2Bucket) {
        const uploadResult = await this.uploadToR2(gazette.pdfUrl, jobId);
        if (uploadResult.r2Key) {
          pdfR2Key = uploadResult.r2Key;
          
          // Use R2 URL if not localhost
          const isLocalR2 = this.r2PublicUrl?.includes('localhost') || this.r2PublicUrl?.includes('127.0.0.1');
          if (!isLocalR2 && this.r2PublicUrl) {
            pdfUrlForOcr = `${this.r2PublicUrl}/${uploadResult.r2Key}`;
          }
        } else if (uploadResult.error) {
          // Log R2 failure but continue with original URL
          await this.logError('r2_upload', 'warning', uploadResult.error.message, {
            jobId,
            gazetteId: gazette.id,
            pdfUrl: gazette.pdfUrl
          });
        }
      }

      // STEP 4: Call Mistral OCR API
      logger.info('Calling Mistral OCR API', {
        jobId,
        gazetteId: gazette.id,
        pdfUrl: pdfUrlForOcr
      });

      const mistralResult = await this.mistralService.processPdf(pdfUrlForOcr, jobId);
      
      const ocrResult: OcrResult = {
        extractedText: mistralResult.extractedText,
        pagesProcessed: mistralResult.pagesProcessed,
        pdfR2Key,
        processingTimeMs: Date.now() - startTime
      };

      // STEP 5: Store result in database
      await this.storeOcrResult(gazette.id, ocrResult);

      // STEP 6: Store in KV cache
      if (this.kvCache) {
        await this.cacheOcrResult(gazette.pdfUrl, ocrResult);
      }

      // STEP 7: Update gazette status to success
      await this.updateGazetteStatus(gazette.id, 'ocr_success', pdfR2Key);

      // STEP 8: Update crawl status
      await this.gazetteRegistryRepository.updateCrawlsStatus(gazetteCrawl.id, 'analysis_pending');

      // Track OCR completion
      const executionTimeMs = Date.now() - startTime;
      await this.crawlJobsRepository.trackProgress({
        crawlJobId,
        territoryId: gazetteCrawl.territoryId,
        spiderId: gazetteCrawl.spiderId,
        spiderType: 'unknown',
        step: 'ocr_end',
        status: 'completed',
        executionTimeMs
      });

      logger.info(`OCR processing completed successfully`, {
        jobId,
        gazetteId: gazette.id,
        textLength: ocrResult.extractedText.length,
        pagesProcessed: ocrResult.pagesProcessed,
        executionTimeMs
      });

      // STEP 9: Send to analysis queue via callback
      await this.sendToAnalysis(ocrMessage, analysisCallback);

      // Acknowledge message
      message.ack();

    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.error('OCR processing failed', error, {
        jobId,
        gazetteId: gazette.id,
        crawlJobId,
        executionTimeMs
      });

      // Update gazette to failed status
      await this.updateGazetteStatus(gazette.id, 'ocr_failure');
      await this.gazetteRegistryRepository.updateCrawlsStatus(gazetteCrawl.id, 'failed');

      // Track failure
      await this.crawlJobsRepository.trackProgress({
        crawlJobId,
        territoryId: gazetteCrawl.territoryId,
        spiderId: gazetteCrawl.spiderId,
        spiderType: 'unknown',
        step: 'ocr_end',
        status: 'failed',
        executionTimeMs,
        errorMessage
      });

      // Log error to database
      await this.logError('ocr_processing', 'critical', errorMessage, {
        jobId,
        gazetteId: gazette.id,
        pdfUrl: gazette.pdfUrl,
        crawlJobId,
        executionTimeMs,
        stack: error instanceof Error ? error.stack : undefined
      });

      // Retry message
      message.retry();
    }
  }

  /**
   * Generate KV cache key from PDF URL
   */
  private generateCacheKey(pdfUrl: string): string {
    const base64 = btoa(pdfUrl)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    return `ocr:${base64}`;
  }

  /**
   * Generate R2 key from PDF URL
   */
  private generateR2Key(pdfUrl: string): string {
    const base64 = btoa(pdfUrl)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    return `pdfs/${base64}.pdf`;
  }

  /**
   * Get cached OCR result from KV or database
   */
  private async getCachedOcrResult(pdfUrl: string, gazetteId: string): Promise<OcrResult | null> {
    // Try KV cache first
    if (this.kvCache) {
      const cacheKey = this.generateCacheKey(pdfUrl);
      const cachedData = await this.kvCache.get(cacheKey);
      if (cachedData) {
        const cached = JSON.parse(cachedData);
        logger.info('OCR result retrieved from KV cache', {
          cacheKey,
          pdfUrl
        });
        return cached;
      }
    }

    // Fallback to database
    const existingOcr = await this.db.select()
      .from(schema.ocrResults)
      .where(and(
        eq(schema.ocrResults.documentType, 'gazette_registry'),
        eq(schema.ocrResults.documentId, gazetteId)
      ))
      .limit(1);

    if (existingOcr.length > 0) {
      const ocrRecord = existingOcr[0];
      logger.info('OCR result retrieved from database', {
        gazetteId
      });

      const result: OcrResult = {
        extractedText: ocrRecord.extractedText,
        pagesProcessed: 0, // Not stored in DB
        processingTimeMs: 0 // Not stored in DB
      };

      // Repopulate cache
      if (this.kvCache) {
        await this.cacheOcrResult(pdfUrl, result);
      }

      return result;
    }

    return null;
  }

  /**
   * Cache OCR result in KV
   */
  private async cacheOcrResult(pdfUrl: string, result: OcrResult): Promise<void> {
    if (!this.kvCache) return;

    const cacheKey = this.generateCacheKey(pdfUrl);
    await this.kvCache.put(
      cacheKey,
      JSON.stringify(result),
      { expirationTtl: 86400 } // 24 hours
    );
    logger.info('Stored OCR result in KV cache', {
      cacheKey,
      pdfUrl
    });
  }

  /**
   * Upload PDF to R2 bucket
   */
  private async uploadToR2(pdfUrl: string, jobId: string): Promise<{
    r2Key?: string;
    error?: Error;
  }> {
    if (!this.r2Bucket) {
      return {};
    }

    try {
      const r2Key = this.generateR2Key(pdfUrl);

      // Check if already exists
      const existing = await this.r2Bucket.head(r2Key);
      if (existing) {
        logger.info('PDF already exists in R2', {
          jobId,
          r2Key,
          pdfUrl
        });
        return { r2Key };
      }

      // Download PDF
      const response = await fetch(pdfUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:108.0) Gecko/20100101 Firefox/108.0',
          'Accept': 'application/pdf,*/*',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to download PDF: ${response.status}`);
      }

      const pdfData = await response.arrayBuffer();

      // Upload to R2
      await this.r2Bucket.put(r2Key, pdfData, {
        httpMetadata: {
          contentType: 'application/pdf',
        },
      });

      logger.info('Successfully uploaded PDF to R2', {
        jobId,
        r2Key,
        sizeBytes: pdfData.byteLength,
        pdfUrl
      });

      return { r2Key };
    } catch (error) {
      logger.error('Failed to upload to R2', error, {
        jobId,
        pdfUrl
      });
      return { error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  /**
   * Try R2 upload for gazette missing R2 key
   */
  private async tryR2Upload(pdfUrl: string, gazetteId: string, jobId: string): Promise<void> {
    logger.info('Cached OCR result found but missing R2 key, attempting upload', {
      gazetteId,
      jobId,
      pdfUrl
    });

    const uploadResult = await this.uploadToR2(pdfUrl, jobId);

    if (uploadResult.r2Key) {
      await this.updateGazetteR2Key(gazetteId, uploadResult.r2Key);
      logger.info('R2 upload succeeded during recrawl', {
        gazetteId,
        r2Key: uploadResult.r2Key
      });
    } else if (uploadResult.error) {
      await this.logError('r2_upload_retry', 'warning', uploadResult.error.message, {
        gazetteId,
        jobId,
        pdfUrl,
        stage: 'recrawl_r2_upload_retry'
      });
    }
  }

  /**
   * Store OCR result in database
   */
  private async storeOcrResult(gazetteId: string, result: OcrResult): Promise<void> {
    // Check if OCR result already exists
    const existing = await this.db.select({ id: schema.ocrResults.id })
      .from(schema.ocrResults)
      .where(and(
        eq(schema.ocrResults.documentType, 'gazette_registry'),
        eq(schema.ocrResults.documentId, gazetteId)
      ))
      .limit(1);

    if (existing.length > 0) {
      // Update existing
      await this.db.update(schema.ocrResults)
        .set({
          extractedText: result.extractedText,
          textLength: result.extractedText.length,
          processingMethod: 'mistral',
          metadata: this.databaseClient.stringifyJson({
            pagesProcessed: result.pagesProcessed,
            processingTimeMs: result.processingTimeMs
          })
        })
        .where(eq(schema.ocrResults.id, existing[0].id));

      logger.info('Updated existing OCR result', {
        gazetteId,
        textLength: result.extractedText.length
      });
    } else {
      // Insert new
      await this.db.insert(schema.ocrResults).values({
        id: this.databaseClient.generateId(),
        documentType: 'gazette_registry',
        documentId: gazetteId,
        extractedText: result.extractedText,
        textLength: result.extractedText.length,
        confidenceScore: null,
        languageDetected: 'pt',
        processingMethod: 'mistral',
        createdAt: this.databaseClient.getCurrentTimestamp(),
        metadata: this.databaseClient.stringifyJson({
          pagesProcessed: result.pagesProcessed,
          processingTimeMs: result.processingTimeMs
        })
      });

      logger.info('Stored new OCR result', {
        gazetteId,
        textLength: result.extractedText.length
      });
    }
  }

  /**
   * Atomically claim gazette for processing
   */
  private async claimGazetteForProcessing(gazetteId: string): Promise<boolean> {
    const result = await this.db.update(schema.gazetteRegistry)
      .set({ status: 'ocr_processing' })
      .where(and(
        eq(schema.gazetteRegistry.id, gazetteId),
        sql`status NOT IN ('ocr_processing', 'ocr_retrying', 'ocr_success')`
      ))
      .returning({ id: schema.gazetteRegistry.id });

    return result.length > 0;
  }

  /**
   * Update gazette status
   */
  private async updateGazetteStatus(
    gazetteId: string,
    status: 'pending' | 'uploaded' | 'ocr_processing' | 'ocr_retrying' | 'ocr_failure' | 'ocr_success',
    pdfR2Key?: string
  ): Promise<void> {
    const updates: any = { status };
    if (pdfR2Key) {
      updates.pdfR2Key = pdfR2Key;
    }

    await this.db.update(schema.gazetteRegistry)
      .set(updates)
      .where(eq(schema.gazetteRegistry.id, gazetteId));

    logger.info('Updated gazette status', {
      gazetteId,
      status,
      pdfR2Key
    });
  }

  /**
   * Update gazette R2 key
   */
  private async updateGazetteR2Key(gazetteId: string, pdfR2Key: string): Promise<void> {
    await this.db.update(schema.gazetteRegistry)
      .set({ pdfR2Key })
      .where(eq(schema.gazetteRegistry.id, gazetteId));

    logger.info('Updated gazette R2 key', {
      gazetteId,
      pdfR2Key
    });
  }

  /**
   * Log error to database
   */
  private async logError(
    operationType: string,
    severity: 'warning' | 'error' | 'critical',
    errorMessage: string,
    context: Record<string, any>
  ): Promise<void> {
    try {
      await this.db.insert(schema.errorLogs).values({
        id: this.databaseClient.generateId(),
        workerName: 'v2-ocr-handler',
        operationType,
        severity,
        errorMessage,
        stackTrace: context.stack || null,
        context: this.databaseClient.stringifyJson(context),
        jobId: context.crawlJobId || null,
        territoryId: context.territoryId || null
      });
    } catch (error) {
      logger.error('Failed to log error to database', error);
    }
  }

  /**
   * Send OCR result to analysis queue via callback
   */
  private async sendToAnalysis(
    ocrMessage: OcrQueueMessage,
    analysisCallback: (message: AnalysisQueueMessage) => Promise<void>
  ): Promise<void> {
    const analysisMsg: AnalysisQueueMessage = {
      jobId: `analysis-${ocrMessage.jobId}`,
      ocrJobId: ocrMessage.jobId,
      gazetteCrawlId: ocrMessage.gazetteCrawl.id,
      gazetteId: ocrMessage.gazette.id,
      territoryId: ocrMessage.gazetteCrawl.territoryId,
      gazetteDate: ocrMessage.gazette.publicationDate,
      pdfUrl: ocrMessage.gazette.pdfUrl,
      queuedAt: new Date().toISOString(),
      metadata: {
        crawlJobId: ocrMessage.crawlJobId,
        spiderId: ocrMessage.gazetteCrawl.spiderId,
      }
    };

    await analysisCallback(analysisMsg);

    logger.info('Sent OCR result to analysis queue', {
      jobId: ocrMessage.jobId,
      gazetteId: ocrMessage.gazette.id,
      gazetteCrawlId: ocrMessage.gazetteCrawl.id
    });
  }
}
