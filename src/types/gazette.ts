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
