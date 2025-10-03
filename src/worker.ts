import { Hono } from 'hono';
import { DispatchRequest, DispatchResponse, QueueMessage, DateRange, CrawlResult, SpiderConfig } from './types';
import { spiderRegistry } from './spiders/registry';
import { logger } from './utils/logger';
import { toISODate } from './utils/date-utils';

/**
 * Unified Worker that handles both HTTP requests (dispatcher) and queue processing (consumer)
 */

type Bindings = {
  CRAWL_QUEUE: Queue<QueueMessage>;
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

    // Enqueue tasks
    const queue = c.env.CRAWL_QUEUE;
    let enqueuedCount = 0;

    for (const config of configs) {
      try {
        const message: QueueMessage = {
          spiderId: config.id,
          territoryId: config.territoryId,
          spiderType: config.spiderType,
          config: config.config,
          dateRange,
        };

        await queue.send(message);
        enqueuedCount++;
      } catch (error) {
        logger.error(`Failed to enqueue task for ${config.id}`, error as Error);
      }
    }

    logger.info('Crawl tasks enqueued', {
      tasksEnqueued: enqueuedCount,
      dateRange,
    });

    return c.json<DispatchResponse>({
      success: true,
      tasksEnqueued: enqueuedCount,
      cities: configs.map(c => c.id),
    });

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
      const spider = spiderRegistry.createSpider(config, queueMessage.dateRange);

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

      // Here you would typically:
      // 1. Store the gazettes in a database or storage
      // 2. Send notifications if needed
      // 3. Update monitoring/metrics

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
