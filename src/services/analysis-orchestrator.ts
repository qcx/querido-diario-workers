/**
 * Analysis Orchestrator - Manages multiple analyzers
 */

import {
  OcrResult,
  GazetteAnalysis,
  AnalysisResult,
  AnalysisConfig,
  AnalysisConfigSignature,
  Finding,
} from '../types';
import {
  BaseAnalyzer,
  KeywordAnalyzer,
  AIAnalyzer,
  EntityExtractor,
  ConcursoAnalyzer,
  ConcursoValidator,
} from '../analyzers';
import { logger, sha256Hash } from '../utils';
import { TerritoryService } from './territory-service';
import { TextFilterService } from './text-filter-service';

interface AnalysisContext {
  documentTypes: Array<{ type: string; confidence: number }>;
  categories: Set<string>;
  highConfidenceFindings: Finding[];
  keyEntities: Record<string, any>;
}

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

    // Concurso Validator (for ambiguous keywords)
    if (this.config.analyzers.concursoValidator?.enabled && this.config.analyzers.concursoValidator.apiKey) {
      this.analyzers.push(
        new ConcursoValidator({
          ...this.config.analyzers.concursoValidator,
          apiKey: this.config.analyzers.concursoValidator.apiKey,
          model: this.config.analyzers.concursoValidator.model,
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
   * Generate config signature for deduplication
   * Public method so it can be used by analysis processor
   */
  public async generateConfigSignature(config: AnalysisConfig, territoryId: string): Promise<AnalysisConfigSignature> {
    const enabledAnalyzers = Object.entries(config.analyzers)
      .filter(([, cfg]) => Boolean((cfg as { enabled?: boolean } | undefined)?.enabled))
      .map(([name]) => name)
      .sort();

    const signature: AnalysisConfigSignature = {
      version: '1.0.0',
      enabledAnalyzers,
      customKeywords: [], // TODO: Load territory-specific keywords
      configHash: ''
    };

    // Generate hash from stable representation
    const hashInput = JSON.stringify({
      version: signature.version,
      analyzers: enabledAnalyzers,
      keywords: signature.customKeywords,
      territoryId
    });

    // Use SHA-256 hash via Web Crypto API (available in Cloudflare Workers)
    const fullHash = await sha256Hash(hashInput);
    signature.configHash = fullHash.substring(0, 32); // Truncate to 32 chars for compatibility

    return signature;
  }

  /**
   * Analyze OCR result with all enabled analyzers
   * For state-level gazettes, can create multiple analyses for different territories
   */
  async analyze(
    ocrResult: OcrResult, 
    territoryId?: string, 
    jobId?: string,
    gazetteScope?: 'city' | 'state',
    requestedTerritories?: string[]
  ): Promise<GazetteAnalysis | GazetteAnalysis[]> {
    // If state-level gazette with multiple territories requested, split analysis
    if (gazetteScope === 'state' && requestedTerritories && requestedTerritories.length > 0) {
      return this.analyzeMultiTerritoryGazette(ocrResult, requestedTerritories, jobId);
    }
    
    // Otherwise, single territory analysis
    return this.analyzeSingleTerritory(ocrResult, territoryId, jobId);
  }

  /**
   * Analyze OCR result for a single territory
   */
  private async analyzeSingleTerritory(
    ocrResult: OcrResult, 
    territoryId?: string, 
    jobId?: string
  ): Promise<GazetteAnalysis> {
    const startTime = Date.now();
    // Use provided jobId or generate a fallback (for backward compatibility)
    const analysisJobId = jobId || `analysis-${ocrResult.jobId}-${Date.now()}`;

    logger.info(`Starting analysis orchestration for job ${ocrResult.jobId}`, {
      jobId: analysisJobId,
      ocrJobId: ocrResult.jobId,
      analyzersCount: this.analyzers.length,
    });

    const analyses: AnalysisResult[] = [];
    const context: AnalysisContext = {
      documentTypes: [],
      categories: new Set<string>(),
      highConfidenceFindings: [],
      keyEntities: {},
    };

    // Phase 1: Run pattern-based analyzers first (keyword, concurso)
    const patternAnalyzers = this.analyzers.filter(a => 
      ['keyword', 'concurso', 'entity'].includes(a.getType())
    );
    
    for (const analyzer of patternAnalyzers) {
      try {
        const result = await analyzer.analyze(ocrResult);
        analyses.push(result);
        this.updateContext(context, result);
      } catch (error: any) {
        logger.error(`Pattern analyzer ${analyzer.getId()} failed`, error);
        analyses.push(this.createFailureResult(analyzer, error));
      }
    }

    // Phase 2: Run AI analyzer with enriched context
    const aiAnalyzers = this.analyzers.filter(a => a.getType() === 'ai');
    
    for (const analyzer of aiAnalyzers) {
      try {
        // Enhance AI analyzer with context if possible
        const enrichedOcrResult = this.enrichOcrResultWithContext(ocrResult, context);
        const result = await analyzer.analyze(enrichedOcrResult);
        analyses.push(result);
        this.updateContext(context, result);
      } catch (error: any) {
        logger.error(`AI analyzer ${analyzer.getId()} failed`, error);
        analyses.push(this.createFailureResult(analyzer, error));
      }
    }

    // Aggregate results
    const summary = this.createSummary(analyses);

    const gazetteAnalysis: GazetteAnalysis = {
      jobId: analysisJobId,
      ocrJobId: ocrResult.jobId,
      territoryId: territoryId || ocrResult.territoryId || 'unknown',
      publicationDate: ocrResult.publicationDate,
      analyzedAt: new Date().toISOString(),
      extractedText: ocrResult.extractedText || '',
      textLength: ocrResult.extractedText?.length || 0,
      analyses,
      summary,
      metadata: {
        spiderId: ocrResult.spiderId || 
          (territoryId && territoryId.includes('_') 
            ? `${territoryId.split('_')[0]}_${territoryId.split('_')[1]}` 
            : 'unknown'),
        editionNumber: ocrResult.editionNumber,
        power: ocrResult.metadata?.power,
        isExtraEdition: ocrResult.metadata?.isExtraEdition,
        textLengths: {
          originalOcrText: ocrResult.metadata?.originalTextLength || ocrResult.extractedText?.length || 0,
          consideredForAnalysis: ocrResult.extractedText?.length || 0,
          reductionPercentage: ocrResult.metadata?.reductionPercentage,
          filtered: !!ocrResult.metadata?.filteredForTerritory,
        },
      },
    };

    const totalTime = Date.now() - startTime;

    logger.info(`Analysis orchestration completed for job ${ocrResult.jobId}`, {
      jobId: analysisJobId,
      ocrJobId: ocrResult.jobId,
      totalFindings: summary.totalFindings,
      totalTimeMs: totalTime,
      textLengths: {
        original: ocrResult.metadata?.originalTextLength || ocrResult.extractedText?.length || 0,
        considered: ocrResult.extractedText?.length || 0,
        filtered: !!ocrResult.metadata?.filteredForTerritory,
        reductionPercentage: ocrResult.metadata?.reductionPercentage,
      },
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

  /**
   * Update analysis context with findings
   */
  private updateContext(context: AnalysisContext, result: AnalysisResult): void {
    if (result.status !== 'success') return;

    for (const finding of result.findings) {
      // Track high confidence findings
      if (finding.confidence >= 0.8) {
        context.highConfidenceFindings.push(finding);
      }

      // Track document types (from concurso analyzer)
      if (finding.type === 'concurso' && finding.data.documentType) {
        context.documentTypes.push({
          type: finding.data.documentType,
          confidence: finding.confidence,
        });
      }

      // Track categories
      if (finding.data.category) {
        context.categories.add(finding.data.category);
      }

      // Track key entities
      if (finding.type.startsWith('entity:')) {
        const entityType = finding.type.split(':')[1];
        if (!context.keyEntities[entityType]) {
          context.keyEntities[entityType] = [];
        }
        context.keyEntities[entityType].push(finding.data);
      }
    }
  }

  /**
   * Enrich OCR result with analysis context for AI
   */
  private enrichOcrResultWithContext(ocrResult: OcrResult, context: AnalysisContext): OcrResult {
    // If we detected specific document types, add context to metadata
    if (context.documentTypes.length > 0) {
      const primaryDocType = context.documentTypes
        .sort((a, b) => b.confidence - a.confidence)[0];
      
      return {
        ...ocrResult,
        metadata: {
          ...ocrResult.metadata,
          detectedDocumentType: primaryDocType.type,
          detectedCategories: Array.from(context.categories),
          keyEntities: context.keyEntities,
        },
      };
    }

    return ocrResult;
  }

  /**
   * Create failure result for analyzer
   */
  private createFailureResult(analyzer: BaseAnalyzer, error: any): AnalysisResult {
    return {
      analyzerId: analyzer.getId(),
      analyzerType: analyzer.getType(),
      status: 'failure',
      findings: [],
      processingTimeMs: 0,
      error: {
        message: error.message,
        code: error.code,
      },
    };
  }

  /**
   * Analyze state-level gazette for multiple territories
   * Splits the text by territory and creates separate analyses
   */
  private async analyzeMultiTerritoryGazette(
    ocrResult: OcrResult,
    requestedTerritories: string[],
    jobId?: string
  ): Promise<GazetteAnalysis[]> {
    logger.info('Starting multi-territory analysis', {
      ocrJobId: ocrResult.jobId,
      requestedTerritories,
      territoryCount: requestedTerritories.length,
    });

    const analyses: GazetteAnalysis[] = [];

    // For each requested territory, filter text and analyze
    for (const territoryId of requestedTerritories) {
      try {
        // Get territory information
        const territoryInfo = TerritoryService.getTerritoryInfo(territoryId);
        if (!territoryInfo) {
          logger.warn(`Territory ${territoryId} not found in registry, skipping`);
          continue;
        }

        // Filter OCR text to include only sections mentioning this territory
        const filteredOcrResult = this.filterTextByTerritory(
          ocrResult, 
          territoryInfo.name, 
          territoryId,
          territoryInfo.aliases || []
        );
        
        // Only analyze if we found relevant content
        if (filteredOcrResult.extractedText && filteredOcrResult.extractedText.trim().length > 0) {
          const territoryAnalysis = await this.analyzeSingleTerritory(
            filteredOcrResult,
            territoryId,
            jobId ? `${jobId}-${territoryId}` : undefined
          );
          analyses.push(territoryAnalysis);
        } else {
          logger.info(`No content found for territory ${territoryInfo.name} (${territoryId}) in gazette`);
        }
      } catch (error) {
        logger.error(`Failed to analyze territory ${territoryId}`, error as Error);
      }
    }

    return analyses;
  }

  /**
   * Filter OCR text to include only sections that mention a specific territory
   * Uses TextFilterService for intelligent filtering with normalization and pattern matching
   */
  private filterTextByTerritory(
    ocrResult: OcrResult, 
    cityName: string, 
    territoryId: string,
    aliases: string[] = []
  ): OcrResult {
    const text = ocrResult.extractedText || '';
    if (!text) {
      return { ...ocrResult, extractedText: '' };
    }

    // Use TextFilterService for intelligent filtering
    const filterResult = TextFilterService.filterTextByCity(text, cityName, aliases, true);

    logger.info(`Filtered text for ${cityName}`, {
      territoryId,
      originalLength: filterResult.originalLength,
      filteredLength: filterResult.filteredLength,
      sectionsFound: filterResult.sectionsFound,
      reductionPercentage: `${filterResult.reductionPercentage}%`,
      aliasesUsed: aliases.length,
    });

    return {
      ...ocrResult,
      extractedText: filterResult.filteredText,
      territoryId, // Override with specific territory
      metadata: {
        ...ocrResult.metadata,
        filteredForTerritory: cityName,
        originalTextLength: filterResult.originalLength,
        filteredTextLength: filterResult.filteredLength,
        sectionsFound: filterResult.sectionsFound,
        reductionPercentage: filterResult.reductionPercentage,
      },
    };
  }
}
