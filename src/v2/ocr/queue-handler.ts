import { DatabaseClient, getDatabase, schema, GazetteRegistryRepository } from '../db';
import { DrizzleD1Database } from 'drizzle-orm/d1';

/**
 * Message sent to OCR queue for processing
 */
export interface OcrQueueMessage {
  jobId: string;
  gazetteCrawl: typeof schema.gazetteCrawls.$inferSelect;
  gazette: typeof schema.gazetteRegistry.$inferSelect;
  crawlJobId: string;
  queuedAt: string;
}

export interface OcrQueueHandlerEnv extends Env {}

export class OcrQueueHandler {
  private databaseClient!: DatabaseClient;
  private db!: DrizzleD1Database<typeof schema>;
  private gazetteRegistryRepository!: GazetteRegistryRepository;

  constructor(private env: OcrQueueHandlerEnv) {
    this.env = env;
    this.databaseClient = getDatabase(this.env);
    this.db = this.databaseClient.getDb();
    this.gazetteRegistryRepository = new GazetteRegistryRepository(this.databaseClient);
  }

  async batchHandler(batch: MessageBatch<OcrQueueMessage>): Promise<void> {
    const results = [];
    
    for (const message of batch.messages) {
      const result = await this.handle(message);
      results.push(result);
    }
  }

  private async handle(message: Message<OcrQueueMessage>): Promise<void> {
    const startTime = Date.now();
    const ocrMessage = message.body;

    if(ocrMessage.gazette.status === 'ocr_success') {
      await this.gazetteRegistryRepository.updateCrawlsStatus(ocrMessage.gazetteCrawl.id, 'analysis_pending');
      message.ack();
      return;
    } else if(ocrMessage.gazette.status === 'ocr_failure') {
      await this.gazetteRegistryRepository.updateCrawlsStatus(ocrMessage.gazetteCrawl.id, 'failed');
      message.ack();
      return;
    }
  }
}