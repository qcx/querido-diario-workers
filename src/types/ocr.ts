/**
 * Types for OCR processing system
 */

/**
 * Message sent to OCR queue for processing
 */
export interface OcrQueueMessage {
  /** Unique identifier for this OCR job */
  jobId: string;
  
  /** URL of the PDF to process */
  pdfUrl: string;
  
  /** IBGE territory code */
  territoryId: string;
  
  /** Publication date (YYYY-MM-DD) */
  publicationDate: string;
  
  /** Edition number if available */
  editionNumber?: string;
  
  /** Spider that found this gazette */
  spiderId: string;
  
  /** Timestamp when this was queued */
  queuedAt: string;
  
  /** Additional metadata */
  metadata?: {
    power?: string;
    isExtraEdition?: boolean;
    sourceText?: string;
    crawlJobId?: string;
  };
}

/**
 * Result of OCR processing
 */
export interface OcrResult {
  /** Job identifier */
  jobId: string;
  
  /** Status of the OCR job */
  status: 'success' | 'failure' | 'partial';
  
  /** Extracted text from the PDF */
  extractedText?: string;
  
  /** Original PDF URL */
  pdfUrl: string;
  
  /** IBGE territory code */
  territoryId: string;
  
  /** Publication date (YYYY-MM-DD) */
  publicationDate: string;
  
  /** Edition number if available */
  editionNumber?: string;
  
  /** Spider that found this gazette */
  spiderId: string;
  
  /** Number of pages processed */
  pagesProcessed?: number;
  
  /** Processing time in milliseconds */
  processingTimeMs?: number;
  
  /** OCR confidence score */
  confidence?: number;
  
  /** Detected language */
  language?: string;
  
  /** Error information if processing failed */
  error?: {
    message: string;
    code?: string;
    details?: any;
  };
  
  /** Timestamp when processing completed */
  completedAt: string;
  
  /** Additional metadata */
  metadata?: {
    power?: string;
    isExtraEdition?: boolean;
    sourceText?: string;
    crawlJobId?: string;
  };
}

/**
 * Configuration for Mistral OCR API
 */
export interface MistralOcrConfig {
  /** Mistral API key */
  apiKey: string;
  
  /** API endpoint */
  endpoint?: string;
  
  /** Model to use for OCR */
  model?: string;
  
  /** Maximum pages to process per request */
  maxPages?: number;
  
  /** Timeout in milliseconds */
  timeout?: number;
}
