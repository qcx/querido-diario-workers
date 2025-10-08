/**
 * Drizzle-based Gazette Repository
 * Replaces gazette-repo.ts with Drizzle ORM implementation
 */

import { eq, and, desc, asc } from 'drizzle-orm';
import { DrizzleDatabaseClient, schema } from './drizzle-client';
import { logger } from '../../utils/logger';
import type { Gazette } from '../../types';
import type { GazetteMetadata } from '../../types/database';

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
      const gazetteJobId = `${jobId}-${gazette.territoryId}-${gazette.date}${gazette.editionNumber ? `-${gazette.editionNumber}` : ''}`;
      const db = this.dbClient.getDb();
      
      const gazetteData = {
        id: this.dbClient.generateId(),
        jobId: gazetteJobId,
        territoryId: gazette.territoryId,
        publicationDate: gazette.date,
        editionNumber: gazette.editionNumber || null,
        spiderId: gazette.territoryId,
        pdfUrl: gazette.fileUrl,
        pdfR2Key: null,
        isExtraEdition: gazette.isExtraEdition,
        power: gazette.power || null,
        scrapedAt: gazette.scrapedAt,
        createdAt: this.dbClient.getCurrentTimestamp(),
        metadata: this.dbClient.stringifyJson({ sourceText: gazette.sourceText })
      };

      // Use INSERT OR REPLACE for upsert behavior
      const result = await db.insert(schema.gazetteRegistry)
        .values(gazetteData)
        .onConflictDoUpdate({
          target: schema.gazetteRegistry.jobId,
          set: {
            pdfUrl: gazetteData.pdfUrl,
            scrapedAt: gazetteData.scrapedAt,
            metadata: gazetteData.metadata
          }
        })
        .returning({ id: schema.gazetteRegistry.id });

      logger.info('Gazette registered successfully', {
        gazetteId: result[0].id,
        jobId: gazetteJobId,
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
        const gazetteJobId = `${jobId}-${gazette.territoryId}-${gazette.date}${gazette.editionNumber ? `-${gazette.editionNumber}` : ''}`;
        const id = this.dbClient.generateId();
        gazetteIds.push(id);
        
        return {
          id,
          jobId: gazetteJobId,
          territoryId: gazette.territoryId,
          publicationDate: gazette.date,
          editionNumber: gazette.editionNumber || null,
          spiderId: gazette.territoryId,
          pdfUrl: gazette.fileUrl,
          pdfR2Key: null,
          isExtraEdition: gazette.isExtraEdition,
          power: gazette.power || null,
          scrapedAt: gazette.scrapedAt,
          createdAt: this.dbClient.getCurrentTimestamp(),
          metadata: this.dbClient.stringifyJson({ sourceText: gazette.sourceText })
        };
      });

      // Execute batch insert using D1 batch API
      const insertStatements = batchData.map(data =>
        db.insert(schema.gazetteRegistry).values(data).onConflictDoUpdate({
          target: schema.gazetteRegistry.jobId,
          set: {
            pdfUrl: data.pdfUrl,
            scrapedAt: data.scrapedAt,
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
   * Get gazette by job ID
   */
  async getGazetteByJobId(jobId: string): Promise<GazetteRecord | null> {
    try {
      const db = this.dbClient.getDb();
      
      const results = await db.select()
        .from(schema.gazetteRegistry)
        .where(eq(schema.gazetteRegistry.jobId, jobId))
        .limit(1);

      if (results.length === 0) {
        return null;
      }

      const record = results[0];
      return {
        ...record,
        metadata: this.dbClient.parseJson<GazetteMetadata>(record.metadata, {})
      };
    } catch (error) {
      logger.error('Failed to get gazette by job ID', {
        jobId,
        error
      });
      throw error;
    }
  }

  /**
   * Get gazette by ID
   */
  async getGazetteById(id: string): Promise<GazetteRecord | null> {
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
        ...record,
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
    try {
      const db = this.dbClient.getDb();

      // Get paginated results
      const gazettes = await db.select()
        .from(schema.gazetteRegistry)
        .where(and(
          eq(schema.gazetteRegistry.territoryId, territoryId),
          // Note: String comparison works for ISO 8601 dates
          eq(schema.gazetteRegistry.publicationDate, '>=', startDate),
          eq(schema.gazetteRegistry.publicationDate, '<=', endDate)
        ))
        .orderBy(desc(schema.gazetteRegistry.publicationDate))
        .limit(limit)
        .offset(offset);

      // Get total count
      const totalResults = await db.select({ count: schema.gazetteRegistry.id })
        .from(schema.gazetteRegistry)
        .where(and(
          eq(schema.gazetteRegistry.territoryId, territoryId),
          eq(schema.gazetteRegistry.publicationDate, '>=', startDate),
          eq(schema.gazetteRegistry.publicationDate, '<=', endDate)
        ));

      const records = gazettes.map(gazette => ({
        ...gazette,
        metadata: this.dbClient.parseJson<GazetteMetadata>(gazette.metadata, {})
      }));

      return {
        gazettes: records,
        total: totalResults.length
      };
    } catch (error) {
      logger.error('Failed to search gazettes', {
        territoryId,
        startDate,
        endDate,
        error
      });
      throw error;
    }
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
   */
  async getRecentGazettes(
    territoryId: string,
    days: number = 7,
    limit: number = 50
  ): Promise<GazetteRecord[]> {
    try {
      const db = this.dbClient.getDb();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const cutoffDateStr = cutoffDate.toISOString().split('T')[0]; // YYYY-MM-DD

      const gazettes = await db.select()
        .from(schema.gazetteRegistry)
        .where(and(
          eq(schema.gazetteRegistry.territoryId, territoryId),
          eq(schema.gazetteRegistry.publicationDate, '>=', cutoffDateStr)
        ))
        .orderBy(desc(schema.gazetteRegistry.publicationDate))
        .limit(limit);

      return gazettes.map(gazette => ({
        ...gazette,
        metadata: this.dbClient.parseJson<GazetteMetadata>(gazette.metadata, {})
      }));
    } catch (error) {
      logger.error('Failed to get recent gazettes', {
        territoryId,
        days,
        error
      });
      throw error;
    }
  }
}
