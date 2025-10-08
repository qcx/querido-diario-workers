/**
 * Error serialization utilities for safe logging
 * Prevents D1_TYPE_ERROR by properly handling error objects
 */

export interface SerializedError {
  message: string;
  stack?: string;
  name: string;
  [key: string]: any;
}

/**
 * Safely serialize an error object for logging
 * Handles circular references and non-serializable properties
 */
export function serializeError(error: unknown, additionalContext?: Record<string, any>): SerializedError {
  if (error instanceof Error) {
    const serialized: SerializedError = {
      message: error.message,
      stack: error.stack,
      name: error.name,
      ...additionalContext
    };
    
    // Add any additional enumerable properties from the error
    for (const key in error) {
      if (error.hasOwnProperty(key) && typeof (error as any)[key] !== 'function') {
        try {
          serialized[key] = (error as any)[key];
        } catch {
          // Skip properties that can't be serialized
        }
      }
    }
    
    return serialized;
  }
  
  return {
    message: String(error),
    name: 'UnknownError',
    ...additionalContext
  };
}

/**
 * Create a logger-safe error object with additional context
 */
export function createLoggerError(error: unknown, context?: Record<string, any>) {
  return serializeError(error, context);
}
