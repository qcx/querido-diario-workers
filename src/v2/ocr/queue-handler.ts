/**
 * OCR Queue Handler - V2 Architecture
 * Orchestrates OCR workflow with callback pattern for analysis queue
 */

import { DatabaseClient, getDatabase, schema, GazetteRegistryRepository, OcrResultsRepository } from '../db';
import { MistralService } from './services/mistral-service';
import { StorageService } from './services/storage-service';
import { CacheService } from './services/cache-service';

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
    });
    
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
    const { gazette, gazetteCrawl, crawlJobId, jobId } = ocrMessage;

    switch (gazette.status) {
      case 'ocr_success':
        await this.handleGazetteCrawlSuccess();
        break;
    }

    let pdfUrlForOcr = gazette.pdfUrl;

    // Get PDF and public URL from storage
    const { r2Key: pdfR2Key, pdf: _pdfObject } = await this.storageService.getPdf(gazette.pdfUrl);
    const publicUrl = this.storageService.getPublicUrl(pdfR2Key);

    if (publicUrl) {
      pdfUrlForOcr = publicUrl;
    }

    const existingResult = await this.cacheService.getOcrResult(
      gazette.pdfUrl,
      gazette.id,
      jobId
    );

    if (existingResult) {
      await this.handleExistingOcrResult();
      return;
    }

    throw new Error('Not implemented');

    // const mistralResult = await this.mistralService.processPdfUrl(pdfUrlForOcr);
  }

  async handleGazetteCrawlSuccess(): Promise<void> {
  }

  async handleExistingOcrResult(): Promise<void> {
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
}
