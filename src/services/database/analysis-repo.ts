/**
 * Analysis Repository
 * Handles storage and retrieval of gazette analysis results
 */

import { DatabaseClient } from './client';
import { GazetteAnalysis, Finding } from '../../types/analysis';
import { logger } from '../../utils';

export interface AnalysisRecord {
  id: string;
  jobId: string;
  ocrJobId: string;
  gazetteId: string;
  territoryId: string;
  publicationDate: string;
  totalFindings: number;
  highConfidenceFindings: number;
  categories: string[];
  keywords: string[];
  findings: Finding[];
  summary: any;
  processingTimeMs?: number;
  analyzedAt: string;
  metadata: Record<string, any>;
}

export class AnalysisRepository {
  constructor(private db: DatabaseClient) {}

  /**
   * Store analysis results in the database
   */
  async storeAnalysis(analysis: GazetteAnalysis): Promise<string> {
    try {
      // Find the gazette using territory_id and publication_date since job_id formats differ
      let gazetteResult = await this.db.queryTemplate`
        SELECT id FROM gazette_registry 
        WHERE territory_id = ${analysis.territoryId} 
        AND publication_date = ${analysis.publicationDate}
        ORDER BY created_at DESC
        LIMIT 1
      `;

      if (gazetteResult.length === 0) {
        // Fallback: try to find by OCR job ID pattern
        gazetteResult = await this.db.queryTemplate`
          SELECT id FROM gazette_registry 
          WHERE job_id LIKE ${`%${analysis.territoryId}%${analysis.publicationDate}%`}
          ORDER BY created_at DESC
          LIMIT 1
        `;
      }

      if (gazetteResult.length === 0) {
        throw new Error(`Gazette not found for territory ${analysis.territoryId} on ${analysis.publicationDate}. Available job formats might not match expected pattern.`);
      }

      const gazetteId = gazetteResult[0].id;

      // Calculate processing time from analyses
      const processingTimeMs = analysis.analyses.reduce(
        (total, a) => total + (a.processingTimeMs || 0), 
        0
      );

      const result = await this.db.queryTemplate`
        INSERT INTO analysis_results (
          job_id, ocr_job_id, gazette_id, territory_id, publication_date,
          total_findings, high_confidence_findings, categories, keywords,
          findings, summary, processing_time_ms, analyzed_at, metadata
        )
        VALUES (
          ${analysis.jobId}, ${analysis.ocrJobId}, ${gazetteId}, 
          ${analysis.territoryId}, ${analysis.publicationDate},
          ${analysis.summary.totalFindings}, ${analysis.summary.highConfidenceFindings},
          ${analysis.summary.categories}, ${analysis.summary.keywords},
          ${JSON.stringify(analysis.analyses.flatMap(a => a.findings))},
          ${JSON.stringify(analysis.summary)}, ${processingTimeMs},
          ${analysis.analyzedAt}, ${JSON.stringify(analysis.metadata)}
        )
        ON CONFLICT (job_id) DO UPDATE SET
          total_findings = EXCLUDED.total_findings,
          high_confidence_findings = EXCLUDED.high_confidence_findings,
          categories = EXCLUDED.categories,
          keywords = EXCLUDED.keywords,
          findings = EXCLUDED.findings,
          summary = EXCLUDED.summary,
          processing_time_ms = EXCLUDED.processing_time_ms,
          analyzed_at = EXCLUDED.analyzed_at,
          metadata = EXCLUDED.metadata
        RETURNING id
      `;

      const analysisId = result[0].id;

      logger.info('Analysis stored successfully', {
        analysisId,
        jobId: analysis.jobId,
        ocrJobId: analysis.ocrJobId,
        totalFindings: analysis.summary.totalFindings
      });

      return analysisId;
    } catch (error) {
      logger.error('Failed to store analysis', {
        jobId: analysis.jobId,
        ocrJobId: analysis.ocrJobId,
        error
      });
      throw error;
    }
  }

  /**
   * Get analysis by job ID
   */
  async getAnalysisByJobId(jobId: string): Promise<AnalysisRecord | null> {
    try {
      const result = await this.db.queryTemplate`
        SELECT * FROM analysis_results WHERE job_id = ${jobId}
      `;

      if (result.length === 0) {
        return null;
      }

      return this.mapToAnalysisRecord(result[0]);
    } catch (error) {
      logger.error('Failed to get analysis by job ID', { jobId, error });
      throw error;
    }
  }

  /**
   * Get analysis by OCR job ID
   */
  async getAnalysisByOcrJobId(ocrJobId: string): Promise<AnalysisRecord | null> {
    try {
      const result = await this.db.queryTemplate`
        SELECT * FROM analysis_results WHERE ocr_job_id = ${ocrJobId}
      `;

      if (result.length === 0) {
        return null;
      }

      return this.mapToAnalysisRecord(result[0]);
    } catch (error) {
      logger.error('Failed to get analysis by OCR job ID', { ocrJobId, error });
      throw error;
    }
  }

  /**
   * Get analyses by territory and date range
   */
  async getAnalysesByTerritory(
    territoryId: string,
    startDate: string,
    endDate: string,
    categories?: string[],
    minConfidence?: number
  ): Promise<AnalysisRecord[]> {
    try {
      let whereClause = `WHERE territory_id = $1 
        AND publication_date >= $2 
        AND publication_date <= $3`;
      const params = [territoryId, startDate, endDate];

      if (categories && categories.length > 0) {
        whereClause += ` AND categories && $${params.length + 1}`;
        params.push(categories);
      }

      if (minConfidence !== undefined) {
        whereClause += ` AND high_confidence_findings > 0`;
      }

      const query = `
        SELECT * FROM analysis_results 
        ${whereClause}
        ORDER BY publication_date DESC, analyzed_at DESC
      `;

      const result = await this.db.query(query, params);
      return result.map(row => this.mapToAnalysisRecord(row));
    } catch (error) {
      logger.error('Failed to get analyses by territory', {
        territoryId,
        startDate,
        endDate,
        error
      });
      throw error;
    }
  }

  /**
   * Search analyses by findings content
   */
  async searchAnalyses(
    searchText: string,
    categories?: string[],
    territoryIds?: string[],
    startDate?: string,
    endDate?: string,
    limit: number = 50
  ): Promise<AnalysisRecord[]> {
    try {
      let whereClause = `WHERE (
        keywords @> ARRAY[$1] OR
        findings::text ILIKE $2 OR
        summary::text ILIKE $2
      )`;
      const params = [searchText.toLowerCase(), `%${searchText}%`];

      if (categories && categories.length > 0) {
        whereClause += ` AND categories && $${params.length + 1}`;
        params.push(categories);
      }

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
        SELECT * FROM analysis_results 
        ${whereClause}
        ORDER BY publication_date DESC, analyzed_at DESC
        LIMIT $${params.length + 1}
      `;
      params.push(limit);

      const result = await this.db.query(query, params);
      return result.map(row => this.mapToAnalysisRecord(row));
    } catch (error) {
      logger.error('Failed to search analyses', {
        searchText,
        categories,
        territoryIds,
        error
      });
      throw error;
    }
  }

  /**
   * Get analysis statistics
   */
  async getAnalysisStats(days: number = 7): Promise<{
    totalAnalyses: number;
    totalFindings: number;
    averageFindings: number;
    topCategories: Array<{ category: string; count: number }>;
    topKeywords: Array<{ keyword: string; count: number }>;
    processingStats: {
      averageTimeMs: number;
      totalProcessingTimeMs: number;
    };
  }> {
    try {
      const [generalStats, categoryStats, keywordStats, processingStats] = await Promise.all([
        // General stats
        this.db.queryTemplate`
          SELECT 
            COUNT(*) as total_analyses,
            SUM(total_findings) as total_findings,
            AVG(total_findings) as average_findings
          FROM analysis_results 
          WHERE analyzed_at > NOW() - INTERVAL ${days} DAY
        `,

        // Top categories (unnest array and count)
        this.db.queryTemplate`
          SELECT category, COUNT(*) as count
          FROM (
            SELECT UNNEST(categories) as category
            FROM analysis_results 
            WHERE analyzed_at > NOW() - INTERVAL ${days} DAY
          ) cat
          GROUP BY category
          ORDER BY count DESC
          LIMIT 10
        `,

        // Top keywords (unnest array and count)
        this.db.queryTemplate`
          SELECT keyword, COUNT(*) as count
          FROM (
            SELECT UNNEST(keywords) as keyword
            FROM analysis_results 
            WHERE analyzed_at > NOW() - INTERVAL ${days} DAY
          ) kw
          GROUP BY keyword
          ORDER BY count DESC
          LIMIT 20
        `,

        // Processing stats
        this.db.queryTemplate`
          SELECT 
            AVG(processing_time_ms) as average_time_ms,
            SUM(processing_time_ms) as total_processing_time_ms
          FROM analysis_results 
          WHERE analyzed_at > NOW() - INTERVAL ${days} DAY
            AND processing_time_ms IS NOT NULL
        `
      ]);

      return {
        totalAnalyses: parseInt(generalStats[0]?.total_analyses || '0'),
        totalFindings: parseInt(generalStats[0]?.total_findings || '0'),
        averageFindings: parseFloat(generalStats[0]?.average_findings || '0'),
        topCategories: categoryStats.map(row => ({
          category: row.category,
          count: parseInt(row.count)
        })),
        topKeywords: keywordStats.map(row => ({
          keyword: row.keyword,
          count: parseInt(row.count)
        })),
        processingStats: {
          averageTimeMs: Math.round(processingStats[0]?.average_time_ms || 0),
          totalProcessingTimeMs: parseInt(processingStats[0]?.total_processing_time_ms || '0')
        }
      };
    } catch (error) {
      logger.error('Failed to get analysis statistics', { days, error });
      throw error;
    }
  }

  /**
   * Get high-confidence findings across territories
   */
  async getHighConfidenceFindings(
    categories?: string[],
    territoryIds?: string[],
    days: number = 7,
    limit: number = 100
  ): Promise<Array<{
    analysisId: string;
    jobId: string;
    territoryId: string;
    publicationDate: string;
    categories: string[];
    findings: Finding[];
    confidence: number;
  }>> {
    try {
      let whereClause = `WHERE high_confidence_findings > 0 
        AND analyzed_at > NOW() - INTERVAL ${days} DAY`;
      const params: any[] = [];

      if (categories && categories.length > 0) {
        whereClause += ` AND categories && $${params.length + 1}`;
        params.push(categories);
      }

      if (territoryIds && territoryIds.length > 0) {
        whereClause += ` AND territory_id = ANY($${params.length + 1})`;
        params.push(territoryIds);
      }

      const query = `
        SELECT 
          id, job_id, territory_id, publication_date, categories, findings,
          (high_confidence_findings::float / NULLIF(total_findings, 0)) as confidence
        FROM analysis_results 
        ${whereClause}
        ORDER BY confidence DESC, high_confidence_findings DESC
        LIMIT $${params.length + 1}
      `;
      params.push(limit);

      const result = await this.db.query(query, params);
      
      return result.map(row => ({
        analysisId: row.id,
        jobId: row.job_id,
        territoryId: row.territory_id,
        publicationDate: row.publication_date,
        categories: row.categories || [],
        findings: row.findings || [],
        confidence: parseFloat(row.confidence || '0')
      }));
    } catch (error) {
      logger.error('Failed to get high confidence findings', {
        categories,
        territoryIds,
        days,
        error
      });
      throw error;
    }
  }

  /**
   * Check if analysis already exists
   */
  async analysisExists(jobId: string): Promise<boolean> {
    try {
      const result = await this.db.queryTemplate`
        SELECT 1 FROM analysis_results WHERE job_id = ${jobId} LIMIT 1
      `;

      return result.length > 0;
    } catch (error) {
      logger.error('Failed to check analysis existence', { jobId, error });
      return false; // Assume it doesn't exist on error
    }
  }

  /**
   * Delete old analyses (for maintenance)
   */
  async deleteOldAnalyses(olderThanDays: number = 90): Promise<{ deleted: number }> {
    try {
      const result = await this.db.queryTemplate`
        DELETE FROM analysis_results 
        WHERE analyzed_at < NOW() - INTERVAL ${olderThanDays} DAY
      `;

      logger.info('Deleted old analyses', {
        deletedCount: result.length,
        olderThanDays
      });

      return { deleted: result.length };
    } catch (error) {
      logger.error('Failed to delete old analyses', { olderThanDays, error });
      throw error;
    }
  }

  /**
   * Map database row to AnalysisRecord
   */
  private mapToAnalysisRecord(row: any): AnalysisRecord {
    return {
      id: row.id,
      jobId: row.job_id,
      ocrJobId: row.ocr_job_id,
      gazetteId: row.gazette_id,
      territoryId: row.territory_id,
      publicationDate: row.publication_date,
      totalFindings: row.total_findings,
      highConfidenceFindings: row.high_confidence_findings,
      categories: row.categories || [],
      keywords: row.keywords || [],
      findings: row.findings || [],
      summary: row.summary || {},
      processingTimeMs: row.processing_time_ms,
      analyzedAt: row.analyzed_at,
      metadata: row.metadata || {}
    };
  }
}

