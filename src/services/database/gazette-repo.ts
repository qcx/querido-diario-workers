/**
 * Gazette Repository
 * Handles CRUD operations for gazette registry
 */

import { DatabaseClient } from './client';
import { Gazette } from '../../types/gazette';
import { logger } from '../../utils';

export interface GazetteRecord {
  id: string;
  jobId: string;
  territoryId: string;
  publicationDate: string;
  editionNumber?: string;
  spiderId: string;
  pdfUrl: string;
  pdfR2Key?: string;
  isExtraEdition: boolean;
  power?: string;
  scrapedAt: string;
  createdAt: string;
  metadata: Record<string, any>;
}

export class GazetteRepository {
  constructor(private db: DatabaseClient) {}

  /**
   * Register a gazette in the permanent registry
   */
  async registerGazette(gazette: Gazette, jobId: string): Promise<string> {
    try {
      // Generate job ID for this specific gazette
      const gazetteJobId = `${jobId}-${gazette.territoryId}-${gazette.date}${gazette.editionNumber ? `-${gazette.editionNumber}` : ''}`;
      
      const result = await this.db.queryTemplate`
        INSERT INTO gazette_registry (
          job_id, territory_id, publication_date, edition_number,
          spider_id, pdf_url, is_extra_edition, power, scraped_at, metadata
        )
        VALUES (
          ${gazetteJobId}, ${gazette.territoryId}, ${gazette.date},
          ${gazette.editionNumber || null}, ${gazette.territoryId}, ${gazette.fileUrl},
          ${gazette.isExtraEdition}, ${gazette.power}, ${gazette.scrapedAt},
          ${JSON.stringify({ sourceText: gazette.sourceText })}
        )
        ON CONFLICT (job_id) DO UPDATE SET
          pdf_url = EXCLUDED.pdf_url,
          scraped_at = EXCLUDED.scraped_at,
          metadata = EXCLUDED.metadata
        RETURNING id, job_id
      `;

      const record = result[0];
      
      logger.info('Gazette registered', {
        gazetteId: record.id,
        jobId: record.job_id,
        territoryId: gazette.territoryId,
        date: gazette.date
      });

      return record.job_id;
    } catch (error) {
      logger.error('Failed to register gazette', {
        territoryId: gazette.territoryId,
        date: gazette.date,
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

      const jobIds: string[] = [];
      
      // Use transaction for batch insertion
      await this.db.transaction(async (sql) => {
        for (const gazette of gazettes) {
          const gazetteJobId = `${jobId}-${gazette.territoryId}-${gazette.date}${gazette.editionNumber ? `-${gazette.editionNumber}` : ''}`;
          
          const result = await sql`
            INSERT INTO gazette_registry (
              job_id, territory_id, publication_date, edition_number,
              spider_id, pdf_url, is_extra_edition, power, scraped_at, metadata
            )
            VALUES (
              ${gazetteJobId}, ${gazette.territoryId}, ${gazette.date},
              ${gazette.editionNumber || null}, ${gazette.territoryId}, ${gazette.fileUrl},
              ${gazette.isExtraEdition}, ${gazette.power}, ${gazette.scrapedAt},
              ${JSON.stringify({ sourceText: gazette.sourceText })}
            )
            ON CONFLICT (job_id) DO UPDATE SET
              pdf_url = EXCLUDED.pdf_url,
              scraped_at = EXCLUDED.scraped_at,
              metadata = EXCLUDED.metadata
            RETURNING job_id
          `;

          jobIds.push(result[0].job_id);
        }
      });

      logger.info('Batch gazette registration completed', {
        count: gazettes.length,
        jobIds: jobIds.length
      });

      return jobIds;
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
      const result = await this.db.queryTemplate`
        SELECT * FROM gazette_registry WHERE job_id = ${jobId}
      `;

      return result.length > 0 ? this.mapToGazetteRecord(result[0]) : null;
    } catch (error) {
      logger.error('Failed to get gazette by job ID', { jobId, error });
      throw error;
    }
  }

  /**
   * Get gazettes by territory and date range
   */
  async getGazettesByTerritory(
    territoryId: string,
    startDate: string,
    endDate: string
  ): Promise<GazetteRecord[]> {
    try {
      const result = await this.db.queryTemplate`
        SELECT * FROM gazette_registry 
        WHERE territory_id = ${territoryId}
          AND publication_date >= ${startDate}
          AND publication_date <= ${endDate}
        ORDER BY publication_date DESC, created_at DESC
      `;

      return result.map(row => this.mapToGazetteRecord(row));
    } catch (error) {
      logger.error('Failed to get gazettes by territory', {
        territoryId,
        startDate,
        endDate,
        error
      });
      throw error;
    }
  }

  /**
   * Get recent gazettes across all territories
   */
  async getRecentGazettes(limit: number = 100): Promise<GazetteRecord[]> {
    try {
      const result = await this.db.queryTemplate`
        SELECT * FROM gazette_registry 
        ORDER BY publication_date DESC, created_at DESC
        LIMIT ${limit}
      `;

      return result.map(row => this.mapToGazetteRecord(row));
    } catch (error) {
      logger.error('Failed to get recent gazettes', { limit, error });
      throw error;
    }
  }

  /**
   * Get gazette statistics
   */
  async getGazetteStats(days: number = 7): Promise<{
    totalGazettes: number;
    totalTerritories: number;
    totalSpiders: number;
    byTerritory: Array<{ territoryId: string; count: number }>;
    byDate: Array<{ date: string; count: number }>;
  }> {
    try {
      const [totalStats, territoryStats, dateStats] = await Promise.all([
        // Total counts
        this.db.queryTemplate`
          SELECT 
            COUNT(*) as total_gazettes,
            COUNT(DISTINCT territory_id) as total_territories,
            COUNT(DISTINCT spider_id) as total_spiders
          FROM gazette_registry 
          WHERE publication_date > NOW() - INTERVAL ${days} DAY
        `,
        
        // By territory
        this.db.queryTemplate`
          SELECT territory_id, COUNT(*) as count
          FROM gazette_registry 
          WHERE publication_date > NOW() - INTERVAL ${days} DAY
          GROUP BY territory_id
          ORDER BY count DESC
          LIMIT 20
        `,
        
        // By date
        this.db.queryTemplate`
          SELECT publication_date::text as date, COUNT(*) as count
          FROM gazette_registry 
          WHERE publication_date > NOW() - INTERVAL ${days} DAY
          GROUP BY publication_date
          ORDER BY publication_date DESC
        `
      ]);

      return {
        totalGazettes: parseInt(totalStats[0]?.total_gazettes || '0'),
        totalTerritories: parseInt(totalStats[0]?.total_territories || '0'),
        totalSpiders: parseInt(totalStats[0]?.total_spiders || '0'),
        byTerritory: territoryStats.map(row => ({
          territoryId: row.territory_id,
          count: parseInt(row.count)
        })),
        byDate: dateStats.map(row => ({
          date: row.date,
          count: parseInt(row.count)  
        }))
      };
    } catch (error) {
      logger.error('Failed to get gazette statistics', { days, error });
      throw error;
    }
  }

  /**
   * Update gazette R2 key after PDF upload
   */
  async updatePdfR2Key(jobId: string, r2Key: string): Promise<void> {
    try {
      await this.db.queryTemplate`
        UPDATE gazette_registry 
        SET pdf_r2_key = ${r2Key}
        WHERE job_id = ${jobId}
      `;

      logger.debug('Updated gazette R2 key', { jobId, r2Key });
    } catch (error) {
      logger.error('Failed to update gazette R2 key', { jobId, r2Key, error });
      throw error;
    }
  }

  /**
   * Check if gazette already exists
   */
  async gazetteExists(jobId: string): Promise<boolean> {
    try {
      const result = await this.db.queryTemplate`
        SELECT 1 FROM gazette_registry WHERE job_id = ${jobId} LIMIT 1
      `;

      return result.length > 0;
    } catch (error) {
      logger.error('Failed to check gazette existence', { jobId, error });
      return false; // Assume it doesn't exist on error
    }
  }

  /**
   * Search gazettes by text
   */
  async searchGazettes(
    searchText: string,
    territoryIds?: string[],
    startDate?: string,
    endDate?: string,
    limit: number = 50
  ): Promise<GazetteRecord[]> {
    try {
      let whereClause = `WHERE (
        territory_id ILIKE $1 OR 
        metadata->>'sourceText' ILIKE $1 OR
        edition_number ILIKE $1
      )`;
      const params = [`%${searchText}%`];

      if (territoryIds && territoryIds.length > 0) {
        whereClause += ` AND territory_id = ANY($${params.length + 1})`;
        params.push(territoryIds);
      }

      if (startDate) {
        whereClause += ` AND publication_date >= $${params.length + 1}`;
        params.push(startDate);
      }

      if (endDate) {
        whereClause += ` AND publication_date <= $${params.length + 1}`;
        params.push(endDate);
      }

      const query = `
        SELECT * FROM gazette_registry 
        ${whereClause}
        ORDER BY publication_date DESC, created_at DESC
        LIMIT $${params.length + 1}
      `;
      params.push(limit);

      const result = await this.db.query(query, params);
      return result.map(row => this.mapToGazetteRecord(row));
    } catch (error) {
      logger.error('Failed to search gazettes', {
        searchText,
        territoryIds,
        error
      });
      throw error;
    }
  }

  /**
   * Map database row to GazetteRecord
   */
  private mapToGazetteRecord(row: any): GazetteRecord {
    return {
      id: row.id,
      jobId: row.job_id,
      territoryId: row.territory_id,
      publicationDate: row.publication_date,
      editionNumber: row.edition_number,
      spiderId: row.spider_id,
      pdfUrl: row.pdf_url,
      pdfR2Key: row.pdf_r2_key,
      isExtraEdition: row.is_extra_edition,
      power: row.power,
      scrapedAt: row.scraped_at,
      createdAt: row.created_at,
      metadata: row.metadata || {}
    };
  }
}
