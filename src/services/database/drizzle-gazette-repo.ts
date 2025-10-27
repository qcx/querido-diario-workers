/**
 * Drizzle-based Gazette Repository
 * Replaces gazette-repo.ts with Drizzle ORM implementation
 */

import { eq, and, desc, sql } from 'drizzle-orm';
import { DrizzleDatabaseClient, schema } from './drizzle-client';
import { logger } from '../../utils/logger';
import type { Gazette } from '../../types';
import type { GazetteMetadata } from '../../types/database';
import type { 
  CreateGazetteCrawlInput, 
  GazetteCrawlRecord, 
  GazetteRegistryRecord,
  GazetteRegistryStatus,
  GazetteCrawlStatus
} from '../../types/gazette';

export interface GazetteRecord {
  id: string;
  jobId: string;
  territoryId: string;
  publicationDate: string;
  editionNumber: string | null;
  spiderId: string;
  pdfUrl: string;
  pdfR2Key: string | null;
  isExtraEdition: boolean;
  power: string | null;
  scrapedAt: string;
  createdAt: string;
  metadata: GazetteMetadata;
}

export class DrizzleGazetteRepository {
  constructor(private dbClient: DrizzleDatabaseClient) {}

  /**
   * Register a single gazette
   */
  async registerGazette(gazette: Gazette, jobId: string): Promise<string> {
    try {
      const db = this.dbClient.getDb();
      
      const gazetteData = {
        id: this.dbClient.generateId(),
        publicationDate: gazette.date,
        editionNumber: gazette.editionNumber || null,
        pdfUrl: gazette.fileUrl,
        pdfR2Key: null,
        isExtraEdition: gazette.isExtraEdition,
        power: gazette.power || null,
        createdAt: this.dbClient.getCurrentTimestamp(),
        status: 'pending' as const,
        metadata: this.dbClient.stringifyJson({ sourceText: gazette.sourceText })
      };

      // Use INSERT with conflict handling
      // Use EXCLUDED to ensure RETURNING always returns a row
      const result = await db.insert(schema.gazetteRegistry)
        .values(gazetteData)
        .onConflictDoUpdate({
          target: schema.gazetteRegistry.pdfUrl,
          set: {
            // Update metadata and reference EXCLUDED to ensure row is returned
            metadata: gazetteData.metadata,
            pdfUrl: sql`EXCLUDED.pdf_url`
          }
        })
        .returning({ id: schema.gazetteRegistry.id });

      // Fallback: if result is empty (shouldn't happen with EXCLUDED, but defensive)
      if (result.length === 0) {
        logger.warn('RETURNING was empty, falling back to SELECT', {
          pdfUrl: gazette.fileUrl
        });
        
        const existing = await db.select({ id: schema.gazetteRegistry.id })
          .from(schema.gazetteRegistry)
          .where(eq(schema.gazetteRegistry.pdfUrl, gazette.fileUrl))
          .limit(1);
        
        if (existing.length === 0) {
          throw new Error(`Failed to register or find gazette by PDF URL: ${gazette.fileUrl}`);
        }
        
        logger.info('Gazette found via fallback SELECT', {
          gazetteId: existing[0].id,
          territoryId: gazette.territoryId,
          publicationDate: gazette.date
        });
        
        return existing[0].id;
      }

      logger.info('Gazette registered successfully', {
        gazetteId: result[0].id,
        territoryId: gazette.territoryId,
        publicationDate: gazette.date
      });

      return result[0].id;
    } catch (error) {
      logger.error('Failed to register gazette', {
        territoryId: gazette.territoryId,
        publicationDate: gazette.date,
        error
      });
      throw error;
    }
  }

  /**
   * Register multiple gazettes in a batch
   */
  async registerGazettes(gazettes: Gazette[], jobId: string): Promise<string[]> {
    try {
      if (gazettes.length === 0) return [];

      const db = this.dbClient.getDb();
      const gazetteIds: string[] = [];
      
      // Prepare batch data
      const batchData = gazettes.map(gazette => {
        const id = this.dbClient.generateId();
        gazetteIds.push(id);
        
        return {
          id,
          publicationDate: gazette.date,
          editionNumber: gazette.editionNumber || null,
          pdfUrl: gazette.fileUrl,
          pdfR2Key: null,
          isExtraEdition: gazette.isExtraEdition,
          power: gazette.power || null,
          createdAt: this.dbClient.getCurrentTimestamp(),
          status: 'pending' as const,
          metadata: this.dbClient.stringifyJson({ sourceText: gazette.sourceText })
        };
      });

      // Execute batch insert using D1 batch API
      const insertStatements = batchData.map(data =>
        db.insert(schema.gazetteRegistry).values(data).onConflictDoUpdate({
          target: schema.gazetteRegistry.pdfUrl,
          set: {
            // Just update metadata on conflict
            metadata: data.metadata
          }
        })
      );

      await this.dbClient.batch(insertStatements);

      logger.info('Batch gazette registration completed', {
        count: gazettes.length,
        gazetteIds: gazetteIds.length
      });

      return gazetteIds;
    } catch (error) {
      logger.error('Failed to register gazettes batch', {
        count: gazettes.length,
        error
      });
      throw error;
    }
  }

  /**
   * Get gazette by job ID (DEPRECATED - jobId is in gazette_crawls, not gazette_registry)
   * Use getGazetteCrawlsByGazetteId instead
   */
  async getGazetteByJobId(jobId: string): Promise<GazetteRecord | null> {
    logger.warn('getGazetteByJobId is deprecated, use gazette_crawls queries instead');
    return null;
  }

  /**
   * Get gazette by ID
   */
  async getGazetteById(id: string): Promise<GazetteRegistryRecord | null> {
    try {
      const db = this.dbClient.getDb();
      
      const results = await db.select()
        .from(schema.gazetteRegistry)
        .where(eq(schema.gazetteRegistry.id, id))
        .limit(1);

      if (results.length === 0) {
        return null;
      }

      const record = results[0];
      return {
        id: record.id,
        publicationDate: record.publicationDate,
        editionNumber: record.editionNumber,
        pdfUrl: record.pdfUrl,
        pdfR2Key: record.pdfR2Key,
        isExtraEdition: !!record.isExtraEdition,
        power: record.power,
        createdAt: record.createdAt,
        status: record.status as GazetteRegistryStatus,
        metadata: this.dbClient.parseJson<GazetteMetadata>(record.metadata, {})
      };
    } catch (error) {
      logger.error('Failed to get gazette by ID', {
        id,
        error
      });
      throw error;
    }
  }

  /**
   * Search gazettes by territory and date range
   * DEPRECATED - territoryId is in gazette_crawls, not gazette_registry
   * Query gazette_crawls and join with gazette_registry instead
   */
  async searchGazettes(
    territoryId: string,
    startDate: string,
    endDate: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<{
    gazettes: GazetteRecord[];
    total: number;
  }> {
    logger.warn('searchGazettes is deprecated, query gazette_crawls instead');
    return {
      gazettes: [],
      total: 0
    };
  }

  /**
   * Update R2 key for a gazette
   */
  async updateR2Key(gazetteId: string, r2Key: string): Promise<void> {
    try {
      const db = this.dbClient.getDb();

      await db.update(schema.gazetteRegistry)
        .set({ pdfR2Key: r2Key })
        .where(eq(schema.gazetteRegistry.id, gazetteId));

      logger.info('R2 key updated for gazette', {
        gazetteId,
        r2Key
      });
    } catch (error) {
      logger.error('Failed to update R2 key', {
        gazetteId,
        r2Key,
        error
      });
      throw error;
    }
  }

  /**
   * Get recent gazettes for a territory
   * DEPRECATED - territoryId is in gazette_crawls, not gazette_registry
   */
  async getRecentGazettes(
    territoryId: string,
    days: number = 7,
    limit: number = 50
  ): Promise<GazetteRecord[]> {
    logger.warn('getRecentGazettes is deprecated, query gazette_crawls instead');
    return [];
  }

  /**
   * Get gazette by PDF URL
   */
  async getGazetteByPdfUrl(pdfUrl: string): Promise<GazetteRegistryRecord | null> {
    try {
      const db = this.dbClient.getDb();
      
      const results = await db.select()
        .from(schema.gazetteRegistry)
        .where(eq(schema.gazetteRegistry.pdfUrl, pdfUrl))
        .limit(1);

      if (results.length === 0) {
        return null;
      }

      const record = results[0];
      return {
        id: record.id,
        publicationDate: record.publicationDate,
        editionNumber: record.editionNumber,
        pdfUrl: record.pdfUrl,
        pdfR2Key: record.pdfR2Key,
        isExtraEdition: !!record.isExtraEdition,
        power: record.power,
        createdAt: record.createdAt,
        status: record.status as GazetteRegistryStatus,
        metadata: this.dbClient.parseJson<GazetteMetadata>(record.metadata, {})
      };
    } catch (error) {
      logger.error('Failed to get gazette by PDF URL', {
        pdfUrl,
        error
      });
      throw error;
    }
  }

  /**
   * Update gazette status
   */
  async updateGazetteStatus(gazetteId: string, status: GazetteRegistryStatus): Promise<void> {
    try {
      const db = this.dbClient.getDb();

      await db.update(schema.gazetteRegistry)
        .set({ status })
        .where(eq(schema.gazetteRegistry.id, gazetteId));

      logger.info('Gazette status updated', {
        gazetteId,
        status
      });
    } catch (error) {
      logger.error('Failed to update gazette status', {
        gazetteId,
        status,
        error
      });
      throw error;
    }
  }

  /**
   * Create a gazette_crawl record
   */
  async createGazetteCrawl(input: CreateGazetteCrawlInput): Promise<string> {
    try {
      const db = this.dbClient.getDb();
      const id = this.dbClient.generateId();

      await db.insert(schema.gazetteCrawls).values({
        id,
        jobId: input.jobId,
        territoryId: input.territoryId,
        spiderId: input.spiderId,
        gazetteId: input.gazetteId,
        status: input.status,
        scrapedAt: input.scrapedAt,
        createdAt: this.dbClient.getCurrentTimestamp()
      });

      logger.info('Gazette crawl created', {
        id,
        gazetteId: input.gazetteId,
        status: input.status
      });

      return id;
    } catch (error) {
      logger.error('Failed to create gazette crawl', {
        gazetteId: input.gazetteId,
        status: input.status,
        error
      });
      throw error;
    }
  }

  /**
   * Update gazette_crawl status
   */
  async updateGazetteCrawlStatus(gazetteCrawlId: string, status: GazetteCrawlStatus): Promise<void> {
    try {
      const db = this.dbClient.getDb();

      await db.update(schema.gazetteCrawls)
        .set({ status })
        .where(eq(schema.gazetteCrawls.id, gazetteCrawlId));

      logger.info('Gazette crawl status updated', {
        gazetteCrawlId,
        status
      });
    } catch (error) {
      logger.error('Failed to update gazette crawl status', {
        gazetteCrawlId,
        status,
        error
      });
      throw error;
    }
  }

  /**
   * Update all gazette_crawls for a gazette to a specific status
   */
  async updateCrawlsStatusByGazetteId(gazetteId: string, status: GazetteCrawlStatus): Promise<void> {
    try {
      const db = this.dbClient.getDb();

      await db.update(schema.gazetteCrawls)
        .set({ status })
        .where(eq(schema.gazetteCrawls.gazetteId, gazetteId));

      logger.info('Updated all gazette crawls for gazette', {
        gazetteId,
        status
      });
    } catch (error) {
      logger.error('Failed to update crawls by gazette ID', {
        gazetteId,
        status,
        error
      });
      throw error;
    }
  }

  /**
   * Get all gazette_crawls for a specific gazette
   */
  async getGazetteCrawlsByGazetteId(gazetteId: string): Promise<GazetteCrawlRecord[]> {
    try {
      const db = this.dbClient.getDb();

      const results = await db.select()
        .from(schema.gazetteCrawls)
        .where(eq(schema.gazetteCrawls.gazetteId, gazetteId))
        .orderBy(desc(schema.gazetteCrawls.createdAt));

      return results.map(record => ({
        id: record.id,
        jobId: record.jobId,
        territoryId: record.territoryId,
        spiderId: record.spiderId,
        gazetteId: record.gazetteId,
        status: record.status as GazetteCrawlStatus,
        scrapedAt: record.scrapedAt,
        createdAt: record.createdAt
      }));
    } catch (error) {
      logger.error('Failed to get gazette crawls by gazette ID', {
        gazetteId,
        error
      });
      throw error;
    }
  }

  /**
   * Update gazette crawl with analysis result ID
   */
  async linkAnalysisToGazetteCrawl(
    gazetteCrawlId: string,
    analysisResultId: string
  ): Promise<void> {
    try {
      const db = this.dbClient.getDb();

      await db.update(schema.gazetteCrawls)
        .set({ analysisResultId, status: 'success' })
        .where(eq(schema.gazetteCrawls.id, gazetteCrawlId));

      logger.info('Linked analysis to gazette crawl', {
        gazetteCrawlId,
        analysisResultId
      });
    } catch (error) {
      logger.error('Failed to link analysis to gazette crawl', {
        gazetteCrawlId,
        analysisResultId,
        error
      });
      throw error;
    }
  }

  /**
   * Get gazette crawl by gazette ID and territory
   */
  async getGazetteCrawlByGazetteAndTerritory(
    gazetteId: string,
    territoryId: string
  ): Promise<GazetteCrawlRecord | null> {
    try {
      const db = this.dbClient.getDb();

      const results = await db.select()
        .from(schema.gazetteCrawls)
        .where(and(
          eq(schema.gazetteCrawls.gazetteId, gazetteId),
          eq(schema.gazetteCrawls.territoryId, territoryId)
        ))
        .orderBy(desc(schema.gazetteCrawls.createdAt))
        .limit(1);

      if (results.length === 0) {
        return null;
      }

      const record = results[0];
      return {
        id: record.id,
        jobId: record.jobId,
        gazetteId: record.gazetteId,
        territoryId: record.territoryId,
        spiderId: record.spiderId,
        status: record.status as GazetteCrawlStatus,
        scrapedAt: record.scrapedAt,
        createdAt: record.createdAt
      };
    } catch (error) {
      logger.error('Failed to get gazette crawl', { gazetteId, territoryId, error });
      throw error;
    }
  }

  /**
   * Get gazette crawl by job ID with joined gazette registry data
   */
  async getGazetteCrawlByJobId(jobId: string): Promise<{
    crawl: GazetteCrawlRecord;
    gazette: GazetteRegistryRecord;
  } | null> {
    try {
      const db = this.dbClient.getDb();
      
      // Query gazette_crawl by jobId, then join with gazette_registry
      const results = await db.select({
        crawl: schema.gazetteCrawls,
        gazette: schema.gazetteRegistry
      })
        .from(schema.gazetteCrawls)
        .innerJoin(
          schema.gazetteRegistry,
          eq(schema.gazetteCrawls.gazetteId, schema.gazetteRegistry.id)
        )
        .where(eq(schema.gazetteCrawls.jobId, jobId))
        .limit(1);

      if (results.length === 0) {
        return null;
      }

      const record = results[0];
      return {
        crawl: {
          id: record.crawl.id,
          jobId: record.crawl.jobId,
          territoryId: record.crawl.territoryId,
          spiderId: record.crawl.spiderId,
          gazetteId: record.crawl.gazetteId,
          status: record.crawl.status as GazetteCrawlStatus,
          scrapedAt: record.crawl.scrapedAt,
          createdAt: record.crawl.createdAt
        },
        gazette: {
          id: record.gazette.id,
          publicationDate: record.gazette.publicationDate,
          editionNumber: record.gazette.editionNumber,
          pdfUrl: record.gazette.pdfUrl,
          pdfR2Key: record.gazette.pdfR2Key,
          isExtraEdition: !!record.gazette.isExtraEdition,
          power: record.gazette.power,
          createdAt: record.gazette.createdAt,
          status: record.gazette.status as GazetteRegistryStatus,
          metadata: this.dbClient.parseJson<GazetteMetadata>(record.gazette.metadata, {})
        }
      };
    } catch (error) {
      logger.error('Failed to get gazette crawl by job ID', { jobId, error });
      throw error;
    }
  }
}
