/**
 * Mistral OCR Service - Pure API client
 * Handles only Mistral API interaction, no R2/DB/caching
 */

export interface MistralServiceEnv extends Env {}

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

/**
 * Result from Mistral OCR processing
 */
export interface MistralOcrResult {
  extractedText: string;
  pagesProcessed: number;
}

// =============================================================================
// MISTRAL OCR API TYPES (Based on official Mistral OCR API documentation)
// =============================================================================

/**
 * Mistral OCR API response structure
 */
export interface MistralOcrResponse {
  /** Array of processed pages */
  pages: MistralPage[];
  /** Model used for processing */
  model: string;
  /** Optional document-level annotation */
  document_annotation?: string;
  /** Usage information */
  usage_info: MistralUsageInfo;
}

/**
 * Individual page in Mistral OCR response
 */
export interface MistralPage {
  /** Page index (0-based) */
  index: number;
  /** Extracted text in markdown format */
  markdown: string;
  /** Images found on this page */
  images: MistralImage[];
  /** Page dimensions */
  dimensions: MistralDimensions;
}

/**
 * Image extracted from a page
 */
export interface MistralImage {
  /** Unique image identifier */
  id: string;
  /** Top-left x coordinate */
  top_left_x: number;
  /** Top-left y coordinate */
  top_left_y: number;
  /** Bottom-right x coordinate */
  bottom_right_x: number;
  /** Bottom-right y coordinate */
  bottom_right_y: number;
  /** Base64-encoded image data (optional) */
  image_base64?: string;
  /** Image annotation (optional) */
  image_annotation?: string;
}

/**
 * Page dimensions information
 */
export interface MistralDimensions {
  /** Dots per inch */
  dpi: number;
  /** Page height in pixels */
  height: number;
  /** Page width in pixels */
  width: number;
}

/**
 * Usage information from Mistral OCR
 */
export interface MistralUsageInfo {
  /** Number of pages processed */
  pages_processed: number;
  /** Document size in bytes */
  doc_size_bytes: number;
}

/**
 * Mistral page processing result (for backward compatibility)
 */
export interface MistralPageResult {
  /** Page number */
  page?: number;
  /** Extracted markdown content */
  markdown: string;
  /** Confidence score for this page */
  confidence?: number;
  /** Processing metadata */
  metadata?: {
    word_count?: number;
    has_images?: boolean;
    processing_time_ms?: number;
  };
}

/**
 * Error response from Mistral API
 */
export interface MistralErrorResponse {
  /** Error object */
  error: {
    /** Error message */
    message: string;
    /** Error type */
    type: string;
    /** Error code */
    code?: string;
    /** HTTP status code */
    status?: number;
  };
  /** Request ID for debugging */
  request_id?: string;
}

/**
 * Type guard for Mistral OCR response
 */
export function isMistralOcrResponse(obj: unknown): obj is MistralOcrResponse {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'pages' in obj &&
    Array.isArray((obj as any).pages) &&
    'model' in obj &&
    typeof (obj as any).model === 'string' &&
    'usage_info' in obj &&
    typeof (obj as any).usage_info === 'object'
  );
}

/**
 * Pure Mistral API client - only handles OCR API calls
 */
export class MistralService {
  private config: MistralOcrConfig;
  private env: MistralServiceEnv;

  constructor(config: MistralOcrConfig, env: MistralServiceEnv) {
    this.env = env;
    this.config = {
      endpoint: 'https://api.mistral.ai/v1/ocr',
      model: 'mistral-ocr-latest',
      maxPages: 1000,
      timeout: 120000,
      ...config
    };
  }

  /**
   * Process a PDF using Mistral OCR API
   * @param pdfUrl - URL of the PDF to process
   * @returns Extracted text and pages processed
   * @throws Error if OCR fails
   */
  async processPdfUrl(pdfUrl: string, resultCacheKey?: string): Promise<MistralOcrResult> {
    const payload = {
      model: this.config.model,
      document: {
        type: 'document_url',
        document_url: pdfUrl
      },
      include_image_base64: false
    };

    const response = await fetch(this.config.endpoint!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.config.timeout!),
    });

    const result: MistralOcrResponse = await response.json();
    
    // Extract markdown from all pages and concatenate
    const extractedText = result.pages
      .map((page: MistralPage) => page.markdown || '')
      .filter((text: string) => text.length > 0)
      .join('\n\n---\n\n');

    if(resultCacheKey) {
      await this.env.OCR_RESULTS.put(resultCacheKey, JSON.stringify({
        extractedText,
        pagesProcessed: result.pages.length
      }), {
        expirationTtl: 86400 // 24 hours
      });
    }

    return {
      extractedText, 
      pagesProcessed: result.pages.length 
    };
  }

  /**
   * Process a PDF using Mistral OCR API with base64 data
   * @param pdfBase64 - Base64-encoded PDF data
   * @returns Extracted text and pages processed
   * @throws Error if OCR fails
   */
  async processPdfBase64(pdfBase64: string): Promise<MistralOcrResult> {
    const payload = {
      model: this.config.model,
      document: {
        type: 'document_base64',
        document_base64: pdfBase64
      },
      include_image_base64: false
    };

    const response = await fetch(this.config.endpoint!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.config.timeout!),
    });

    const result: MistralOcrResponse = await response.json();
    
    // Extract markdown from all pages and concatenate
    const extractedText = result.pages
      .map((page: MistralPage) => page.markdown || '')
      .filter((text: string) => text.length > 0)
      .join('\n\n---\n\n');

    return { 
      extractedText, 
      pagesProcessed: result.pages.length 
    };
  }
}
