/**
 * Error Tracker Service
 * Tracks all errors and crashes that could stop the pipeline
 */

import { DatabaseClient } from './client';
import { logger } from '../../utils';
import { validateErrorLog } from '../../utils/db-validators';

export type ErrorSeverity = 'warning' | 'error' | 'critical';

export interface ErrorLog {
  workerName: string;
  operationType: string;
  severity: ErrorSeverity;
  errorCode?: string;
  errorMessage: string;
  stackTrace?: string;
  context?: Record<string, any>;
  jobId?: string;
  territoryId?: string;
}

export interface ErrorLogRecord extends ErrorLog {
  id: string;
  createdAt: string;
  resolvedAt?: string;
  resolutionNotes?: string;
}

export interface ErrorStatistics {
  totalErrors: number;
  errorsBySeverity: Record<ErrorSeverity, number>;
  errorsByWorker: Record<string, number>;
  errorsByOperation: Record<string, number>;
  recentErrors: number;
  unresolvedErrors: number;
}

export class ErrorTracker {
  constructor(private db: DatabaseClient) {}

  /**
   * Track an error that could impact pipeline operation
   */
  async trackError(errorLog: ErrorLog): Promise<string> {
    try {
      // Validate the error log data
      validateErrorLog(errorLog);

      const result = await this.db.queryTemplate`
        INSERT INTO error_logs (
          worker_name, operation_type, severity, error_code,
          error_message, stack_trace, context, job_id, territory_id
        )
        VALUES (
          ${errorLog.workerName}, ${errorLog.operationType}, ${errorLog.severity},
          ${errorLog.errorCode || null}, ${errorLog.errorMessage}, 
          ${errorLog.stackTrace || null}, ${JSON.stringify(errorLog.context || {})},
          ${errorLog.jobId || null}, ${errorLog.territoryId || null}
        )
        RETURNING id
      `;

      const errorId = result[0].id;

      logger.info('Error tracked', {
        errorId,
        workerName: errorLog.workerName,
        severity: errorLog.severity,
        operationType: errorLog.operationType,
        jobId: errorLog.jobId
      });

      return errorId;
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
    return this.trackError({
      workerName,
      operationType,
      severity: 'critical',
      errorMessage: error.message,
      stackTrace: error.stack,
      context: {
        ...context,
        errorName: error.name,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Track a database operation error
   */
  async trackDatabaseError(
    workerName: string,
    operation: string,
    error: Error,
    query?: string,
    jobId?: string
  ): Promise<string> {
    return this.trackError({
      workerName,
      operationType: `database_${operation}`,
      severity: 'error',
      errorCode: 'DB_ERROR',
      errorMessage: error.message,
      stackTrace: error.stack,
      jobId,
      context: {
        query: query?.substring(0, 200), // Truncate long queries
        errorName: error.name
      }
    });
  }

  /**
   * Mark an error as resolved
   */
  async resolveError(errorId: string, resolutionNotes?: string): Promise<void> {
    try {
      await this.db.queryTemplate`
        UPDATE error_logs 
        SET resolved_at = NOW(), resolution_notes = ${resolutionNotes || null}
        WHERE id = ${errorId}
      `;

      logger.info('Error marked as resolved', { errorId, resolutionNotes });
    } catch (error) {
      logger.error('Failed to resolve error', { errorId, error });
      throw error;
    }
  }

  /**
   * Get recent errors for monitoring
   */
  async getRecentErrors(
    limit: number = 50,
    severity?: ErrorSeverity,
    workerName?: string
  ): Promise<ErrorLogRecord[]> {
    try {
      let query = `
        SELECT id, worker_name, operation_type, severity, error_code,
               error_message, stack_trace, context, job_id, territory_id,
               created_at, resolved_at, resolution_notes
        FROM error_logs
        WHERE 1=1
      `;
      
      const params: any[] = [];
      let paramIndex = 1;

      if (severity) {
        query += ` AND severity = $${paramIndex++}`;
        params.push(severity);
      }

      if (workerName) {
        query += ` AND worker_name = $${paramIndex++}`;
        params.push(workerName);
      }

      query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
      params.push(limit);

      const result = await this.db.query(query, params);
      return result.map(row => this.mapToErrorRecord(row));
    } catch (error) {
      logger.error('Failed to get recent errors', { error });
      throw error;
    }
  }

  /**
   * Get error statistics for dashboard
   */
  async getErrorStatistics(days: number = 7): Promise<ErrorStatistics> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const result = await this.db.queryTemplate`
        SELECT 
          COUNT(*) as total_errors,
          COUNT(*) FILTER (WHERE severity = 'warning') as warning_count,
          COUNT(*) FILTER (WHERE severity = 'error') as error_count,
          COUNT(*) FILTER (WHERE severity = 'critical') as critical_count,
          COUNT(*) FILTER (WHERE created_at >= ${cutoffDate.toISOString()}) as recent_errors,
          COUNT(*) FILTER (WHERE resolved_at IS NULL) as unresolved_errors
        FROM error_logs
      `;

      const workerStats = await this.db.queryTemplate`
        SELECT worker_name, COUNT(*) as count
        FROM error_logs
        WHERE created_at >= ${cutoffDate.toISOString()}
        GROUP BY worker_name
      `;

      const operationStats = await this.db.queryTemplate`
        SELECT operation_type, COUNT(*) as count
        FROM error_logs
        WHERE created_at >= ${cutoffDate.toISOString()}
        GROUP BY operation_type
      `;

      const stats = result[0];
      
      return {
        totalErrors: parseInt(stats.total_errors),
        errorsBySeverity: {
          warning: parseInt(stats.warning_count),
          error: parseInt(stats.error_count),
          critical: parseInt(stats.critical_count)
        },
        errorsByWorker: Object.fromEntries(
          workerStats.map(row => [row.worker_name, parseInt(row.count)])
        ),
        errorsByOperation: Object.fromEntries(
          operationStats.map(row => [row.operation_type, parseInt(row.count)])
        ),
        recentErrors: parseInt(stats.recent_errors),
        unresolvedErrors: parseInt(stats.unresolved_errors)
      };
    } catch (error) {
      logger.error('Failed to get error statistics', { error });
      throw error;
    }
  }

  /**
   * Get errors by job ID for troubleshooting
   */
  async getErrorsByJobId(jobId: string): Promise<ErrorLogRecord[]> {
    try {
      const result = await this.db.queryTemplate`
        SELECT id, worker_name, operation_type, severity, error_code,
               error_message, stack_trace, context, job_id, territory_id,
               created_at, resolved_at, resolution_notes
        FROM error_logs
        WHERE job_id = ${jobId}
        ORDER BY created_at DESC
      `;

      return result.map(row => this.mapToErrorRecord(row));
    } catch (error) {
      logger.error('Failed to get errors by job ID', { jobId, error });
      throw error;
    }
  }

  /**
   * Clean up old resolved errors
   */
  async cleanupOldErrors(olderThanDays: number = 30): Promise<{ deleted: number }> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const result = await this.db.queryTemplate`
        DELETE FROM error_logs
        WHERE resolved_at IS NOT NULL 
        AND resolved_at < ${cutoffDate.toISOString()}
        RETURNING id
      `;

      logger.info('Old error logs cleaned up', {
        deleted: result.length,
        olderThanDays
      });

      return { deleted: result.length };
    } catch (error) {
      logger.error('Failed to cleanup old errors', { olderThanDays, error });
      throw error;
    }
  }

  /**
   * Map database row to ErrorLogRecord
   */
  private mapToErrorRecord(row: any): ErrorLogRecord {
    return {
      id: row.id,
      workerName: row.worker_name,
      operationType: row.operation_type,
      severity: row.severity as ErrorSeverity,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      stackTrace: row.stack_trace,
      context: row.context || {},
      jobId: row.job_id,
      territoryId: row.territory_id,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
      resolutionNotes: row.resolution_notes
    };
  }
}
