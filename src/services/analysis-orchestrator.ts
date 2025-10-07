/**
 * Analysis Orchestrator - Manages multiple analyzers
 */

import {
  OcrResult,
  GazetteAnalysis,
  AnalysisResult,
  AnalysisConfig,
} from '../types';
import {
  BaseAnalyzer,
  KeywordAnalyzer,
  AIAnalyzer,
  EntityExtractor,
  ConcursoAnalyzer,
} from '../analyzers';
import { logger } from '../utils';

export class AnalysisOrchestrator {
  private analyzers: BaseAnalyzer[] = [];
  private config: AnalysisConfig;

  constructor(config: AnalysisConfig) {
    this.config = config;
    this.initializeAnalyzers();
  }

  /**
   * Initialize analyzers based on configuration
   */
  private initializeAnalyzers(): void {
    // Keyword Analyzer
    if (this.config.analyzers.keyword?.enabled) {
      this.analyzers.push(
        new KeywordAnalyzer({
          ...this.config.analyzers.keyword,
          patterns: this.config.analyzers.keyword.patterns,
        })
      );
    }

    // AI Analyzer
    if (this.config.analyzers.ai?.enabled && this.config.analyzers.ai.apiKey) {
      this.analyzers.push(
        new AIAnalyzer({
          ...this.config.analyzers.ai,
          apiKey: this.config.analyzers.ai.apiKey,
          prompts: this.config.analyzers.ai.prompts,
        })
      );
    }

    // Entity Extractor
    if (this.config.analyzers.entity?.enabled) {
      this.analyzers.push(
        new EntityExtractor({
          ...this.config.analyzers.entity,
          entityTypes: this.config.analyzers.entity.entityTypes,
        })
      );
    }

    // Concurso Analyzer
    if (this.config.analyzers.concurso?.enabled) {
      this.analyzers.push(
        new ConcursoAnalyzer({
          ...this.config.analyzers.concurso,
          useAIExtraction: this.config.analyzers.concurso.useAIExtraction,
          apiKey: this.config.analyzers.concurso.apiKey,
          model: this.config.analyzers.concurso.model,
        })
      );
    }

    // Sort by priority
    this.analyzers.sort((a, b) => a.getPriority() - b.getPriority());

    logger.info(`Initialized ${this.analyzers.length} analyzers`, {
      analyzers: this.analyzers.map(a => ({
        id: a.getId(),
        type: a.getType(),
        priority: a.getPriority(),
      })),
    });
  }

  /**
   * Analyze OCR result with all enabled analyzers
   */
  async analyze(ocrResult: OcrResult, territoryId?: string): Promise<GazetteAnalysis> {
    const startTime = Date.now();
    const jobId = `analysis-${ocrResult.jobId}-${Date.now()}`;

    logger.info(`Starting analysis orchestration for job ${ocrResult.jobId}`, {
      jobId,
      ocrJobId: ocrResult.jobId,
      analyzersCount: this.analyzers.length,
    });

    const analyses: AnalysisResult[] = [];

    // Run analyzers sequentially (could be parallelized if needed)
    for (const analyzer of this.analyzers) {
      try {
        const result = await analyzer.analyze(ocrResult);
        analyses.push(result);
      } catch (error: any) {
        logger.error(`Analyzer ${analyzer.getId()} failed`, error);
        analyses.push({
          analyzerId: analyzer.getId(),
          analyzerType: analyzer.getType(),
          status: 'failure',
          findings: [],
          processingTimeMs: 0,
          error: {
            message: error.message,
          },
        });
      }
    }

    // Aggregate results
    const summary = this.createSummary(analyses);

    const gazetteAnalysis: GazetteAnalysis = {
      jobId,
      ocrJobId: ocrResult.jobId,
      territoryId: territoryId || ocrResult.territoryId || 'unknown',
      publicationDate: ocrResult.publicationDate,
      analyzedAt: new Date().toISOString(),
      extractedText: ocrResult.extractedText || '',
      textLength: ocrResult.extractedText?.length || 0,
      analyses,
      summary,
      metadata: {
        spiderId: ocrResult.spiderId || territoryId?.split('_')[0] + '_' + territoryId?.split('_')[1] || 'unknown',
        editionNumber: ocrResult.editionNumber,
        power: ocrResult.metadata?.power,
        isExtraEdition: ocrResult.metadata?.isExtraEdition,
      },
    };

    const totalTime = Date.now() - startTime;

    logger.info(`Analysis orchestration completed for job ${ocrResult.jobId}`, {
      jobId,
      ocrJobId: ocrResult.jobId,
      totalFindings: summary.totalFindings,
      totalTimeMs: totalTime,
    });

    return gazetteAnalysis;
  }

  /**
   * Create summary from analysis results
   */
  private createSummary(analyses: AnalysisResult[]): GazetteAnalysis['summary'] {
    const findingsByType: Record<string, number> = {};
    const categories = new Set<string>();
    const keywords = new Set<string>();
    let totalFindings = 0;
    let highConfidenceFindings = 0;

    for (const analysis of analyses) {
      if (analysis.status !== 'success') continue;

      for (const finding of analysis.findings) {
        totalFindings++;

        // Count by type
        findingsByType[finding.type] = (findingsByType[finding.type] || 0) + 1;

        // High confidence findings
        if (finding.confidence >= 0.8) {
          highConfidenceFindings++;
        }

        // Extract categories
        if (finding.type.startsWith('keyword:')) {
          const category = finding.data.category as string;
          if (category) categories.add(category);
          
          const keyword = finding.data.keyword as string;
          if (keyword) keywords.add(keyword);
        } else if (finding.type.startsWith('ai:')) {
          if (finding.data.category) {
            if (Array.isArray(finding.data.category)) {
              finding.data.category.forEach((c: string) => categories.add(c));
            } else {
              categories.add(finding.data.category);
            }
          }
          if (finding.data.categories && Array.isArray(finding.data.categories)) {
            finding.data.categories.forEach((c: string) => categories.add(c));
          }
        }
      }
    }

    return {
      totalFindings,
      findingsByType,
      highConfidenceFindings,
      categories: Array.from(categories),
      keywords: Array.from(keywords).slice(0, 20), // Top 20 keywords
    };
  }

  /**
   * Get enabled analyzers
   */
  getAnalyzers(): BaseAnalyzer[] {
    return [...this.analyzers];
  }
}
