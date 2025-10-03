import { Hono } from 'hono';
import { DispatchRequest, DispatchResponse, QueueMessage, DateRange } from './types';
import { spiderRegistry } from './spiders/registry';
import { logger } from './utils/logger';
import { toISODate } from './utils/date-utils';

type Bindings = {
  CRAWL_QUEUE: Queue<QueueMessage>;
};

const app = new Hono<{ Bindings: Bindings }>();

/**
 * Health check endpoint
 */
app.get('/', (c) => {
  return c.json({
    service: 'querido-diario-dispatcher',
    version: '1.0.0',
    spidersRegistered: spiderRegistry.getCount(),
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

export default app;
