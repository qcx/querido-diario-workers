import { CrawlQueueMessage } from './request-handler';
import { DatabaseClient, getDatabase, schema, CrawlJobsRepository } from '../db';
import { DrizzleD1Database } from 'drizzle-orm/d1';
import { SpiderConfig, spiderRegistry, SpiderScope } from './spiders';

interface Gazette {
  date: string;
  editionNumber?: string;
  fileUrl: string;
  isExtraEdition: boolean;
  power:  'executive' | 'legislative' | 'executive_legislative';
  territoryId: string;
  scrapedAt: string;
  sourceText?: string;
  spiderId: string;
}

export interface CrawlResult {
  spiderId: string;
  territoryId: string;
  gazettes: Gazette[];
  stats: {
    totalFound: number;
    dateRange: {
      start: string;
      end: string;
    };
    
    requestCount?: number;
    executionTimeMs?: number;
  };
  
  error?: {
    message: string;
    code?: string;
    details?: any;
  };
}

export interface CrawlQueueHandlerEnv extends Env {}

export class CrawlQueueHandler {
  private databaseClient!: DatabaseClient;
  private db!: DrizzleD1Database<typeof schema>;
  private crawlJobsRepository!: CrawlJobsRepository;

  constructor(private env: CrawlQueueHandlerEnv) {
    this.env = env;
    this.databaseClient = getDatabase(this.env);
    this.db = this.databaseClient.getDb();
    this.crawlJobsRepository = new CrawlJobsRepository(this.databaseClient);
  }

  async batchHandler(batch: MessageBatch<CrawlQueueMessage>, gazetteCallback: (gazette: Gazette, crawlJobId: string) => Promise<void>): Promise<void> {
    for (const message of batch.messages) {
      await this.handle(message, gazetteCallback);
    }
  }

  async handle(message: Message<CrawlQueueMessage>, gazetteCallback: (gazette: Gazette, crawlJobId: string) => Promise<void>): Promise<void> {
    const startTime = Date.now();
    const queueMessage = message.body;
    const crawlJobId = queueMessage.metadata?.crawlJobId || 'unknown';

    await this.crawlJobsRepository.trackProgress({
      crawlJobId,
      territoryId: queueMessage.territoryId,
      spiderId: queueMessage.spiderId,
      spiderType: queueMessage.spiderType,
      step: 'crawl_start',
      status: 'started',
    });

    const config: SpiderConfig = {
      id: queueMessage.spiderId,
      name: '',
      territoryId: queueMessage.territoryId,
      spiderType: queueMessage.spiderType,
      gazetteScope: queueMessage.gazetteScope as SpiderScope || SpiderScope.CITY,
      startDate: '',
      config: queueMessage.config,
    };

    const spider = spiderRegistry.createSpider(config, queueMessage.dateRange, this.env.BROWSER);
    const gazettes = await spider.crawl();
    const executionTimeMs = Date.now() - startTime;

    // const result: CrawlResult = {
    //  spiderId: queueMessage.spiderId,
    //  territoryId: queueMessage.territoryId,
    //  gazettes,
    //  stats: {
    //    totalFound: gazettes.length,
    //    dateRange: queueMessage.dateRange,
    //    requestCount: spider.getRequestCount(),
    //    executionTimeMs,
    //  },
    //};

    if(gazettes.length > 0) {
      for(const gazette of gazettes) {
        await gazetteCallback(gazette, crawlJobId);
      }
    }

    await this.crawlJobsRepository.trackProgress({
      crawlJobId,
      territoryId: queueMessage.territoryId,
      spiderId: queueMessage.spiderId,
      spiderType: queueMessage.spiderType,
      step: 'crawl_end',
      status: 'completed',
      gazettesFound: gazettes.length,
      executionTimeMs
    });

    message.ack();
  }
}