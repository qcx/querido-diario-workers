/**
 * Standardized error types for the application
 * Replaces generic 'any' error handling with proper type hierarchy
 */

// =============================================================================
// BASE ERROR CLASSES
// =============================================================================

/**
 * Base application error class
 */
export abstract class AppError extends Error {
  /** Error code for programmatic handling */
  abstract readonly code: string;
  /** Error category */
  abstract readonly category: string;
  /** HTTP status code (if applicable) */
  readonly statusCode?: number;
  /** Additional error context */
  readonly context?: Record<string, unknown>;
  /** Timestamp when error occurred */
  readonly timestamp: string;

  constructor(
    message: string,
    statusCode?: number,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.context = context;
    this.timestamp = new Date().toISOString();
    
    // Maintains proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Serialize error for logging
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      category: this.category,
      message: this.message,
      statusCode: this.statusCode,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack
    };
  }
}

// =============================================================================
// EXTERNAL API ERRORS
// =============================================================================

/**
 * Base class for external API errors
 */
export abstract class ExternalApiError extends AppError {
  readonly category = 'external_api';
  /** API endpoint that failed */
  readonly endpoint?: string;
  /** HTTP response status */
  readonly responseStatus?: number;
  /** Response body (if safe to log) */
  readonly responseBody?: string;

  constructor(
    message: string,
    code: string,
    endpoint?: string,
    responseStatus?: number,
    responseBody?: string,
    context?: Record<string, unknown>
  ) {
    super(message, responseStatus, context);
    this.endpoint = endpoint;
    this.responseStatus = responseStatus;
    this.responseBody = responseBody;
  }
}

/**
 * Mistral OCR API errors
 */
export class MistralOcrError extends ExternalApiError {
  readonly code = 'MISTRAL_OCR_ERROR';

  constructor(
    message: string,
    endpoint?: string,
    responseStatus?: number,
    responseBody?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'MISTRAL_OCR_ERROR', endpoint, responseStatus, responseBody, context);
  }
}

/**
 * AI analysis API errors (OpenAI, Mistral chat, etc.)
 */
export class AIAnalysisError extends ExternalApiError {
  readonly code = 'AI_ANALYSIS_ERROR';

  constructor(
    message: string,
    provider: string,
    endpoint?: string,
    responseStatus?: number,
    responseBody?: string,
    context?: Record<string, unknown>
  ) {
    super(
      message, 
      'AI_ANALYSIS_ERROR', 
      endpoint, 
      responseStatus, 
      responseBody, 
      { ...context, provider }
    );
  }
}

/**
 * Spider API errors (when scraping external sites)
 */
export class SpiderApiError extends ExternalApiError {
  readonly code = 'SPIDER_API_ERROR';

  constructor(
    message: string,
    spiderType: string,
    endpoint?: string,
    responseStatus?: number,
    responseBody?: string,
    context?: Record<string, unknown>
  ) {
    super(
      message,
      'SPIDER_API_ERROR',
      endpoint,
      responseStatus,
      responseBody,
      { ...context, spiderType }
    );
  }
}

// =============================================================================
// DATABASE ERRORS
// =============================================================================

/**
 * Base class for database errors
 */
export abstract class DatabaseError extends AppError {
  readonly category = 'database';
  /** Database operation that failed */
  readonly operation?: string;
  /** Table/collection involved */
  readonly table?: string;

  constructor(
    message: string,
    code: string,
    operation?: string,
    table?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 500, context);
    this.operation = operation;
    this.table = table;
  }
}

/**
 * Database connection errors
 */
export class DatabaseConnectionError extends DatabaseError {
  readonly code = 'DB_CONNECTION_ERROR';

  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'DB_CONNECTION_ERROR', 'connect', undefined, context);
  }
}

/**
 * Database query errors
 */
export class DatabaseQueryError extends DatabaseError {
  readonly code = 'DB_QUERY_ERROR';

  constructor(
    message: string,
    operation: string,
    table?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'DB_QUERY_ERROR', operation, table, context);
  }
}

/**
 * Database validation errors
 */
export class DatabaseValidationError extends DatabaseError {
  readonly code = 'DB_VALIDATION_ERROR';

  constructor(
    message: string,
    table: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'DB_VALIDATION_ERROR', 'validate', table, context);
  }
}

// =============================================================================
// BUSINESS LOGIC ERRORS
// =============================================================================

/**
 * Configuration errors
 */
export class ConfigurationError extends AppError {
  readonly code = 'CONFIGURATION_ERROR';
  readonly category = 'configuration';

  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 500, context);
  }
}

/**
 * Validation errors for input data
 */
export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR';
  readonly category = 'validation';
  /** Field that failed validation */
  readonly field?: string;
  /** Validation rule that failed */
  readonly rule?: string;

  constructor(
    message: string,
    field?: string,
    rule?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 400, { ...context, field, rule });
    this.field = field;
    this.rule = rule;
  }
}

/**
 * Resource not found errors
 */
export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND_ERROR';
  readonly category = 'not_found';
  /** Resource type that wasn't found */
  readonly resourceType?: string;
  /** Resource identifier */
  readonly resourceId?: string;

  constructor(
    message: string,
    resourceType?: string,
    resourceId?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 404, { ...context, resourceType, resourceId });
    this.resourceType = resourceType;
    this.resourceId = resourceId;
  }
}

/**
 * Processing timeout errors
 */
export class TimeoutError extends AppError {
  readonly code = 'TIMEOUT_ERROR';
  readonly category = 'timeout';
  /** Timeout duration in ms */
  readonly timeoutMs: number;
  /** Operation that timed out */
  readonly operation?: string;

  constructor(
    message: string,
    timeoutMs: number,
    operation?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 408, { ...context, timeoutMs, operation });
    this.timeoutMs = timeoutMs;
    this.operation = operation;
  }
}

// =============================================================================
// WORKER/QUEUE ERRORS
// =============================================================================

/**
 * Queue processing errors
 */
export class QueueError extends AppError {
  readonly code = 'QUEUE_ERROR';
  readonly category = 'queue';
  /** Queue name */
  readonly queueName?: string;
  /** Message ID that failed */
  readonly messageId?: string;

  constructor(
    message: string,
    queueName?: string,
    messageId?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 500, { ...context, queueName, messageId });
    this.queueName = queueName;
    this.messageId = messageId;
  }
}

/**
 * Worker execution errors
 */
export class WorkerError extends AppError {
  readonly code = 'WORKER_ERROR';
  readonly category = 'worker';
  /** Worker name */
  readonly workerName?: string;
  /** Job ID being processed */
  readonly jobId?: string;

  constructor(
    message: string,
    workerName?: string,
    jobId?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 500, { ...context, workerName, jobId });
    this.workerName = workerName;
    this.jobId = jobId;
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Type guard to check if an error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Type guard to check if an error is an ExternalApiError
 */
export function isExternalApiError(error: unknown): error is ExternalApiError {
  return error instanceof ExternalApiError;
}

/**
 * Type guard to check if an error is a DatabaseError
 */
export function isDatabaseError(error: unknown): error is DatabaseError {
  return error instanceof DatabaseError;
}

/**
 * Convert unknown error to AppError
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new WorkerError(
      error.message,
      'unknown',
      undefined,
      {
        originalName: error.name,
        originalStack: error.stack
      }
    );
  }

  // Handle non-Error objects
  const message = typeof error === 'string' ? error : 'Unknown error occurred';
  return new WorkerError(message, 'unknown', undefined, { originalError: error });
}

/**
 * Safe error serialization for logging
 */
export function serializeError(error: unknown): Record<string, unknown> {
  if (isAppError(error)) {
    return error.toJSON();
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      category: 'native_error',
      timestamp: new Date().toISOString()
    };
  }

  return {
    error: String(error),
    category: 'unknown_error',
    timestamp: new Date().toISOString()
  };
}

/**
 * Create error context from request/operation data
 */
export function createErrorContext(data: {
  jobId?: string;
  territoryId?: string;
  operationType?: string;
  userId?: string;
  requestId?: string;
  [key: string]: unknown;
}): Record<string, unknown> {
  // Filter out undefined values
  return Object.fromEntries(
    Object.entries(data).filter(([_, value]) => value !== undefined)
  );
}
