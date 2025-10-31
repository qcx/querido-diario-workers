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

/**
 * Analysis result with text metrics and pipeline status
 */
export interface AnalysisResultWithMetrics {
  id: string;
  jobId: string;
  gazetteId: string;
  territoryId: string;
  publicationDate: string;
  totalFindings: number;
  highConfidenceFindings: number;
  categories: string[];
  keywords: string[];
  processingTimeMs: number | null;
  analyzedAt: string;
  metadata: any;
  // Text metrics
  originalOcrTextLength: number | null;
  analyzedTextLength: number | null;
  reductionPercentage: number | null;
  filtered: boolean;
  // Pipeline info
  gazetteStatus: string;
  ocrStatus: string | null;
  ocrTextLength: number | null;
  ocrProcessingTimeMs: number | null;
}

/**
 * Get analysis results with text processing metrics
 */
export async function getAnalysisResults(
  db: DrizzleDatabaseClient,
  options: {
    limit?: number;
    territoryId?: string;
  } = {}
): Promise<AnalysisResultWithMetrics[]> {
  const { limit = 50, territoryId } = options;
  const database = db.getDb();

  let query = database
    .select({
      analysis: schema.analysisResults,
      gazette: schema.gazetteRegistry,
      ocrJob: schema.ocrJobs,
    })
    .from(schema.analysisResults)
    .leftJoin(
      schema.gazetteRegistry,
      eq(schema.analysisResults.gazetteId, schema.gazetteRegistry.id)
    )
    .leftJoin(
      schema.ocrJobs,
      and(
        eq(schema.ocrJobs.documentType, 'gazette_registry'),
        eq(schema.ocrJobs.documentId, schema.analysisResults.gazetteId)
      )
    );

  if (territoryId) {
    query = query.where(eq(schema.analysisResults.territoryId, territoryId)) as any;
  }

  const results = await query
    .orderBy(desc(schema.analysisResults.analyzedAt))
    .limit(limit);

  return results.map((row) => {
    const metadata = typeof row.analysis.metadata === 'string' 
      ? JSON.parse(row.analysis.metadata) 
      : row.analysis.metadata;
    const textLengths = metadata?.textLengths || {};

    return {
      id: row.analysis.id,
      jobId: row.analysis.jobId,
      gazetteId: row.analysis.gazetteId,
      territoryId: row.analysis.territoryId,
      publicationDate: row.analysis.publicationDate,
      totalFindings: row.analysis.totalFindings,
      highConfidenceFindings: row.analysis.highConfidenceFindings,
      categories: typeof row.analysis.categories === 'string'
        ? JSON.parse(row.analysis.categories)
        : row.analysis.categories,
      keywords: typeof row.analysis.keywords === 'string'
        ? JSON.parse(row.analysis.keywords)
        : row.analysis.keywords,
      processingTimeMs: row.analysis.processingTimeMs,
      analyzedAt: row.analysis.analyzedAt,
      metadata,
      // Text metrics from metadata
      originalOcrTextLength: textLengths.originalOcrText || null,
      analyzedTextLength: textLengths.consideredForAnalysis || null,
      reductionPercentage: textLengths.reductionPercentage || null,
      filtered: textLengths.filtered || false,
      // Pipeline info
      gazetteStatus: row.gazette?.status || 'unknown',
      ocrStatus: row.ocrJob?.status || null,
      ocrTextLength: row.ocrJob?.textLength || null,
      ocrProcessingTimeMs: row.ocrJob?.processingTimeMs || null,
    };
  });
}

/**
 * Gazette detail with full pipeline information
 */
export interface GazetteDetail {
  // Gazette info
  id: string;
  publicationDate: string;
  editionNumber: string | null;
  pdfUrl: string;
  status: string;
  territoryId: string | null;
  createdAt: string;
  metadata: any;
  // Crawl info
  crawlJobId: string | null;
  spiderId: string | null;
  gazetteScope: string | null;
  // OCR info
  ocrJobId: string | null;
  ocrStatus: string | null;
  ocrTextLength: number | null;
  ocrPagesProcessed: number | null;
  ocrProcessingTimeMs: number | null;
  ocrCompletedAt: string | null;
  ocrErrorMessage: string | null;
  // Analysis info
  analysisJobId: string | null;
  analysisTotalFindings: number | null;
  analysisHighConfidenceFindings: number | null;
  analysisCategories: string[] | null;
  analysisKeywords: string[] | null;
  analysisFindings: any[] | null;
  analysisSummary: any | null;
  analysisProcessingTimeMs: number | null;
  analysisAnalyzedAt: string | null;
  analysisMetadata: any | null;
  // Text metrics
  originalOcrTextLength: number | null;
  analyzedTextLength: number | null;
  reductionPercentage: number | null;
  filtered: boolean;
}

/**
 * Get single gazette with full details
 */
export async function getGazetteDetail(
  db: DrizzleDatabaseClient,
  gazetteId: string
): Promise<GazetteDetail | null> {
  const database = db.getDb();

  const result = await database
    .select({
      gazette: schema.gazetteRegistry,
      crawl: schema.gazetteCrawls,
      ocrJob: schema.ocrJobs,
      analysis: schema.analysisResults,
    })
    .from(schema.gazetteRegistry)
    .leftJoin(
      schema.gazetteCrawls,
      eq(schema.gazetteCrawls.gazetteId, schema.gazetteRegistry.id)
    )
    .leftJoin(
      schema.ocrJobs,
      and(
        eq(schema.ocrJobs.documentType, 'gazette_registry'),
        eq(schema.ocrJobs.documentId, schema.gazetteRegistry.id)
      )
    )
    .leftJoin(
      schema.analysisResults,
      eq(schema.analysisResults.gazetteId, schema.gazetteRegistry.id)
    )
    .where(eq(schema.gazetteRegistry.id, gazetteId))
    .limit(1);

  if (result.length === 0) {
    return null;
  }

  const row = result[0];
  const gazetteMetadata = typeof row.gazette.metadata === 'string'
    ? JSON.parse(row.gazette.metadata)
    : row.gazette.metadata;
  const crawlMetadata = row.crawl?.metadata 
    ? (typeof row.crawl.metadata === 'string' ? JSON.parse(row.crawl.metadata) : row.crawl.metadata)
    : null;
  const analysisMetadata = row.analysis?.metadata
    ? (typeof row.analysis.metadata === 'string' ? JSON.parse(row.analysis.metadata) : row.analysis.metadata)
    : null;
  const textLengths = analysisMetadata?.textLengths || {};

  return {
    // Gazette info
    id: row.gazette.id,
    publicationDate: row.gazette.publicationDate,
    editionNumber: row.gazette.editionNumber,
    pdfUrl: row.gazette.pdfUrl,
    status: row.gazette.status,
    territoryId: row.gazette.territoryId,
    createdAt: row.gazette.createdAt,
    metadata: gazetteMetadata,
    // Crawl info
    crawlJobId: row.crawl?.jobId || null,
    spiderId: row.crawl?.spiderId || null,
    gazetteScope: crawlMetadata?.gazetteScope || null,
    // OCR info
    ocrJobId: row.ocrJob?.id || null,
    ocrStatus: row.ocrJob?.status || null,
    ocrTextLength: row.ocrJob?.textLength || null,
    ocrPagesProcessed: row.ocrJob?.pagesProcessed || null,
    ocrProcessingTimeMs: row.ocrJob?.processingTimeMs || null,
    ocrCompletedAt: row.ocrJob?.completedAt || null,
    ocrErrorMessage: row.ocrJob?.errorMessage || null,
    // Analysis info
    analysisJobId: row.analysis?.jobId || null,
    analysisTotalFindings: row.analysis?.totalFindings || null,
    analysisHighConfidenceFindings: row.analysis?.highConfidenceFindings || null,
    analysisCategories: row.analysis?.categories
      ? (typeof row.analysis.categories === 'string' ? JSON.parse(row.analysis.categories) : row.analysis.categories)
      : null,
    analysisKeywords: row.analysis?.keywords
      ? (typeof row.analysis.keywords === 'string' ? JSON.parse(row.analysis.keywords) : row.analysis.keywords)
      : null,
    analysisFindings: row.analysis?.findings
      ? (typeof row.analysis.findings === 'string' ? JSON.parse(row.analysis.findings) : row.analysis.findings)
      : null,
    analysisSummary: row.analysis?.summary
      ? (typeof row.analysis.summary === 'string' ? JSON.parse(row.analysis.summary) : row.analysis.summary)
      : null,
    analysisProcessingTimeMs: row.analysis?.processingTimeMs || null,
    analysisAnalyzedAt: row.analysis?.analyzedAt || null,
    analysisMetadata,
    // Text metrics
    originalOcrTextLength: textLengths.originalOcrText || null,
    analyzedTextLength: textLengths.consideredForAnalysis || null,
    reductionPercentage: textLengths.reductionPercentage || null,
    filtered: textLengths.filtered || false,
  };
}

/**
 * Pipeline statistics for overview
 */
export interface PipelineStats {
  totalGazettes: number;
  gazettesWithOcr: number;
  gazettesWithAnalysis: number;
  pipelineSuccessRate: number; // % completing full pipeline
  avgOcrTextLength: number;
  avgAnalyzedTextLength: number;
  avgReductionPercentage: number;
  avgHighConfidenceFindings: number;
  avgOcrProcessingTime: number;
  avgAnalysisProcessingTime: number;
  stateGazetteCount: number;
  cityGazetteCount: number;
}

/**
 * Get pipeline statistics
 */
export async function getAnalysisPipelineStats(
  db: DrizzleDatabaseClient
): Promise<PipelineStats> {
  const database = db.getDb();

  // Total gazettes
  const totalGazettesResult = await database
    .select({ count: count() })
    .from(schema.gazetteRegistry);
  const totalGazettes = Number(totalGazettesResult[0]?.count || 0);

  // Gazettes with OCR
  const gazettesWithOcrResult = await database
    .select({ count: count() })
    .from(schema.gazetteRegistry)
    .innerJoin(
      schema.ocrJobs,
      and(
        eq(schema.ocrJobs.documentType, 'gazette_registry'),
        eq(schema.ocrJobs.documentId, schema.gazetteRegistry.id),
        eq(schema.ocrJobs.status, 'success')
      )
    );
  const gazettesWithOcr = Number(gazettesWithOcrResult[0]?.count || 0);

  // Gazettes with analysis
  const gazettesWithAnalysisResult = await database
    .select({ count: count() })
    .from(schema.gazetteRegistry)
    .innerJoin(
      schema.analysisResults,
      eq(schema.analysisResults.gazetteId, schema.gazetteRegistry.id)
    );
  const gazettesWithAnalysis = Number(gazettesWithAnalysisResult[0]?.count || 0);

  // Pipeline success rate
  const pipelineSuccessRate = totalGazettes > 0 
    ? Math.round((gazettesWithAnalysis / totalGazettes) * 100)
    : 0;

  // OCR averages
  const ocrAvgsResult = await database
    .select({
      avgTextLength: sql<number>`AVG(${schema.ocrJobs.textLength})`,
      avgProcessingTime: sql<number>`AVG(${schema.ocrJobs.processingTimeMs})`,
    })
    .from(schema.ocrJobs)
    .where(eq(schema.ocrJobs.status, 'success'));
  const avgOcrTextLength = Math.round(Number(ocrAvgsResult[0]?.avgTextLength || 0));
  const avgOcrProcessingTime = Math.round(Number(ocrAvgsResult[0]?.avgProcessingTime || 0));

  // Analysis averages
  const analysisAvgsResult = await database
    .select({
      avgHighConfidence: sql<number>`AVG(${schema.analysisResults.highConfidenceFindings})`,
      avgProcessingTime: sql<number>`AVG(${schema.analysisResults.processingTimeMs})`,
    })
    .from(schema.analysisResults);
  const avgHighConfidenceFindings = Number(analysisAvgsResult[0]?.avgHighConfidence || 0).toFixed(1);
  const avgAnalysisProcessingTime = Math.round(Number(analysisAvgsResult[0]?.avgProcessingTime || 0));

  // Text metrics - need to parse metadata JSON
  const analysisWithMetrics = await database
    .select({
      metadata: schema.analysisResults.metadata,
    })
    .from(schema.analysisResults);
  
  let totalAnalyzedTextLength = 0;
  let totalReductionPercentage = 0;
  let filteredCount = 0;

  analysisWithMetrics.forEach((row) => {
    try {
      const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
      const textLengths = metadata?.textLengths || {};
      if (textLengths.consideredForAnalysis) {
        totalAnalyzedTextLength += textLengths.consideredForAnalysis;
      }
      if (textLengths.filtered && textLengths.reductionPercentage) {
        totalReductionPercentage += textLengths.reductionPercentage;
        filteredCount++;
      }
    } catch (e) {
      // Skip parsing errors
    }
  });

  const avgAnalyzedTextLength = analysisWithMetrics.length > 0
    ? Math.round(totalAnalyzedTextLength / analysisWithMetrics.length)
    : 0;
  const avgReductionPercentage = filteredCount > 0
    ? Math.round(totalReductionPercentage / filteredCount)
    : 0;

  // State vs city gazettes (from crawl metadata)
  const crawls = await database
    .select({
      metadata: schema.gazetteCrawls.metadata,
    })
    .from(schema.gazetteCrawls);

  let stateGazetteCount = 0;
  let cityGazetteCount = 0;

  crawls.forEach((row) => {
    try {
      const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
      if (metadata?.gazetteScope === 'state') {
        stateGazetteCount++;
      } else if (metadata?.gazetteScope === 'city') {
        cityGazetteCount++;
      }
    } catch (e) {
      // Skip parsing errors
    }
  });

  return {
    totalGazettes,
    gazettesWithOcr,
    gazettesWithAnalysis,
    pipelineSuccessRate,
    avgOcrTextLength,
    avgAnalyzedTextLength,
    avgReductionPercentage,
    avgHighConfidenceFindings: Number(avgHighConfidenceFindings),
    avgOcrProcessingTime,
    avgAnalysisProcessingTime,
    stateGazetteCount,
    cityGazetteCount,
  };
}

