/**
 * Dashboard Statistics Service
 * Aggregates data from database for dashboard, reports, and admin pages
 */

import { desc, eq, gte, sql, and, count as drizzleCount } from 'drizzle-orm';
import { DrizzleDatabaseClient, schema } from './database/drizzle-client';
import {
  GazetteRepository,
  AnalysisRepository,
  OcrRepository,
  ErrorTracker,
  WebhookRepository,
  ConcursoRepository,
  TelemetryService,
} from './database';
import { spiderRegistry } from '../spiders/registry';
import { logger } from '../utils/logger';
import type {
  OverviewStats,
  StateCoverage,
  TrendPoint,
  ConcursoData,
  JobData,
  ProcessingStats,
  ErrorStats,
  ErrorLogData,
  SpiderInfo,
  WebhookLogData,
  HealthStatus,
  DbStats,
} from '../types/dashboard';

export class DashboardStatsService {
  private dbClient: DrizzleDatabaseClient;
  private gazetteRepo: GazetteRepository;
  private analysisRepo: AnalysisRepository;
  private ocrRepo: OcrRepository;
  private errorTracker: ErrorTracker;
  private webhookRepo: WebhookRepository;
  private concursoRepo: ConcursoRepository;
  private telemetryService: TelemetryService;

  constructor(dbClient: DrizzleDatabaseClient) {
    this.dbClient = dbClient;
    this.gazetteRepo = new GazetteRepository(dbClient);
    this.analysisRepo = new AnalysisRepository(dbClient);
    this.ocrRepo = new OcrRepository(dbClient);
    this.errorTracker = new ErrorTracker(dbClient);
    this.webhookRepo = new WebhookRepository(dbClient);
    this.concursoRepo = new ConcursoRepository(dbClient);
    this.telemetryService = new TelemetryService(dbClient);
  }

  /**
   * Get overview statistics
   */
  async getOverviewStats(): Promise<OverviewStats> {
    try {
      const db = this.dbClient.getDb();

      // Get counts
      const [gazetteCount, ocrCount, analysisCount, concursoCount] = await Promise.all([
        db.select({ count: drizzleCount() }).from(schema.gazetteRegistry),
        db.select({ count: drizzleCount() }).from(schema.ocrJobs),
        db.select({ count: drizzleCount() }).from(schema.analysisResults),
        db.select({ count: drizzleCount() }).from(schema.concursoFindings),
      ]);

      // Get success rates
      const ocrSuccess = await db
        .select({ count: drizzleCount() })
        .from(schema.ocrJobs)
        .where(eq(schema.ocrJobs.status, 'success'));

      const totalOcr = ocrCount[0]?.count || 0;
      const successOcr = ocrSuccess[0]?.count || 0;

      // Get average processing time from recent OCR jobs
      const recentOcr = await db
        .select({ processingTime: schema.ocrJobs.processingTimeMs })
        .from(schema.ocrJobs)
        .where(eq(schema.ocrJobs.status, 'success'))
        .orderBy(desc(schema.ocrJobs.createdAt))
        .limit(100);

      const avgProcessingTime =
        recentOcr.length > 0
          ? recentOcr.reduce((sum, job) => sum + (job.processingTime || 0), 0) / recentOcr.length
          : 0;

      return {
        totalGazettes: gazetteCount[0]?.count || 0,
        totalOcrJobs: totalOcr,
        totalAnalyses: analysisCount[0]?.count || 0,
        totalConcursos: concursoCount[0]?.count || 0,
        ocrSuccessRate: totalOcr > 0 ? (successOcr / totalOcr) * 100 : 0,
        analysisSuccessRate: 100, // Assuming all analyses succeed
        avgProcessingTimeMs: Math.round(avgProcessingTime),
      };
    } catch (error) {
      logger.error('Failed to get overview stats', { error });
      return {
        totalGazettes: 0,
        totalOcrJobs: 0,
        totalAnalyses: 0,
        totalConcursos: 0,
        ocrSuccessRate: 0,
        analysisSuccessRate: 0,
        avgProcessingTimeMs: 0,
      };
    }
  }

  /**
   * Get coverage by state
   */
  async getCoverageByState(): Promise<StateCoverage[]> {
    // This data comes from the spider registry
    const stateData: Record<string, { name: string; total: number; unique: number; configs: number }> = {
      MT: { name: 'Mato Grosso', total: 141, unique: 142, configs: 143 },
      AC: { name: 'Acre', total: 22, unique: 22, configs: 22 },
      AM: { name: 'Amazonas', total: 62, unique: 62, configs: 62 },
      SC: { name: 'Santa Catarina', total: 295, unique: 295, configs: 295 },
      PE: { name: 'Pernambuco', total: 185, unique: 182, configs: 185 },
      BA: { name: 'Bahia', total: 417, unique: 407, configs: 478 },
      RN: { name: 'Rio Grande do Norte', total: 167, unique: 161, configs: 164 },
      CE: { name: 'Ceará', total: 184, unique: 131, configs: 139 },
      SP: { name: 'São Paulo', total: 645, unique: 456, configs: 589 },
      MG: { name: 'Minas Gerais', total: 853, unique: 486, configs: 492 },
      RS: { name: 'Rio Grande do Sul', total: 497, unique: 278, configs: 281 },
      PR: { name: 'Paraná', total: 399, unique: 197, configs: 199 },
    };

    return Object.entries(stateData).map(([uf, data]) => ({
      uf,
      stateName: data.name,
      totalMunicipalities: data.total,
      coveredMunicipalities: data.unique,
      percentage: (data.unique / data.total) * 100,
      totalConfigs: data.configs,
    }));
  }

  /**
   * Get trends data for the last N days
   */
  async getTrendsData(days: number = 30): Promise<TrendPoint[]> {
    try {
      const db = this.dbClient.getDb();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      const startDateStr = startDate.toISOString().split('T')[0];

      // Group gazettes by publication date
      const gazettesByDate = await db
        .select({
          date: schema.gazetteRegistry.publicationDate,
          count: drizzleCount(),
        })
        .from(schema.gazetteRegistry)
        .where(gte(schema.gazetteRegistry.publicationDate, startDateStr))
        .groupBy(schema.gazetteRegistry.publicationDate)
        .orderBy(schema.gazetteRegistry.publicationDate);

      // Group OCR jobs by created date
      const ocrByDate = await db
        .select({
          date: sql<string>`date(${schema.ocrJobs.createdAt})`,
          count: drizzleCount(),
        })
        .from(schema.ocrJobs)
        .where(gte(schema.ocrJobs.createdAt, startDateStr))
        .groupBy(sql`date(${schema.ocrJobs.createdAt})`)
        .orderBy(sql`date(${schema.ocrJobs.createdAt})`);

      // Group analyses by analyzed date
      const analysesByDate = await db
        .select({
          date: sql<string>`date(${schema.analysisResults.analyzedAt})`,
          count: drizzleCount(),
        })
        .from(schema.analysisResults)
        .where(gte(schema.analysisResults.analyzedAt, startDateStr))
        .groupBy(sql`date(${schema.analysisResults.analyzedAt})`)
        .orderBy(sql`date(${schema.analysisResults.analyzedAt})`);

      // Group concursos by created date
      const concursosByDate = await db
        .select({
          date: sql<string>`date(${schema.concursoFindings.createdAt})`,
          count: drizzleCount(),
        })
        .from(schema.concursoFindings)
        .where(gte(schema.concursoFindings.createdAt, startDateStr))
        .groupBy(sql`date(${schema.concursoFindings.createdAt})`)
        .orderBy(sql`date(${schema.concursoFindings.createdAt})`);

      // Create map of dates
      const dateMap = new Map<string, TrendPoint>();

      // Fill with gazettes
      gazettesByDate.forEach((item) => {
        dateMap.set(item.date, {
          date: item.date,
          gazettes: item.count,
          ocrJobs: 0,
          analyses: 0,
          concursos: 0,
        });
      });

      // Add OCR data
      ocrByDate.forEach((item) => {
        const existing = dateMap.get(item.date) || {
          date: item.date,
          gazettes: 0,
          ocrJobs: 0,
          analyses: 0,
          concursos: 0,
        };
        existing.ocrJobs = item.count;
        dateMap.set(item.date, existing);
      });

      // Add analysis data
      analysesByDate.forEach((item) => {
        const existing = dateMap.get(item.date) || {
          date: item.date,
          gazettes: 0,
          ocrJobs: 0,
          analyses: 0,
          concursos: 0,
        };
        existing.analyses = item.count;
        dateMap.set(item.date, existing);
      });

      // Add concurso data
      concursosByDate.forEach((item) => {
        const existing = dateMap.get(item.date) || {
          date: item.date,
          gazettes: 0,
          ocrJobs: 0,
          analyses: 0,
          concursos: 0,
        };
        existing.concursos = item.count;
        dateMap.set(item.date, existing);
      });

      return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    } catch (error) {
      logger.error('Failed to get trends data', { error });
      return [];
    }
  }

  /**
   * Get recent concurso findings
   */
  async getRecentConcursos(limit: number = 20): Promise<ConcursoData[]> {
    try {
      const results = await this.concursoRepo.searchConcursos({}, limit, 0);

      return results.concursos.map((c) => ({
        id: c.id,
        territoryId: c.territoryId,
        territoryName: c.territoryId, // We don't have territory names, using ID
        orgao: c.orgao,
        editalNumero: c.editalNumero,
        totalVagas: c.totalVagas,
        confidence: c.confidence,
        publicationDate: c.createdAt.split('T')[0],
        createdAt: c.createdAt,
      }));
    } catch (error) {
      logger.error('Failed to get recent concursos', { error });
      return [];
    }
  }

  /**
   * Get active crawl jobs
   */
  async getActiveJobs(): Promise<JobData[]> {
    try {
      const db = this.dbClient.getDb();

      const activeJobs = await db
        .select()
        .from(schema.crawlJobs)
        .where(
          sql`${schema.crawlJobs.status} IN ('pending', 'running')`
        )
        .orderBy(desc(schema.crawlJobs.createdAt))
        .limit(10);

      return activeJobs.map((job) => ({
        id: job.id,
        jobType: job.jobType,
        status: job.status,
        totalCities: job.totalCities,
        completedCities: job.completedCities,
        failedCities: job.failedCities,
        startDate: job.startDate,
        endDate: job.endDate,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      }));
    } catch (error) {
      logger.error('Failed to get active jobs', { error });
      return [];
    }
  }

  /**
   * Get recent crawl jobs
   */
  async getRecentJobs(limit: number = 10): Promise<JobData[]> {
    try {
      const db = this.dbClient.getDb();

      const recentJobs = await db
        .select()
        .from(schema.crawlJobs)
        .orderBy(desc(schema.crawlJobs.createdAt))
        .limit(limit);

      return recentJobs.map((job) => ({
        id: job.id,
        jobType: job.jobType,
        status: job.status,
        totalCities: job.totalCities,
        completedCities: job.completedCities,
        failedCities: job.failedCities,
        startDate: job.startDate,
        endDate: job.endDate,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      }));
    } catch (error) {
      logger.error('Failed to get recent jobs', { error });
      return [];
    }
  }

  /**
   * Get processing statistics
   */
  async getProcessingStats(): Promise<ProcessingStats> {
    try {
      const db = this.dbClient.getDb();

      const [activeJobs, pendingOcr, recentGazettes] = await Promise.all([
        db
          .select({ count: drizzleCount() })
          .from(schema.crawlJobs)
          .where(sql`${schema.crawlJobs.status} IN ('pending', 'running')`),
        db
          .select({ count: drizzleCount() })
          .from(schema.ocrJobs)
          .where(eq(schema.ocrJobs.status, 'pending')),
        db
          .select({ count: drizzleCount() })
          .from(schema.gazetteRegistry)
          .where(gte(schema.gazetteRegistry.createdAt, sql`datetime('now', '-7 days')`)),
      ]);

      const avgPerDay = (recentGazettes[0]?.count || 0) / 7;

      return {
        activeJobsCount: activeJobs[0]?.count || 0,
        pendingOcrJobs: pendingOcr[0]?.count || 0,
        pendingAnalyses: 0, // Not tracked separately
        recentSuccessRate: 95, // Placeholder
        avgGazettesPerDay: Math.round(avgPerDay),
      };
    } catch (error) {
      logger.error('Failed to get processing stats', { error });
      return {
        activeJobsCount: 0,
        pendingOcrJobs: 0,
        pendingAnalyses: 0,
        recentSuccessRate: 0,
        avgGazettesPerDay: 0,
      };
    }
  }

  /**
   * Get error summary for the last N days
   */
  async getErrorSummary(days: number = 7): Promise<ErrorStats> {
    try {
      const stats = await this.errorTracker.getErrorStatistics(days);

      return {
        totalErrors: stats.totalErrors,
        criticalErrors: stats.errorsBySeverity.critical || 0,
        errorsByType: stats.errorsByType,
        errorsBySeverity: stats.errorsBySeverity,
        recentErrorRate: stats.errorRate,
      };
    } catch (error) {
      logger.error('Failed to get error summary', { error });
      return {
        totalErrors: 0,
        criticalErrors: 0,
        errorsByType: {},
        errorsBySeverity: {},
        recentErrorRate: 0,
      };
    }
  }

  /**
   * Get recent error logs
   */
  async getRecentErrors(limit: number = 50): Promise<ErrorLogData[]> {
    try {
      const db = this.dbClient.getDb();

      const errors = await db
        .select()
        .from(schema.errorLogs)
        .orderBy(desc(schema.errorLogs.createdAt))
        .limit(limit);

      return errors.map((error) => ({
        id: error.id,
        workerName: error.workerName,
        operationType: error.operationType,
        severity: error.severity,
        errorCode: error.errorCode,
        errorMessage: error.errorMessage,
        territoryId: error.territoryId,
        createdAt: error.createdAt,
        resolvedAt: error.resolvedAt,
      }));
    } catch (error) {
      logger.error('Failed to get recent errors', { error });
      return [];
    }
  }

  /**
   * Get list of available spiders
   */
  async getSpidersList(): Promise<SpiderInfo[]> {
    try {
      const spiders = spiderRegistry.getAllSpiders();

      // Group by platform/type
      const spiderMap = new Map<string, SpiderInfo>();

      spiders.forEach((spider) => {
        const key = `${spider.type}`;
        if (!spiderMap.has(key)) {
          spiderMap.set(key, {
            id: key,
            type: spider.type,
            platform: spider.type,
            citiesCount: 0,
            isActive: true,
          });
        }
        const info = spiderMap.get(key)!;
        info.citiesCount++;
      });

      return Array.from(spiderMap.values());
    } catch (error) {
      logger.error('Failed to get spiders list', { error });
      return [];
    }
  }

  /**
   * Get recent webhook deliveries
   */
  async getWebhookDeliveries(limit: number = 50): Promise<WebhookLogData[]> {
    try {
      const db = this.dbClient.getDb();

      const deliveries = await db
        .select()
        .from(schema.webhookDeliveries)
        .orderBy(desc(schema.webhookDeliveries.createdAt))
        .limit(limit);

      return deliveries.map((delivery) => ({
        id: delivery.id,
        notificationId: delivery.notificationId,
        subscriptionId: delivery.subscriptionId,
        eventType: delivery.eventType,
        status: delivery.status,
        attempts: delivery.attempts,
        statusCode: delivery.statusCode,
        createdAt: delivery.createdAt,
        deliveredAt: delivery.deliveredAt,
      }));
    } catch (error) {
      logger.error('Failed to get webhook deliveries', { error });
      return [];
    }
  }

  /**
   * Get database health status
   */
  async getDatabaseHealth(): Promise<HealthStatus> {
    try {
      return await this.dbClient.healthCheck();
    } catch (error) {
      logger.error('Failed to get database health', { error });
      return {
        healthy: false,
        latency: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats(): Promise<DbStats> {
    try {
      return await this.dbClient.getStats();
    } catch (error) {
      logger.error('Failed to get database stats', { error });
      return {
        tablesCount: 0,
        recordsCounts: {},
      };
    }
  }
}


