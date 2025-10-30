import { DatabaseClient, getDatabase, schema, GazetteRegistryRepository } from '../db';
import { DrizzleD1Database } from 'drizzle-orm/d1';

interface Gazette {
  date: string;
  editionNumber?: string;
  fileUrl: string;
  isExtraEdition: boolean;
  power:  'executive' | 'legislative' | 'executive_legislative';
  territoryId: string;
  spiderId: string;
  scrapedAt: string;
  sourceText?: string;
}

export interface GazetteEnqueuerEnv extends Env {}

export class GazetteEnqueuer {
  private databaseClient!: DatabaseClient;
  private db!: DrizzleD1Database<typeof schema>;
  private gazetteRegistryRepository!: GazetteRegistryRepository;
  
  constructor(private env: GazetteEnqueuerEnv) {
    this.env = env;
    this.databaseClient = getDatabase(this.env);
    this.db = this.databaseClient.getDb();
    this.gazetteRegistryRepository = new GazetteRegistryRepository(this.databaseClient);
  }

  async enqueueGazette(gazette: Gazette, crawlJobId: string): Promise<void> {
    const gazetteRecord = await this.gazetteRegistryRepository.findOrCreate(gazette);
    // Fix job id so we can decode? like territoryId:${territoryId}-crawlJobId:${crawlJobId}-gazetteId:${gazetteRecord.id}-date:${gazette.date}
    const gazetteJobId = `${crawlJobId}-${gazetteRecord.id}-${Date.now()}`;

    const gazetteCrawlRecord = await this.gazetteRegistryRepository.trackGazetteCrawl({
      gazetteId: gazetteRecord.id,
      jobId: gazetteJobId,
      territoryId: gazette.territoryId,
      spiderId: gazette.spiderId,
      status: 'created',
      scrapedAt: gazette.scrapedAt
    }, crawlJobId);

    if (this.env.OCR_QUEUE) {
      const edition = gazette.editionNumber || 'regular';
      // Fix job id so we can decode? like territoryId:${territoryId}-crawlJobId:${crawlJobId}-gazetteId:${gazetteRecord.id}-date:${gazette.date}
      const jobId = `${gazette.territoryId}_${gazette.date}_${edition}_${Date.now()}`;
      const message = {
        jobId,
        gazetteCrawl: gazetteCrawlRecord,
        gazette: gazetteRecord,
        queuedAt: new Date().toISOString(),
        crawlJobId: crawlJobId
      };

      this.env.OCR_QUEUE.send(message);
    }
  }
}