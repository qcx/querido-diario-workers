/**
 * Drizzle-based OCR Repository  
 * Replaces ocr-repo.ts with Drizzle ORM implementation
 */

import { eq, desc, and, gte, like } from 'drizzle-orm';
import { DrizzleDatabaseClient, schema } from './drizzle-client';
import { logger } from '../../utils/logger';
import type { OcrResult } from '../../types';
import type { OcrMetadata } from '../../types/database';

export interface OcrResultRecord {
  id: string;
  jobId: string;
  gazetteId: string;
  extractedText: string;
  textLength: number;
  confidenceScore: number | null;
  languageDetected: string | null;
  processingMethod: string | null;
  createdAt: string;
  metadata: OcrMetadata;
  pdfUrl?: string; // Added for URL-based deduplication
  pdfR2Key?: string | null; // Added for R2 storage key reuse
}

export interface OcrMetadataRecord {
  id: string;
  jobId: string;
  gazetteId: string;
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

      // Find the gazette by territory ID and publication date
      // This is more robust than jobId matching since jobId formats may differ
      const gazetteResults = await db.select({ id: schema.gazetteRegistry.id })
        .from(schema.gazetteRegistry)
        .where(and(
          eq(schema.gazetteRegistry.territoryId, ocrResult.territoryId),
          eq(schema.gazetteRegistry.publicationDate, ocrResult.publicationDate)
        ))
        .orderBy(desc(schema.gazetteRegistry.createdAt))
        .limit(1);

      if (gazetteResults.length === 0) {
        throw new Error(
          `Gazette not found for territory ${ocrResult.territoryId} on date ${ocrResult.publicationDate}. OCR jobId: ${ocrResult.jobId}`
        );
      }

      const gazetteId = gazetteResults[0].id;

      // Store OCR result
      const ocrData = {
        id: this.dbClient.generateId(),
        jobId: ocrResult.jobId,
        gazetteId,
        extractedText: ocrResult.extractedText || '',
        textLength: (ocrResult.extractedText || '').length,
        confidenceScore: ocrResult.confidence || null,
        languageDetected: ocrResult.language || 'pt',
        processingMethod: 'mistral', // Currently only using Mistral OCR
        createdAt: this.dbClient.getCurrentTimestamp(),
        metadata: this.dbClient.stringifyJson(ocrResult.metadata || {})
      };

      const result = await db.insert(schema.ocrResults)
        .values(ocrData)
        .onConflictDoUpdate({
          target: schema.ocrResults.jobId,
          set: {
            extractedText: ocrData.extractedText,
            textLength: ocrData.textLength,
            confidenceScore: ocrData.confidenceScore,
            languageDetected: ocrData.languageDetected,
            processingMethod: ocrData.processingMethod,
            metadata: ocrData.metadata
          }
        })
        .returning({ id: schema.ocrResults.id });

      // Store OCR metadata
      const metadataData = {
        id: this.dbClient.generateId(),
        jobId: ocrResult.jobId,
        gazetteId,
        status: 'success',
        pagesProcessed: ocrResult.pagesProcessed || null,
        processingTimeMs: ocrResult.processingTimeMs || null,
        textLength: (ocrResult.extractedText || '').length,
        errorCode: null,
        errorMessage: null,
        createdAt: this.dbClient.getCurrentTimestamp(),
        completedAt: this.dbClient.getCurrentTimestamp(),
        metadata: this.dbClient.stringifyJson({})
      };

      await db.insert(schema.ocrMetadata)
        .values(metadataData)
        .onConflictDoUpdate({
          target: schema.ocrMetadata.jobId,
          set: {
            status: metadataData.status,
            pagesProcessed: metadataData.pagesProcessed,
            processingTimeMs: metadataData.processingTimeMs,
            textLength: metadataData.textLength,
            completedAt: metadataData.completedAt
          }
        });

      logger.info('OCR result stored successfully', {
        ocrId: result[0].id,
        jobId: ocrResult.jobId,
        textLength: (ocrResult.extractedText || '').length
      });

      return result[0].id;
    } catch (error) {
      logger.error('Failed to store OCR result', {
        jobId: ocrResult.jobId,
        error
      });
      throw error;
    }
  }

  /**
   * Check if OCR result exists (compatibility method)
   */
  async ocrResultExists(jobId: string): Promise<boolean> {
    try {
      const db = this.dbClient.getDb();

      const results = await db.select({ id: schema.ocrResults.id })
        .from(schema.ocrResults)
        .where(eq(schema.ocrResults.jobId, jobId))
        .limit(1);

      return results.length > 0;
    } catch (error) {
      logger.error('Failed to check if OCR result exists', {
        jobId,
        error
      });
      return false;
    }
  }

  /**
   * Get OCR result by job ID
   */
  async getOcrResultByJobId(jobId: string): Promise<OcrResultRecord | null> {
    try {
      const db = this.dbClient.getDb();

      const results = await db.select()
        .from(schema.ocrResults)
        .where(eq(schema.ocrResults.jobId, jobId))
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
      logger.error('Failed to get OCR result by job ID', {
        jobId,
        error
      });
      throw error;
    }
  }

  /**
   * Find OCR result by PDF URL within a time window
   * Used for deduplication to avoid processing the same PDF multiple times
   */
  async findOcrByPdfUrl(
    pdfUrl: string,
    daysWindow: number = 30
  ): Promise<OcrResultRecord | null> {
    try {
      const db = this.dbClient.getDb();

      // Calculate cutoff date
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysWindow);
      const cutoffDateStr = cutoffDate.toISOString();

      // Join ocr_results with gazette_registry to get PDF URL
      const results = await db.select({
        id: schema.ocrResults.id,
        jobId: schema.ocrResults.jobId,
        gazetteId: schema.ocrResults.gazetteId,
        extractedText: schema.ocrResults.extractedText,
        textLength: schema.ocrResults.textLength,
        confidenceScore: schema.ocrResults.confidenceScore,
        languageDetected: schema.ocrResults.languageDetected,
        processingMethod: schema.ocrResults.processingMethod,
        createdAt: schema.ocrResults.createdAt,
        metadata: schema.ocrResults.metadata,
        pdfUrl: schema.gazetteRegistry.pdfUrl,
        pdfR2Key: schema.gazetteRegistry.pdfR2Key,
      })
        .from(schema.ocrResults)
        .innerJoin(
          schema.gazetteRegistry,
          eq(schema.ocrResults.gazetteId, schema.gazetteRegistry.id)
        )
        .where(
          and(
            eq(schema.gazetteRegistry.pdfUrl, pdfUrl),
            // SQLite string comparison works for ISO dates
            gte(schema.ocrResults.createdAt, cutoffDateStr)
          )
        )
        .orderBy(desc(schema.ocrResults.createdAt))
        .limit(1);

      if (results.length === 0) {
        logger.debug('No OCR result found for PDF URL within time window', {
          pdfUrl: pdfUrl.substring(0, 100),
          daysWindow,
        });
        return null;
      }

      const record = results[0];
      logger.info('Found existing OCR result for PDF URL', {
        jobId: record.jobId,
        pdfUrl: pdfUrl.substring(0, 100),
        createdAt: record.createdAt,
        daysWindow,
      });

      return {
        ...record,
        metadata: this.dbClient.parseJson<OcrMetadata>(record.metadata, {}),
      };
    } catch (error) {
      logger.error('Failed to find OCR result by PDF URL', {
        pdfUrl: pdfUrl.substring(0, 100),
        daysWindow,
        error,
      });
      throw error;
    }
  }

  /**
   * Get OCR metadata by job ID
   */
  async getOcrMetadataByJobId(jobId: string): Promise<OcrMetadataRecord | null> {
    try {
      const db = this.dbClient.getDb();

      const results = await db.select()
        .from(schema.ocrMetadata)
        .where(eq(schema.ocrMetadata.jobId, jobId))
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
      logger.error('Failed to get OCR metadata by job ID', {
        jobId,
        error
      });
      throw error;
    }
  }

  /**
   * Update OCR status (for tracking progress)
   */
  async updateOcrStatus(
    jobId: string,
    status: 'pending' | 'processing' | 'success' | 'failure' | 'partial',
    errorMessage?: string
  ): Promise<void> {
    try {
      const db = this.dbClient.getDb();

      const updateData: Partial<typeof schema.ocrMetadata.$inferInsert> = {
        status,
        ...(status === 'success' || status === 'failure' || status === 'partial' 
          ? { completedAt: this.dbClient.getCurrentTimestamp() } 
          : {}),
        ...(errorMessage ? { errorMessage } : {})
      };

      await db.update(schema.ocrMetadata)
        .set(updateData)
        .where(eq(schema.ocrMetadata.jobId, jobId));

      logger.info('OCR status updated', {
        jobId,
        status,
        errorMessage
      });
    } catch (error) {
      logger.error('Failed to update OCR status', {
        jobId,
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
        .where(eq(schema.ocrResults.gazetteId, gazetteId))
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

      const metadata = await db.select()
        .from(schema.ocrMetadata)
        .where(
          gte(schema.ocrMetadata.createdAt, cutoffDateStr)
        );

      if (metadata.length === 0) {
        return {
          totalJobs: 0,
          successfulJobs: 0,
          failedJobs: 0,
          averageTextLength: 0,
          averageProcessingTime: 0
        };
      }

      const successfulJobs = metadata.filter(m => m.status === 'success').length;
      const failedJobs = metadata.filter(m => m.status === 'failure').length;
      
      const totalTextLength = metadata.reduce((sum, m) => sum + (m.textLength || 0), 0);
      const totalProcessingTime = metadata.reduce((sum, m) => sum + (m.processingTimeMs || 0), 0);

      return {
        totalJobs: metadata.length,
        successfulJobs,
        failedJobs,
        averageTextLength: Math.round(totalTextLength / metadata.length),
        averageProcessingTime: Math.round(totalProcessingTime / metadata.length)
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
