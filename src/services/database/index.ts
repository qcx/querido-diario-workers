/**
 * Database Services Index
 * D1/Drizzle-based database services
 */

// D1 Database client and schema
export { DrizzleDatabaseClient, getDatabase, schema } from './drizzle-client';
export type { D1DatabaseEnv } from './drizzle-client';

// D1-based repositories (renamed for simplicity)
export { DrizzleGazetteRepository as GazetteRepository } from './drizzle-gazette-repo';
export { DrizzleAnalysisRepository as AnalysisRepository } from './drizzle-analysis-repo';
export { DrizzleOcrRepository as OcrRepository } from './drizzle-ocr-repo';
export { DrizzleErrorTracker as ErrorTracker } from './drizzle-error-tracker';
export { DrizzleWebhookRepository as WebhookRepository } from './drizzle-webhook-repo';
export { DrizzleConcursoRepository as ConcursoRepository } from './drizzle-concurso-repo';
export { DrizzleTelemetryService as TelemetryService } from './drizzle-telemetry';

// Type exports
export type { ConcursoRecord, ConcursoSearchFilters } from './drizzle-concurso-repo';
export type { ErrorLog, ErrorLogRecord, ErrorStatistics } from './drizzle-error-tracker';
export type { OcrResultRecord, OcrMetadataRecord } from './drizzle-ocr-repo';
export type { WebhookDeliveryRecord } from './drizzle-webhook-repo';
export type { TelemetryStep, StepStatus, JobType, JobStatus, CrawlJobData, TelemetryStepData } from './drizzle-telemetry';

// Legacy type exports for compatibility
export type { GazetteRecord } from './drizzle-gazette-repo';
export type { AnalysisRecord } from './drizzle-analysis-repo';
