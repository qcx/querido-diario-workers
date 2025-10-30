/**
 * OCR Results Repository
 * Handles database operations for OCR results
 */

import { eq, and } from 'drizzle-orm';
import { DatabaseClient } from '../index';
import { schema } from '../index';

/**
 * OCR result data structure for repository operations
 */
export interface OcrResultData {
  extractedText: string;
  pagesProcessed: number;
  processingTimeMs: number;
  pdfR2Key?: string;
}

/**
 * Repository for managing OCR results in the database
 */
export class OcrResultsRepository {
  constructor(private dbClient: DatabaseClient) {}

  /**
   * Find OCR result by document ID and type
   */
  async findByDocumentId(
    documentId: string, 
    documentType: string = 'gazette_registry'
  ): Promise<typeof schema.ocrResults.$inferSelect | null> {
    const db = this.dbClient.getDb();
    
    const results = await db.select()
      .from(schema.ocrResults)
      .where(and(
        eq(schema.ocrResults.documentType, documentType),
        eq(schema.ocrResults.documentId, documentId)
      ))
      .limit(1);

    return results.length > 0 ? results[0] : null;
  }

  /**
   * Convenience method to find OCR result by gazette ID
   */
  async findByGazetteId(gazetteId: string): Promise<typeof schema.ocrResults.$inferSelect | null> {
    return this.findByDocumentId(gazetteId, 'gazette_registry');
  }

  /**
   * Create or update OCR result for a document
   */
  async createOrUpdate(
    documentId: string, 
    ocrData: OcrResultData,
    documentType: string = 'gazette_registry'
  ): Promise<typeof schema.ocrResults.$inferSelect> {
    const db = this.dbClient.getDb();

    // Check if OCR result already exists
    const existing = await db.select({ id: schema.ocrResults.id })
      .from(schema.ocrResults)
      .where(and(
        eq(schema.ocrResults.documentType, documentType),
        eq(schema.ocrResults.documentId, documentId)
      ))
      .limit(1);

    const metadata = this.dbClient.stringifyJson({
      pagesProcessed: ocrData.pagesProcessed,
      processingTimeMs: ocrData.processingTimeMs,
      pdfR2Key: ocrData.pdfR2Key
    });

    if (existing.length > 0) {
      // Update existing record
      const updated = await db.update(schema.ocrResults)
        .set({
          extractedText: ocrData.extractedText,
          textLength: ocrData.extractedText.length,
          processingMethod: 'mistral',
          metadata
        })
        .where(eq(schema.ocrResults.id, existing[0].id))
        .returning();

      return updated[0];
    } else {
      // Insert new record
      const inserted = await db.insert(schema.ocrResults)
        .values({
          id: this.dbClient.generateId(),
          documentType,
          documentId,
          extractedText: ocrData.extractedText,
          textLength: ocrData.extractedText.length,
          confidenceScore: null,
          languageDetected: 'pt',
          processingMethod: 'mistral',
          createdAt: this.dbClient.getCurrentTimestamp(),
          metadata
        })
        .returning();

      return inserted[0];
    }
  }

  /**
   * Create or update OCR result for a gazette (convenience method)
   */
  async createOrUpdateForGazette(
    gazetteId: string, 
    ocrData: OcrResultData
  ): Promise<typeof schema.ocrResults.$inferSelect> {
    return this.createOrUpdate(gazetteId, ocrData, 'gazette_registry');
  }
}