/**
 * Drizzle-based Telemetry Service
 * Replaces telemetry.ts with Drizzle ORM implementation
 */

import { eq, desc, gte, sql } from 'drizzle-orm';
import { DrizzleDatabaseClient, schema } from './drizzle-client';
import { logger } from '../../utils/logger';
import type { CrawlJobMetadata, CrawlTelemetryMetadata } from '../../types/database';

export type TelemetryStep = 'crawl_start' | 'crawl_end' | 'ocr_start' | 'ocr_end' | 'analysis_start' | 'analysis_end' | 'webhook_sent';
export type StepStatus = 'started' | 'completed' | 'failed' | 'skipped';
export type JobType = 'scheduled' | 'manual' | 'cities';
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface CrawlJobData {
  id?: string;
  jobType: JobType;
  totalCities: number;
  startDate?: string;
  endDate?: string;
  platformFilter?: string;
  metadata?: CrawlJobMetadata;
}

export interface TelemetryStepData {
  crawlJobId: string;
  territoryId: string;
  spiderId: string;
  spiderType: string;
  step: TelemetryStep;
  status: StepStatus;
  gazettesFound?: number;
  executionTimeMs?: number;
  errorMessage?: string;
  retryCount?: number;
  metadata?: CrawlTelemetryMetadata;
}

export class DrizzleTelemetryService {
  constructor(private dbClient: DrizzleDatabaseClient) {}

  /**
   * Create a new crawl job
   */
  async createCrawlJob(jobData: CrawlJobData): Promise<string> {
    try {
      const db = this.dbClient.getDb();

      const crawlJob = {
        id: jobData.id || this.dbClient.generateId(),
        jobType: jobData.jobType,
        status: 'pending' as JobStatus,
        totalCities: jobData.totalCities,
        completedCities: 0,
        failedCities: 0,
        startDate: jobData.startDate || null,
        endDate: jobData.endDate || null,
        platformFilter: jobData.platformFilter || null,
        createdAt: this.dbClient.getCurrentTimestamp(),
        startedAt: null,
        completedAt: null,
        metadata: this.dbClient.stringifyJson(jobData.metadata || {})
      };

      const result = await db.insert(schema.crawlJobs)
        .values(crawlJob)
        .returning({ id: schema.crawlJobs.id });

      logger.info('Crawl job created', {
        jobId: result[0].id,
        jobType: jobData.jobType,
        totalCities: jobData.totalCities
      });

      return result[0].id;
    } catch (error) {
      logger.error('Failed to create crawl job', error as Error, {
        jobData
      });
      throw error;
    }
  }

  /**
   * Update crawl job status
   */
  async updateCrawlJobStatus(
    jobId: string,
    status: JobStatus,
    updates?: {
      completedCities?: number;
      failedCities?: number;
    }
  ): Promise<void> {
    try {
      const db = this.dbClient.getDb();

      const updateData: any = {
        status,
        ...(status === 'running' ? { startedAt: this.dbClient.getCurrentTimestamp() } : {}),
        ...(status === 'completed' || status === 'failed' ? { completedAt: this.dbClient.getCurrentTimestamp() } : {}),
        ...(updates?.completedCities !== undefined ? { completedCities: updates.completedCities } : {}),
        ...(updates?.failedCities !== undefined ? { failedCities: updates.failedCities } : {}),
      };

      await db.update(schema.crawlJobs)
        .set(updateData)
        .where(eq(schema.crawlJobs.id, jobId));

      logger.info('Crawl job status updated', {
        jobId,
        status,
        updates
      });
    } catch (error) {
      logger.error('Failed to update crawl job status', error as Error, {
        jobId,
        status
      });
      throw error;
    }
  }

  /**
   * Record telemetry step
   */
  async recordStep(stepData: TelemetryStepData): Promise<string> {
    try {
      const db = this.dbClient.getDb();

      const telemetryRecord = {
        id: this.dbClient.generateId(),
        crawlJobId: stepData.crawlJobId,
        territoryId: stepData.territoryId,
        spiderId: stepData.spiderId,
        spiderType: stepData.spiderType,
        step: stepData.step,
        status: stepData.status,
        gazettesFound: stepData.gazettesFound || 0,
        executionTimeMs: stepData.executionTimeMs || null,
        errorMessage: stepData.errorMessage || null,
        retryCount: stepData.retryCount || 0,
        timestamp: this.dbClient.getCurrentTimestamp(),
        metadata: this.dbClient.stringifyJson(stepData.metadata || {})
      };

      const result = await db.insert(schema.crawlTelemetry)
        .values(telemetryRecord)
        .returning({ id: schema.crawlTelemetry.id });

      // Update crawl job counters if this is an end step
      if (stepData.step.endsWith('_end')) {
        await this.updateJobCounters(stepData.crawlJobId, stepData.status);
      }

      logger.debug('Telemetry step recorded', {
        telemetryId: result[0].id,
        crawlJobId: stepData.crawlJobId,
        territoryId: stepData.territoryId,
        step: stepData.step,
        status: stepData.status
      });

      return result[0].id;
    } catch (error) {
      logger.error('Failed to record telemetry step', error as Error, {
        stepData
      });
      throw error;
    }
  }

  /**
   * Get crawl job by ID
   */
  async getCrawlJob(jobId: string): Promise<{
    id: string;
    jobType: string;
    status: string;
    totalCities: number;
    completedCities: number;
    failedCities: number;
    startDate: string | null;
    endDate: string | null;
    platformFilter: string | null;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
    metadata: CrawlJobMetadata;
  } | null> {
    try {
      const db = this.dbClient.getDb();

      const results = await db.select()
        .from(schema.crawlJobs)
        .where(eq(schema.crawlJobs.id, jobId))
        .limit(1);

      if (results.length === 0) {
        return null;
      }

      const job = results[0];
      return {
        ...job,
        metadata: this.dbClient.parseJson<CrawlJobMetadata>(job.metadata, {})
      };
    } catch (error) {
      logger.error('Failed to get crawl job', error as Error, {
        jobId
      });
      throw error;
    }
  }

  /**
   * Get telemetry for a crawl job
   */
  async getJobTelemetry(jobId: string): Promise<{
    id: string;
    crawlJobId: string;
    territoryId: string;
    spiderId: string;
    spiderType: string;
    step: string;
    status: string;
    gazettesFound: number | null;
    executionTimeMs: number | null;
    errorMessage: string | null;
    retryCount: number;
    timestamp: string;
    metadata: CrawlTelemetryMetadata;
  }[]> {
    try {
      const db = this.dbClient.getDb();

      const telemetry = await db.select()
        .from(schema.crawlTelemetry)
        .where(eq(schema.crawlTelemetry.crawlJobId, jobId))
        .orderBy(schema.crawlTelemetry.timestamp);

      return telemetry.map(record => ({
        ...record,
        retryCount: record.retryCount ?? 0,
        metadata: this.dbClient.parseJson<CrawlTelemetryMetadata>(record.metadata, {})
      }));
    } catch (error) {
      logger.error('Failed to get job telemetry', error as Error, {
        jobId
      });
      throw error;
    }
  }

  /**
   * Get recent crawl jobs
   */
  async getRecentJobs(limit: number = 10): Promise<{
    id: string;
    jobType: string;
    status: string;
    totalCities: number;
    completedCities: number;
    failedCities: number;
    startDate: string | null;
    endDate: string | null;
    platformFilter: string | null;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
    metadata: CrawlJobMetadata;
  }[]> {
    try {
      const db = this.dbClient.getDb();

      const jobs = await db.select()
        .from(schema.crawlJobs)
        .orderBy(desc(schema.crawlJobs.createdAt))
        .limit(limit);

      return jobs.map(job => ({
        ...job,
        metadata: this.dbClient.parseJson<CrawlJobMetadata>(job.metadata, {})
      }));
    } catch (error) {
      logger.error('Failed to get recent jobs', error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Get pipeline health summary
   */
  async getHealthSummary(hours: number = 24): Promise<{
    totalJobs: number;
    activeJobs: number;
    completedJobs: number;
    failedJobs: number;
    totalCities: number;
    successfulCities: number;
    failedCities: number;
    averageExecutionTime: number;
  }> {
    try {
      const db = this.dbClient.getDb();
      const cutoffDate = new Date();
      cutoffDate.setHours(cutoffDate.getHours() - hours);
      const cutoffDateStr = cutoffDate.toISOString();

      // Get job statistics
      const jobs = await db.select()
        .from(schema.crawlJobs)
        .where(gte(schema.crawlJobs.createdAt, cutoffDateStr));

      // Get telemetry statistics
      const telemetry = await db.select()
        .from(schema.crawlTelemetry)
        .where(gte(schema.crawlTelemetry.timestamp, cutoffDateStr));

      const totalJobs = jobs.length;
      const activeJobs = jobs.filter(j => j.status === 'running').length;
      const completedJobs = jobs.filter(j => j.status === 'completed').length;
      const failedJobs = jobs.filter(j => j.status === 'failed').length;

      const totalCities = jobs.reduce((sum, j) => sum + j.totalCities, 0);
      const successfulCities = jobs.reduce((sum, j) => sum + j.completedCities, 0);
      const failedCities = jobs.reduce((sum, j) => sum + j.failedCities, 0);

      const executionTimes = telemetry
        .filter(t => t.executionTimeMs)
        .map(t => t.executionTimeMs!);
      const averageExecutionTime = executionTimes.length > 0
        ? Math.round(executionTimes.reduce((sum, time) => sum + time, 0) / executionTimes.length)
        : 0;

      return {
        totalJobs,
        activeJobs,
        completedJobs,
        failedJobs,
        totalCities,
        successfulCities,
        failedCities,
        averageExecutionTime
      };
    } catch (error) {
      logger.error('Failed to get health summary', error as Error, {
        hours
      });
      throw error;
    }
  }

  /**
   * Track a city crawl step (compatibility method)
   */
  async trackCityStep(
    crawlJobId: string,
    territoryId: string,
    spiderId: string,
    step: TelemetryStep,
    status: StepStatus,
    gazettesFound?: number,
    executionTimeMs?: number,
    errorMessage?: string
  ): Promise<void> {
    const stepData: TelemetryStepData = {
      crawlJobId,
      territoryId,
      spiderId,
      spiderType: spiderId, // Use spiderId as spiderType for compatibility
      step,
      status,
      gazettesFound,
      executionTimeMs,
      errorMessage,
      retryCount: 0
    };

    await this.recordStep(stepData);
  }

  /**
   * Track crawl job start (compatibility method)
   */
  async trackCrawlJobStart(jobId: string, _jobType: JobType): Promise<void> {
    await this.updateCrawlJobStatus(jobId, 'running');
  }

  /**
   * Update crawl job (compatibility method)  
   */
  async updateCrawlJob(
    jobId: string,
    updates: {
      status?: JobStatus;
      completedCities?: number;
      failedCities?: number;
    }
  ): Promise<void> {
    if (updates.status) {
      await this.updateCrawlJobStatus(jobId, updates.status, {
        completedCities: updates.completedCities,
        failedCities: updates.failedCities
      });
    }
  }

  /**
   * Update job counters based on step completion
   */
  private async updateJobCounters(jobId: string, stepStatus: StepStatus): Promise<void> {
    try {
      const db = this.dbClient.getDb();

      if (stepStatus === 'completed') {
        await db.update(schema.crawlJobs)
          .set({
            completedCities: sql`${schema.crawlJobs.completedCities} + 1`
          } as any)
          .where(eq(schema.crawlJobs.id, jobId));
      } else if (stepStatus === 'failed') {
        await db.update(schema.crawlJobs)
          .set({
            failedCities: sql`${schema.crawlJobs.failedCities} + 1`
          } as any)
          .where(eq(schema.crawlJobs.id, jobId));
      }
    } catch (error) {
      logger.error('Failed to update job counters', error as Error, {
        jobId,
        stepStatus
      });
      // Don't throw - this is a best-effort update
    }
  }
}
