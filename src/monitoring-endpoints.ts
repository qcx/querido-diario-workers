/**
 * Monitoring Endpoints
 * Real-time crawl progress and analytics endpoints
 */

import { Hono } from 'hono';
import { 
  getDatabase, 
  TelemetryService, 
  AnalysisRepository,
  WebhookRepository,
  ConcursoRepository,
  GazetteRepository,
  DatabaseEnv 
} from './services/database';
import { logger } from './utils';

const app = new Hono<{ Bindings: DatabaseEnv }>();

/**
 * Real-time crawl job progress
 */
app.get('/monitor/jobs', async (c) => {
  try {
    const db = getDatabase(c.env);
    const telemetry = new TelemetryService(db);

    // Get active jobs
    const activeJobs = await db.queryTemplate`
      SELECT 
        id, job_type, status, total_cities, completed_cities, failed_cities,
        created_at, started_at, platform_filter, metadata
      FROM crawl_jobs 
      WHERE status IN ('pending', 'running')
      ORDER BY created_at DESC
      LIMIT 20
    `;

    const jobProgress = [];
    for (const job of activeJobs) {
      const progress = await telemetry.getCrawlJobProgress(job.id);
      jobProgress.push(progress);
    }

    return c.json({
      activeJobs: jobProgress,
      summary: {
        totalActive: activeJobs.length,
        running: activeJobs.filter(j => j.status === 'running').length,
        pending: activeJobs.filter(j => j.status === 'pending').length,
      }
    });
  } catch (error) {
    logger.error('Failed to get crawl job progress', { error });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * System metrics and health
 */
app.get('/monitor/system', async (c) => {
  try {
    const timeRange = c.req.query('timeRange') as '1h' | '24h' | '7d' || '24h';
    const db = getDatabase(c.env);
    const telemetry = new TelemetryService(db);

    const [systemMetrics, dbHealth, dbStats] = await Promise.all([
      telemetry.getSystemMetrics(timeRange),
      db.healthCheck(),
      db.getStats()
    ]);

    return c.json({
      health: {
        database: dbHealth,
        connectionPool: dbStats
      },
      metrics: systemMetrics,
      timeRange,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get system metrics', { error });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * Webhook delivery statistics
 */
app.get('/monitor/webhooks', async (c) => {
  try {
    const subscriptionId = c.req.query('subscriptionId');
    const days = parseInt(c.req.query('days') || '7');
    
    const db = getDatabase(c.env);
    const webhookRepo = new WebhookRepository(db);

    const [stats, failedWebhooks, deliveryRate] = await Promise.all([
      webhookRepo.getWebhookStats(subscriptionId, days),
      webhookRepo.getFailedWebhooks(1), // Last 24 hours
      webhookRepo.getDeliveryRate(60) // Last hour
    ]);

    return c.json({
      stats,
      recentFailures: failedWebhooks,
      currentRate: deliveryRate,
      timeRange: `${days} days`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get webhook statistics', { error });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * Concurso findings dashboard
 */
app.get('/monitor/concursos', async (c) => {
  try {
    const days = parseInt(c.req.query('days') || '30');
    const minVagas = parseInt(c.req.query('minVagas') || '1');
    
    const db = getDatabase(c.env);
    const concursoRepo = new ConcursoRepository(db);

    const [stats, highVacancy, recent] = await Promise.all([
      concursoRepo.getConcursoStats(days),
      concursoRepo.getHighVacancyConcursos(minVagas, days, 20),
      concursoRepo.searchConcursos({}, 50, 0)
    ]);

    return c.json({
      statistics: stats,
      highVacancyConcursos: highVacancy,
      recentConcursos: recent.concursos,
      filters: { days, minVagas },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get concurso dashboard', { error });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * Analysis results overview
 */
app.get('/monitor/analysis', async (c) => {
  try {
    const days = parseInt(c.req.query('days') || '7');
    const territories = c.req.query('territories')?.split(',');
    
    const db = getDatabase(c.env);
    const analysisRepo = new AnalysisRepository(db);

    const [stats, highConfidence] = await Promise.all([
      analysisRepo.getAnalysisStats(days),
      analysisRepo.getHighConfidenceFindings(undefined, territories, days, 50)
    ]);

    return c.json({
      statistics: stats,
      highConfidenceFindings: highConfidence,
      filters: { days, territories },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get analysis overview', { error });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * Gazette registry statistics
 */
app.get('/monitor/gazettes', async (c) => {
  try {
    const days = parseInt(c.req.query('days') || '7');
    
    const db = getDatabase(c.env);
    const gazetteRepo = new GazetteRepository(db);

    const [stats, recent] = await Promise.all([
      gazetteRepo.getGazetteStats(days),
      gazetteRepo.getRecentGazettes(100)
    ]);

    return c.json({
      statistics: stats,
      recentGazettes: recent,
      timeRange: `${days} days`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get gazette statistics', { error });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * Search across all content
 */
app.get('/monitor/search', async (c) => {
  try {
    const query = c.req.query('q');
    const type = c.req.query('type') || 'all'; // 'gazettes', 'analysis', 'concursos', 'all'
    const limit = parseInt(c.req.query('limit') || '50');
    
    if (!query) {
      return c.json({ error: 'Search query is required' }, 400);
    }

    const db = getDatabase(c.env);
    const results: any = { query, type, results: {} };

    if (type === 'all' || type === 'gazettes') {
      const gazetteRepo = new GazetteRepository(db);
      results.results.gazettes = await gazetteRepo.searchGazettes(query, undefined, undefined, undefined, limit);
    }

    if (type === 'all' || type === 'analysis') {
      const analysisRepo = new AnalysisRepository(db);
      results.results.analyses = await analysisRepo.searchAnalyses(query, undefined, undefined, undefined, undefined, limit);
    }

    if (type === 'all' || type === 'concursos') {
      const concursoRepo = new ConcursoRepository(db);
      results.results.concursos = await concursoRepo.searchConcursosByText(query, {}, limit);
    }

    return c.json(results);
  } catch (error) {
    logger.error('Failed to perform search', { error });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * Real-time telemetry for specific job
 */
app.get('/monitor/jobs/:jobId', async (c) => {
  try {
    const jobId = c.req.param('jobId');
    const db = getDatabase(c.env);
    const telemetry = new TelemetryService(db);

    const progress = await telemetry.getCrawlJobProgress(jobId);

    // Get recent telemetry steps
    const recentSteps = await db.queryTemplate`
      SELECT territory_id, spider_id, step, status, timestamp, 
             execution_time_ms, error_message, gazettes_found
      FROM crawl_telemetry 
      WHERE crawl_job_id = ${jobId}
      ORDER BY timestamp DESC
      LIMIT 200
    `;

    return c.json({
      progress,
      recentSteps,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get job telemetry', { jobId: c.req.param('jobId'), error });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * Territory-specific dashboard
 */
app.get('/monitor/territories/:territoryId', async (c) => {
  try {
    const territoryId = c.req.param('territoryId');
    const days = parseInt(c.req.query('days') || '30');
    
    const db = getDatabase(c.env);
    const gazetteRepo = new GazetteRepository(db);
    const analysisRepo = new AnalysisRepository(db);
    const concursoRepo = new ConcursoRepository(db);

    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const [gazettes, analyses, concursos] = await Promise.all([
      gazetteRepo.getGazettesByTerritory(territoryId, startDate, endDate),
      analysisRepo.getAnalysesByTerritory(territoryId, startDate, endDate),
      concursoRepo.getConcursosByTerritory(territoryId, days)
    ]);

    return c.json({
      territoryId,
      timeRange: { startDate, endDate, days },
      summary: {
        totalGazettes: gazettes.length,
        totalAnalyses: analyses.length,
        totalConcursos: concursos.length,
        totalVagas: concursos.reduce((sum, c) => sum + c.totalVagas, 0)
      },
      gazettes: gazettes.slice(0, 20), // Recent 20
      analyses: analyses.slice(0, 20),
      concursos: concursos.slice(0, 20),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get territory dashboard', {
      territoryId: c.req.param('territoryId'),
      error
    });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default app;
