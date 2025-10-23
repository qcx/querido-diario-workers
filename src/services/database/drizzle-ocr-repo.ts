/**
 * Drizzle-based OCR Repository  
 * Replaces ocr-repo.ts with Drizzle ORM implementation
 */

import { eq, desc, and, sql, like } from 'drizzle-orm';
import { DrizzleDatabaseClient, schema } from './drizzle-client';
import { logger } from '../../utils/logger';
import type { OcrResult } from '../../types';
import type { OcrMetadata } from '../../types/database';

export interface OcrResultRecord {
  id: string;
  documentType: string;
  documentId: string;
  extractedText: string;
  textLength: number;
  confidenceScore: number | null;
  languageDetected: string | null;
  processingMethod: string | null;
  createdAt: string;
  metadata: OcrMetadata;
}

export interface OcrMetadataRecord {
  id: string;
  documentType: string;
  documentId: string;
  status: string;
  pagesProcessed: number | null;
  processingTimeMs: number | null;
  textLength: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  metadata: OcrMetadata;
}

export class DrizzleOcrRepository {
  constructor(private dbClient: DrizzleDatabaseClient) {}

  /**
   * Store OCR result
   */
  async storeOcrResult(ocrResult: OcrResult): Promise<string> {
    try {
      const db = this.dbClient.getDb();

      // Find the gazette by PDF URL (unique identifier)
      // PDF URL is unique in the schema, so this is the most reliable lookup
      const gazetteResults = await db.select({ id: schema.gazetteRegistry.id })
        .from(schema.gazetteRegistry)
        .where(eq(schema.gazetteRegistry.pdfUrl, ocrResult.pdfUrl))
        .limit(1);

      if (gazetteResults.length === 0) {
        throw new Error(
          `Gazette not found for PDF URL ${ocrResult.pdfUrl}. OCR jobId: ${ocrResult.jobId}`
        );
      }

      const gazetteId = gazetteResults[0].id;

      // Store OCR result with correct schema fields
      const ocrData = {
        id: this.dbClient.generateId(),
        documentType: 'gazette_registry' as const,
        documentId: gazetteId, // This links to gazette_registry.id
        extractedText: ocrResult.extractedText || '',
        textLength: (ocrResult.extractedText || '').length,
        confidenceScore: ocrResult.confidence || null,
        languageDetected: ocrResult.language || 'pt',
        processingMethod: 'mistral',
        createdAt: this.dbClient.getCurrentTimestamp(),
        metadata: this.dbClient.stringifyJson({ 
          jobId: ocrResult.jobId,
          ...(ocrResult.metadata || {})
        })
      };

      // Check if OCR result already exists for this gazette
      const existingOcrResult = await db.select({ id: schema.ocrResults.id })
        .from(schema.ocrResults)
        .where(and(
          eq(schema.ocrResults.documentType, 'gazette_registry'),
          eq(schema.ocrResults.documentId, gazetteId)
        ))
        .limit(1);

      let ocrResultId: string;
      if (existingOcrResult.length === 0) {
        const result = await db.insert(schema.ocrResults)
          .values(ocrData)
          .returning({ id: schema.ocrResults.id });
        ocrResultId = result[0].id;
      } else {
        // Update existing record
        await db.update(schema.ocrResults)
          .set({
            extractedText: ocrData.extractedText,
            textLength: ocrData.textLength,
            confidenceScore: ocrData.confidenceScore,
            languageDetected: ocrData.languageDetected,
            processingMethod: ocrData.processingMethod,
            metadata: ocrData.metadata
          })
          .where(eq(schema.ocrResults.id, existingOcrResult[0].id));
        ocrResultId = existingOcrResult[0].id;
      }

      // Store OCR job tracking
      const jobData = {
        id: this.dbClient.generateId(),
        documentType: 'gazette_registry' as const,
        documentId: gazetteId,
        status: 'success' as const,
        pagesProcessed: ocrResult.pagesProcessed || null,
        processingTimeMs: ocrResult.processingTimeMs || null,
        textLength: (ocrResult.extractedText || '').length,
        errorCode: null,
        errorMessage: null,
        createdAt: this.dbClient.getCurrentTimestamp(),
        completedAt: this.dbClient.getCurrentTimestamp(),
        metadata: this.dbClient.stringifyJson({ jobId: ocrResult.jobId })
      };

      // Check if OCR job already exists for this gazette
      const existingJob = await db.select({ id: schema.ocrJobs.id })
        .from(schema.ocrJobs)
        .where(and(
          eq(schema.ocrJobs.documentType, 'gazette_registry'),
          eq(schema.ocrJobs.documentId, gazetteId)
        ))
        .limit(1);

      if (existingJob.length === 0) {
        await db.insert(schema.ocrJobs).values(jobData);
      } else {
        await db.update(schema.ocrJobs)
          .set({
            status: jobData.status,
            pagesProcessed: jobData.pagesProcessed,
            processingTimeMs: jobData.processingTimeMs,
            textLength: jobData.textLength,
            completedAt: jobData.completedAt,
            metadata: jobData.metadata
          })
          .where(eq(schema.ocrJobs.id, existingJob[0].id));
      }

      // Atomically update gazette_registry status to ocr_success
      await db.update(schema.gazetteRegistry)
        .set({ status: 'ocr_success' })
        .where(eq(schema.gazetteRegistry.id, gazetteId));

      // Atomically update all associated gazette_crawls to success status
      await db.update(schema.gazetteCrawls)
        .set({ status: 'success' })
        .where(eq(schema.gazetteCrawls.gazetteId, gazetteId));

      logger.info('OCR result stored successfully with status updates', {
        ocrId: ocrResultId,
        jobId: ocrResult.jobId,
        gazetteId,
        textLength: (ocrResult.extractedText || '').length
      });

      return ocrResultId;
    } catch (error) {
      logger.error('Failed to store OCR result', {
        jobId: ocrResult.jobId,
        pdfUrl: ocrResult.pdfUrl,
        error
      });
      throw error;
    }
  }

  /**
   * Check if OCR result exists by gazette ID
   */
  async ocrResultExists(gazetteId: string): Promise<boolean> {
    try {
      const db = this.dbClient.getDb();

      const results = await db.select({ id: schema.ocrResults.id })
        .from(schema.ocrResults)
        .where(and(
          eq(schema.ocrResults.documentType, 'gazette_registry'),
          eq(schema.ocrResults.documentId, gazetteId)
        ))
        .limit(1);

      return results.length > 0;
    } catch (error) {
      logger.error('Failed to check if OCR result exists', {
        gazetteId,
        error
      });
      return false;
    }
  }

  /**
   * Get OCR result by gazette ID
   */
  async getOcrResultByGazetteId(gazetteId: string): Promise<OcrResultRecord | null> {
    try {
      const db = this.dbClient.getDb();

      const results = await db.select()
        .from(schema.ocrResults)
        .where(and(
          eq(schema.ocrResults.documentType, 'gazette_registry'),
          eq(schema.ocrResults.documentId, gazetteId)
        ))
        .limit(1);

      if (results.length === 0) {
        return null;
      }

      const record = results[0];
      return {
        ...record,
        metadata: this.dbClient.parseJson<OcrMetadata>(record.metadata, {})
      };
    } catch (error) {
      logger.error('Failed to get OCR result by gazette ID', {
        gazetteId,
        error
      });
      throw error;
    }
  }

  /**
   * Get OCR result by job ID (legacy compatibility - searches in metadata)
   */
  async getOcrResultByJobId(jobId: string): Promise<OcrResultRecord | null> {
    try {
      const db = this.dbClient.getDb();

      // Unfortunately we need to scan all results since jobId is in metadata JSON
      const results = await db.select()
        .from(schema.ocrResults);

      for (const record of results) {
        const metadata = this.dbClient.parseJson<any>(record.metadata, {});
        if (metadata.jobId === jobId) {
          return {
            ...record,
            metadata
          };
        }
      }

      return null;
    } catch (error) {
      logger.error('Failed to get OCR result by job ID', {
        jobId,
        error
      });
      throw error;
    }
  }

  /**
   * Get OCR job by gazette ID
   */
  async getOcrJobByGazetteId(gazetteId: string): Promise<OcrMetadataRecord | null> {
    try {
      const db = this.dbClient.getDb();

      const results = await db.select()
        .from(schema.ocrJobs)
        .where(and(
          eq(schema.ocrJobs.documentType, 'gazette_registry'),
          eq(schema.ocrJobs.documentId, gazetteId)
        ))
        .limit(1);

      if (results.length === 0) {
        return null;
      }

      const record = results[0];
      return {
        ...record,
        metadata: this.dbClient.parseJson<OcrMetadata>(record.metadata, {})
      };
    } catch (error) {
      logger.error('Failed to get OCR job by gazette ID', {
        gazetteId,
        error
      });
      throw error;
    }
  }

  /**
   * Update OCR status (for tracking progress) by gazette ID
   */
  async updateOcrStatus(
    gazetteId: string,
    status: 'pending' | 'processing' | 'success' | 'failure' | 'partial',
    errorMessage?: string
  ): Promise<void> {
    try {
      const db = this.dbClient.getDb();

      const updateData: Partial<typeof schema.ocrJobs.$inferInsert> = {
        status,
        ...(status === 'success' || status === 'failure' || status === 'partial' 
          ? { completedAt: this.dbClient.getCurrentTimestamp() } 
          : {}),
        ...(errorMessage ? { errorMessage } : {})
      };

      await db.update(schema.ocrJobs)
        .set(updateData)
        .where(and(
          eq(schema.ocrJobs.documentType, 'gazette_registry'),
          eq(schema.ocrJobs.documentId, gazetteId)
        ));

      logger.info('OCR status updated', {
        gazetteId,
        status,
        errorMessage
      });
    } catch (error) {
      logger.error('Failed to update OCR status', {
        gazetteId,
        status,
        error
      });
      throw error;
    }
  }

  /**
   * Get OCR results by gazette ID
   */
  async getOcrResultsByGazetteId(gazetteId: string): Promise<OcrResultRecord[]> {
    try {
      const db = this.dbClient.getDb();

      const results = await db.select()
        .from(schema.ocrResults)
        .where(and(
          eq(schema.ocrResults.documentType, 'gazette_registry'),
          eq(schema.ocrResults.documentId, gazetteId)
        ))
        .orderBy(desc(schema.ocrResults.createdAt));

      return results.map(record => ({
        ...record,
        metadata: this.dbClient.parseJson<OcrMetadata>(record.metadata, {})
      }));
    } catch (error) {
      logger.error('Failed to get OCR results by gazette ID', {
        gazetteId,
        error
      });
      throw error;
    }
  }

  /**
   * Get OCR statistics
   */
  async getOcrStats(days: number = 7): Promise<{
    totalJobs: number;
    successfulJobs: number;
    failedJobs: number;
    averageTextLength: number;
    averageProcessingTime: number;
  }> {
    try {
      const db = this.dbClient.getDb();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const cutoffDateStr = cutoffDate.toISOString();

      const jobs = await db.select()
        .from(schema.ocrJobs)
        .where(sql`${schema.ocrJobs.createdAt} >= ${cutoffDateStr}`);

      if (jobs.length === 0) {
        return {
          totalJobs: 0,
          successfulJobs: 0,
          failedJobs: 0,
          averageTextLength: 0,
          averageProcessingTime: 0
        };
      }

      const successfulJobs = jobs.filter(j => j.status === 'success').length;
      const failedJobs = jobs.filter(j => j.status === 'failure').length;
      
      const totalTextLength = jobs.reduce((sum, j) => sum + (j.textLength || 0), 0);
      const totalProcessingTime = jobs.reduce((sum, j) => sum + (j.processingTimeMs || 0), 0);

      return {
        totalJobs: jobs.length,
        successfulJobs,
        failedJobs,
        averageTextLength: Math.round(totalTextLength / jobs.length),
        averageProcessingTime: Math.round(totalProcessingTime / jobs.length)
      };
    } catch (error) {
      logger.error('Failed to get OCR stats', {
        days,
        error
      });
      throw error;
    }
  }

  /**
   * Search OCR results by text content (simple text search since full-text is not needed)
   */
  async searchByText(
    searchTerm: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<{
    results: OcrResultRecord[];
    total: number;
  }> {
    try {
      const db = this.dbClient.getDb();

      // Simple LIKE search (SQLite supports this)
      const results = await db.select()
        .from(schema.ocrResults)
        .where(like(schema.ocrResults.extractedText, `%${searchTerm}%`))
        .orderBy(desc(schema.ocrResults.createdAt))
        .limit(limit)
        .offset(offset);

      // Get total count for the same search
      const totalResults = await db.select({ count: schema.ocrResults.id })
        .from(schema.ocrResults)
        .where(like(schema.ocrResults.extractedText, `%${searchTerm}%`));

      const records = results.map(record => ({
        ...record,
        metadata: this.dbClient.parseJson<OcrMetadata>(record.metadata, {})
      }));

      return {
        results: records,
        total: totalResults.length
      };
    } catch (error) {
      logger.error('Failed to search OCR results by text', {
        searchTerm: searchTerm.substring(0, 50),
        error
      });
      throw error;
    }
  }
}
