/**
 * Analysis Results Repository
 * Handles database operations for analysis results
 */

import { eq, and, desc } from 'drizzle-orm';
import { DatabaseClient, schema } from '../client';
import { analysisResults } from '../schema';
import { logger } from '../../../utils';
import type { GazetteAnalysis, AnalysisConfigSignature } from '../../../types';
import type { AnalysisMetadata } from '../../analysis/types';

export class AnalysisResultsRepository {
  constructor(private client: DatabaseClient) {}

  /**
   * Store analysis results in database
   */
  async storeAnalysis(
    analysis: GazetteAnalysis,
    gazetteId: string,
    configSignature: AnalysisConfigSignature,
    metadata?: AnalysisMetadata
  ): Promise<typeof analysisResults.$inferSelect> {
    const db = this.client.getDb();
    const id = this.client.generateId();

    try {
      // Prepare data for storage
      const analysisData = {
        id,
        jobId: analysis.jobId,
        gazetteId,
        territoryId: analysis.territoryId,
        publicationDate: analysis.publicationDate,
        totalFindings: analysis.summary.totalFindings,
        highConfidenceFindings: analysis.summary.highConfidenceFindings,
        categories: JSON.stringify(analysis.summary.categories || []),
        keywords: JSON.stringify(analysis.summary.keywords || []),
        findings: JSON.stringify(analysis.analyses.flatMap(a => a.findings)),
        summary: JSON.stringify(analysis.summary),
        processingTimeMs: analysis.analyses.reduce((sum, a) => sum + a.processingTimeMs, 0),
        analyzedAt: analysis.analyzedAt,
        metadata: JSON.stringify({
          ...analysis.metadata,
          ...metadata,
          configSignature
        })
      };

      const result = await db.insert(schema.analysisResults).values(analysisData).returning();

      if (!result || result.length === 0) {
        throw new Error('Failed to insert analysis - no result returned');
      }

      logger.info('Analysis results stored successfully', {
        id,
        jobId: analysis.jobId,
        gazetteId,
        territoryId: analysis.territoryId,
        totalFindings: analysis.summary.totalFindings
      });

      return result[0];
    } catch (error) {
      logger.error('Failed to store analysis results', error as Error, {
        jobId: analysis.jobId,
        gazetteId
      });
      throw error;
    }
  }

  /**
   * Find existing analysis by deduplication key
   */
  async findExistingAnalysis(
    territoryId: string,
    gazetteId: string,
    configHash: string
  ): Promise<string | null> {
    const db = this.client.getDb();

    try {
      const results = await db
        .select({ id: analysisResults.id })
        .from(analysisResults)
        .where(
          and(
            eq(analysisResults.territoryId, territoryId),
            eq(analysisResults.gazetteId, gazetteId)
          )
        )
        .limit(1);

      if (results.length === 0) {
        return null;
      }

      // Check if config hash matches
      const analysis = await this.getAnalysisById(results[0].id);
      if (!analysis) return null;

      const metadata = JSON.parse(analysis.metadata);
      if (metadata.configSignature?.configHash === configHash) {
        return results[0].id;
      }

      return null;
    } catch (error) {
      logger.error('Failed to find existing analysis', error as Error, {
        territoryId,
        gazetteId,
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
