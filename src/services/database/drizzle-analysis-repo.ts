/**
 * Drizzle-based Analysis Repository
 * Replaces analysis-repo.ts with Drizzle ORM implementation
 */

import { eq, desc, and, gte, lte } from 'drizzle-orm';
import { DrizzleDatabaseClient, schema } from './drizzle-client';
import { logger } from '../../utils/logger';
import type { GazetteAnalysis, AnalysisConfigSignature } from '../../types';
import type { 
  StructuredFinding, 
  AnalysisSummary, 
  AnalysisMetadata 
} from '../../types/database';

export interface AnalysisRecord {
  id: string;
  jobId: string;
  gazetteId: string;
  territoryId: string;
  publicationDate: string;
  totalFindings: number;
  highConfidenceFindings: number;
  categories: string[];
  keywords: string[];
  findings: StructuredFinding[];
  summary: AnalysisSummary;
  processingTimeMs: number | null;
  analyzedAt: string;
  metadata: AnalysisMetadata; // ocrJobId is stored in metadata
}

export class DrizzleAnalysisRepository {
  constructor(private dbClient: DrizzleDatabaseClient) {}

  /**
   * Store analysis results in the database
   */
  async storeAnalysis(analysis: GazetteAnalysis, gazetteId: string, configSignature?: AnalysisConfigSignature): Promise<string> {
    try {
      const db = this.dbClient.getDb();

      // Calculate processing time from analyses
      const processingTimeMs = analysis.analyses.reduce(
        (total, a) => total + (a.processingTimeMs || 0), 
        0
      );

      const analysisData = {
        id: this.dbClient.generateId(),
        jobId: analysis.jobId,
        gazetteId,
        territoryId: analysis.territoryId,
        publicationDate: analysis.publicationDate,
        totalFindings: analysis.summary.totalFindings,
        highConfidenceFindings: analysis.summary.highConfidenceFindings,
        categories: this.dbClient.stringifyJson(analysis.summary.categories),
        keywords: this.dbClient.stringifyJson(analysis.summary.keywords),
        findings: this.dbClient.stringifyJson(analysis.analyses.flatMap(a => a.findings)),
        summary: this.dbClient.stringifyJson(analysis.summary),
        processingTimeMs,
        analyzedAt: analysis.analyzedAt,
        metadata: this.dbClient.stringifyJson({
          ...analysis.metadata,
          ocrJobId: analysis.ocrJobId, // Store ocrJobId in metadata
          configSignature  // Store config for deduplication
        })
      };

      const result = await db.insert(schema.analysisResults)
        .values(analysisData)
        .onConflictDoUpdate({
          target: schema.analysisResults.jobId,
          set: {
            totalFindings: analysisData.totalFindings,
            highConfidenceFindings: analysisData.highConfidenceFindings,
            categories: analysisData.categories,
            keywords: analysisData.keywords,
            findings: analysisData.findings,
            summary: analysisData.summary,
            processingTimeMs: analysisData.processingTimeMs,
            analyzedAt: analysisData.analyzedAt,
            metadata: analysisData.metadata
          }
        })
        .returning({ id: schema.analysisResults.id });

      logger.info('Analysis stored successfully', {
        analysisId: result[0].id,
        jobId: analysis.jobId,
        gazetteId,
        totalFindings: analysis.summary.totalFindings
      });

      return result[0].id;
    } catch (error) {
      logger.error('Failed to store analysis', {
        jobId: analysis.jobId,
        gazetteId,
        error
      });
      throw error;
    }
  }

  /**
   * Get analysis by analysis ID (primary key)
   */
  async getAnalysisById(id: string): Promise<AnalysisRecord | null> {
    try {
      const db = this.dbClient.getDb();

      const results = await db.select()
        .from(schema.analysisResults)
        .where(eq(schema.analysisResults.id, id))
        .limit(1);

      if (results.length === 0) {
        return null;
      }

      const record = results[0];
      return {
        ...record,
        categories: this.dbClient.parseJson<string[]>(record.categories, []),
        keywords: this.dbClient.parseJson<string[]>(record.keywords, []),
        findings: this.dbClient.parseJson<StructuredFinding[]>(record.findings, []),
        summary: this.dbClient.parseJson<AnalysisSummary>(record.summary, {
          totalFindings: 0,
          highConfidenceFindings: 0,
          findingsByType: {},
          categories: [],
          keywords: []
        }),
        metadata: this.dbClient.parseJson<AnalysisMetadata>(record.metadata, {})
      };
    } catch (error) {
      logger.error('Failed to get analysis by ID', {
        id,
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
      const db = this.dbClient.getDb();

      const results = await db.select()
        .from(schema.analysisResults)
        .where(eq(schema.analysisResults.jobId, jobId))
        .limit(1);

      if (results.length === 0) {
        return null;
      }

      const record = results[0];
      return {
        ...record,
        categories: this.dbClient.parseJson<string[]>(record.categories, []),
        keywords: this.dbClient.parseJson<string[]>(record.keywords, []),
        findings: this.dbClient.parseJson<StructuredFinding[]>(record.findings, []),
        summary: this.dbClient.parseJson<AnalysisSummary>(record.summary, {
          totalFindings: 0,
          highConfidenceFindings: 0,
          findingsByType: {},
          categories: [],
          keywords: []
        }),
        metadata: this.dbClient.parseJson<AnalysisMetadata>(record.metadata, {})
      };
    } catch (error) {
      logger.error('Failed to get analysis by job ID', {
        jobId,
        error
      });
      throw error;
    }
  }

  /**
   * Check if analysis exists by job ID
   */
  async analysisExists(jobId: string): Promise<boolean> {
    try {
      const db = this.dbClient.getDb();

      const results = await db.select({ id: schema.analysisResults.id })
        .from(schema.analysisResults)
        .where(eq(schema.analysisResults.jobId, jobId))
        .limit(1);

      return results.length > 0;
    } catch (error) {
      logger.error('Failed to check if analysis exists', {
        jobId,
        error
      });
      return false;
    }
  }

  /**
   * Find existing analysis by territory + gazette + config
   * This is the core deduplication logic
   */
  async findExistingAnalysis(
    territoryId: string,
    gazetteId: string,
    configHash: string
  ): Promise<string | null> {
    try {
      const db = this.dbClient.getDb();

      // Query for matching analysis
      const results = await db.select({ 
        id: schema.analysisResults.id,
        metadata: schema.analysisResults.metadata
      })
      .from(schema.analysisResults)
      .where(and(
        eq(schema.analysisResults.territoryId, territoryId),
        eq(schema.analysisResults.gazetteId, gazetteId)
      ))
      .limit(10); // Check multiple in case of config variations

      // Check metadata for matching config hash
      for (const result of results) {
        const metadata = this.dbClient.parseJson<any>(result.metadata, {});
        const storedConfigHash = metadata.configSignature?.configHash;
        
        if (storedConfigHash === configHash) {
          logger.info('Found existing analysis with matching config', {
            analysisId: result.id,
            territoryId,
            gazetteId,
            configHash
          });
          return result.id;
        }
      }

      return null; // No matching analysis found
    } catch (error) {
      logger.error('Failed to find existing analysis', {
        territoryId,
        gazetteId,
        configHash,
        error
      });
      return null;
    }
  }

  /**
   * Search analysis results by territory and date range
   */
  async searchAnalyses(
    territoryId: string,
    startDate: string,
    endDate: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<{
    analyses: AnalysisRecord[];
    total: number;
  }> {
    try {
      const db = this.dbClient.getDb();

      // Get paginated results
      const analyses = await db.select()
        .from(schema.analysisResults)
        .where(and(
          eq(schema.analysisResults.territoryId, territoryId),
          gte(schema.analysisResults.publicationDate, startDate),
          lte(schema.analysisResults.publicationDate, endDate)
        ))
        .orderBy(desc(schema.analysisResults.publicationDate))
        .limit(limit)
        .offset(offset);

      // Get total count
      const totalResults = await db.select({ count: schema.analysisResults.id })
        .from(schema.analysisResults)
        .where(and(
          eq(schema.analysisResults.territoryId, territoryId),
          gte(schema.analysisResults.publicationDate, startDate),
          lte(schema.analysisResults.publicationDate, endDate)
        ));

      const records = analyses.map(analysis => ({
        ...analysis,
        categories: this.dbClient.parseJson<string[]>(analysis.categories, []),
        keywords: this.dbClient.parseJson<string[]>(analysis.keywords, []),
        findings: this.dbClient.parseJson<StructuredFinding[]>(analysis.findings, []),
        summary: this.dbClient.parseJson<AnalysisSummary>(analysis.summary, {
          totalFindings: 0,
          highConfidenceFindings: 0,
          findingsByType: {},
          categories: [],
          keywords: []
        }),
        metadata: this.dbClient.parseJson<AnalysisMetadata>(analysis.metadata, {})
      }));

      return {
        analyses: records,
        total: totalResults.length
      };
    } catch (error) {
      logger.error('Failed to search analyses', {
        territoryId,
        startDate,
        endDate,
        error
      });
      throw error;
    }
  }

  /**
   * Get high confidence findings for a territory
   */
  async getHighConfidenceFindings(
    territoryId: string,
    minFindings: number = 1,
    limit: number = 50
  ): Promise<AnalysisRecord[]> {
    try {
      const db = this.dbClient.getDb();

      const analyses = await db.select()
        .from(schema.analysisResults)
        .where(and(
          eq(schema.analysisResults.territoryId, territoryId),
          gte(schema.analysisResults.highConfidenceFindings, minFindings)
        ))
        .orderBy(desc(schema.analysisResults.analyzedAt))
        .limit(limit);

      return analyses.map(analysis => ({
        ...analysis,
        categories: this.dbClient.parseJson<string[]>(analysis.categories, []),
        keywords: this.dbClient.parseJson<string[]>(analysis.keywords, []),
        findings: this.dbClient.parseJson<StructuredFinding[]>(analysis.findings, []),
        summary: this.dbClient.parseJson<AnalysisSummary>(analysis.summary, {
          totalFindings: 0,
          highConfidenceFindings: 0,
          findingsByType: {},
          categories: [],
          keywords: []
        }),
        metadata: this.dbClient.parseJson<AnalysisMetadata>(analysis.metadata, {})
      }));
    } catch (error) {
      logger.error('Failed to get high confidence findings', {
        territoryId,
        minFindings,
        error
      });
      throw error;
    }
  }

  /**
   * Get analysis statistics for a territory
   */
  async getAnalysisStats(territoryId: string, days: number = 30): Promise<{
    totalAnalyses: number;
    totalFindings: number;
    highConfidenceFindings: number;
    averageProcessingTime: number;
    topCategories: { category: string; count: number }[];
  }> {
    try {
      const db = this.dbClient.getDb();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

      const analyses = await db.select()
        .from(schema.analysisResults)
        .where(and(
          eq(schema.analysisResults.territoryId, territoryId),
          gte(schema.analysisResults.publicationDate, cutoffDateStr)
        ));

      if (analyses.length === 0) {
        return {
          totalAnalyses: 0,
          totalFindings: 0,
          highConfidenceFindings: 0,
          averageProcessingTime: 0,
          topCategories: []
        };
      }

      // Calculate statistics
      const totalFindings = analyses.reduce((sum, a) => sum + a.totalFindings, 0);
      const highConfidenceFindings = analyses.reduce((sum, a) => sum + a.highConfidenceFindings, 0);
      const totalProcessingTime = analyses.reduce((sum, a) => sum + (a.processingTimeMs || 0), 0);
      const averageProcessingTime = totalProcessingTime / analyses.length;

      // Extract and count categories
      const categoryCount: Record<string, number> = {};
      analyses.forEach(analysis => {
        const categories = this.dbClient.parseJson<string[]>(analysis.categories, []);
        categories.forEach((category: string) => {
          categoryCount[category] = (categoryCount[category] || 0) + 1;
        });
      });

      const topCategories = Object.entries(categoryCount)
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      return {
        totalAnalyses: analyses.length,
        totalFindings,
        highConfidenceFindings,
        averageProcessingTime,
        topCategories
      };
    } catch (error) {
      logger.error('Failed to get analysis stats', {
        territoryId,
        days,
        error
      });
      throw error;
    }
  }
}
