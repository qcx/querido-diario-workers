/**
 * Dashboard Type Definitions
 */

export interface OverviewStats {
  totalGazettes: number;
  totalOcrJobs: number;
  totalAnalyses: number;
  totalConcursos: number;
  ocrSuccessRate: number;
  analysisSuccessRate: number;
  avgProcessingTimeMs: number;
}

export interface StateCoverage {
  uf: string;
  stateName: string;
  totalMunicipalities: number;
  coveredMunicipalities: number;
  percentage: number;
  totalConfigs: number;
}

export interface TrendPoint {
  date: string;
  gazettes: number;
  ocrJobs: number;
  analyses: number;
  concursos: number;
}

export interface ConcursoData {
  id: string;
  territoryId: string;
  territoryName: string;
  orgao: string | null;
  editalNumero: string | null;
  totalVagas: number;
  confidence: number | null;
  publicationDate: string;
  createdAt: string;
}

export interface JobData {
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
}

export interface ProcessingStats {
  activeJobsCount: number;
  pendingOcrJobs: number;
  pendingAnalyses: number;
  recentSuccessRate: number;
  avgGazettesPerDay: number;
}

export interface ErrorStats {
  totalErrors: number;
  criticalErrors: number;
  errorsByType: Record<string, number>;
  errorsBySeverity: Record<string, number>;
  recentErrorRate: number;
}

export interface ErrorLogData {
  id: string;
  workerName: string;
  operationType: string;
  severity: string;
  errorCode: string | null;
  errorMessage: string;
  territoryId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface SpiderInfo {
  id: string;
  type: string;
  platform: string;
  citiesCount: number;
  isActive: boolean;
}

export interface WebhookLogData {
  id: string;
  notificationId: string;
  subscriptionId: string;
  eventType: string;
  status: string;
  attempts: number;
  statusCode: number | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface HealthStatus {
  healthy: boolean;
  latency: number | null;
  error: string | null;
}

export interface DbStats {
  tablesCount: number;
  recordsCounts: Record<string, number>;
}

export interface ReportsPageData {
  overview: OverviewStats;
  coverage: StateCoverage[];
  trends: TrendPoint[];
  concursos: ConcursoData[];
  errors: ErrorStats;
}

export interface DashboardPageData {
  activeJobs: JobData[];
  recentJobs: JobData[];
  processingStats: ProcessingStats;
  overview: OverviewStats;
}

export interface AdminPageData {
  dbHealth: HealthStatus;
  spiders: SpiderInfo[];
  webhooks: WebhookLogData[];
  errors: ErrorLogData[];
  dbStats: DbStats;
}


