/**
 * Goodfellow Worker - Unified worker handling all pipeline stages
 * Combines: Crawl → OCR → Analysis → Webhook
 * Each queue consumer does ONE job and dies, but all run from the same codebase
 */

import { Hono } from 'hono';
import {
  DispatchRequest,
  DispatchResponse,
  QueueMessage,
  DateRange,
  SpiderConfig,
  OcrQueueMessage,
  AnalysisQueueMessage,
  WebhookQueueMessage,
} from './types';
import type { D1DatabaseEnv } from './services/database';
import { spiderRegistry } from './spiders/registry';
import { logger } from './utils/logger';
import { toISODate } from './utils/date-utils';
import { getDatabase, TelemetryService } from './services/database';

// Import queue processors
import { processCrawlBatch, CrawlProcessorEnv } from './goodfellow/crawl-processor';
import { processOcrBatch, OcrProcessorEnv } from './goodfellow/ocr-processor';
import { processAnalysisBatch, AnalysisProcessorEnv } from './goodfellow/analysis-processor';
import { processWebhookBatch, WebhookProcessorEnv } from './goodfellow/webhook-processor';

/**
 * Combined environment bindings for Goodfellow
 */
export interface GoodfellowEnv extends D1DatabaseEnv {
  // Queue bindings - both producer and consumer
  CRAWL_QUEUE: Queue<QueueMessage>;
  OCR_QUEUE: Queue<OcrQueueMessage>;
  ANALYSIS_QUEUE: Queue<AnalysisQueueMessage>;
  WEBHOOK_QUEUE: Queue<WebhookQueueMessage>;

  // KV namespaces
  OCR_RESULTS: KVNamespace;
  ANALYSIS_RESULTS: KVNamespace;
  WEBHOOK_SUBSCRIPTIONS: KVNamespace;
  WEBHOOK_DELIVERY_LOGS: KVNamespace;

  // R2 buckets
  GAZETTE_PDFS: R2Bucket;

  // Browser rendering
  BROWSER: Fetcher;

  // Secrets
  MISTRAL_API_KEY: string;
  OPENAI_API_KEY: string;
}

// Create Hono app for HTTP handling
const app = new Hono<{ Bindings: GoodfellowEnv }>();

/**
 * Health check endpoint
 */
app.get('/', (c) => {
  return c.json({
    service: 'goodfellow',
    version: '1.0.0',
    description: 'Unified gazette processing pipeline',
    spidersRegistered: spiderRegistry.getCount(),
    handlers: ['http', 'crawl-queue', 'ocr-queue', 'analysis-queue', 'webhook-queue'],
  });
});

/**
 * Enhanced queue message sender
 */
async function sendMessagesToQueue(
  queue: Queue,
  configs: SpiderConfig[],
  dateRange: DateRange,
  crawlJobId: string,
  logger: any
): Promise<{ enqueuedCount: number; failedCount: number }> {
  let enqueuedCount = 0;
  let failedCount = 0;
  const BATCH_SIZE = 100;

  const messages: QueueMessage[] = configs.map((config) => ({
    spiderId: config.id,
    territoryId: config.territoryId,
    spiderType: config.spiderType,
    config: config.config,
    dateRange,
    metadata: {
      crawlJobId,
    },
  }));

  logger.info(
    `Starting to enqueue ${messages.length} messages in ${Math.ceil(
      messages.length / BATCH_SIZE
    )} batches`
  );

  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.ceil((i + 1) / BATCH_SIZE);
    const totalBatches = Math.ceil(messages.length / BATCH_SIZE);

    try {
      const wrappedBatch = batch.map((msg) => ({ body: msg }));
      await queue.sendBatch(wrappedBatch);
      enqueuedCount += batch.length;

      logger.info(`Enqueued batch ${batchNumber}/${totalBatches}`, {
        batchSize: batch.length,
        totalEnqueued: enqueuedCount,
        progress: `${enqueuedCount}/${messages.length}`,
        percentage: Math.round((enqueuedCount / messages.length) * 100),
      });
    } catch (error) {
      logger.error(
        `Failed to enqueue batch ${batchNumber}/${totalBatches}`,
        error as Error,
        {
          batchStart: i,
          batchSize: batch.length,
        }
      );

      // Try individual sends
      for (const message of batch) {
        try {
          await queue.send(message);
          enqueuedCount++;
        } catch (individualError) {
          failedCount++;
          logger.error(`Failed to enqueue individual task`, individualError as Error, {
            spiderId: message.spiderId,
            territoryId: message.territoryId,
          });
        }
      }
    }
  }

  return { enqueuedCount, failedCount };
}

/**
 * Dispatch crawl jobs to the queue
 */
app.post('/crawl', async (c) => {
  try {
    const request = await c.req.json<DispatchRequest>();

    logger.info('Received crawl request', { request });

    if (!request.cities || (Array.isArray(request.cities) && request.cities.length === 0)) {
      return c.json<DispatchResponse>(
        {
          success: false,
          tasksEnqueued: 0,
          cities: [],
          error: 'No cities specified',
        },
        400
      );
    }

    const dateRange = getDateRange(request.startDate, request.endDate);

    const configs =
      request.cities === 'all'
        ? spiderRegistry.getAllConfigs()
        : request.cities
            .map((id) => spiderRegistry.getConfig(id))
            .filter((config): config is NonNullable<typeof config> => config !== undefined);

    if (configs.length === 0) {
      return c.json<DispatchResponse>(
        {
          success: false,
          tasksEnqueued: 0,
          cities: [],
          error: 'No valid spider configurations found',
        },
        400
      );
    }

    const db = getDatabase(c.env);
    const telemetry = new TelemetryService(db);

    const crawlJobId = await telemetry.trackCrawlJobStart({
      jobType: 'manual',
      totalCities: configs.length,
      startDate: dateRange.start,
      endDate: dateRange.end,
      metadata: {
        requestType: 'manual',
        requestedCities: request.cities,
        userAgent: c.req.header('user-agent'),
      },
    });

    logger.info('Created crawl job', { crawlJobId, totalCities: configs.length });

    const queue = c.env.CRAWL_QUEUE;
    const { enqueuedCount, failedCount } = await sendMessagesToQueue(
      queue,
      configs,
      dateRange,
      crawlJobId,
      logger
    );

    await telemetry.updateCrawlJob(crawlJobId, {
      status: failedCount === 0 ? 'running' : 'failed',
      metadata: {
        enqueuedCount,
        failedCount,
      },
    });

    const success = failedCount === 0;
    const status = success ? 200 : enqueuedCount > 0 ? 207 : 500;

    return c.json<DispatchResponse>(
      {
        success,
        tasksEnqueued: enqueuedCount,
        cities: configs.map((c) => c.id),
        crawlJobId,
        ...(failedCount > 0 && {
          error: `${failedCount} tasks failed to enqueue`,
          failedCount,
        }),
      },
      status
    );
  } catch (error) {
    logger.error('Error processing crawl request', error as Error);

    return c.json<DispatchResponse>(
      {
        success: false,
        tasksEnqueued: 0,
        cities: [],
        error: (error as Error).message,
      },
      500
    );
  }
});

/**
 * Crawl today and yesterday for all cities
 */
app.post('/crawl/today-yesterday', async (c) => {
  try {
    const { platform } = await c.req.json().catch(() => ({}));

    logger.info('Starting today-yesterday crawl', { platform });

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const startDate = toISODate(yesterday);
    const endDate = toISODate(today);

    const allConfigs = spiderRegistry.getAllConfigs();
    const configs = platform
      ? allConfigs.filter((config) => config.spiderType === platform)
      : allConfigs;

    const db = getDatabase(c.env);
    const telemetry = new TelemetryService(db);

    const crawlJobId = await telemetry.trackCrawlJobStart({
      jobType: 'scheduled',
      totalCities: configs.length,
      startDate,
      endDate,
      platformFilter: platform,
      metadata: {
        requestType: 'today-yesterday',
        platform: platform || 'all',
        userAgent: c.req.header('user-agent'),
      },
    });

    const queue = c.env.CRAWL_QUEUE;
    const dateRange = { start: startDate, end: endDate };
    const { enqueuedCount, failedCount } = await sendMessagesToQueue(
      queue,
      configs,
      dateRange,
      crawlJobId,
      logger
    );

    await telemetry.updateCrawlJob(crawlJobId, {
      status: failedCount === 0 ? 'running' : 'failed',
      metadata: {
        enqueuedCount,
        failedCount,
      },
    });

    const success = failedCount === 0;
    const status = success ? 200 : enqueuedCount > 0 ? 207 : 500;

    return c.json(
      {
        success,
        message: 'Crawl initiated for today and yesterday',
        crawlJobId,
        tasksEnqueued: enqueuedCount,
        totalCities: configs.length,
        dateRange: { startDate, endDate },
        platform: platform || 'all',
        estimatedTimeMinutes: Math.ceil((configs.length * 7.5) / 60),
        ...(failedCount > 0 && {
          failedCount,
          warning: `${failedCount} tasks failed to enqueue`,
        }),
      },
      status
    );
  } catch (error) {
    logger.error('Error starting today-yesterday crawl', error as Error);

    return c.json(
      {
        success: false,
        error: (error as Error).message,
      },
      500
    );
  }
});

/**
 * Crawl specific cities
 */
app.post('/crawl/cities', async (c) => {
  try {
    const { cities, startDate, endDate } = await c.req.json();

    if (!cities || !Array.isArray(cities) || cities.length === 0) {
      return c.json(
        {
          success: false,
          error: 'Cities array is required',
        },
        400
      );
    }

    logger.info('Starting cities crawl', { cities, startDate, endDate });

    const dateRange = getDateRange(startDate, endDate);

    const configs = cities
      .map((id) => spiderRegistry.getConfig(id))
      .filter((config): config is NonNullable<typeof config> => config !== undefined);

    if (configs.length === 0) {
      return c.json(
        {
          success: false,
          error: 'No valid spider configurations found for provided cities',
        },
        400
      );
    }

    const db = getDatabase(c.env);
    const telemetry = new TelemetryService(db);

    const crawlJobId = await telemetry.trackCrawlJobStart({
      jobType: 'cities',
      totalCities: configs.length,
      startDate: dateRange.start,
      endDate: dateRange.end,
      metadata: {
        requestType: 'cities',
        requestedCities: cities,
        validCities: configs.map((c) => c.id),
        userAgent: c.req.header('user-agent'),
      },
    });

    const queue = c.env.CRAWL_QUEUE;
    const { enqueuedCount, failedCount } = await sendMessagesToQueue(
      queue,
      configs,
      dateRange,
      crawlJobId,
      logger
    );

    await telemetry.updateCrawlJob(crawlJobId, {
      status: failedCount === 0 ? 'running' : 'failed',
      metadata: {
        enqueuedCount,
        failedCount,
      },
    });

    const success = failedCount === 0;
    const status = success ? 200 : enqueuedCount > 0 ? 207 : 500;

    return c.json(
      {
        success,
        message: 'Crawl initiated for specified cities',
        crawlJobId,
        tasksEnqueued: enqueuedCount,
        cities: configs.map((c) => ({ id: c.id, name: c.name })),
        dateRange,
        ...(failedCount > 0 && {
          failedCount,
          warning: `${failedCount} tasks failed to enqueue`,
        }),
      },
      status
    );
  } catch (error) {
    logger.error('Error starting cities crawl', error as Error);

    return c.json(
      {
        success: false,
        error: (error as Error).message,
      },
      500
    );
  }
});

/**
 * List available spiders
 */
app.get('/spiders', (c) => {
  const spiderType = c.req.query('type');

  const configs = spiderType
    ? spiderRegistry.getConfigsByType(spiderType as any)
    : spiderRegistry.getAllConfigs();

  return c.json({
    total: configs.length,
    spiders: configs.map((config) => ({
      id: config.id,
      name: config.name,
      territoryId: config.territoryId,
      type: config.spiderType,
      startDate: config.startDate,
    })),
  });
});

/**
 * Get statistics
 */
app.get('/stats', (c) => {
  const allConfigs = spiderRegistry.getAllConfigs();

  const platformCounts: Record<string, number> = {};
  for (const config of allConfigs) {
    platformCounts[config.spiderType] = (platformCounts[config.spiderType] || 0) + 1;
  }

  return c.json({
    total: allConfigs.length,
    platforms: platformCounts,
    webhookConfigured: true,
    endpoint: 'https://n8n.grupoq.io/webhook/webhook-concursos',
    expectedProcessing: {
      totalCities: allConfigs.length,
      estimatedBatches: Math.ceil(allConfigs.length / 100),
      estimatedTimeMinutes: Math.ceil((allConfigs.length * 7.5) / 60),
    },
  });
});

/**
 * Health check with queue processing insights
 */
app.get('/health/queue', async (c) => {
  const allConfigs = spiderRegistry.getAllConfigs();

  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    queues: {
      crawl: { configured: !!c.env.CRAWL_QUEUE },
      ocr: { configured: !!c.env.OCR_QUEUE },
      analysis: { configured: !!c.env.ANALYSIS_QUEUE },
      webhook: { configured: !!c.env.WEBHOOK_QUEUE },
    },
    config: {
      totalCitiesConfigured: allConfigs.length,
      batchSize: 100,
      expectedBatches: Math.ceil(allConfigs.length / 100),
    },
    worker: {
      maxBatchSize: 1,
      maxBatchTimeout: 60,
      maxRetries: 3,
      concurrency: 'auto-scaled by Cloudflare',
    },
  });
});

/**
 * Get date range from request or use defaults
 */
function getDateRange(startDate?: string, endDate?: string): DateRange {
  const now = new Date();

  const defaultStart = new Date(now);
  defaultStart.setDate(defaultStart.getDate() - 30);

  return {
    start: startDate || toISODate(defaultStart),
    end: endDate || toISODate(now),
  };
}

/**
 * Queue consumer handler - routes to appropriate processor
 */
async function handleQueue(
  batch: MessageBatch,
  env: GoodfellowEnv
): Promise<void> {
  const queueName = batch.queue;

  logger.info(`Goodfellow: Received batch from queue: ${queueName}`, {
    queueName,
    batchSize: batch.messages.length,
  });

  switch (queueName) {
    case 'goodfellow-crawl-queue':
      await processCrawlBatch(batch as MessageBatch<QueueMessage>, env as CrawlProcessorEnv);
      break;

    case 'goodfellow-ocr-queue':
      await processOcrBatch(batch as MessageBatch<OcrQueueMessage>, env as OcrProcessorEnv);
      break;

    case 'goodfellow-analysis-queue':
      await processAnalysisBatch(
        batch as MessageBatch<AnalysisQueueMessage>,
        env as AnalysisProcessorEnv
      );
      break;

    case 'goodfellow-webhook-queue':
      await processWebhookBatch(
        batch as MessageBatch<WebhookQueueMessage>,
        env as WebhookProcessorEnv
      );
      break;

    default:
      logger.error(`Unknown queue: ${queueName}`);
      throw new Error(`Unknown queue: ${queueName}`);
  }
}

/**
 * Export unified worker with both HTTP and Queue handlers
 */
export default {
  // HTTP handler
  fetch: app.fetch,

  // Queue handler - routes to appropriate processor based on queue name
  queue: handleQueue,
};
