/**
 * Database Services Index
 * Central exports for all database-related services
 */

export { DatabaseClient, getDatabase, initTestDatabase } from './client';
export type { DatabaseConfig, DatabaseEnv } from './client';

export { TelemetryService } from './telemetry';
export type { 
  TelemetryStep, 
  StepStatus, 
  JobType, 
  JobStatus, 
  CrawlJobData, 
  TelemetryStepData 
} from './telemetry';

export { GazetteRepository } from './gazette-repo';
export type { GazetteRecord } from './gazette-repo';

export { AnalysisRepository } from './analysis-repo';
export type { AnalysisRecord } from './analysis-repo';

export { WebhookRepository } from './webhook-repo';
export type { WebhookDeliveryRecord } from './webhook-repo';

export { ErrorTracker } from './error-tracker';
export type { 
  ErrorLog, 
  ErrorLogRecord, 
  ErrorSeverity, 
  ErrorStatistics 
} from './error-tracker';

export { ConcursoRepository } from './concurso-repo';
export type { 
  ConcursoRecord, 
  ConcursoSearchFilters 
} from './concurso-repo';

export { OcrRepository } from './ocr-repo';
export type { 
  OcrResultRecord, 
  OcrPageRecord, 
  OcrPageData 
} from './ocr-repo';

export { DashboardQueries } from './dashboard-queries';
export type {
  PipelineHealthData,
  ErrorSummary,
  SystemStatus
} from './dashboard-queries';
