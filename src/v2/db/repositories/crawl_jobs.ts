/**
 * Drizzle-based Crawl Jobs Repository
 */

import { eq } from 'drizzle-orm';
import { DatabaseClient } from '../index';
import { schema } from '../index';
import { BaseMetadata } from '../types';

type JobType = 'scheduled' | 'manual' | 'cities';
type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export type TelemetryStep = 'crawl_start' | 'crawl_end' | 'ocr_start' | 'ocr_end' | 'analysis_start' | 'analysis_end' | 'webhook_sent';
export type StepStatus = 'started' | 'completed' | 'failed' | 'skipped';


export interface CrawlJobMetadata extends BaseMetadata {
  initiatedBy?: string;
  originalDateRange?: {
    start: string;
    end: string;
  };
  config?: {
    maxRetries?: number;
    timeout?: number;
    concurrency?: number;
  };
  filters?: {
    platforms?: string[];
    territories?: string[];
    excludeWeekends?: boolean;
  };
}

interface CrawlTelemetryMetadata extends BaseMetadata {
  spiderConfig?: {
    baseUrl?: string;
    timeout?: number;
    retryCount?: number;
  };
  httpDetails?: {
    requestCount?: number;
    averageResponseTime?: number;
    statusCodes?: Record<string, number>;
  };
  performance?: {
    memoryUsage?: number;
    cpuTime?: number;
    networkLatency?: number;
  };
  debug?: {
    userAgent?: string;
    cookies?: boolean;
    javascript?: boolean;
  };
}

interface CrawlJobData {
  jobType: JobType;
  totalCities: number;
  startDate?: string;
  endDate?: string;
  platformFilter?: string;
  metadata?: CrawlJobMetadata;
}

type ProgressData = {
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
  failedCount?: number;
}

export class CrawlJobsRepository {
  constructor(private dbClient: DatabaseClient) {}

  async create(crawlJobData: CrawlJobData): Promise<typeof schema.crawlJobs.$inferSelect> {
    const db = this.dbClient.getDb();

    const crawlJob = {
      ...crawlJobData,
      id: this.dbClient.generateId(),
      status: 'pending' as JobStatus,
      createdAt: this.dbClient.getCurrentTimestamp(),
      metadata: this.dbClient.stringifyJson(crawlJobData.metadata || {})
    };

    const result = await db.insert(schema.crawlJobs).values(crawlJob).returning();
    return result[0];
  }

  async trackStart(crawlJobId: string): Promise<typeof schema.crawlJobs.$inferSelect> {
    return await this.updateStatus(crawlJobId, 'running');
  }

  async trackProgress(progressData: ProgressData): Promise<typeof schema.crawlTelemetry.$inferSelect> {
    const db = this.dbClient.getDb();

    const progressRecord = {
      ...progressData,
      id: this.dbClient.generateId(),
      metadata: this.dbClient.stringifyJson(progressData.metadata || {})
    };

    const result = await db.insert(schema.crawlTelemetry).values(progressRecord).returning();
    return result[0];
  }

  async trackFailure(crawlJobId: string, errorMessage: string, progressData: Omit<ProgressData, 'crawlJobId'>): Promise<typeof schema.crawlJobs.$inferSelect> {
    
    await this.trackProgress({
      ...progressData,
      crawlJobId,
      status: 'failed',
      errorMessage
    });

    return await this.updateStatus(crawlJobId, 'failed');
  }

  private async updateStatus(crawlJobId: string, status: JobStatus): Promise<typeof schema.crawlJobs.$inferSelect> {
    const db = this.dbClient.getDb();

    const updateData: Partial<typeof schema.crawlJobs.$inferInsert> = {
      status,
      ...(status === 'running' ? { startedAt: this.dbClient.getCurrentTimestamp() } : {}),
      ...(status === 'completed' || status === 'failed' ? { completedAt: this.dbClient.getCurrentTimestamp() } : {}),
    };

    const result = await db.update(schema.crawlJobs).set(updateData).where(eq(schema.crawlJobs.id, crawlJobId)).returning();
    return result[0];
  }
}