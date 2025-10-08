/**
 * Drizzle-based Error Tracker
 * Replaces error-tracker.ts with Drizzle ORM implementation
 */

import { eq, desc, and, gte, isNull, lte, ne } from 'drizzle-orm';
import { DrizzleDatabaseClient, schema } from './drizzle-client';
import { logger } from '../../utils/logger';
import type { ErrorContext } from '../../types/database';

export interface ErrorLog {
  workerName: string;
  operationType: string;
  severity: 'warning' | 'error' | 'critical';
  errorCode?: string;
  errorMessage: string;
  stackTrace?: string;
  context?: ErrorContext;
  jobId?: string;
  territoryId?: string;
}

export interface ErrorLogRecord {
  id: string;
  workerName: string;
  operationType: string;
  severity: string;
  errorCode: string | null;
  errorMessage: string;
  stackTrace: string | null;
  context: ErrorContext;
  jobId: string | null;
  territoryId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNotes: string | null;
}

export interface ErrorStatistics {
  totalErrors: number;
  criticalErrors: number;
  unresolvedErrors: number;
  errorsByWorker: { worker: string; count: number }[];
  errorsByType: { type: string; count: number }[];
  recentErrors: ErrorLogRecord[];
}

export class DrizzleErrorTracker {
  constructor(private dbClient: DrizzleDatabaseClient) {}

  /**
   * Track an error that could impact pipeline operation
   */
  async trackError(errorLog: ErrorLog): Promise<string> {
    try {
      // Validate the error log data
      this.validateErrorLog(errorLog);

      const db = this.dbClient.getDb();

      const errorData = {
        id: this.dbClient.generateId(),
        workerName: errorLog.workerName,
        operationType: errorLog.operationType,
        severity: errorLog.severity,
        errorCode: errorLog.errorCode || null,
        errorMessage: errorLog.errorMessage,
        stackTrace: errorLog.stackTrace || null,
        context: this.dbClient.stringifyJson(errorLog.context || {}),
        jobId: errorLog.jobId || null,
        territoryId: errorLog.territoryId || null,
        createdAt: this.dbClient.getCurrentTimestamp(),
        resolvedAt: null,
        resolutionNotes: null
      };

      const result = await db.insert(schema.errorLogs)
        .values(errorData)
        .returning({ id: schema.errorLogs.id });

      logger.info('Error tracked', {
        errorId: result[0].id,
        workerName: errorLog.workerName,
        severity: errorLog.severity,
        operationType: errorLog.operationType,
        jobId: errorLog.jobId
      });

      return result[0].id;
    } catch (error) {
      logger.error('Failed to track error', {
        originalError: errorLog,
        trackingError: error
      });
      throw error;
    }
  }

  /**
   * Track a critical error that stops the pipeline
   */
  async trackCriticalError(
    workerName: string,
    operationType: string,
    error: Error,
    context?: Record<string, any>
  ): Promise<string> {
    const errorLog: ErrorLog = {
      workerName,
      operationType,
      severity: 'critical',
      errorMessage: error.message,
      stackTrace: error.stack,
      context,
      ...(context?.jobId ? { jobId: context.jobId } : {}),
      ...(context?.territoryId ? { territoryId: context.territoryId } : {})
    };

    return this.trackError(errorLog);
  }

  /**
   * Get error statistics for dashboard
   */
  async getErrorStatistics(days: number = 7): Promise<ErrorStatistics> {
    try {
      const db = this.dbClient.getDb();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const cutoffDateStr = cutoffDate.toISOString();

      // Get all errors within the time period
      const errors = await db.select()
        .from(schema.errorLogs)
        .where(gte(schema.errorLogs.createdAt, cutoffDateStr))
        .orderBy(desc(schema.errorLogs.createdAt));

      // Calculate statistics
      const totalErrors = errors.length;
      const criticalErrors = errors.filter(e => e.severity === 'critical').length;
      const unresolvedErrors = errors.filter(e => !e.resolvedAt).length;

      // Count errors by worker
      const errorsByWorkerMap: Record<string, number> = {};
      errors.forEach(error => {
        errorsByWorkerMap[error.workerName] = (errorsByWorkerMap[error.workerName] || 0) + 1;
      });
      const errorsByWorker = Object.entries(errorsByWorkerMap)
        .map(([worker, count]) => ({ worker, count }))
        .sort((a, b) => b.count - a.count);

      // Count errors by operation type
      const errorsByTypeMap: Record<string, number> = {};
      errors.forEach(error => {
        errorsByTypeMap[error.operationType] = (errorsByTypeMap[error.operationType] || 0) + 1;
      });
      const errorsByType = Object.entries(errorsByTypeMap)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count);

      // Get recent errors (last 10)
      const recentErrors = errors.slice(0, 10).map(error => ({
        ...error,
        context: this.dbClient.parseJson<ErrorContext>(error.context, {})
      }));

      return {
        totalErrors,
        criticalErrors,
        unresolvedErrors,
        errorsByWorker,
        errorsByType,
        recentErrors
      };
    } catch (error) {
      logger.error('Failed to get error statistics', { error });
      throw error;
    }
  }

  /**
   * Get unresolved errors
   */
  async getUnresolvedErrors(limit: number = 50): Promise<ErrorLogRecord[]> {
    try {
      const db = this.dbClient.getDb();

      const errors = await db.select()
        .from(schema.errorLogs)
        .where(isNull(schema.errorLogs.resolvedAt))
        .orderBy(desc(schema.errorLogs.createdAt))
        .limit(limit);

      return errors.map(error => ({
        ...error,
        context: this.dbClient.parseJson<ErrorContext>(error.context, {})
      }));
    } catch (error) {
      logger.error('Failed to get unresolved errors', { error });
      throw error;
    }
  }

  /**
   * Resolve an error with notes
   */
  async resolveError(errorId: string, resolutionNotes: string): Promise<void> {
    try {
      const db = this.dbClient.getDb();

      await db.update(schema.errorLogs)
        .set({
          resolvedAt: this.dbClient.getCurrentTimestamp(),
          resolutionNotes
        })
        .where(eq(schema.errorLogs.id, errorId));

      logger.info('Error resolved', {
        errorId,
        resolutionNotes
      });
    } catch (error) {
      logger.error('Failed to resolve error', {
        errorId,
        error
      });
      throw error;
    }
  }

  /**
   * Get errors by worker name
   */
  async getErrorsByWorker(
    workerName: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<{
    errors: ErrorLogRecord[];
    total: number;
  }> {
    try {
      const db = this.dbClient.getDb();

      // Get paginated errors
      const errors = await db.select()
        .from(schema.errorLogs)
        .where(eq(schema.errorLogs.workerName, workerName))
        .orderBy(desc(schema.errorLogs.createdAt))
        .limit(limit)
        .offset(offset);

      // Get total count
      const totalResults = await db.select({ count: schema.errorLogs.id })
        .from(schema.errorLogs)
        .where(eq(schema.errorLogs.workerName, workerName));

      const records = errors.map(error => ({
        ...error,
        context: this.dbClient.parseJson<ErrorContext>(error.context, {})
      }));

      return {
        errors: records,
        total: totalResults.length
      };
    } catch (error) {
      logger.error('Failed to get errors by worker', {
        workerName,
        error
      });
      throw error;
    }
  }

  /**
   * Get error details by ID
   */
  async getErrorById(errorId: string): Promise<ErrorLogRecord | null> {
    try {
      const db = this.dbClient.getDb();

      const results = await db.select()
        .from(schema.errorLogs)
        .where(eq(schema.errorLogs.id, errorId))
        .limit(1);

      if (results.length === 0) {
        return null;
      }

      const error = results[0];
      return {
        ...error,
        context: this.dbClient.parseJson<ErrorContext>(error.context, {})
      };
    } catch (error) {
      logger.error('Failed to get error by ID', {
        errorId,
        error
      });
      throw error;
    }
  }

  /**
   * Validate error log data
   */
  private validateErrorLog(errorLog: ErrorLog): void {
    if (!errorLog.workerName || errorLog.workerName.trim().length === 0) {
      throw new Error('Worker name is required');
    }

    if (!errorLog.operationType || errorLog.operationType.trim().length === 0) {
      throw new Error('Operation type is required');
    }

    if (!['warning', 'error', 'critical'].includes(errorLog.severity)) {
      throw new Error('Invalid severity level');
    }

    if (!errorLog.errorMessage || errorLog.errorMessage.trim().length === 0) {
      throw new Error('Error message is required');
    }

    if (errorLog.errorMessage.length > 10000) {
      throw new Error('Error message too long (max 10000 characters)');
    }
  }

  /**
   * Track database error (compatibility method)
   */
  async trackDatabaseError(
    operation: string,
    error: Error,
    context?: Record<string, any>
  ): Promise<string> {
    return this.trackError({
      workerName: 'database',
      operationType: operation,
      severity: 'error',
      errorMessage: error.message,
      stackTrace: error.stack,
      context
    });
  }

  /**
   * Clean up old resolved errors (housekeeping)
   */
  async cleanupOldErrors(daysOld: number = 90): Promise<number> {
    try {
      const db = this.dbClient.getDb();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);
      const cutoffDateStr = cutoffDate.toISOString();

      // Delete old resolved errors (simplified for D1)
      const result = await db.delete(schema.errorLogs)
        .where(
          and(
            lte(schema.errorLogs.createdAt, cutoffDateStr),
            ne(schema.errorLogs.resolvedAt, null)
          )
        );

      logger.info('Old errors cleaned up', {
        deletedCount: 0, // D1 doesn't return changes count easily
        cutoffDate: cutoffDateStr
      });

      return 0;
    } catch (error) {
      logger.error('Failed to cleanup old errors', {
        daysOld,
        error
      });
      throw error;
    }
  }
}
