/**
 * SSR Data Loaders for Dashboard Pages
 */

import { DashboardStatsService } from '../services/dashboard-stats';
import { getDatabase, type D1DatabaseEnv } from '../services/database';
import type { ReportsPageData, DashboardPageData, AdminPageData } from '../types/dashboard';
import { logger } from '../utils/logger';

export type LoaderContext = { env: D1DatabaseEnv };

/**
 * Reports page loader
 * Fetches historical reports and statistics
 */
export async function reportsLoader(ctx: LoaderContext): Promise<ReportsPageData> {
  try {
    const stats = new DashboardStatsService(getDatabase(ctx.env));

    const [overview, coverage, trends, concursos, errors] = await Promise.all([
      stats.getOverviewStats(),
      stats.getCoverageByState(),
      stats.getTrendsData(30), // last 30 days
      stats.getRecentConcursos(20),
      stats.getErrorSummary(7), // last 7 days
    ]);

    return {
      overview,
      coverage,
      trends,
      concursos,
      errors,
    };
  } catch (error) {
    logger.error('Failed to load reports data', { error });
    // Return empty data on error
    return {
      overview: {
        totalGazettes: 0,
        totalOcrJobs: 0,
        totalAnalyses: 0,
        totalConcursos: 0,
        ocrSuccessRate: 0,
        analysisSuccessRate: 0,
        avgProcessingTimeMs: 0,
      },
      coverage: [],
      trends: [],
      concursos: [],
      errors: {
        totalErrors: 0,
        criticalErrors: 0,
        errorsByType: {},
        errorsBySeverity: {},
        recentErrorRate: 0,
      },
    };
  }
}

/**
 * Dashboard page loader
 * Fetches real-time monitoring data
 */
export async function dashboardLoader(ctx: LoaderContext): Promise<DashboardPageData> {
  try {
    const stats = new DashboardStatsService(getDatabase(ctx.env));

    const [activeJobs, recentJobs, processingStats, overview] = await Promise.all([
      stats.getActiveJobs(),
      stats.getRecentJobs(10),
      stats.getProcessingStats(),
      stats.getOverviewStats(),
    ]);

    return {
      activeJobs,
      recentJobs,
      processingStats,
      overview,
    };
  } catch (error) {
    logger.error('Failed to load dashboard data', { error });
    return {
      activeJobs: [],
      recentJobs: [],
      processingStats: {
        activeJobsCount: 0,
        pendingOcrJobs: 0,
        pendingAnalyses: 0,
        recentSuccessRate: 0,
        avgGazettesPerDay: 0,
      },
      overview: {
        totalGazettes: 0,
        totalOcrJobs: 0,
        totalAnalyses: 0,
        totalConcursos: 0,
        ocrSuccessRate: 0,
        analysisSuccessRate: 0,
        avgProcessingTimeMs: 0,
      },
    };
  }
}

/**
 * Admin page loader
 * Fetches system administration data
 */
export async function adminLoader(ctx: LoaderContext): Promise<AdminPageData> {
  try {
    const stats = new DashboardStatsService(getDatabase(ctx.env));

    const [dbHealth, spiders, webhooks, errors, dbStats] = await Promise.all([
      stats.getDatabaseHealth(),
      stats.getSpidersList(),
      stats.getWebhookDeliveries(50),
      stats.getRecentErrors(50),
      stats.getDatabaseStats(),
    ]);

    return {
      dbHealth,
      spiders,
      webhooks,
      errors,
      dbStats,
    };
  } catch (error) {
    logger.error('Failed to load admin data', { error });
    return {
      dbHealth: {
        healthy: false,
        latency: null,
        error: 'Failed to load data',
      },
      spiders: [],
      webhooks: [],
      errors: [],
      dbStats: {
        tablesCount: 0,
        recordsCounts: {},
      },
    };
  }
}


