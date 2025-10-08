/**
 * Type definitions for external API responses
 * Replaces 'any' types with structured interfaces
 */

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

// =============================================================================
// AI ANALYSIS API TYPES
// =============================================================================

/**
 * Generic AI model response structure
 */
export interface AIModelResponse {
  /** Response ID */
  id?: string;
  /** Model identifier */
  model: string;
  /** Response choices */
  choices: AIResponseChoice[];
  /** Token usage */
  usage?: TokenUsage;
  /** Response metadata */
  metadata?: {
    processing_time?: number;
    confidence?: number;
    model_version?: string;
  };
}

/**
 * Individual choice in AI response
 */
export interface AIResponseChoice {
  /** Choice index */
  index: number;
  /** Response message */
  message: AIResponseMessage;
  /** Reason for completion */
  finish_reason?: 'stop' | 'length' | 'content_filter' | 'null';
}

/**
 * AI response message structure
 */
export interface AIResponseMessage {
  /** Message role */
  role: 'assistant' | 'user' | 'system';
  /** Message content */
  content: string;
  /** Function call if applicable */
  function_call?: {
    name: string;
    arguments: string;
  };
}

/**
 * Token usage for AI models
 */
export interface TokenUsage {
  /** Input tokens */
  prompt_tokens: number;
  /** Output tokens */
  completion_tokens: number;
  /** Total tokens */
  total_tokens: number;
  /** Cost estimation */
  estimated_cost?: number;
}

/**
 * Structured AI analysis result
 */
export interface AIAnalysisResult {
  /** Analysis success status */
  success: boolean;
  /** Extracted findings */
  findings: {
    /** Finding type */
    type: string;
    /** Content/data */
    content: string;
    /** Confidence score (0-1) */
    confidence: number;
    /** Context/location */
    context?: string;
    /** Additional metadata */
    metadata?: Record<string, unknown>;
  }[];
  /** Processing metadata */
  metadata: {
    /** Model used */
    model: string;
    /** Processing time */
    processing_time_ms: number;
    /** Token count */
    tokens_used?: number;
    /** Prompt name/version */
    prompt_version?: string;
  };
  /** Raw response for debugging */
  raw_response?: unknown;
}

// =============================================================================
// SPIDER API TYPES
// =============================================================================

/**
 * Generic spider API response structure
 */
export interface SpiderApiResponse<T = unknown> {
  /** Success status */
  success: boolean;
  /** Response data */
  data: T;
  /** Error message if failed */
  error?: string;
  /** Response metadata */
  metadata?: {
    /** Total items available */
    total?: number;
    /** Current page */
    page?: number;
    /** Items per page */
    per_page?: number;
    /** Response time */
    response_time_ms?: number;
  };
}

/**
 * Siganet API specific response structure
 */
export interface SiganetApiResponse {
  /** Response data array */
  data: SiganetApiItem[];
  /** Status information */
  status?: {
    code: number;
    message: string;
  };
  /** Pagination info */
  pagination?: {
    current_page: number;
    total_pages: number;
    total_items: number;
  };
}

/**
 * Individual item from Siganet API
 */
export interface SiganetApiItem {
  /** Item ID */
  id: string | number;
  /** Publication date */
  date: string;
  /** Document title */
  title?: string;
  /** Document URL */
  url: string;
  /** File size */
  size?: number;
  /** Additional properties */
  [key: string]: unknown;
}

/**
 * Modernização API response structure  
 */
export interface ModernizacaoApiResponse {
  /** Array of publication items */
  items: ModernizacaoApiItem[];
  /** Response status */
  status: 'success' | 'error';
  /** Error message if applicable */
  message?: string;
  /** Request timestamp */
  timestamp?: string;
}

/**
 * Individual modernização API item
 */
export interface ModernizacaoApiItem {
  /** Publication ID */
  id: string;
  /** Publication date */
  date: string;
  /** Edition information */
  edition?: {
    number: string;
    type: 'regular' | 'extra';
  };
  /** File information */
  file: {
    url: string;
    format: string;
    size_bytes?: number;
  };
  /** Municipality info */
  municipality?: {
    name: string;
    code: string;
  };
}

// =============================================================================
// VALIDATION UTILITIES
// =============================================================================

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
 * Type guard for AI analysis result
 */
export function isAIAnalysisResult(obj: unknown): obj is AIAnalysisResult {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'success' in obj &&
    typeof (obj as any).success === 'boolean' &&
    'findings' in obj &&
    Array.isArray((obj as any).findings)
  );
}

/**
 * Type guard for spider API response
 */
export function isSpiderApiResponse<T>(obj: unknown): obj is SpiderApiResponse<T> {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'success' in obj &&
    typeof (obj as any).success === 'boolean' &&
    'data' in obj
  );
}

/**
 * Safe response parser with validation
 */
export function parseApiResponse<T>(
  response: unknown,
  validator: (obj: unknown) => obj is T
): T | null {
  try {
    if (validator(response)) {
      return response;
    }
    return null;
  } catch {
    return null;
  }
}

// =============================================================================
// ERROR HANDLING TYPES
// =============================================================================

/**
 * Generic API error structure
 */
export interface ApiError {
  /** Error message */
  message: string;
  /** Error code */
  code?: string | number;
  /** HTTP status code */
  status?: number;
  /** Additional error details */
  details?: Record<string, unknown>;
  /** Original error object */
  original?: Error;
}

/**
 * API timeout error
 */
export interface ApiTimeoutError extends ApiError {
  /** Timeout duration in ms */
  timeout_ms: number;
  /** Request start time */
  started_at: string;
}

/**
 * API rate limit error
 */
export interface ApiRateLimitError extends ApiError {
  /** Retry after seconds */
  retry_after?: number;
  /** Rate limit details */
  rate_limit?: {
    limit: number;
    remaining: number;
    reset_at: string;
  };
}
