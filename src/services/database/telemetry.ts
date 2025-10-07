/**
 * Telemetry Service
 * Tracks crawling progress and system metrics
 */

import { DatabaseClient } from './client';
import { logger } from '../../utils';

export type TelemetryStep = 'crawl_start' | 'crawl_end' | 'ocr_start' | 'ocr_end' | 'analysis_start' | 'analysis_end' | 'webhook_sent';
export type StepStatus = 'started' | 'completed' | 'failed' | 'skipped';
export type JobType = 'scheduled' | 'manual' | 'cities';
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface CrawlJobData {
  jobType: JobType;
  totalCities: number;
  startDate?: string;
  endDate?: string;
  platformFilter?: string;
  metadata?: Record<string, any>;
}

export interface TelemetryStepData {
  gazettesFound?: number;
  executionTimeMs?: number;
  errorMessage?: string;
  retryCount?: number;
  metadata?: Record<string, any>;
}

export class TelemetryService {
  constructor(private db: DatabaseClient) {}

  /**
   * Start tracking a new crawl job
   */
  async trackCrawlJobStart(jobData: CrawlJobData): Promise<string> {
    try {
      const result = await this.db.queryTemplate`
        INSERT INTO crawl_jobs (
          job_type, total_cities, start_date, end_date, 
          platform_filter, status, started_at, metadata
        )
        VALUES (
          ${jobData.jobType}, ${jobData.totalCities},
          ${jobData.startDate ? new Date(jobData.startDate) : null},
          ${jobData.endDate ? new Date(jobData.endDate) : null},
          ${jobData.platformFilter || null}, 'running', NOW(),
          ${JSON.stringify(jobData.metadata || {})}
        )
        RETURNING id
      `;

      const jobId = result[0].id;
      
      logger.info('Crawl job started', {
        jobId,
        jobType: jobData.jobType,
        totalCities: jobData.totalCities
      });

      return jobId;
    } catch (error) {
      logger.error('Failed to start crawl job tracking', { error });
      throw error;
    }
  }

  /**
   * Update crawl job status and progress
   */
  async updateCrawlJob(
    jobId: string, 
    updates: {
      status?: JobStatus;
      completedCities?: number;
      failedCities?: number;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    try {
      const setParts = [];
      const values = [];

      if (updates.status !== undefined) {
        setParts.push(`status = $${values.length + 1}`);
        values.push(updates.status);
        
        if (updates.status === 'completed') {
          setParts.push(`completed_at = NOW()`);
        }
      }

      if (updates.completedCities !== undefined) {
        setParts.push(`completed_cities = $${values.length + 1}`);
        values.push(updates.completedCities);
      }

      if (updates.failedCities !== undefined) {
        setParts.push(`failed_cities = $${values.length + 1}`);
        values.push(updates.failedCities);
      }

      if (updates.metadata !== undefined) {
        setParts.push(`metadata = $${values.length + 1}`);
        values.push(JSON.stringify(updates.metadata));
      }

      if (setParts.length === 0) return;

      const query = `
        UPDATE crawl_jobs 
        SET ${setParts.join(', ')}
        WHERE id = $${values.length + 1}
      `;
      values.push(jobId);

      await this.db.query(query, values);

      logger.debug('Crawl job updated', { jobId, updates });
    } catch (error) {
      logger.error('Failed to update crawl job', { jobId, error });
      throw error;
    }
  }

  /**
   * Track a specific step for a city within a crawl job
   */
  async trackCityStep(
    crawlJobId: string,
    territoryId: string,
    spiderId: string,
    spiderType: string,
    step: TelemetryStep,
    status: StepStatus,
    data?: TelemetryStepData
  ): Promise<void> {
    try {
      await this.db.queryTemplate`
        INSERT INTO crawl_telemetry (
          crawl_job_id, territory_id, spider_id, spider_type,
          step, status, gazettes_found, execution_time_ms,
          error_message, retry_count, metadata
        )
        VALUES (
          ${crawlJobId}, ${territoryId}, ${spiderId}, ${spiderType},
          ${step}, ${status}, ${data?.gazettesFound || 0},
          ${data?.executionTimeMs || null}, ${data?.errorMessage || null},
          ${data?.retryCount || 0}, ${JSON.stringify(data?.metadata || {})}
        )
      `;

      logger.debug('City step tracked', {
        crawlJobId,
        territoryId,
        step,
        status,
        gazettesFound: data?.gazettesFound
      });
    } catch (error) {
      logger.error('Failed to track city step', {
        crawlJobId,
        territoryId,
        step,
        error
      });
      // Don't throw here - telemetry shouldn't break the main flow
    }
  }

  /**
   * Get current crawl job progress
   */
  async getCrawlJobProgress(jobId: string): Promise<{
    job: any;
    progress: {
      totalCities: number;
      citiesStarted: number;
      citiesCompleted: number;
      citiesFailed: number;
      averageTimeMs: number;
      stepsCompleted: Record<TelemetryStep, number>;
    };
  }> {
    try {
      // Get job info
      const jobResult = await this.db.queryTemplate`
        SELECT * FROM crawl_jobs WHERE id = ${jobId}
      `;

      if (jobResult.length === 0) {
        throw new Error(`Crawl job ${jobId} not found`);
      }

      const job = jobResult[0];

      // Get telemetry stats
      const statsResult = await this.db.queryTemplate`
        SELECT 
          COUNT(DISTINCT territory_id) as cities_started,
          COUNT(DISTINCT CASE WHEN step = 'crawl_end' AND status = 'completed' THEN territory_id END) as cities_completed,
          COUNT(DISTINCT CASE WHEN status = 'failed' THEN territory_id END) as cities_failed,
          AVG(execution_time_ms) as avg_time_ms,
          step,
          COUNT(*) as step_count
        FROM crawl_telemetry 
        WHERE crawl_job_id = ${jobId}
        GROUP BY step
      `;

      const stepsCompleted: Record<string, number> = {};
      let citiesStarted = 0;
      let citiesCompleted = 0;
      let citiesFailed = 0;
      let averageTimeMs = 0;

      if (statsResult.length > 0) {
        // Get overall stats from first row
        citiesStarted = statsResult[0].cities_started || 0;
        citiesCompleted = statsResult[0].cities_completed || 0;
        citiesFailed = statsResult[0].cities_failed || 0;
        averageTimeMs = statsResult[0].avg_time_ms || 0;

        // Aggregate step counts
        statsResult.forEach(row => {
          stepsCompleted[row.step] = row.step_count;
        });
      }

      return {
        job,
        progress: {
          totalCities: job.total_cities,
          citiesStarted,
          citiesCompleted,
          citiesFailed,
          averageTimeMs: Math.round(averageTimeMs),
          stepsCompleted: stepsCompleted as Record<TelemetryStep, number>
        }
      };
    } catch (error) {
      logger.error('Failed to get crawl job progress', { jobId, error });
      throw error;
    }
  }

  /**
   * Get system metrics for monitoring
   */
  async getSystemMetrics(timeRange: '1h' | '24h' | '7d' = '24h'): Promise<{
    crawlJobs: {
      total: number;
      completed: number;
      failed: number;
      running: number;
    };
    processing: {
      averageTimeMs: number;
      totalGazettes: number;
      successRate: number;
    };
    errors: Array<{
      error: string;
      count: number;
      lastSeen: string;
    }>;
  }> {
    try {
      const interval = timeRange === '1h' ? '1 hour' : 
                     timeRange === '24h' ? '24 hours' : '7 days';

      // Get job stats
      const jobStats = await this.db.queryTemplate`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
          COUNT(CASE WHEN status = 'running' THEN 1 END) as running
        FROM crawl_jobs 
        WHERE created_at > NOW() - INTERVAL ${interval}
      `;

      // Get processing stats
      const processingStats = await this.db.queryTemplate`
        SELECT 
          AVG(execution_time_ms) as avg_time_ms,
          SUM(gazettes_found) as total_gazettes,
          (COUNT(CASE WHEN status = 'completed' THEN 1 END)::float / 
           NULLIF(COUNT(*), 0)) * 100 as success_rate
        FROM crawl_telemetry 
        WHERE timestamp > NOW() - INTERVAL ${interval}
      `;

      // Get top errors
      const errorStats = await this.db.queryTemplate`
        SELECT 
          error_message as error,
          COUNT(*) as count,
          MAX(timestamp) as last_seen
        FROM crawl_telemetry 
        WHERE timestamp > NOW() - INTERVAL ${interval}
          AND error_message IS NOT NULL
        GROUP BY error_message
        ORDER BY count DESC
        LIMIT 10
      `;

      return {
        crawlJobs: jobStats[0] || { total: 0, completed: 0, failed: 0, running: 0 },
        processing: {
          averageTimeMs: Math.round(processingStats[0]?.avg_time_ms || 0),
          totalGazettes: processingStats[0]?.total_gazettes || 0,
          successRate: Math.round(processingStats[0]?.success_rate || 0)
        },
        errors: errorStats.map(row => ({
          error: row.error,
          count: row.count,
          lastSeen: row.last_seen
        }))
      };
    } catch (error) {
      logger.error('Failed to get system metrics', { error });
      throw error;
    }
  }

  /**
   * Clean up old telemetry data (for maintenance)
   */
  async cleanupOldData(olderThanDays: number = 30): Promise<{ deleted: number }> {
    try {
      const result = await this.db.queryTemplate`
        DELETE FROM crawl_telemetry 
        WHERE timestamp < NOW() - INTERVAL ${olderThanDays} DAY
      `;

      logger.info('Cleaned up old telemetry data', { 
        deletedRows: result.length,
        olderThanDays 
      });

      return { deleted: result.length };
    } catch (error) {
      logger.error('Failed to cleanup old telemetry data', { error });
      throw error;
    }
  }
}
