/**
 * Gazette scope - defines whether a gazette is city-specific or state-level
 */
export type GazetteScope = 'city' | 'state';

/**
 * Represents a gazette (official diary) publication
 */
export interface Gazette {
  /** Publication date in ISO format (YYYY-MM-DD) */
  date: string;
  
  /** Edition number or identifier */
  editionNumber?: string;
  
  /** Direct URL to the PDF file */
  fileUrl: string;
  
  /** Whether this is an extra/supplementary edition */
  isExtraEdition: boolean;
  
  /** Government power that published the gazette */
  power: GazettePower;
  
  /** IBGE territory code */
  territoryId: string;
  
  /** Timestamp when this gazette was scraped (ISO format) */
  scrapedAt: string;
  
  /** Source text or additional metadata */
  sourceText?: string;
}

export type GazettePower = 'executive' | 'legislative' | 'executive_legislative';

/**
 * Result of a spider crawl operation
 */
export interface CrawlResult {
  /** Spider identifier */
  spiderId: string;
  
  /** Territory IBGE code */
  territoryId: string;
  
  /** List of gazettes found */
  gazettes: Gazette[];
  
  /** Crawl statistics */
  stats: CrawlStats;
  
  /** Error information if crawl failed */
  error?: {
    message: string;
    code?: string;
    details?: any;
  };
}

export interface CrawlStats {
  /** Total number of gazettes found */
  totalFound: number;
  
  /** Date range that was crawled */
  dateRange: {
    start: string;
    end: string;
  };
  
  /** Number of HTTP requests made */
  requestCount?: number;
  
  /** Execution time in milliseconds */
  executionTimeMs?: number;
}

/**
 * Gazette registry status - tracks OCR processing lifecycle
 */
export type GazetteRegistryStatus = 
  | 'pending'           // Just created, not yet uploaded
  | 'uploaded'          // PDF uploaded to R2
  | 'ocr_processing'    // Currently being processed by OCR
  | 'ocr_retrying'      // OCR failed, retrying
  | 'ocr_failure'       // OCR permanently failed
  | 'ocr_success';      // OCR completed successfully

/**
 * Gazette crawl status - tracks individual crawl attempts
 * 
 * Flow: created/processing → analysis_pending → success
 *       └─ failed (if OCR fails)
 */
export type GazetteCrawlStatus = 
  | 'created'            // New gazette found, ready for OCR
  | 'processing'         // OCR is in progress (waiting)
  | 'analysis_pending'   // OCR complete, sent to analysis queue, awaiting processing
  | 'success'            // Analysis complete (final state)
  | 'failed';            // OCR failed or gazette has ocr_failure status (final state)

/**
 * Input for creating a gazette_crawl record
 */
export interface CreateGazetteCrawlInput {
  gazetteId: string;
  jobId: string;
  territoryId: string;
  spiderId: string;
  status: GazetteCrawlStatus;
  scrapedAt: string;
}

/**
 * Gazette crawl record from database
 */
export interface GazetteCrawlRecord {
  id: string;
  jobId: string;
  territoryId: string;
  spiderId: string;
  gazetteId: string;
  status: GazetteCrawlStatus;
  scrapedAt: string;
  createdAt: string;
}

/**
 * Extended gazette registry record with status
 */
export interface GazetteRegistryRecord {
  id: string;
  publicationDate: string;
  editionNumber: string | null;
  pdfUrl: string;
  pdfR2Key: string | null;
  isExtraEdition: boolean;
  power: string | null;
  createdAt: string;
  status: GazetteRegistryStatus;
  metadata: any;
}
