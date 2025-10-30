import { Context } from 'hono';
import { getDatabase } from '../db/client';
import { spiderRegistry, SpiderConfig, DateRange, SpiderPlatformConfig, SpiderType, SpiderScope } from './spiders';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';
import { CrawlJobsRepository } from '../db/repositories/crawl_jobs';

export interface CrawlQueueMessage {
  /** Spider identifier */
  spiderId: string;
  
  /** Territory IBGE code */
  territoryId: string;
  
  /** Spider type */
  spiderType: SpiderType;
  
  /** Gazette scope - city-specific, state-level, or association-level */
  gazetteScope?: SpiderScope;
  
  /** Platform-specific configuration */
  config: SpiderPlatformConfig;
  
  /** Date range to crawl */
  dateRange: DateRange;
  
  /** Optional retry count */
  retryCount?: number;
  
  /** Additional metadata */
  metadata?: {
    crawlJobId?: string;
    [key: string]: any;
  };
}

/**
 * Response from the dispatcher endpoint
 */
interface CrawlDispatchResponse {
  success: boolean;
  tasksEnqueued: number;
  cities: string[];
  crawlJobId?: string;
  error?: string;
}

interface CrawlDispatchRequest {
  /** List of spider IDs to crawl (or "all" for all spiders) */
  cities: string[] | 'all';
  
  /** Optional date range (defaults to last 30 days) */
  startDate?: string;
  endDate?: string;
  
  /** Optional filter by gazette scope */
  scopeFilter?: "city" | "state";
}

/**
 * Environment interface for crawl request handler
 * Extends the full Env interface to ensure compatibility
 */
export interface CrawlRequestEnv extends Env {}

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

  const messages: CrawlQueueMessage[] = configs.map((config) => ({
    spiderId: config.id,
    territoryId: config.territoryId,
    spiderType: config.spiderType,
    gazetteScope: config.gazetteScope,
    config: config.config,
    dateRange,
    metadata: {
      crawlJobId,
    },
  }));

  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);

    try {
      const wrappedBatch = batch.map((msg) => ({ body: msg }));
      await queue.sendBatch(wrappedBatch);
      enqueuedCount += batch.length;

    } catch (error) {
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
 * Handle crawl request
 */
export async function handleCrawlRequest(c: Context<{ Bindings: CrawlRequestEnv }>): Promise<Response> {
  try {
    const request = await c.req.json<CrawlDispatchRequest>();

    const hasCities = request.cities && (Array.isArray(request.cities) && request.cities.length > 0);

    if (!hasCities) {
      return c.json<CrawlDispatchResponse>(
        {
          success: false,
          tasksEnqueued: 0,
          cities: [],
          error:  request.cities ? 'No cities specified on "cities" parameter' : 'Invalid or missing cities parameter' ,
        },
        400
      );
    }

    const now = new Date();     
    const defaultStart = new Date(now);
    
    defaultStart.setDate(defaultStart.getDate() - 30);

    const dateRange = {
      start: request.startDate || toISODate(defaultStart),
      end: request.endDate || toISODate(now),
    };

    let configs: SpiderConfig[] = [];

    if(request.cities === 'all') {
      configs = spiderRegistry.getAllConfigs();
    } else {
      configs = request.cities.map((id) => spiderRegistry.getConfig(id)).filter((config): config is NonNullable<typeof config> => config !== undefined);
    }

    if(configs.length === 0) {
      return c.json<CrawlDispatchResponse>(
        {
          success: false,
          tasksEnqueued: 0,
          cities: [],
          error: 'No valid spider configurations for crawling found',
        },
        400
      );
    }

    // Apply scope filtering at endpoint level
    const originalCount = configs.length;
  
    if (request.scopeFilter) {
      const allowedScopes = Array.isArray(request.scopeFilter) 
        ? request.scopeFilter 
        : [request.scopeFilter];
      
      configs = configs.filter(c => allowedScopes.includes(c?.gazetteScope));

      if (configs.length === 0) {
        return c.json<CrawlDispatchResponse>(
          {
            success: false,
            tasksEnqueued: 0,
            cities: [],
            error: `No cities gazette scope match the specified scope filter: ${allowedScopes.join(', ')}. Found ${originalCount} cities before filtering.`,
          },
          400
        );
      }
    }

    const db = getDatabase(c.env);
    const crawlJobsRepository = new CrawlJobsRepository(db);

    const crawlJob = await crawlJobsRepository.create({
      jobType: 'manual',
      totalCities: configs.length,
      startDate: dateRange.start,
      endDate: dateRange.end,
      metadata: {
        requestType: 'manual',
        requestedCities: request.cities,
        scopeFilter: request.scopeFilter,
        originalCityCount: originalCount,
        userAgent: c.req.header('user-agent'),
      },
    });

    await crawlJobsRepository.trackStart(crawlJob.id);

    const queue = c.env.CRAWL_QUEUE;
    const { enqueuedCount, failedCount } = await sendMessagesToQueue(
      queue,
      configs,
      dateRange,
      crawlJob.id,
      logger
    );

    if(failedCount > 0) {
      await crawlJobsRepository.trackFailure(crawlJob.id, `${failedCount} tasks failed to enqueue`, {
        territoryId: configs[0].territoryId,
        spiderId: configs[0].id,
        spiderType: configs[0].spiderType,
        step: 'crawl_start',
        status: 'failed',
        errorMessage: `${failedCount} tasks failed to enqueue`,
      });

      const hasSuccess = enqueuedCount > 0;
      const status = hasSuccess ? 207 : 500;

      return c.json<CrawlDispatchResponse>(
        {
          success: hasSuccess,
          tasksEnqueued: enqueuedCount,
          cities: configs.map((c) => c.id),
          crawlJobId: crawlJob.id,
          ...(failedCount > 0 && { error: `${failedCount} tasks failed to enqueue`, failedCount }),
        },
        status
      );
    }

    return c.json<CrawlDispatchResponse>(
      {
        success: true,
        tasksEnqueued: enqueuedCount,
        cities: configs.map((c) => c.id),
        crawlJobId: crawlJob.id,
      },
      200
    );
  } catch (error) {

    return c.json<CrawlDispatchResponse>(
      {
        success: false,
        tasksEnqueued: 0,
        cities: [],
        error: (error as Error).message,
      },
      500
    );
  }
}