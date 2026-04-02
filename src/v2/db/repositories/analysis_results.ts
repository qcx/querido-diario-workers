/**
 * Analysis Results Repository
 * Handles database operations for analysis results
 */

import { eq, and, desc } from 'drizzle-orm';
import { DatabaseClient, schema } from '../client';
import { analysisResults } from '../schema';
import { logger } from '../../../utils';
import type { AnalysisMetadata } from '../../analysis/types';
import type { ProcessorResult } from '../../analysis/analyzers/processor';

export class AnalysisResultsRepository {
  constructor(private client: DatabaseClient) {}

  /**
   * Store analysis results in database
   */
  async storeAnalysis(
    processorResult: ProcessorResult,
    ocrResult: typeof schema.ocrResults.$inferSelect,
    gazetteId: string,
    territoryId: string,
    publicationDate: string,
    jobId: string,
    configSignature: { version: string; analyzers: string[]; territoryId: string; gazetteId: string; configHash: string },
    metadata?: AnalysisMetadata
  ): Promise<typeof analysisResults.$inferSelect> {
    const db = this.client.getDb();
    const id = this.client.generateId();

    try {
      // Extract all findings from analyzer results
      const allFindings = processorResult.analyzerResults.flatMap(result => result.findings);
      
      // Extract categories from findings
      const categoriesSet = new Set<string>();
      for (const finding of allFindings) {
        if (finding.data?.category) {
          if (Array.isArray(finding.data.category)) {
            finding.data.category.forEach((cat: string) => categoriesSet.add(cat));
          } else if (typeof finding.data.category === 'string') {
            categoriesSet.add(finding.data.category);
          }
        }
        if (finding.data?.categories && Array.isArray(finding.data.categories)) {
          finding.data.categories.forEach((cat: string) => categoriesSet.add(cat));
        }
      }
      const categories = Array.from(categoriesSet);

      // Extract keywords from findings
      const keywordsSet = new Set<string>();
      for (const finding of allFindings) {
        if (finding.data?.keyword && typeof finding.data.keyword === 'string') {
          keywordsSet.add(finding.data.keyword);
        }
        if (finding.data?.keywords && Array.isArray(finding.data.keywords)) {
          finding.data.keywords.forEach((kw: string) => keywordsSet.add(kw));
        }
      }
      const keywords = Array.from(keywordsSet);

      // Count high confidence findings (>= 0.7)
      const highConfidenceFindings = allFindings.filter(f => f.confidence >= 0.7).length;

      // Prepare data for storage
      const analysisData = {
        id,
        jobId,
        gazetteId,
        territoryId,
        publicationDate,
        totalFindings: processorResult.totalFindings,
        highConfidenceFindings,
        categories: JSON.stringify(categories),
        keywords: JSON.stringify(keywords),
        findings: JSON.stringify(allFindings),
        summary: JSON.stringify({
          totalFindings: processorResult.totalFindings,
          highConfidenceFindings,
          categories,
          keywords,
          successCount: processorResult.successCount,
          failureCount: processorResult.failureCount,
          skippedCount: processorResult.skippedCount
        }),
        processingTimeMs: processorResult.totalProcessingTimeMs,
        analyzedAt: new Date().toISOString(),
        metadata: JSON.stringify({
          ...metadata,
          configSignature,
          analyzerResults: processorResult.analyzerResults.map(r => ({
            analyzerId: r.analyzerId,
            analyzerType: r.analyzerType,
            status: r.status,
            findingsCount: r.findings.length,
            processingTimeMs: r.processingTimeMs,
            metadata: r.metadata
          })),
          ocrMetadata: {
            textLength: ocrResult.extractedText?.length || 0,
            quality: ocrResult.metadata
          }
        })
      };

      const result = await db.insert(schema.analysisResults).values(analysisData).returning();

      if (!result || result.length === 0) {
        throw new Error('Failed to insert analysis - no result returned');
      }

      return result[0];
    } catch (error) {
      throw error;
    }
  }

  /**
   * Find existing analysis by config hash
   * Queries by extracting configHash from metadata JSON field
   */
  async findExistingAnalysis(
    configHash: string
  ): Promise<typeof analysisResults.$inferSelect | null> {
    const db = this.client.getDb();

    try {
      // Query all analysis results and filter by configHash in metadata
      // Note: D1 SQLite supports JSON extraction, but for compatibility we scan and filter
      const results = await db
        .select()
        .from(analysisResults)
        .orderBy(desc(analysisResults.analyzedAt))
        .limit(100); // Limit to recent results for performance

      // Find first match with matching configHash in metadata
      for (const result of results) {
        try {
          const metadata = JSON.parse(result.metadata);
          if (metadata.configSignature?.configHash === configHash) {
            return result;
          }
        } catch (parseError) {
          // Skip invalid metadata
          continue;
        }
      }

      return null;
    } catch (error) {
      logger.error('Failed to find existing analysis', error as Error, {
        configHash
      });
      return null;
    }
  }

  /**
   * Get analysis by ID
   */
  async getAnalysisById(id: string): Promise<typeof analysisResults.$inferSelect | null> {
    const db = this.client.getDb();

    try {
      const results = await db
        .select()
        .from(analysisResults)
        .where(eq(analysisResults.id, id))
        .limit(1);

      return results.length > 0 ? results[0] : null;
    } catch (error) {
      logger.error('Failed to get analysis by ID', error as Error, { id });
      return null;
    }
  }

  /**
   * Get analysis by job ID
   */
  async getAnalysisByJobId(jobId: string): Promise<typeof analysisResults.$inferSelect | null> {
    const db = this.client.getDb();

    try {
      const results = await db
        .select()
        .from(analysisResults)
        .where(eq(analysisResults.jobId, jobId))
        .limit(1);

      return results.length > 0 ? results[0] : null;
    } catch (error) {
      logger.error('Failed to get analysis by job ID', error as Error, { jobId });
      return null;
    }
  }

  /**
   * Get analyses for a gazette
   */
  async getAnalysesByGazetteId(gazetteId: string): Promise<typeof analysisResults.$inferSelect[]> {
    const db = this.client.getDb();

    try {
      return await db
        .select()
        .from(analysisResults)
        .where(eq(analysisResults.gazetteId, gazetteId))
        .orderBy(desc(analysisResults.analyzedAt));
    } catch (error) {
      logger.error('Failed to get analyses by gazette ID', error as Error, { gazetteId });
      return [];
    }
  }

  /**
   * Update analysis metadata
   */
  async updateMetadata(id: string, metadata: Record<string, any>): Promise<void> {
    const db = this.client.getDb();

    try {
      const existing = await this.getAnalysisById(id);
      if (!existing) {
        throw new Error('Analysis not found');
      }

      const currentMetadata = JSON.parse(existing.metadata);
      const updatedMetadata = { ...currentMetadata, ...metadata };

      await db
        .update(analysisResults)
        .set({ metadata: JSON.stringify(updatedMetadata) })
        .where(eq(analysisResults.id, id));

      logger.info('Analysis metadata updated', { id });
    } catch (error) {
      logger.error('Failed to update analysis metadata', error as Error, { id });
      throw error;
    }
  }

  /**
   * Check if analysis exists for gazette and territory
   */
  async analysisExists(gazetteId: string, territoryId: string): Promise<boolean> {
    const db = this.client.getDb();

    try {
      const results = await db
        .select({ id: analysisResults.id })
        .from(analysisResults)
        .where(
          and(
            eq(analysisResults.gazetteId, gazetteId),
            eq(analysisResults.territoryId, territoryId)
          )
        )
        .limit(1);

      return results.length > 0;
    } catch (error) {
      logger.error('Failed to check if analysis exists', error as Error, {
        gazetteId,
        territoryId
      });
      return false;
    }
  }
}
