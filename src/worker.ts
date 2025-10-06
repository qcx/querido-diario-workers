import { Hono } from 'hono';
import { DispatchRequest, DispatchResponse, QueueMessage, DateRange, CrawlResult, SpiderConfig } from './types';
import { spiderRegistry } from './spiders/registry';
import { logger } from './utils/logger';
import { toISODate } from './utils/date-utils';
import { OcrQueueSender } from './services/ocr-queue-sender';

/**
 * Unified Worker that handles both HTTP requests (dispatcher) and queue processing (consumer)
 */

type Bindings = {
  CRAWL_QUEUE: Queue<QueueMessage>;
  OCR_QUEUE: Queue<any>;
  BROWSER: Fetcher;
};

// Create Hono app for HTTP handling
const app = new Hono<{ Bindings: Bindings }>();

/**
 * Health check endpoint
 */
app.get('/', (c) => {
  return c.json({
    service: 'querido-diario-unified',
    version: '1.0.0',
    spidersRegistered: spiderRegistry.getCount(),
    handlers: ['http', 'queue'],
  });
});

/**
 * Enhanced queue message sender with detailed logging
 */
async function sendMessagesToQueue(
  queue: Queue,
  configs: SpiderConfig[],
  dateRange: DateRange,
  logger: any
): Promise<{ enqueuedCount: number; failedCount: number }> {
  let enqueuedCount = 0;
  let failedCount = 0;
  const BATCH_SIZE = 100; // Cloudflare Workers Queue batch limit

  // Prepare all messages
  const messages: QueueMessage[] = configs.map(config => ({
    spiderId: config.id,
    territoryId: config.territoryId,    
    spiderType: config.spiderType,
    config: config.config,
    dateRange,
  }));

  logger.info(`🚀 Starting to enqueue ${messages.length} messages in ${Math.ceil(messages.length / BATCH_SIZE)} batches`);

  // Send in batches
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.ceil((i + 1) / BATCH_SIZE);
    const totalBatches = Math.ceil(messages.length / BATCH_SIZE);
    
    try {
      // Wrap messages in the format expected by Cloudflare Queues
      const wrappedBatch = batch.map(msg => ({ body: msg }));
      await queue.sendBatch(wrappedBatch);
      enqueuedCount += batch.length;
      
      logger.info(`✅ Enqueued batch ${batchNumber}/${totalBatches}`, {
        batchSize: batch.length,
        totalEnqueued: enqueuedCount,
        progress: `${enqueuedCount}/${messages.length}`,
        percentage: Math.round((enqueuedCount / messages.length) * 100)
      });
    } catch (error) {
      logger.error(`❌ Failed to enqueue batch ${batchNumber}/${totalBatches}`, error as Error, {
        batchStart: i,
        batchSize: batch.length,
        errorMessage: (error as Error).message
      });
      
      // Try individual sends for this batch as fallback
      let batchFailedCount = 0;
      for (const message of batch) {
        try {
          await queue.send(message);
          enqueuedCount++;
        } catch (individualError) {
          batchFailedCount++;
          failedCount++;
          logger.error(`Failed to enqueue individual task`, individualError as Error, {
            spiderId: message.spiderId,
            territoryId: message.territoryId,
            errorMessage: (individualError as Error).message
          });
        }
      }
      
      if (batchFailedCount > 0) {
        logger.error(`Batch ${batchNumber} individual fallback completed`, {
          succeeded: batch.length - batchFailedCount,
          failed: batchFailedCount,
          totalEnqueued: enqueuedCount,
          totalFailed: failedCount
        });
      }
    }
  }

  logger.info(`📊 Final enqueue results`, {
    totalMessages: messages.length,
    enqueuedCount,
    failedCount,
    successRate: Math.round((enqueuedCount / messages.length) * 100) + '%'
  });

  return { enqueuedCount, failedCount };
}

/**
 * Dispatch crawl jobs to the queue
 */
app.post('/crawl', async (c) => {
  try {
    const request = await c.req.json<DispatchRequest>();
    
    logger.info('Received crawl request', { request });

    // Validate request
    if (!request.cities || (Array.isArray(request.cities) && request.cities.length === 0)) {
      return c.json<DispatchResponse>({
        success: false,
        tasksEnqueued: 0,
        cities: [],
        error: 'No cities specified',
      }, 400);
    }

    // Determine date range
    const dateRange = getDateRange(request.startDate, request.endDate);

    // Get spider configurations
    const configs = request.cities === 'all'
      ? spiderRegistry.getAllConfigs()
      : request.cities
          .map(id => spiderRegistry.getConfig(id))
          .filter((config): config is NonNullable<typeof config> => config !== undefined);

    if (configs.length === 0) {
      return c.json<DispatchResponse>({
        success: false,
        tasksEnqueued: 0,
        cities: [],
        error: 'No valid spider configurations found',
      }, 400);
    }

    // Enqueue tasks using enhanced sender with detailed logging
    const queue = c.env.CRAWL_QUEUE;
    const { enqueuedCount, failedCount } = await sendMessagesToQueue(queue, configs, dateRange, logger);

    const success = failedCount === 0;
    const status = success ? 200 : (enqueuedCount > 0 ? 207 : 500); // 207 = partial success

    return c.json<DispatchResponse>({
      success,
      tasksEnqueued: enqueuedCount,
      cities: configs.map(c => c.id),
      ...(failedCount > 0 && {
        error: `${failedCount} tasks failed to enqueue`,
        failedCount
      })
    }, status);

  } catch (error) {
    logger.error('Error processing crawl request', error as Error);
    
    return c.json<DispatchResponse>({
      success: false,
      tasksEnqueued: 0,
      cities: [],
      error: (error as Error).message,
    }, 500);
  }
});

/**
 * Crawl today and yesterday for all cities
 */
app.post('/crawl/today-yesterday', async (c) => {
  try {
    const { platform } = await c.req.json().catch(() => ({}));
    
    logger.info('Starting today-yesterday crawl', { platform });

    // Calculate today and yesterday
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const startDate = toISODate(yesterday);
    const endDate = toISODate(today);

    // Get configurations
    const allConfigs = spiderRegistry.getAllConfigs();
    const configs = platform 
      ? allConfigs.filter(config => config.spiderType === platform)
      : allConfigs;

    logger.info('Enqueueing crawl tasks', {
      totalCities: configs.length,
      platform: platform || 'all',
      dateRange: { startDate, endDate }
    });

    // Enqueue tasks using enhanced sender with detailed logging
    const queue = c.env.CRAWL_QUEUE;
    const dateRange = { start: startDate, end: endDate };
    const { enqueuedCount, failedCount } = await sendMessagesToQueue(queue, configs, dateRange, logger);

    const success = failedCount === 0;
    const status = success ? 200 : (enqueuedCount > 0 ? 207 : 500);

    return c.json({
      success,
      message: 'Crawl initiated for today and yesterday',
      tasksEnqueued: enqueuedCount,
      totalCities: configs.length,
      dateRange: { startDate, endDate },
      platform: platform || 'all',
      estimatedTimeMinutes: Math.ceil(configs.length * 7.5 / 60),
      ...(failedCount > 0 && {
        failedCount,
        warning: `${failedCount} tasks failed to enqueue`
      })
    }, status);

  } catch (error) {
    logger.error('Error starting today-yesterday crawl', error as Error);
    
    return c.json({
      success: false,
      error: (error as Error).message,
    }, 500);
  }
});

/**
 * Crawl specific cities 
 */
app.post('/crawl/cities', async (c) => {
  try {
    const { cities, startDate, endDate } = await c.req.json();
    
    if (!cities || !Array.isArray(cities) || cities.length === 0) {
      return c.json({ 
        success: false, 
        error: 'Cities array is required' 
      }, 400);
    }

    logger.info('Starting cities crawl', { cities, startDate, endDate });

    // Determine date range
    const dateRange = getDateRange(startDate, endDate);

    // Get configurations
    const configs = cities
      .map(id => spiderRegistry.getConfig(id))
      .filter((config): config is NonNullable<typeof config> => config !== undefined);

    if (configs.length === 0) {
      return c.json({
        success: false,
        error: 'No valid spider configurations found for provided cities',
      }, 400);
    }

    // Enqueue tasks using enhanced sender with detailed logging
    const queue = c.env.CRAWL_QUEUE;
    const { enqueuedCount, failedCount } = await sendMessagesToQueue(queue, configs, dateRange, logger);

    const success = failedCount === 0;
    const status = success ? 200 : (enqueuedCount > 0 ? 207 : 500);

    return c.json({
      success,
      message: 'Crawl initiated for specified cities',
      tasksEnqueued: enqueuedCount,
      cities: configs.map(c => ({ id: c.id, name: c.name })),
      dateRange,
      ...(failedCount > 0 && {
        failedCount,
        warning: `${failedCount} tasks failed to enqueue`
      })
    }, status);

  } catch (error) {
    logger.error('Error starting cities crawl', error as Error);
    
    return c.json({
      success: false,
      error: (error as Error).message,
    }, 500);
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
    spiders: configs.map(config => ({
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
  
  // Count by platform
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
      estimatedTimeMinutes: Math.ceil(allConfigs.length * 7.5 / 60)
    }
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
    queue: {
      configured: !!c.env.CRAWL_QUEUE,
      totalCitiesConfigured: allConfigs.length,
      batchSize: 100,
      expectedBatches: Math.ceil(allConfigs.length / 100)
    },
    worker: {
      maxBatchSize: 1, // Each worker processes 1 city at a time
      maxBatchTimeout: 60,  // 60 seconds per city
      maxRetries: 3,
      concurrency: 'auto-scaled by Cloudflare'
    }
  });
});

/**
 * Get date range from request or use defaults
 */
function getDateRange(startDate?: string, endDate?: string): DateRange {
  const now = new Date();
  
  // Default: last 30 days
  const defaultStart = new Date(now);
  defaultStart.setDate(defaultStart.getDate() - 30);
  
  return {
    start: startDate || toISODate(defaultStart),
    end: endDate || toISODate(now),
  };
}

/**
 * Queue consumer handler
 */
async function handleQueue(batch: MessageBatch<QueueMessage>, _env: Bindings): Promise<void> {
  logger.info('Processing queue batch', { batchSize: batch.messages.length });

  for (const message of batch.messages) {
    const startTime = Date.now();
    
    try {
      const queueMessage = message.body;
      
      logger.setContext({
        spiderId: queueMessage.spiderId,
        territoryId: queueMessage.territoryId,
      });

      logger.info('Processing crawl task', {
        spiderType: queueMessage.spiderType,
        dateRange: queueMessage.dateRange,
      });

      // Get spider configuration
      const config: SpiderConfig = {
        id: queueMessage.spiderId,
        name: '', // Will be filled from registry if needed
        territoryId: queueMessage.territoryId,
        spiderType: queueMessage.spiderType,
        startDate: '', // Will be filled from config
        config: queueMessage.config,
      };

      // Create spider instance
      const spider = spiderRegistry.createSpider(config, queueMessage.dateRange, _env.BROWSER);

      // Execute crawl
      const gazettes = await spider.crawl();

      const executionTimeMs = Date.now() - startTime;

      const result: CrawlResult = {
        spiderId: queueMessage.spiderId,
        territoryId: queueMessage.territoryId,
        gazettes,
        stats: {
          totalFound: gazettes.length,
          dateRange: queueMessage.dateRange,
          requestCount: spider.getRequestCount(),
          executionTimeMs,
        },
      };

      logger.info('Crawl task completed', {
        spiderId: result.spiderId,
        totalFound: result.stats.totalFound,
        executionTimeMs: result.stats.executionTimeMs,
      });

      // Send gazettes to OCR queue if any were found
      logger.info('OCR Queue check', {
        gazettesLength: gazettes.length,
        hasOcrQueue: !!_env.OCR_QUEUE,
        envKeys: Object.keys(_env),
      });
      
      if (gazettes.length > 0 && _env.OCR_QUEUE) {
        try {
          const ocrSender = new OcrQueueSender(_env.OCR_QUEUE);
          await ocrSender.sendGazettes(gazettes, queueMessage.spiderId);
          
          logger.info('Gazettes sent to OCR queue', {
            spiderId: queueMessage.spiderId,
            count: gazettes.length,
          });
        } catch (error) {
          logger.error('Failed to send gazettes to OCR queue', error as Error, {
            spiderId: queueMessage.spiderId,
            count: gazettes.length,
          });
          // Don't fail the crawl task if OCR queueing fails
        }
      }

      // Mark message as acknowledged
      message.ack();
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      
      logger.error('Crawl task failed', error as Error, {
        spiderId: message.body.spiderId,
        territoryId: message.body.territoryId,
      });

      const result: CrawlResult = {
        spiderId: message.body.spiderId,
        territoryId: message.body.territoryId,
        gazettes: [],
        stats: {
          totalFound: 0,
          dateRange: message.body.dateRange,
          executionTimeMs,
        },
        error: {
          message: (error as Error).message,
        },
      };

      logger.error('Crawl failed', undefined, {
        spiderId: result.spiderId,
        errorMessage: result.error?.message,
      });

      // Retry the message
      message.retry();
    } finally {
      logger.clearContext();
    }
  }
}

// Export unified worker with both HTTP and Queue handlers
export default {
  // HTTP handler
  fetch: app.fetch,
  
  // Queue handler
  queue: handleQueue,
};
