/**
 * V2 Analysis Module - Type Definitions
 * Defines interfaces for analysis queue messages and related types
 */

import { schema } from '../db';
import { SpiderConfig } from '../crawl/spiders';

/**
 * Message sent to analysis queue from OCR handler
 * Contains references to database entities instead of full data
 */
export interface AnalysisQueueMessage {
  /** Unique job identifier for this analysis */
  jobId: string;
  
  /** Reference to gazette crawl record */
  gazetteCrawl: typeof schema.gazetteCrawls.$inferSelect;
  
  /** Reference to gazette registry record */
  gazette: typeof schema.gazetteRegistry.$inferSelect;
  
  /** Reference to OCR result record */
  ocrResult: typeof schema.ocrResults.$inferSelect;
  
  /** Full spider configuration for scope detection and city filtering */
  spiderConfig: SpiderConfig;
  
  /** Original crawl job ID for tracking */
  crawlJobId: string;
  
  /** Timestamp when message was queued */
  queuedAt: string;
}

/**
 * Callback message sent to webhook queue after analysis completes
 */
export interface AnalysisCallbackMessage {
  /** Analysis result ID from database */
  analysisResultId: string;
  
  /** Gazette crawl ID for linking */
  gazetteCrawlId: string;
  
  /** Territory ID this analysis is for */
  territoryId: string;
  
  /** Total number of findings */
  findingsCount: number;
  
  /** Categories identified in analysis */
  categories: string[];
  
  /** High confidence findings count */
  highConfidenceFindings: number;
  
  /** Keywords found */
  keywords: string[];
  
  /** Analysis job ID */
  jobId: string;
  
  /** Gazette ID */
  gazetteId: string;
  
  /** Publication date */
  publicationDate: string;
  
  /** Analysis completion timestamp */
  analyzedAt: string;
}

/**
 * Territory information for state-level gazette splitting
 */
export interface TerritoryInfo {
  /** IBGE territory code */
  territoryId: string;
  
  /** City name */
  cityName: string;
  
  /** Regex pattern for matching city in text */
  cityRegex?: string;
}

/**
 * Analysis configuration for a specific run
 */
export interface AnalysisRunConfig {
  /** Whether this is a state-level analysis that needs splitting */
  isStateLevelAnalysis: boolean;
  
  /** Territory filter information if applicable */
  territoryFilter?: {
    cityName: string;
    cityRegex: string;
    territoryId: string;
  };
  
  /** Source spider ID */
  spiderId: string;
  
  /** Gazette scope from spider config */
  gazetteScope: 'city' | 'state';
}

/**
 * Result of a single territory analysis (for state-level splitting)
 */
export interface TerritoryAnalysisResult {
  /** Territory this analysis is for */
  territoryId: string;
  
  /** Analysis result ID from database */
  analysisResultId: string;
  
  /** Number of findings for this territory */
  findingsCount: number;
  
  /** Length of filtered text analyzed */
  filteredTextLength: number;
  
  /** Whether any content was found for this territory */
  hasContent: boolean;
}

/**
 * Metadata stored with analysis results
 */
export interface AnalysisMetadata {
  /** Whether this analysis was filtered from a state-level gazette */
  isStateLevelAnalysis?: boolean;
  
  /** Territory filter information if applicable */
  territoryFilter?: {
    cityName: string;
    cityRegex: string;
    filteredTextLength: number;
    originalTextLength: number;
  };
  
  /** Source spider identifier */
  sourceSpider: string;
  
  /** Gazette scope */
  gazetteScope: 'city' | 'state';
  
  /** Spider type */
  spiderType?: string;
  
  /** Power (executive, legislative, etc.) */
  power?: string;
  
  /** Edition number if available */
  editionNumber?: string;
  
  /** Whether this is an extra edition */
  isExtraEdition?: boolean;
  
  /** Processing time in milliseconds */
  processingTimeMs?: number;
  
  /** Config signature for deduplication */
  configSignature?: {
    version: string;
    enabledAnalyzers: string[];
    customKeywords?: string[];
    configHash: string;
  };
}

/**
 * Cache key components for analysis deduplication
 */
export interface AnalysisCacheKey {
  territoryId: string;
  gazetteId: string;
  configHash: string;
  cityFilter?: string; // For state-level analyses
}

/**
 * Analysis handler environment interface
 */
export interface AnalysisQueueHandlerEnv {
  // Database
  DB: D1Database;
  
  // KV Namespaces
  ANALYSIS_RESULTS: KVNamespace;
  OCR_RESULTS: KVNamespace;
  
  // Queues
  WEBHOOK_QUEUE?: Queue;
  
  // API Keys
  OPENAI_API_KEY?: string;
  
  // URLs
  R2_PUBLIC_URL?: string;
}
