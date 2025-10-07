/**
 * OCR Repository
 * Handles storage and retrieval of OCR results for gazette documents
 */

import { DatabaseClient } from './client';
import { OcrResult } from '../../types/ocr';
import { logger } from '../../utils';

export interface OcrResultRecord {
  id: string;
  jobId: string;
  gazetteId: string;
  extractedText: string;
  textLength: number;
  confidenceScore?: number;
  languageDetected?: string;
  processingMethod?: string;
  createdAt: string;
  metadata: Record<string, any>;
}

export interface OcrPageRecord {
  id: string;
  ocrResultId: string;
  pageNumber: number;
  extractedText: string;
  textLength: number;
  confidenceScore?: number;
  bbox?: any;
  createdAt: string;
  metadata: Record<string, any>;
}

export interface OcrPageData {
  pageNumber: number;
  text: string;
  confidence?: number;
  bbox?: any;
}

export class OcrRepository {
  constructor(private db: DatabaseClient) {}

  /**
   * Store complete OCR result with optional page breakdown
   */
  async storeOcrResult(
    ocrResult: OcrResult,
    pages?: OcrPageData[]
  ): Promise<string> {
    try {
      // Validate the OCR result data
      if (!ocrResult.jobId || !ocrResult.territoryId || !ocrResult.extractedText) {
        throw new Error('Missing required OCR result fields: jobId, territoryId, or extractedText');
      }

      // Get gazette ID from the OCR result's job ID pattern
      // Try exact match first, then fallback to pattern matching
      let gazetteResult = await this.db.queryTemplate`
        SELECT id FROM gazette_registry 
        WHERE job_id = ${ocrResult.jobId}
        LIMIT 1
      `;

      if (gazetteResult.length === 0) {
        // Fallback to pattern matching
        gazetteResult = await this.db.queryTemplate`
          SELECT id FROM gazette_registry 
          WHERE job_id LIKE ${`%${ocrResult.territoryId}%${ocrResult.publicationDate}%`}
          ORDER BY created_at DESC
          LIMIT 1
        `;
      }

      if (gazetteResult.length === 0) {
        logger.warn('Gazette not found for OCR result, creating placeholder', {
          jobId: ocrResult.jobId,
          territoryId: ocrResult.territoryId
        });
        
        // Create a basic gazette record if not found
        const gazetteInsert = await this.db.queryTemplate`
          INSERT INTO gazette_registry (
            job_id, territory_id, publication_date, spider_id, pdf_url,
            is_extra_edition, scraped_at, metadata
          )
          VALUES (
            ${ocrResult.jobId}, ${ocrResult.territoryId}, ${ocrResult.publicationDate},
            ${ocrResult.spiderId || 'unknown'}, ${ocrResult.pdfUrl || ''}, false, NOW(),
            ${JSON.stringify({ source: 'ocr_placeholder' })}
          )
          RETURNING id
        `;
        
        gazetteResult.push(gazetteInsert[0]);
      }

      const gazetteId = gazetteResult[0].id;

      // Store main OCR result
      const result = await this.db.queryTemplate`
        INSERT INTO ocr_results (
          job_id, gazette_id, extracted_text, text_length, confidence_score,
          language_detected, processing_method, metadata
        )
        VALUES (
          ${ocrResult.jobId}, ${gazetteId}, ${ocrResult.extractedText},
          ${ocrResult.extractedText.length}, ${ocrResult.confidence || null}, 
          ${ocrResult.language || 'pt'}, ${'mistral'}, ${JSON.stringify({
            pagesProcessed: ocrResult.pagesProcessed || 0,
            processingTimeMs: ocrResult.processingTimeMs || 0,
            status: ocrResult.status || 'success',
            error: ocrResult.error || null,
            metadata: ocrResult.metadata || {}
          })}
        )
        ON CONFLICT (job_id) DO UPDATE SET
          extracted_text = EXCLUDED.extracted_text,
          text_length = EXCLUDED.text_length,
          confidence_score = EXCLUDED.confidence_score,
          metadata = EXCLUDED.metadata
        RETURNING id
      `;

      const ocrResultId = result[0].id;

      // Store individual pages if provided
      if (pages && pages.length > 0) {
        await this.storeOcrPages(ocrResultId, pages);
      }

      logger.info('OCR result stored successfully', {
        ocrResultId,
        jobId: ocrResult.jobId,
        textLength: ocrResult.extractedText?.length || 0,
        pagesCount: pages?.length || 0
      });

      return ocrResultId;
    } catch (error) {
      logger.error('Failed to store OCR result', {
        jobId: ocrResult.jobId,
        error
      });
      throw error;
    }
  }

  /**
   * Store individual page results
   */
  async storeOcrPages(ocrResultId: string, pages: OcrPageData[]): Promise<void> {
    try {
      await this.db.transaction(async (sql) => {
        // Clear existing pages for this OCR result
        await sql`DELETE FROM ocr_pages WHERE ocr_result_id = ${ocrResultId}`;

        // Insert new pages
        for (const page of pages) {
          await sql`
            INSERT INTO ocr_pages (
              ocr_result_id, page_number, extracted_text, text_length,
              confidence_score, bbox, metadata
            )
            VALUES (
              ${ocrResultId}, ${page.pageNumber}, ${page.text},
              ${page.text.length}, ${page.confidence || null},
              ${JSON.stringify(page.bbox || {})}, ${JSON.stringify({})}
            )
          `;
        }
      });

      logger.info('OCR pages stored successfully', {
        ocrResultId,
        pagesCount: pages.length
      });
    } catch (error) {
      logger.error('Failed to store OCR pages', {
        ocrResultId,
        pagesCount: pages.length,
        error
      });
      throw error;
    }
  }

  /**
   * Get OCR result by job ID
   */
  async getOcrResultByJobId(jobId: string): Promise<OcrResultRecord | null> {
    try {
      const result = await this.db.queryTemplate`
        SELECT * FROM ocr_results WHERE job_id = ${jobId}
      `;

      if (result.length === 0) {
        return null;
      }

      return this.mapToOcrResultRecord(result[0]);
    } catch (error) {
      logger.error('Failed to get OCR result by job ID', { jobId, error });
      throw error;
    }
  }

  /**
   * Get OCR result with pages by job ID
   */
  async getOcrResultWithPages(jobId: string): Promise<{
    result: OcrResultRecord;
    pages: OcrPageRecord[];
  } | null> {
    try {
      const resultData = await this.getOcrResultByJobId(jobId);
      if (!resultData) {
        return null;
      }

      const pages = await this.getOcrPages(resultData.id);
      
      return {
        result: resultData,
        pages
      };
    } catch (error) {
      logger.error('Failed to get OCR result with pages', { jobId, error });
      throw error;
    }
  }

  /**
   * Get individual pages for an OCR result
   */
  async getOcrPages(ocrResultId: string): Promise<OcrPageRecord[]> {
    try {
      const result = await this.db.queryTemplate`
        SELECT * FROM ocr_pages 
        WHERE ocr_result_id = ${ocrResultId}
        ORDER BY page_number ASC
      `;

      return result.map(row => this.mapToOcrPageRecord(row));
    } catch (error) {
      logger.error('Failed to get OCR pages', { ocrResultId, error });
      throw error;
    }
  }

  /**
   * Search OCR text content
   */
  async searchOcrText(
    searchText: string,
    territoryIds?: string[],
    startDate?: string,
    endDate?: string,
    limit: number = 50
  ): Promise<Array<{
    ocrResult: OcrResultRecord;
    matchedPages?: Array<{ pageNumber: number; snippet: string }>;
    relevanceScore: number;
  }>> {
    try {
      let whereClause = `WHERE to_tsvector('portuguese', or.extracted_text) @@ plainto_tsquery('portuguese', $1)`;
      const params = [searchText];

      if (territoryIds && territoryIds.length > 0) {
        whereClause += ` AND gr.territory_id = ANY($${params.length + 1})`;
        params.push(territoryIds);
      }

      if (startDate) {
        whereClause += ` AND gr.publication_date >= $${params.length + 1}`;
        params.push(startDate);
      }

      if (endDate) {
        whereClause += ` AND gr.publication_date <= $${params.length + 1}`;
        params.push(endDate);
      }

      const query = `
        SELECT 
          or.*,
          ts_rank(to_tsvector('portuguese', or.extracted_text), plainto_tsquery('portuguese', $1)) as relevance_score,
          ts_headline('portuguese', or.extracted_text, plainto_tsquery('portuguese', $1), 
                     'MaxWords=50, MinWords=20, MaxFragments=3') as snippet
        FROM ocr_results or
        JOIN gazette_registry gr ON or.gazette_id = gr.id
        ${whereClause}
        ORDER BY relevance_score DESC, or.created_at DESC
        LIMIT $${params.length + 1}
      `;
      params.push(limit);

      const results = await this.db.query(query, params);

      // For each result, get matching pages if they have page-level data
      const searchResults = [];
      for (const row of results) {
        const ocrResult = this.mapToOcrResultRecord(row);
        
        // Get matched pages
        const pageMatches = await this.db.queryTemplate`
          SELECT 
            page_number,
            ts_headline('portuguese', extracted_text, plainto_tsquery('portuguese', ${searchText}),
                       'MaxWords=30, MinWords=10') as snippet
          FROM ocr_pages 
          WHERE ocr_result_id = ${row.id}
            AND to_tsvector('portuguese', extracted_text) @@ plainto_tsquery('portuguese', ${searchText})
          ORDER BY page_number ASC
          LIMIT 5
        `;

        searchResults.push({
          ocrResult,
          matchedPages: pageMatches.map(p => ({
            pageNumber: p.page_number,
            snippet: p.snippet
          })),
          relevanceScore: parseFloat(row.relevance_score || '0')
        });
      }

      return searchResults;
    } catch (error) {
      logger.error('Failed to search OCR text', {
        searchText,
        territoryIds,
        error
      });
      throw error;
    }
  }

  /**
   * Get OCR statistics
   */
  async getOcrStats(days: number = 7): Promise<{
    totalDocuments: number;
    totalPages: number;
    averageTextLength: number;
    averageConfidence: number;
    processingMethods: Array<{ method: string; count: number }>;
    languageDistribution: Array<{ language: string; count: number }>;
    textLengthDistribution: Array<{ range: string; count: number }>;
  }> {
    try {
      const [generalStats, methodStats, languageStats, lengthStats] = await Promise.all([
        // General statistics
        this.db.queryTemplate`
          SELECT 
            COUNT(*) as total_documents,
            COALESCE(SUM((metadata->>'pagesProcessed')::int), 0) as total_pages,
            AVG(text_length) as average_text_length,
            AVG(confidence_score) as average_confidence
          FROM ocr_results 
          WHERE created_at > NOW() - INTERVAL ${days} DAY
        `,

        // Processing methods
        this.db.queryTemplate`
          SELECT 
            processing_method as method, 
            COUNT(*) as count
          FROM ocr_results 
          WHERE created_at > NOW() - INTERVAL ${days} DAY
            AND processing_method IS NOT NULL
          GROUP BY processing_method
          ORDER BY count DESC
        `,

        // Language distribution
        this.db.queryTemplate`
          SELECT 
            language_detected as language, 
            COUNT(*) as count
          FROM ocr_results 
          WHERE created_at > NOW() - INTERVAL ${days} DAY
            AND language_detected IS NOT NULL
          GROUP BY language_detected
          ORDER BY count DESC
        `,

        // Text length distribution
        this.db.queryTemplate`
          SELECT 
            CASE 
              WHEN text_length < 1000 THEN '<1K'
              WHEN text_length < 5000 THEN '1K-5K'
              WHEN text_length < 20000 THEN '5K-20K'
              WHEN text_length < 50000 THEN '20K-50K'
              ELSE '50K+'
            END as range,
            COUNT(*) as count
          FROM ocr_results 
          WHERE created_at > NOW() - INTERVAL ${days} DAY
          GROUP BY range
          ORDER BY 
            CASE range
              WHEN '<1K' THEN 1
              WHEN '1K-5K' THEN 2
              WHEN '5K-20K' THEN 3
              WHEN '20K-50K' THEN 4
              ELSE 5
            END
        `
      ]);

      const general = generalStats[0] || {};

      return {
        totalDocuments: parseInt(general.total_documents || '0'),
        totalPages: parseInt(general.total_pages || '0'),
        averageTextLength: Math.round(general.average_text_length || 0),
        averageConfidence: Math.round(general.average_confidence || 0),
        processingMethods: methodStats.map(row => ({
          method: row.method,
          count: parseInt(row.count)
        })),
        languageDistribution: languageStats.map(row => ({
          language: row.language,
          count: parseInt(row.count)
        })),
        textLengthDistribution: lengthStats.map(row => ({
          range: row.range,
          count: parseInt(row.count)
        }))
      };
    } catch (error) {
      logger.error('Failed to get OCR statistics', { days, error });
      throw error;
    }
  }

  /**
   * Get OCR result by gazette ID
   */
  async getOcrResultByGazetteId(gazetteId: string): Promise<OcrResultRecord | null> {
    try {
      const result = await this.db.queryTemplate`
        SELECT * FROM ocr_results WHERE gazette_id = ${gazetteId}
      `;

      if (result.length === 0) {
        return null;
      }

      return this.mapToOcrResultRecord(result[0]);
    } catch (error) {
      logger.error('Failed to get OCR result by gazette ID', { gazetteId, error });
      throw error;
    }
  }

  /**
   * Check if OCR result exists
   */
  async ocrResultExists(jobId: string): Promise<boolean> {
    try {
      const result = await this.db.queryTemplate`
        SELECT 1 FROM ocr_results WHERE job_id = ${jobId} LIMIT 1
      `;

      return result.length > 0;
    } catch (error) {
      logger.error('Failed to check OCR result existence', { jobId, error });
      return false;
    }
  }

  /**
   * Delete old OCR results (for maintenance)
   */
  async deleteOldOcrResults(olderThanDays: number = 90): Promise<{ 
    deletedResults: number; 
    deletedPages: number; 
  }> {
    try {
      const result = await this.db.transaction(async (sql) => {
        // Get count of pages that will be deleted
        const pageCountResult = await sql`
          SELECT COUNT(*) as count
          FROM ocr_pages op
          JOIN ocr_results or ON op.ocr_result_id = or.id
          WHERE or.created_at < NOW() - INTERVAL ${olderThanDays} DAY
        `;

        // Delete OCR results (pages will be cascade deleted)
        const resultDeleteResult = await sql`
          DELETE FROM ocr_results 
          WHERE created_at < NOW() - INTERVAL ${olderThanDays} DAY
        `;

        return {
          deletedResults: resultDeleteResult.length,
          deletedPages: parseInt(pageCountResult[0]?.count || '0')
        };
      });

      logger.info('Deleted old OCR results', {
        deletedResults: result.deletedResults,
        deletedPages: result.deletedPages,
        olderThanDays
      });

      return result;
    } catch (error) {
      logger.error('Failed to delete old OCR results', { olderThanDays, error });
      throw error;
    }
  }

  /**
   * Map database row to OcrResultRecord
   */
  private mapToOcrResultRecord(row: any): OcrResultRecord {
    return {
      id: row.id,
      jobId: row.job_id,
      gazetteId: row.gazette_id,
      extractedText: row.extracted_text,
      textLength: row.text_length,
      confidenceScore: row.confidence_score,
      languageDetected: row.language_detected,
      processingMethod: row.processing_method,
      createdAt: row.created_at,
      metadata: row.metadata || {}
    };
  }

  /**
   * Map database row to OcrPageRecord
   */
  private mapToOcrPageRecord(row: any): OcrPageRecord {
    return {
      id: row.id,
      ocrResultId: row.ocr_result_id,
      pageNumber: row.page_number,
      extractedText: row.extracted_text,
      textLength: row.text_length,
      confidenceScore: row.confidence_score,
      bbox: row.bbox,
      createdAt: row.created_at,
      metadata: row.metadata || {}
    };
  }
}
