/**
 * Dashboard Queries Service
 * Provides queries for monitoring pipeline health and performance
 */

import { DatabaseClient } from './client';
import { logger } from '../../utils';

export interface PipelineHealthData {
  jobId: string;
  status: string;
  totalCities: number;
  completedCities: number;
  failedCities: number;
  errorCount: number;
  lastErrorAt?: string;
  gazettesFound: number;
  ocrCompleted: number;
  analysesCompleted: number;
  createdAt: string;
}

export interface ErrorSummary {
  totalErrors: number;
  criticalErrors: number;
  recentErrors: number;
  unresolvedErrors: number;
  topWorkerErrors: { worker: string; count: number }[];
  topOperationErrors: { operation: string; count: number }[];
}

export interface SystemStatus {
  pipelineHealth: 'healthy' | 'degraded' | 'critical';
  activeJobs: number;
  processingRate: number;
  errorRate: number;
  lastSuccessfulCrawl?: string;
  queueBacklog: {
    crawl: number;
    ocr: number;
    analysis: number;
    webhook: number;
  };
}

export class DashboardQueries {
  constructor(private db: DatabaseClient) {}

  /**
   * Get pipeline health overview
   */
  async getPipelineHealth(limit: number = 10): Promise<PipelineHealthData[]> {
    try {
      const result = await this.db.queryTemplate`
        SELECT 
          cj.id as job_id,
          cj.status,
          cj.total_cities,
          cj.completed_cities,
          cj.failed_cities,
          COUNT(DISTINCT el.id) as error_count,
          MAX(el.created_at) as last_error_at,
          COUNT(DISTINCT gr.id) as gazettes_found,
          COUNT(DISTINCT ocr.id) as ocr_completed,
          COUNT(DISTINCT ar.id) as analyses_completed,
          cj.created_at
        FROM crawl_jobs cj
        LEFT JOIN error_logs el ON el.job_id = cj.id::text
        LEFT JOIN gazette_registry gr ON gr.job_id LIKE CONCAT(cj.id::text, '%')
        LEFT JOIN ocr_results ocr ON ocr.job_id LIKE CONCAT(cj.id::text, '%')
        LEFT JOIN analysis_results ar ON ar.job_id LIKE CONCAT(cj.id::text, '%')
        GROUP BY cj.id, cj.status, cj.total_cities, cj.completed_cities, cj.failed_cities, cj.created_at
        ORDER BY cj.created_at DESC
        LIMIT ${limit}
      `;

      return result.map(row => ({
        jobId: row.job_id,
        status: row.status,
        totalCities: parseInt(row.total_cities),
        completedCities: parseInt(row.completed_cities),
        failedCities: parseInt(row.failed_cities),
        errorCount: parseInt(row.error_count),
        lastErrorAt: row.last_error_at,
        gazettesFound: parseInt(row.gazettes_found),
        ocrCompleted: parseInt(row.ocr_completed),
        analysesCompleted: parseInt(row.analyses_completed),
        createdAt: row.created_at
      }));
    } catch (error) {
      logger.error('Failed to get pipeline health', { error });
      throw error;
    }
  }

  /**
   * Get error summary for monitoring
   */
  async getErrorSummary(days: number = 7): Promise<ErrorSummary> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const summary = await this.db.queryTemplate`
        SELECT 
          COUNT(*) as total_errors,
          COUNT(*) FILTER (WHERE severity = 'critical') as critical_errors,
          COUNT(*) FILTER (WHERE created_at >= ${cutoffDate.toISOString()}) as recent_errors,
          COUNT(*) FILTER (WHERE resolved_at IS NULL) as unresolved_errors
        FROM error_logs
      `;

      const workerErrors = await this.db.queryTemplate`
        SELECT worker_name as worker, COUNT(*) as count
        FROM error_logs
        WHERE created_at >= ${cutoffDate.toISOString()}
        GROUP BY worker_name
        ORDER BY COUNT(*) DESC
        LIMIT 5
      `;

      const operationErrors = await this.db.queryTemplate`
        SELECT operation_type as operation, COUNT(*) as count
        FROM error_logs
        WHERE created_at >= ${cutoffDate.toISOString()}
        GROUP BY operation_type
        ORDER BY COUNT(*) DESC
        LIMIT 5
      `;

      const stats = summary[0];

      return {
        totalErrors: parseInt(stats.total_errors),
        criticalErrors: parseInt(stats.critical_errors),
        recentErrors: parseInt(stats.recent_errors),
        unresolvedErrors: parseInt(stats.unresolved_errors),
        topWorkerErrors: workerErrors.map(row => ({
          worker: row.worker,
          count: parseInt(row.count)
        })),
        topOperationErrors: operationErrors.map(row => ({
          operation: row.operation,
          count: parseInt(row.count)
        }))
      };
    } catch (error) {
      logger.error('Failed to get error summary', { error });
      throw error;
    }
  }

  /**
   * Get system status for health checks
   */
  async getSystemStatus(): Promise<SystemStatus> {
    try {
      // Get active jobs
      const activeJobs = await this.db.queryTemplate`
        SELECT COUNT(*) as count
        FROM crawl_jobs
        WHERE status IN ('pending', 'running')
      `;

      // Calculate processing rate (jobs per hour in last 24h)
      const processingRate = await this.db.queryTemplate`
        SELECT COUNT(*) as count
        FROM crawl_jobs
        WHERE created_at >= NOW() - INTERVAL '24 hours'
      `;

      // Calculate error rate (errors per hour in last 24h)
      const errorRate = await this.db.queryTemplate`
        SELECT COUNT(*) as count
        FROM error_logs
        WHERE severity IN ('error', 'critical')
        AND created_at >= NOW() - INTERVAL '24 hours'
      `;

      // Get last successful crawl
      const lastSuccessful = await this.db.queryTemplate`
        SELECT created_at
        FROM crawl_jobs
        WHERE status = 'completed'
        ORDER BY created_at DESC
        LIMIT 1
      `;

      // Estimate queue backlogs based on recent activity
      const recentActivity = await this.db.queryTemplate`
        SELECT 
          COUNT(DISTINCT cj.id) as crawl_jobs,
          COUNT(DISTINCT gr.id) as gazettes,
          COUNT(DISTINCT ocr.id) as ocr_results,
          COUNT(DISTINCT ar.id) as analyses
        FROM crawl_jobs cj
        LEFT JOIN gazette_registry gr ON gr.job_id LIKE CONCAT(cj.id::text, '%')
        LEFT JOIN ocr_results ocr ON ocr.job_id LIKE CONCAT(cj.id::text, '%')
        LEFT JOIN analysis_results ar ON ar.job_id LIKE CONCAT(cj.id::text, '%')
        WHERE cj.created_at >= NOW() - INTERVAL '1 hour'
      `;

      const activity = recentActivity[0];
      const activeJobCount = parseInt(activeJobs[0].count);
      const hourlyProcessingRate = parseInt(processingRate[0].count) / 24;
      const hourlyErrorRate = parseInt(errorRate[0].count) / 24;

      // Determine pipeline health
      let health: 'healthy' | 'degraded' | 'critical' = 'healthy';
      if (hourlyErrorRate > 10) {
        health = 'critical';
      } else if (hourlyErrorRate > 5 || activeJobCount > 10) {
        health = 'degraded';
      }

      return {
        pipelineHealth: health,
        activeJobs: activeJobCount,
        processingRate: hourlyProcessingRate,
        errorRate: hourlyErrorRate,
        lastSuccessfulCrawl: lastSuccessful[0]?.created_at,
        queueBacklog: {
          crawl: Math.max(0, activeJobCount),
          ocr: Math.max(0, parseInt(activity.gazettes) - parseInt(activity.ocr_results)),
          analysis: Math.max(0, parseInt(activity.ocr_results) - parseInt(activity.analyses)),
          webhook: Math.max(0, parseInt(activity.analyses)) // Assuming 1:1 mapping
        }
      };
    } catch (error) {
      logger.error('Failed to get system status', { error });
      throw error;
    }
  }

  /**
   * Get pipeline performance metrics
   */
  async getPerformanceMetrics(hours: number = 24): Promise<{
    averageProcessingTime: number;
    successRate: number;
    throughput: number;
    bottlenecks: string[];
  }> {
    try {
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - hours);

      const metrics = await this.db.queryTemplate`
        SELECT 
          AVG(ct.execution_time_ms) as avg_processing_time,
          COUNT(*) FILTER (WHERE ct.status = 'completed') * 100.0 / COUNT(*) as success_rate,
          COUNT(*) as total_operations
        FROM crawl_telemetry ct
        WHERE ct.timestamp >= ${cutoffTime.toISOString()}
      `;

      const bottleneckAnalysis = await this.db.queryTemplate`
        SELECT 
          ct.step,
          AVG(ct.execution_time_ms) as avg_time,
          COUNT(*) FILTER (WHERE ct.status = 'failed') as failure_count
        FROM crawl_telemetry ct
        WHERE ct.timestamp >= ${cutoffTime.toISOString()}
        GROUP BY ct.step
        ORDER BY avg_time DESC
      `;

      const stats = metrics[0];
      const bottlenecks = bottleneckAnalysis
        .filter(row => parseInt(row.failure_count) > 0 || parseFloat(row.avg_time) > 30000)
        .map(row => row.step);

      return {
        averageProcessingTime: parseFloat(stats.avg_processing_time) || 0,
        successRate: parseFloat(stats.success_rate) || 0,
        throughput: parseInt(stats.total_operations) / hours,
        bottlenecks
      };
    } catch (error) {
      logger.error('Failed to get performance metrics', { error });
      throw error;
    }
  }

  /**
   * Get detailed error analysis
   */
  async getDetailedErrorAnalysis(jobId?: string): Promise<{
    errors: ErrorLogRecord[];
    patterns: { pattern: string; count: number }[];
    timeline: { hour: string; errorCount: number }[];
  }> {
    try {
      let baseQuery = `
        SELECT id, worker_name, operation_type, severity, error_code,
               error_message, stack_trace, context, job_id, territory_id,
               created_at, resolved_at, resolution_notes
        FROM error_logs
      `;
      
      const params: any[] = [];
      if (jobId) {
        baseQuery += ` WHERE job_id = $1`;
        params.push(jobId);
      }

      baseQuery += ` ORDER BY created_at DESC LIMIT 100`;

      const errors = await this.db.query(baseQuery, params);

      // Analyze error patterns
      const patterns = await this.db.queryTemplate`
        SELECT 
          SUBSTRING(error_message, 1, 50) as pattern,
          COUNT(*) as count
        FROM error_logs
        ${jobId ? `WHERE job_id = ${jobId}` : ''}
        GROUP BY SUBSTRING(error_message, 1, 50)
        ORDER BY COUNT(*) DESC
        LIMIT 10
      `;

      // Get hourly error timeline
      const timeline = await this.db.queryTemplate`
        SELECT 
          DATE_TRUNC('hour', created_at) as hour,
          COUNT(*) as error_count
        FROM error_logs
        WHERE created_at >= NOW() - INTERVAL '24 hours'
        ${jobId ? `AND job_id = ${jobId}` : ''}
        GROUP BY DATE_TRUNC('hour', created_at)
        ORDER BY hour DESC
      `;

      return {
        errors: errors.map(row => this.mapToErrorRecord(row)),
        patterns: patterns.map(row => ({
          pattern: row.pattern,
          count: parseInt(row.count)
        })),
        timeline: timeline.map(row => ({
          hour: row.hour,
          errorCount: parseInt(row.error_count)
        }))
      };
    } catch (error) {
      logger.error('Failed to get detailed error analysis', { jobId, error });
      throw error;
    }
  }

  /**
   * Map database row to error record
   */
  private mapToErrorRecord(row: any): ErrorLogRecord {
    return {
      id: row.id,
      workerName: row.worker_name,
      operationType: row.operation_type,
      severity: row.severity,
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

// Type definitions to export
export interface ErrorLogRecord {
  id: string;
  workerName: string;
  operationType: string;
  severity: 'warning' | 'error' | 'critical';
  errorCode?: string;
  errorMessage: string;
  stackTrace?: string;
  context: Record<string, any>;
  jobId?: string;
  territoryId?: string;
  createdAt: string;
  resolvedAt?: string;
  resolutionNotes?: string;
}
