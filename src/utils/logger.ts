/**
 * Simple structured logger for Cloudflare Workers
 */

import { serializeError } from './error-serializer';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: unknown;
}

class Logger {
  private context: LogContext = {};

  /**
   * Sets persistent context for all log messages
   */
  setContext(context: LogContext): void {
    this.context = { ...this.context, ...context };
  }

  /**
   * Clears the persistent context
   */
  clearContext(): void {
    this.context = {};
  }

  /**
   * Logs a debug message
   */
  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  /**
   * Logs an info message
   */
  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  /**
   * Logs a warning message
   */
  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  /**
   * Logs an error message
   */
  error(message: string, error?: Error | unknown, context?: LogContext): void {
    this.log('error', message, {
      ...context,
      error: error ? serializeError(error) : undefined,
    });
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    const logData = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...this.context,
      ...context,
    };

    // Use appropriate console method
    switch (level) {
      case 'debug':
        console.debug(JSON.stringify(logData));
        break;
      case 'info':
        console.log(JSON.stringify(logData));
        break;
      case 'warn':
        console.warn(JSON.stringify(logData));
        break;
      case 'error':
        console.error(JSON.stringify(logData));
        break;
    }
  }
}

export const logger = new Logger();
