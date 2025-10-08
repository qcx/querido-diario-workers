/**
 * Finding Deduplication Service
 * Prevents duplicate findings across gazettes using similarity hashing
 */

import { Finding, GazetteAnalysis } from '../types/analysis';
import { createHash } from 'crypto';
import { logger } from '../utils';
import { schema } from './database';
import { sql, eq, gte } from 'drizzle-orm';

export interface DeduplicationResult {
  uniqueFindings: Finding[];
  duplicates: Array<{
    finding: Finding;
    similarTo: string; // Reference to existing finding
    similarity: number;
  }>;
}

export class FindingDeduplicator {
  private findingCache: Map<string, StoredFinding> = new Map();
  private readonly SIMILARITY_THRESHOLD = 0.85;
  private readonly CACHE_TTL_HOURS = 24;

  constructor(private databaseClient?: any) {}

  /**
   * Deduplicate findings from an analysis
   */
  async deduplicateFindings(
    analysis: GazetteAnalysis,
    timeWindowHours: number = 24
  ): Promise<DeduplicationResult> {
    const uniqueFindings: Finding[] = [];
    const duplicates: any[] = [];

    // Load recent findings from database if available
    if (this.databaseClient) {
      await this.loadRecentFindings(analysis.territoryId, timeWindowHours);
    }

    // Process each finding
    for (const analysisResult of analysis.analyses) {
      for (const finding of analysisResult.findings) {
        const hash = this.generateFindingHash(finding, analysis.territoryId);
        const similarity = await this.checkSimilarity(finding, analysis.territoryId);

        if (similarity.score >= this.SIMILARITY_THRESHOLD) {
          duplicates.push({
            finding,
            similarTo: similarity.referenceId,
            similarity: similarity.score
          });
        } else {
          uniqueFindings.push(finding);
          this.storeFinding(hash, finding, analysis);
        }
      }
    }

    logger.info(`Deduplication complete`, {
      totalFindings: analysis.analyses.flatMap(a => a.findings).length,
      unique: uniqueFindings.length,
      duplicates: duplicates.length
    });

    return { uniqueFindings, duplicates };
  }

  /**
   * Generate a hash for a finding based on its content
   */
  private generateFindingHash(finding: Finding, territoryId: string): string {
    // Create normalized content for hashing
    const normalized = {
      type: finding.type,
      category: finding.data.category || finding.type.split(':')[1],
      // Normalize key data points
      orgao: finding.data.orgao?.toLowerCase().trim(),
      editalNumero: finding.data.editalNumero,
      cargo: finding.data.cargo?.toLowerCase().trim(),
      // Extract key numbers/dates
      totalVagas: finding.data.totalVagas,
      date: this.extractDate(finding.context || ''),
      // Territory for regional deduplication
      territoryId
    };

    // Generate hash
    const content = JSON.stringify(normalized);
    return createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  /**
   * Check similarity with existing findings
   */
  private async checkSimilarity(
    finding: Finding,
    territoryId: string
  ): Promise<{ score: number; referenceId: string }> {
    let maxSimilarity = 0;
    let referenceId = '';

    // Check against cached findings
    for (const [hash, stored] of this.findingCache) {
      // Skip if too old
      if (this.isExpired(stored.timestamp)) {
        this.findingCache.delete(hash);
        continue;
      }

      // Calculate similarity
      const similarity = this.calculateSimilarity(finding, stored.finding, territoryId);
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        referenceId = stored.analysisId;
      }
    }

    // Check database for recent similar findings
    if (this.databaseClient && maxSimilarity < this.SIMILARITY_THRESHOLD) {
      const dbSimilarity = await this.checkDatabaseSimilarity(finding, territoryId);
      if (dbSimilarity.score > maxSimilarity) {
        maxSimilarity = dbSimilarity.score;
        referenceId = dbSimilarity.referenceId;
      }
    }

    return { score: maxSimilarity, referenceId };
  }

  /**
   * Calculate similarity between two findings
   */
  private calculateSimilarity(
    finding1: Finding,
    finding2: Finding,
    territoryId: string
  ): number {
    let score = 0;
    let weights = 0;

    // Type match (high weight)
    if (finding1.type === finding2.type) {
      score += 0.3;
    }
    weights += 0.3;

    // Category match
    const cat1 = finding1.data.category || finding1.type.split(':')[1];
    const cat2 = finding2.data.category || finding2.type.split(':')[1];
    if (cat1 === cat2) {
      score += 0.2;
    }
    weights += 0.2;

    // For concurso findings, check specific fields
    if (finding1.type === 'concurso' && finding2.type === 'concurso') {
      // Organization match
      if (finding1.data.orgao && finding2.data.orgao) {
        const orgSimilarity = this.stringSimilarity(
          finding1.data.orgao.toLowerCase(),
          finding2.data.orgao.toLowerCase()
        );
        score += orgSimilarity * 0.2;
      }
      weights += 0.2;

      // Edital number match
      if (finding1.data.editalNumero === finding2.data.editalNumero) {
        score += 0.15;
      }
      weights += 0.15;

      // Position/cargo similarity
      if (finding1.data.cargo && finding2.data.cargo) {
        const cargoSimilarity = this.stringSimilarity(
          finding1.data.cargo.toLowerCase(),
          finding2.data.cargo.toLowerCase()
        );
        score += cargoSimilarity * 0.1;
      }
      weights += 0.1;
    }

    // Context similarity (lower weight)
    if (finding1.context && finding2.context) {
      const contextSimilarity = this.stringSimilarity(
        finding1.context.substring(0, 200),
        finding2.context.substring(0, 200)
      );
      score += contextSimilarity * 0.05;
    }
    weights += 0.05;

    return weights > 0 ? score / weights : 0;
  }

  /**
   * Simple string similarity using Jaccard index
   */
  private stringSimilarity(str1: string, str2: string): number {
    const words1 = new Set(str1.split(/\s+/));
    const words2 = new Set(str2.split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Load recent findings from database
   */
  private async loadRecentFindings(
    territoryId: string,
    hoursBack: number
  ): Promise<void> {
    if (!this.databaseClient) return;

    try {
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - hoursBack);

      const db = this.databaseClient.getDb();
      const recentFindings = await db.select({
        job_id: schema.analysisResults.jobId,
        findings: schema.analysisResults.findings,
        analyzed_at: schema.analysisResults.analyzedAt
      })
      .from(schema.analysisResults)
      .where(sql`${schema.analysisResults.territoryId} = ${territoryId} 
        AND ${schema.analysisResults.analyzedAt} >= ${cutoffTime.toISOString()}`)
      .orderBy(sql`${schema.analysisResults.analyzedAt} DESC`)
      .limit(1000);

      // Load into cache
      for (const row of recentFindings) {
        const findings = JSON.parse(row.findings);
        for (const finding of findings) {
          const hash = this.generateFindingHash(finding, territoryId);
          this.findingCache.set(hash, {
            finding,
            analysisId: row.job_id,
            timestamp: new Date(row.analyzed_at)
          });
        }
      }

      logger.info(`Loaded ${recentFindings.length} recent analyses for deduplication`);
    } catch (error) {
      logger.error('Failed to load recent findings', { error });
    }
  }

  /**
   * Check database for similar findings
   */
  private async checkDatabaseSimilarity(
    finding: Finding,
    territoryId: string
  ): Promise<{ score: number; referenceId: string }> {
    // This would use pg_trgm or vector similarity in PostgreSQL
    // For now, returning no match
    return { score: 0, referenceId: '' };
  }

  /**
   * Store finding in cache
   */
  private storeFinding(hash: string, finding: Finding, analysis: GazetteAnalysis): void {
    this.findingCache.set(hash, {
      finding,
      analysisId: analysis.jobId,
      timestamp: new Date()
    });

    // Cleanup old entries periodically
    if (this.findingCache.size > 10000) {
      this.cleanupCache();
    }
  }

  /**
   * Check if a cached entry is expired
   */
  private isExpired(timestamp: Date): boolean {
    const ageHours = (Date.now() - timestamp.getTime()) / (1000 * 60 * 60);
    return ageHours > this.CACHE_TTL_HOURS;
  }

  /**
   * Cleanup expired cache entries
   */
  private cleanupCache(): void {
    for (const [hash, stored] of this.findingCache) {
      if (this.isExpired(stored.timestamp)) {
        this.findingCache.delete(hash);
      }
    }
  }

  /**
   * Extract date from context
   */
  private extractDate(context: string): string | null {
    const dateMatch = context.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/);
    return dateMatch ? dateMatch[0] : null;
  }
}

interface StoredFinding {
  finding: Finding;
  analysisId: string;
  timestamp: Date;
}
