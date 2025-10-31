/**
 * OCR Queue Handler - V2 Architecture
 * Orchestrates OCR workflow with callback pattern for analysis queue
 */

import { DatabaseClient, getDatabase, schema, GazetteRegistryRepository, OcrResultsRepository } from '../db';
import { MistralService } from './services/mistral-service';
import { StorageService } from './services/storage-service';
import { CacheService } from './services/cache-service';
import type { CachedOcrResult } from './services/cache-service';
import { spiderRegistry } from '../crawl/spiders';

const RETRY_DELAY = 5;
const DB_OPERATION_MAX_RETRIES = 3;
const DB_OPERATION_RETRY_BASE_DELAY_MS = 1000;

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelayMs: number,
  operationName: string
): Promise<{ success: boolean; result?: T; error?: Error }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      return { success: true, result };
    } catch (error) {
      if (attempt === maxRetries) {
        return { success: false, error: error as Error };
      }
      
      // Exponential backoff: 1s, 2s, 4s...
      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return { success: false, error: new Error('Max retries exceeded') };
}

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

export interface OcrQueueHandlerEnv extends Env {}

import type { AnalysisQueueMessage } from '../analysis/types';

// OCR callback is now just an AnalysisQueueMessage
type OcrCallbackMessage = AnalysisQueueMessage;

/**
 * OCR Queue Handler
 * Follows the same pattern as CrawlQueueHandler with callback-based architecture
 */
export class OcrQueueHandler {
  private databaseClient!: DatabaseClient;
  private gazetteRegistryRepository!: GazetteRegistryRepository;
  private ocrResultsRepository!: OcrResultsRepository;
  private mistralService!: MistralService;
  private storageService!: StorageService;
  private cacheService!: CacheService;

  constructor(private env: OcrQueueHandlerEnv) {
    this.databaseClient = getDatabase(this.env);
    this.env = env;

    this.gazetteRegistryRepository = new GazetteRegistryRepository(this.databaseClient);
    this.ocrResultsRepository = new OcrResultsRepository(this.databaseClient);
    
    this.mistralService = new MistralService({
      apiKey: this.env.MISTRAL_API_KEY,
    }, this.env);
    
    this.storageService = new StorageService({
      GAZETTE_PDFS: this.env.GAZETTE_PDFS,
      R2_PUBLIC_URL: this.env.R2_PUBLIC_URL,
    });
    
    this.cacheService = new CacheService(
      {
        OCR_RESULTS: this.env.OCR_RESULTS,
        defaultTtl: 86400 // 24 hours
      },
      this.ocrResultsRepository
    );
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
    const ocrMessage = message.body;
    const { gazette: initialGazette, gazetteCrawl, crawlJobId, jobId } = ocrMessage;

    let gazette = await this.checkGazetteStatus(initialGazette, true);

    if(!gazette) {
      message.retry({
        delaySeconds: RETRY_DELAY
      });
      return;
    }

    if(gazette.status === 'ocr_success') {
      // Get OCR result from database for callback
      const ocrResultRecord = await this.ocrResultsRepository.findByGazetteId(gazette.id);
      if (ocrResultRecord) {
        await this.handleGazetteCrawlSuccess(gazette, gazetteCrawl, ocrResultRecord, analysisCallback, jobId, crawlJobId);
      }
      message.ack();
      return;
    }

    // Check if already being processed
    if(gazette.status === 'ocr_processing' || gazette.status === 'ocr_retrying') {
      message.retry({ delaySeconds: RETRY_DELAY });
      return;
    }

    // Handle retry case
    if(gazette.status === 'ocr_failure') {
      gazette = await this.gazetteRegistryRepository.updateGazetteStatus(gazette.id, 'ocr_retrying');
    }

    // ATOMIC CLAIM - Do this FIRST before expensive operations
    gazette = await this.gazetteRegistryRepository.startProcessing(gazette.id);

    if(!gazette) {
      // Failed to claim - another worker got it or status changed
      // Re-check current status
      const currentGazette = await this.gazetteRegistryRepository.findById(initialGazette.id);
      
      if(currentGazette.status === 'ocr_success') {
        // Completed by another worker - use cached result
        const existingResult = await this.cacheService.getOcrResult(
          currentGazette.pdfUrl,
          currentGazette.id,
          jobId
        );
        
        if(existingResult) {
          // Get OCR result record
          const ocrResultRecord = await this.ocrResultsRepository.findByGazetteId(currentGazette.id);
          if (ocrResultRecord) {
            await this.handleExistingOcrResult(existingResult, gazetteCrawl, analysisCallback, jobId, crawlJobId, currentGazette, ocrResultRecord);
          }
          message.ack();
          return;
        }
      }
      
      // Still processing or other state - retry
      message.retry({ delaySeconds: RETRY_DELAY });
      return;
    }

    // Successfully claimed - now do R2 upload
    let pdfUrlForOcr = gazette.pdfUrl;
    const { r2Key: pdfR2Key, pdf: _pdfObject } = await this.storageService.getPdf(gazette.pdfUrl);
    const publicUrl = this.storageService.getPublicUrl(pdfR2Key);

    if (publicUrl) {
      pdfUrlForOcr = publicUrl;
    }

    // Store R2 key in gazette
    if(pdfR2Key) {
      await this.gazetteRegistryRepository.updateR2Key(gazette.id, pdfR2Key);
    }

    // Check cache one more time (in case another process completed during R2 upload)
    const existingResult = await this.cacheService.getOcrResult(
      gazette.pdfUrl,
      gazette.id,
      jobId
    );

    if (existingResult) {
      // Get OCR result record
      const ocrResultRecord = await this.ocrResultsRepository.findByGazetteId(gazette.id);
      if (ocrResultRecord) {
        await this.handleExistingOcrResult(existingResult, gazetteCrawl, analysisCallback, jobId, crawlJobId, gazette, ocrResultRecord);
      }
      message.ack();
      return;
    }

    // Create OCR job record
    const startTime = Date.now();
    await this.ocrResultsRepository.startProcessing(gazette.id, {
      crawlJobId,
      gazetteCrawlId: gazetteCrawl.id,
      territoryId: gazetteCrawl.territoryId,
      gazetteDate: gazette.publicationDate,
      pdfUrl: gazette.pdfUrl,
      processingMethod: 'mistral',
      isRetry: gazette.status === 'ocr_retrying'
    });

    try {
      const mistralResult = await this.mistralService.processPdfUrl(pdfUrlForOcr);
  
      if(mistralResult.extractedText && mistralResult.extractedText.trim().length > 0) {
        const processingTimeMs = Date.now() - startTime;
        await this.saveOcrResult(
          mistralResult,
          gazette,
          gazetteCrawl,
          analysisCallback,
          jobId,
          pdfR2Key,
          processingTimeMs,
          crawlJobId
        );
        message.ack();
        return;
      } else {
        // No text extracted - treat as failure
        const processingTimeMs = Date.now() - startTime;
        
        await this.ocrResultsRepository.updateOcrJobFailure(
          gazette.id,
          'NO_TEXT_EXTRACTED',
          'OCR completed but extracted text is empty',
          processingTimeMs
        );
        
        await this.gazetteRegistryRepository.updateGazetteStatus(gazette.id, 'ocr_failure');
        await this.gazetteRegistryRepository.updateCrawlsStatus(gazetteCrawl.id, 'failed');
        
        message.retry({ delaySeconds: RETRY_DELAY });
        return;
      }
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Update OCR job to failure
      await this.ocrResultsRepository.updateOcrJobFailure(
        gazette.id,
        'OCR_PROCESSING_ERROR',
        errorMessage,
        processingTimeMs
      );
      
      // Update gazette and crawl statuses
      await this.gazetteRegistryRepository.updateGazetteStatus(gazette.id, 'ocr_failure');
      await this.gazetteRegistryRepository.updateCrawlsStatus(gazetteCrawl.id, 'failed');
      
      // Retry message - don't throw
      message.retry({ delaySeconds: RETRY_DELAY });
      return;
    }
  }

  private async handleGazetteCrawlSuccess(
    gazette: typeof schema.gazetteRegistry.$inferSelect,
    gazetteCrawl: typeof schema.gazetteCrawls.$inferSelect,
    ocrResult: typeof schema.ocrResults.$inferSelect,
    analysisCallback: (message: OcrCallbackMessage) => Promise<void>,
    jobId: string,
    crawlJobId: string
  ): Promise<void> {
    // Get cached OCR result
    const cachedResult = await this.cacheService.getOcrResult(
      gazette.pdfUrl,
      gazette.id,
      jobId
    );
    
    if(!cachedResult) {
      return;
    }
    
    // Reuse the existing handler - same logic applies
    await this.handleExistingOcrResult(cachedResult, gazetteCrawl, analysisCallback, jobId, crawlJobId, gazette, ocrResult);
  }

  private async handleExistingOcrResult(
    cachedResult: CachedOcrResult,
    gazetteCrawl: typeof schema.gazetteCrawls.$inferSelect,
    analysisCallback: (message: OcrCallbackMessage) => Promise<void>,
    jobId: string,
    crawlJobId: string,
    gazette: typeof schema.gazetteRegistry.$inferSelect,
    ocrResult: typeof schema.ocrResults.$inferSelect
  ): Promise<void> {
    // ALWAYS ensure OCR result exists in database, even if it's only in cache
    const dbResult = await retryWithBackoff(
      () => this.ocrResultsRepository.createOrUpdate(
        gazetteCrawl.gazetteId,
        {
          extractedText: cachedResult.extractedText,
          pagesProcessed: cachedResult.pagesProcessed ?? 0,
          processingTimeMs: cachedResult.processingTimeMs ?? 0,
          pdfR2Key: cachedResult.pdfR2Key
        }
      ),
      DB_OPERATION_MAX_RETRIES,
      DB_OPERATION_RETRY_BASE_DELAY_MS,
      'OCR result storage from cache'
    );

    if(!dbResult.success) {
      throw dbResult.error;
    }

    // Ensure OCR job record exists
    const existingJob = await this.ocrResultsRepository.findByGazetteId(gazetteCrawl.gazetteId);
    if (!existingJob) {
      await this.ocrResultsRepository.startProcessing(gazetteCrawl.gazetteId, {
        crawlJobId,
        gazetteCrawlId: gazetteCrawl.id,
        territoryId: cachedResult.territoryId,
        gazetteDate: cachedResult.gazetteDate,
        pdfUrl: cachedResult.pdfUrl,
        processingMethod: 'mistral',
        isRetry: false
      });
      
      // Update OCR job to success
      await this.ocrResultsRepository.updateOcrJobSuccess(
        gazetteCrawl.gazetteId,
        cachedResult.pagesProcessed ?? 0,
        cachedResult.processingTimeMs ?? 0,
        cachedResult.extractedText.length
      );
    }
    
    // Update gazette status to ocr_success if not already
    await this.gazetteRegistryRepository.updateGazetteStatus(
      gazetteCrawl.gazetteId,
      'ocr_success'
    );
    
    // Update crawl status to analysis_pending
    await this.gazetteRegistryRepository.updateCrawlsStatus(
      gazetteCrawl.id,
      'analysis_pending'
    );
    
    // Get spider config
    const spiderConfig = spiderRegistry.getConfig(gazetteCrawl.spiderId);
    if (!spiderConfig) {
      throw new Error(`Spider config not found for ${gazetteCrawl.spiderId}`);
    }
    
    // Send to analysis queue
    await analysisCallback({
      jobId: `analysis-${jobId}`,
      gazetteCrawl,
      gazette,
      ocrResult,
      spiderConfig,
      crawlJobId,
      queuedAt: new Date().toISOString()
    });
  }

  private async checkGazetteStatus(gazette: typeof schema.gazetteRegistry.$inferSelect, forceSync: boolean): Promise<typeof schema.gazetteRegistry.$inferSelect> {
    let currentGazette = gazette;

    if (currentGazette.status === 'ocr_success') {
      return currentGazette;
    }

    if (forceSync) {
      const syncedGazette = await this.gazetteRegistryRepository.findById(gazette.id);

      return await this.checkGazetteStatus(syncedGazette, false);
    }

    return gazette;
  }

  private async saveOcrResult(
    ocrResult: { extractedText: string; pagesProcessed: number },
    gazette: typeof schema.gazetteRegistry.$inferSelect,
    gazetteCrawl: typeof schema.gazetteCrawls.$inferSelect,
    analysisCallback: (message: OcrCallbackMessage) => Promise<void>,
    jobId: string,
    pdfR2Key: string | undefined,
    processingTimeMs: number,
    crawlJobId: string
  ): Promise<void> {
    // Store in database with retry
    const dbResult = await retryWithBackoff(
      () => this.ocrResultsRepository.createOrUpdate(
        gazette.id,
        {
          extractedText: ocrResult.extractedText,
          pagesProcessed: ocrResult.pagesProcessed,
          processingTimeMs,
          pdfR2Key
        }
      ),
      DB_OPERATION_MAX_RETRIES,
      DB_OPERATION_RETRY_BASE_DELAY_MS,
      'OCR result storage'
    );

    if(!dbResult.success) {
      throw dbResult.error;
    }
    
    // Store in KV cache
    const cachedResult: CachedOcrResult = {
      jobId,
      status: 'success',
      extractedText: ocrResult.extractedText,
      pdfUrl: gazette.pdfUrl,
      pdfR2Key,
      territoryId: gazetteCrawl.territoryId,
      gazetteDate: gazette.publicationDate,
      editionNumber: gazette.editionNumber || undefined,
      spiderId: gazetteCrawl.spiderId,
      pagesProcessed: ocrResult.pagesProcessed,
      processingTimeMs,
      completedAt: new Date().toISOString()
    };
    
    await this.cacheService.setOcrResult(gazette.pdfUrl, cachedResult);
    
    // Update OCR job to success
    await this.ocrResultsRepository.updateOcrJobSuccess(
      gazette.id,
      ocrResult.pagesProcessed,
      processingTimeMs,
      ocrResult.extractedText.length
    );
    
    // Update gazette status to ocr_success
    await this.gazetteRegistryRepository.updateGazetteStatus(
      gazette.id,
      'ocr_success'
    );
    
    // Update crawl status to analysis_pending
    await this.gazetteRegistryRepository.updateCrawlsStatus(
      gazetteCrawl.id,
      'analysis_pending'
    );
    
    // Get OCR result record we just created
    const ocrResultRecord = await this.ocrResultsRepository.findByGazetteId(gazette.id);
    if (!ocrResultRecord) {
      throw new Error('OCR result not found after creation');
    }
    
    // Get spider config
    const spiderConfig = spiderRegistry.getConfig(gazetteCrawl.spiderId);
    if (!spiderConfig) {
      throw new Error(`Spider config not found for ${gazetteCrawl.spiderId}`);
    }
    
    // Send to analysis queue
    await analysisCallback({
      jobId: `analysis-${jobId}`,
      gazetteCrawl,
      gazette,
      ocrResult: ocrResultRecord,
      spiderConfig,
      crawlJobId,
      queuedAt: new Date().toISOString()
    });
  }
}
