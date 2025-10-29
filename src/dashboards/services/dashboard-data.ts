/**
 * Dashboard data services - aggregation and queries
 */

import { DrizzleDatabaseClient } from '../../services/database/drizzle-client';
import { desc, eq, and, sql, count, isNull } from 'drizzle-orm';
import * as schema from '../../services/database/schema';

export interface OverviewStats {
  totalGazettes: number;
  totalCrawlJobs: number;
  activeCrawlJobs: number;
  totalErrors: number;
  unresolvedErrors: number;
  ocrJobsPending: number;
  ocrJobsSuccess: number;
  ocrJobsFailed: number;
  webhooksPending: number;
  webhooksSent: number;
  totalConcursos: number;
  recentActivity: Array<{
    id: string;
    type: string;
    message: string;
    timestamp: string;
  }>;
}

export interface CrawlJobWithStats {
  id: string;
  jobType: string;
  status: string;
  totalCities: number;
  completedCities: number;
  failedCities: number;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  completionPercentage: number;
}

export interface ErrorLogWithContext {
  id: string;
  workerName: string;
  operationType: string;
  severity: string;
  errorCode: string | null;
  errorMessage: string;
  jobId: string | null;
  territoryId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface TelemetryStats {
  bySpiderType: Array<{
    spiderType: string;
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    avgExecutionTime: number;
  }>;
  byStep: Array<{
    step: string;
    totalRuns: number;
    completed: number;
    failed: number;
  }>;
  recentTelemetry: Array<{
    id: string;
    territoryId: string;
    spiderId: string;
    spiderType: string;
    step: string;
    status: string;
    gazettesFound: number | null;
    executionTimeMs: number | null;
    timestamp: string;
  }>;
}

export interface GazetteWithDetails {
  id: string;
  publicationDate: string;
  editionNumber: string | null;
  pdfUrl: string;
  status: string;
  createdAt: string;
  territoryId?: string;
  hasOcr: boolean;
  hasAnalysis: boolean;
}

export interface OcrJobStats {
  pending: number;
  processing: number;
  success: number;
  failure: number;
  avgProcessingTime: number;
  avgTextLength: number;
  recentJobs: Array<{
    id: string;
    documentId: string;
    status: string;
    pagesProcessed: number | null;
    processingTimeMs: number | null;
    textLength: number | null;
    createdAt: string;
    completedAt: string | null;
  }>;
}

export interface WebhookStats {
  pending: number;
  sent: number;
  failed: number;
  retry: number;
  avgAttempts: number;
  recentDeliveries: Array<{
    id: string;
    subscriptionId: string;
    eventType: string;
    status: string;
    attempts: number;
    statusCode: number | null;
    createdAt: string;
    deliveredAt: string | null;
  }>;
}

export interface ConcursoWithDetails {
  id: string;
  territoryId: string;
  documentType: string | null;
  confidence: number | null;
  orgao: string | null;
  editalNumero: string | null;
  totalVagas: number | null;
  extractionMethod: string | null;
  createdAt: string;
  gazettePublicationDate?: string;
}

/**
 * Get overview statistics
 */
export async function getOverviewStats(db: DrizzleDatabaseClient): Promise<OverviewStats> {
  const database = db.getDb();
  
  // Total gazettes
  const totalGazettesResult = await database
    .select({ count: count() })
    .from(schema.gazetteRegistry);
  const totalGazettes = totalGazettesResult[0]?.count || 0;

  // Crawl jobs stats
  const totalJobsResult = await database
    .select({ count: count() })
    .from(schema.crawlJobs);
  const totalCrawlJobs = totalJobsResult[0]?.count || 0;

  const activeJobsResult = await database
    .select({ count: count() })
    .from(schema.crawlJobs)
    .where(
      sql`${schema.crawlJobs.status} IN ('pending', 'running')`
    );
  const activeCrawlJobs = activeJobsResult[0]?.count || 0;

  // Error stats
  const totalErrorsResult = await database
    .select({ count: count() })
    .from(schema.errorLogs);
  const totalErrors = totalErrorsResult[0]?.count || 0;

  const unresolvedErrorsResult = await database
    .select({ count: count() })
    .from(schema.errorLogs)
    .where(isNull(schema.errorLogs.resolvedAt));
  const unresolvedErrors = unresolvedErrorsResult[0]?.count || 0;

  // OCR stats
  const ocrPendingResult = await database
    .select({ count: count() })
    .from(schema.ocrJobs)
    .where(eq(schema.ocrJobs.status, 'pending'));
  const ocrJobsPending = ocrPendingResult[0]?.count || 0;

  const ocrSuccessResult = await database
    .select({ count: count() })
    .from(schema.ocrJobs)
    .where(eq(schema.ocrJobs.status, 'success'));
  const ocrJobsSuccess = ocrSuccessResult[0]?.count || 0;

  const ocrFailedResult = await database
    .select({ count: count() })
    .from(schema.ocrJobs)
    .where(eq(schema.ocrJobs.status, 'failure'));
  const ocrJobsFailed = ocrFailedResult[0]?.count || 0;

  // Webhook stats
  const webhookPendingResult = await database
    .select({ count: count() })
    .from(schema.webhookDeliveries)
    .where(eq(schema.webhookDeliveries.status, 'pending'));
  const webhooksPending = webhookPendingResult[0]?.count || 0;

  const webhookSentResult = await database
    .select({ count: count() })
    .from(schema.webhookDeliveries)
    .where(eq(schema.webhookDeliveries.status, 'sent'));
  const webhooksSent = webhookSentResult[0]?.count || 0;

  // Concurso stats
  const totalConcursosResult = await database
    .select({ count: count() })
    .from(schema.concursoFindings);
  const totalConcursos = totalConcursosResult[0]?.count || 0;

  // Recent activity (from crawl telemetry)
  const recentTelemetry = await database
    .select()
    .from(schema.crawlTelemetry)
    .orderBy(desc(schema.crawlTelemetry.timestamp))
    .limit(10);

  const recentActivity = recentTelemetry.map((t) => ({
    id: t.id,
    type: 'crawl',
    message: `${t.spiderType} - ${t.territoryId}: ${t.step} ${t.status}`,
    timestamp: t.timestamp,
  }));

  return {
    totalGazettes,
    totalCrawlJobs,
    activeCrawlJobs,
    totalErrors,
    unresolvedErrors,
    ocrJobsPending,
    ocrJobsSuccess,
    ocrJobsFailed,
    webhooksPending,
    webhooksSent,
    totalConcursos,
    recentActivity,
  };
}

/**
 * Get recent crawl jobs with stats
 */
export async function getRecentCrawlJobs(
  db: DrizzleDatabaseClient,
  limit: number = 20
): Promise<CrawlJobWithStats[]> {
  const database = db.getDb();
  const jobs = await database
    .select()
    .from(schema.crawlJobs)
    .orderBy(desc(schema.crawlJobs.createdAt))
    .limit(limit);

  return jobs.map((job) => ({
    ...job,
    completionPercentage:
      job.totalCities > 0
        ? Math.round((job.completedCities / job.totalCities) * 100)
        : 0,
  }));
}

/**
 * Get error logs with filtering
 */
export async function getErrorLogs(
  db: DrizzleDatabaseClient,
  options: {
    limit?: number;
    severity?: string;
    resolved?: boolean;
  } = {}
): Promise<ErrorLogWithContext[]> {
  const { limit = 50, severity, resolved } = options;
  const database = db.getDb();

  let query = database.select().from(schema.errorLogs);

  const conditions = [];
  if (severity) {
    conditions.push(eq(schema.errorLogs.severity, severity));
  }
  if (resolved !== undefined) {
    if (resolved) {
      conditions.push(sql`${schema.errorLogs.resolvedAt} IS NOT NULL`);
    } else {
      conditions.push(isNull(schema.errorLogs.resolvedAt));
    }
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }

  const errors = await query
    .orderBy(desc(schema.errorLogs.createdAt))
    .limit(limit);

  return errors;
}

/**
 * Get telemetry statistics
 */
export async function getTelemetryStats(db: DrizzleDatabaseClient): Promise<TelemetryStats> {
  const database = db.getDb();
  
  // By spider type
  const bySpiderTypeRaw = await database
    .select({
      spiderType: schema.crawlTelemetry.spiderType,
      totalRuns: count(),
      successfulRuns: sql<number>`SUM(CASE WHEN ${schema.crawlTelemetry.status} = 'completed' THEN 1 ELSE 0 END)`,
      failedRuns: sql<number>`SUM(CASE WHEN ${schema.crawlTelemetry.status} = 'failed' THEN 1 ELSE 0 END)`,
      avgExecutionTime: sql<number>`AVG(${schema.crawlTelemetry.executionTimeMs})`,
    })
    .from(schema.crawlTelemetry)
    .groupBy(schema.crawlTelemetry.spiderType);

  const bySpiderType = bySpiderTypeRaw.map((row) => ({
    spiderType: row.spiderType,
    totalRuns: Number(row.totalRuns),
    successfulRuns: Number(row.successfulRuns),
    failedRuns: Number(row.failedRuns),
    avgExecutionTime: Number(row.avgExecutionTime) || 0,
  }));

  // By step
  const byStepRaw = await database
    .select({
      step: schema.crawlTelemetry.step,
      totalRuns: count(),
      completed: sql<number>`SUM(CASE WHEN ${schema.crawlTelemetry.status} = 'completed' THEN 1 ELSE 0 END)`,
      failed: sql<number>`SUM(CASE WHEN ${schema.crawlTelemetry.status} = 'failed' THEN 1 ELSE 0 END)`,
    })
    .from(schema.crawlTelemetry)
    .groupBy(schema.crawlTelemetry.step);

  const byStep = byStepRaw.map((row) => ({
    step: row.step,
    totalRuns: Number(row.totalRuns),
    completed: Number(row.completed),
    failed: Number(row.failed),
  }));

  // Recent telemetry
  const recentTelemetry = await database
    .select()
    .from(schema.crawlTelemetry)
    .orderBy(desc(schema.crawlTelemetry.timestamp))
    .limit(50);

  return {
    bySpiderType,
    byStep,
    recentTelemetry,
  };
}

/**
 * Get gazettes with details
 */
export async function getGazettes(
  db: DrizzleDatabaseClient,
  options: {
    limit?: number;
    status?: string;
  } = {}
): Promise<GazetteWithDetails[]> {
  const { limit = 50, status } = options;
  const database = db.getDb();

  let query = database.select().from(schema.gazetteRegistry);

  if (status) {
    query = query.where(eq(schema.gazetteRegistry.status, status)) as any;
  }

  const gazettes = await query
    .orderBy(desc(schema.gazetteRegistry.createdAt))
    .limit(limit);

  // Check for OCR and analysis for each gazette
  const gazettesWithDetails = await Promise.all(
    gazettes.map(async (gazette) => {
      const ocrResult = await database
        .select()
        .from(schema.ocrResults)
        .where(
          and(
            eq(schema.ocrResults.documentType, 'gazette_registry'),
            eq(schema.ocrResults.documentId, gazette.id)
          )
        )
        .limit(1);

      const analysisResult = await database
        .select()
        .from(schema.analysisResults)
        .where(eq(schema.analysisResults.gazetteId, gazette.id))
        .limit(1);

      return {
        ...gazette,
        hasOcr: ocrResult.length > 0,
        hasAnalysis: analysisResult.length > 0,
      };
    })
  );

  return gazettesWithDetails;
}

/**
 * Get OCR job statistics
 */
export async function getOcrJobStats(db: DrizzleDatabaseClient): Promise<OcrJobStats> {
  const database = db.getDb();
  
  // Status counts
  const statusCounts = await database
    .select({
      status: schema.ocrJobs.status,
      count: count(),
    })
    .from(schema.ocrJobs)
    .groupBy(schema.ocrJobs.status);

  const stats = {
    pending: 0,
    processing: 0,
    success: 0,
    failure: 0,
  };

  statusCounts.forEach((row) => {
    const status = row.status as keyof typeof stats;
    if (status in stats) {
      stats[status] = Number(row.count);
    }
  });

  // Average metrics
  const avgMetrics = await database
    .select({
      avgProcessingTime: sql<number>`AVG(${schema.ocrJobs.processingTimeMs})`,
      avgTextLength: sql<number>`AVG(${schema.ocrJobs.textLength})`,
    })
    .from(schema.ocrJobs)
    .where(eq(schema.ocrJobs.status, 'success'));

  const avgProcessingTime = Number(avgMetrics[0]?.avgProcessingTime) || 0;
  const avgTextLength = Number(avgMetrics[0]?.avgTextLength) || 0;

  // Recent jobs
  const recentJobs = await database
    .select()
    .from(schema.ocrJobs)
    .orderBy(desc(schema.ocrJobs.createdAt))
    .limit(50);

  return {
    ...stats,
    avgProcessingTime,
    avgTextLength,
    recentJobs,
  };
}

/**
 * Get webhook delivery statistics
 */
export async function getWebhookStats(db: DrizzleDatabaseClient): Promise<WebhookStats> {
  const database = db.getDb();
  
  // Status counts
  const statusCounts = await database
    .select({
      status: schema.webhookDeliveries.status,
      count: count(),
    })
    .from(schema.webhookDeliveries)
    .groupBy(schema.webhookDeliveries.status);

  const stats = {
    pending: 0,
    sent: 0,
    failed: 0,
    retry: 0,
  };

  statusCounts.forEach((row) => {
    const status = row.status as keyof typeof stats;
    if (status in stats) {
      stats[status] = Number(row.count);
    }
  });

  // Average attempts
  const avgAttemptsResult = await database
    .select({
      avgAttempts: sql<number>`AVG(${schema.webhookDeliveries.attempts})`,
    })
    .from(schema.webhookDeliveries);

  const avgAttempts = Number(avgAttemptsResult[0]?.avgAttempts) || 0;

  // Recent deliveries
  const recentDeliveries = await database
    .select()
    .from(schema.webhookDeliveries)
    .orderBy(desc(schema.webhookDeliveries.createdAt))
    .limit(50);

  return {
    ...stats,
    avgAttempts,
    recentDeliveries,
  };
}

/**
 * Get concurso findings
 */
export async function getConcursos(
  db: DrizzleDatabaseClient,
  options: {
    limit?: number;
    territoryId?: string;
  } = {}
): Promise<ConcursoWithDetails[]> {
  const { limit = 50, territoryId } = options;
  const database = db.getDb();

  let query = database
    .select({
      concurso: schema.concursoFindings,
      gazette: schema.gazetteRegistry,
    })
    .from(schema.concursoFindings)
    .leftJoin(
      schema.gazetteRegistry,
      eq(schema.concursoFindings.gazetteId, schema.gazetteRegistry.id)
    );

  if (territoryId) {
    query = query.where(eq(schema.concursoFindings.territoryId, territoryId)) as any;
  }

  const results = await query
    .orderBy(desc(schema.concursoFindings.createdAt))
    .limit(limit);

  return results.map((row) => ({
    ...row.concurso,
    gazettePublicationDate: row.gazette?.publicationDate,
  }));
}

