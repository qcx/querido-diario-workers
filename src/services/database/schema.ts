/**
 * Drizzle Schema Definition
 * Compatible with both PostgreSQL (current) and D1/SQLite (target)
 */

import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

// Job Type enum values
export const JOB_TYPES = ['scheduled', 'manual', 'cities'] as const;
export const JOB_STATUSES = ['pending', 'running', 'completed', 'failed'] as const;
export const TELEMETRY_STEPS = ['crawl_start', 'crawl_end', 'ocr_start', 'ocr_end', 'analysis_start', 'analysis_end', 'webhook_sent'] as const;
export const STEP_STATUSES = ['started', 'completed', 'failed', 'skipped'] as const;
export const OCR_STATUSES = ['pending', 'processing', 'success', 'failure', 'partial'] as const;
export const WEBHOOK_STATUSES = ['pending', 'sent', 'failed', 'retry'] as const;
export const ERROR_SEVERITIES = ['warning', 'error', 'critical'] as const;
export const GAZETTE_REGISTRY_STATUSES = ['pending', 'uploaded', 'ocr_processing', 'ocr_retrying', 'ocr_failure', 'ocr_success'] as const;
export const GAZETTE_CRAWL_STATUSES = ['created', 'processing', 'success', 'failed', 'analysis_pending'] as const;

// 1. CRAWL_JOBS - Track crawling sessions
export const crawlJobs = sqliteTable('crawl_jobs', {
  id: text('id').primaryKey(),
  jobType: text('job_type').notNull(),
  status: text('status').notNull().default('pending'),
  totalCities: integer('total_cities').notNull().default(0),
  completedCities: integer('completed_cities').notNull().default(0),
  failedCities: integer('failed_cities').notNull().default(0),
  startDate: text('start_date'), // ISO 8601 date
  endDate: text('end_date'), // ISO 8601 date
  platformFilter: text('platform_filter'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  metadata: text('metadata').notNull().default('{}') // JSON string
}, (table) => ({
  activeJobsIdx: index('idx_active_crawl_jobs').on(table.createdAt).where(sql`status IN ('pending', 'running')`),
}));

// 2. CRAWL_TELEMETRY - Track per-city crawl progress
export const crawlTelemetry = sqliteTable('crawl_telemetry', {
  id: text('id').primaryKey(),
  crawlJobId: text('crawl_job_id').notNull().references(() => crawlJobs.id, { onDelete: 'cascade' }),
  territoryId: text('territory_id').notNull(),
  spiderId: text('spider_id').notNull(),
  spiderType: text('spider_type').notNull(),
  step: text('step').notNull(),
  status: text('status').notNull(),
  gazettesFound: integer('gazettes_found').default(0),
  executionTimeMs: integer('execution_time_ms'),
  errorMessage: text('error_message'),
  retryCount: integer('retry_count').default(0),
  timestamp: text('timestamp').notNull().default(sql`(datetime('now'))`),
  metadata: text('metadata').notNull().default('{}')
}, (table) => ({
  jobTerritoryIdx: index('idx_crawl_telemetry_job_territory').on(table.crawlJobId, table.territoryId),
  timestampIdx: index('idx_crawl_telemetry_timestamp').on(table.timestamp),
  stepStatusIdx: index('idx_crawl_telemetry_step_status').on(table.step, table.status),
}));

// 3. GAZETTE_REGISTRY - Gazette metadata (permanent record)
// Defined before gazette_crawls to avoid TDZ issues with forward references
export const gazetteRegistry = sqliteTable('gazette_registry', {
  id: text('id').primaryKey(),
  publicationDate: text('publication_date').notNull(), // ISO 8601 date
  editionNumber: text('edition_number'),
  pdfUrl: text('pdf_url').notNull().unique(),
  pdfR2Key: text('pdf_r2_key'),
  isExtraEdition: integer('is_extra_edition', { mode: 'boolean' }).notNull().default(false),
  power: text('power'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  status: text('status').notNull().default('pending'),
  metadata: text('metadata').notNull().default('{}')
}, (table) => ({
  publicationDateIdx: index('idx_gazette_registry_publication_date').on(table.publicationDate),
  pdfUrlIdx: index('idx_gazette_registry_pdf_url').on(table.pdfUrl),
  statusIdx: index('idx_gazette_registry_status').on(table.status, table.createdAt),
}));

// 4. OCR_RESULTS - OCR results with extracted text
export const ocrResults = sqliteTable('ocr_results', {
  id: text('id').primaryKey(),
  documentType: text('document_type').notNull().default('gazette_registry'),
  documentId: text('document_id').notNull(),
  extractedText: text('extracted_text').notNull(),
  textLength: integer('text_length').notNull().default(0),
  confidenceScore: real('confidence_score'),
  languageDetected: text('language_detected').default('pt'),
  processingMethod: text('processing_method').default('mistral'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  metadata: text('metadata').notNull().default('{}') // Includes aiUsage with cost info
}, (table) => ({
  documentIdx: index('idx_ocr_results_document').on(table.documentType, table.documentId),
  createdAtIdx: index('idx_ocr_results_created_at').on(table.createdAt),
}));

// 5. OCR_JOBS - OCR job tracking (not the text)
export const ocrJobs = sqliteTable('ocr_jobs', {
  id: text('id').primaryKey(),
  documentType: text('document_type').notNull().default('gazette_registry'),
  documentId: text('document_id').notNull(),
  status: text('status').notNull().default('pending'),
  pagesProcessed: integer('pages_processed'),
  processingTimeMs: integer('processing_time_ms'),
  textLength: integer('text_length'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  completedAt: text('completed_at'),
  metadata: text('metadata').notNull().default('{}')
}, (table) => ({
  statusIdx: index('idx_ocr_jobs_status').on(table.status, table.createdAt),
  documentIdx: index('idx_ocr_jobs_document').on(table.documentType, table.documentId),
  createdAtIdx: index('idx_ocr_jobs_created_at').on(table.createdAt),
}));

// 6. ANALYSIS_RESULTS - Full analysis results
// Defined before gazette_crawls to avoid TDZ issues with forward references
export const analysisResults = sqliteTable('analysis_results', {
  id: text('id').primaryKey(),
  jobId: text('job_id').unique().notNull(),
  gazetteId: text('gazette_id').notNull().references(() => gazetteRegistry.id, { onDelete: 'cascade' }),
  territoryId: text('territory_id').notNull(),
  publicationDate: text('publication_date').notNull(), // ISO 8601 date
  totalFindings: integer('total_findings').notNull().default(0),
  highConfidenceFindings: integer('high_confidence_findings').notNull().default(0),
  categories: text('categories').notNull().default('[]'), // JSON array
  keywords: text('keywords').notNull().default('[]'), // JSON array
  findings: text('findings').notNull().default('[]'), // JSON array
  summary: text('summary').notNull().default('{}'), // JSON object
  processingTimeMs: integer('processing_time_ms'),
  analyzedAt: text('analyzed_at').notNull(), // ISO 8601 timestamp
  metadata: text('metadata').notNull().default('{}') // Includes aiUsage costs, configSignature, etc.
}, (table) => ({
  territoryDateIdx: index('idx_analysis_territory_date').on(table.territoryId, table.publicationDate),
  highConfidenceIdx: index('idx_analysis_high_confidence').on(table.highConfidenceFindings),
  jobIdIdx: index('idx_analysis_job_id').on(table.jobId),
  gazetteIdIdx: index('idx_analysis_gazette_id').on(table.gazetteId),
}));

// 7. GAZETTE_CRAWLS - Track crawl-specific metadata and relationships
// Defined after gazetteRegistry and analysisResults to avoid TDZ issues
export const gazetteCrawls = sqliteTable('gazette_crawls', {
  id: text('id').primaryKey(),
  jobId: text('job_id').unique().notNull(),
  territoryId: text('territory_id').notNull(),
  spiderId: text('spider_id').notNull(),
  gazetteId: text('gazette_id').notNull().references(() => gazetteRegistry.id, { onDelete: 'cascade' }),
  analysisResultId: text('analysis_result_id').references(() => analysisResults.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('created'),
  scrapedAt: text('scraped_at').notNull(), // ISO 8601 timestamp
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`)
}, (table) => ({
  territoryDateIdx: index('idx_gazette_crawls_territory_date').on(table.territoryId, table.scrapedAt),
  spiderIdx: index('idx_gazette_crawls_spider').on(table.spiderId, table.scrapedAt),
  jobIdIdx: index('idx_gazette_crawls_job_id').on(table.jobId),
  gazetteIdIdx: index('idx_gazette_crawls_gazette_id').on(table.gazetteId),
  analysisResultIdx: index('idx_gazette_crawls_analysis_result').on(table.analysisResultId),
}));

// 8. WEBHOOK_DELIVERIES - Webhook delivery logs
export const webhookDeliveries = sqliteTable('webhook_deliveries', {
  id: text('id').primaryKey(),
  notificationId: text('notification_id').unique().notNull(),
  subscriptionId: text('subscription_id').notNull(),
  analysisJobId: text('analysis_job_id'),
  eventType: text('event_type').notNull(),
  status: text('status').notNull().default('pending'),
  statusCode: integer('status_code'),
  attempts: integer('attempts').notNull().default(0),
  responseBody: text('response_body'),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  deliveredAt: text('delivered_at'),
  nextRetryAt: text('next_retry_at'),
  metadata: text('metadata').notNull().default('{}')
}, (table) => ({
  statusRetryIdx: index('idx_webhook_status_retry').on(table.status, table.nextRetryAt),
  subscriptionIdx: index('idx_webhook_subscription').on(table.subscriptionId, table.createdAt),
  notificationIdIdx: index('idx_webhook_notification_id').on(table.notificationId),
  failedWebhooksIdx: index('idx_failed_webhooks').on(table.nextRetryAt).where(sql`status = 'retry'`),
  subscriptionAnalysisIdx: index('idx_webhook_subscription_analysis').on(table.subscriptionId, table.analysisJobId, table.status),
}));

// 9. CONCURSO_FINDINGS - Dedicated concurso data
export const concursoFindings = sqliteTable('concurso_findings', {
  id: text('id').primaryKey(),
  analysisJobId: text('analysis_job_id').notNull(),
  gazetteId: text('gazette_id').notNull().references(() => gazetteRegistry.id, { onDelete: 'cascade' }),
  territoryId: text('territory_id').notNull(),
  documentType: text('document_type'),
  confidence: real('confidence'),
  orgao: text('orgao'),
  editalNumero: text('edital_numero'),
  totalVagas: integer('total_vagas').default(0),
  cargos: text('cargos').notNull().default('[]'), // JSON array
  datas: text('datas').notNull().default('{}'), // JSON object
  taxas: text('taxas').notNull().default('[]'), // JSON array
  banca: text('banca').notNull().default('{}'), // JSON object
  extractionMethod: text('extraction_method'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`)
}, (table) => ({
  territoryIdx: index('idx_concurso_territory').on(table.territoryId, table.createdAt),
  vagasIdx: index('idx_concurso_vagas').on(table.totalVagas),
  analysisJobIdx: index('idx_concurso_analysis_job').on(table.analysisJobId),
}));

// 10. ERROR_LOGS - Comprehensive error tracking for dashboard
export const errorLogs = sqliteTable('error_logs', {
  id: text('id').primaryKey(),
  workerName: text('worker_name').notNull(),
  operationType: text('operation_type').notNull(),
  severity: text('severity').notNull(),
  errorCode: text('error_code'),
  errorMessage: text('error_message').notNull(),
  stackTrace: text('stack_trace'),
  context: text('context').notNull().default('{}'), // JSON object
  jobId: text('job_id'),
  territoryId: text('territory_id'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  resolvedAt: text('resolved_at'),
  resolutionNotes: text('resolution_notes')
}, (table) => ({
  severityTimeIdx: index('idx_error_logs_severity_time').on(table.severity, table.createdAt),
  workerIdx: index('idx_error_logs_worker').on(table.workerName, table.createdAt),
  unresolvedIdx: index('idx_error_logs_unresolved').on(table.createdAt).where(sql`resolved_at IS NULL`),
}));

// Type exports for use in application
export type CrawlJob = typeof crawlJobs.$inferSelect;
export type InsertCrawlJob = typeof crawlJobs.$inferInsert;

export type CrawlTelemetry = typeof crawlTelemetry.$inferSelect;
export type InsertCrawlTelemetry = typeof crawlTelemetry.$inferInsert;

export type GazetteCrawl = typeof gazetteCrawls.$inferSelect;
export type InsertGazetteCrawl = typeof gazetteCrawls.$inferInsert;

export type GazetteRegistry = typeof gazetteRegistry.$inferSelect;
export type InsertGazetteRegistry = typeof gazetteRegistry.$inferInsert;

export type OcrResult = typeof ocrResults.$inferSelect;
export type InsertOcrResult = typeof ocrResults.$inferInsert;

export type OcrJob = typeof ocrJobs.$inferSelect;
export type InsertOcrJob = typeof ocrJobs.$inferInsert;

export type AnalysisResult = typeof analysisResults.$inferSelect;
export type InsertAnalysisResult = typeof analysisResults.$inferInsert;

export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type InsertWebhookDelivery = typeof webhookDeliveries.$inferInsert;

export type ConcursoFinding = typeof concursoFindings.$inferSelect;
export type InsertConcursoFinding = typeof concursoFindings.$inferInsert;

export type ErrorLog = typeof errorLogs.$inferSelect;
export type InsertErrorLog = typeof errorLogs.$inferInsert;
