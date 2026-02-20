/**
 * V2 Analysis Orchestrator - Enhanced orchestrator with section-based processing
 * Maintains the same contract as the original AnalysisOrchestrator
 */

import {
  OcrResult,
  GazetteAnalysis,
  AnalysisResult,
  AnalysisConfig,
  AnalysisConfigSignature,
  Finding,
} from '../../types';
import { BaseAnalyzerV2 } from './base-analyzer-v2';
import { ConcursoKeywordsAnalyzerV2 } from './concurso-keywords';
import { ConcursoAmbiguousValidatorService } from './concurso-ambiguous-validator';
import { ConcursoCategoryAnalyzer } from './concurso-category';
import { AberturaExtractorService } from './abertura-extractor';
import { AnalysisConfigV2 } from './types';
import { logger, sha256Hash } from '../../utils';

/**
 * Analysis context for V2 system with section awareness
 */
interface AnalysisContextV2 {
  documentTypes: Array<{ type: string; confidence: number }>;
  categories: Set<string>;
  highConfidenceFindings: Finding[];
  keyEntities: Record<string, any>;
  sectionsAnalyzed: number;
  sectionFindings: Map<string, Finding[]>;
}

/**
 * V2 Analysis Orchestrator with section-based processing
 */
export class AnalysisOrchestratorV2 {
  private analyzers: BaseAnalyzerV2[] = [];
  private config: AnalysisConfigV2;
  private ambiguousValidator?: ConcursoAmbiguousValidatorService;
  private aberturaExtractor?: AberturaExtractorService;
  private categoryAnalyzer: ConcursoCategoryAnalyzer;

  constructor(config: AnalysisConfigV2) {
    this.config = config;
    this.categoryAnalyzer = new ConcursoCategoryAnalyzer();
    this.initializeAnalyzers();
    this.initializeValidator();
    this.initializeAberturaExtractor();
  }

  /**
   * Initialize V2 analyzers based on configuration
   */
  private initializeAnalyzers(): void {
    // Always initialize Concurso Keywords Analyzer for V2
    this.analyzers.push(new ConcursoKeywordsAnalyzerV2());

    // Sort by priority
    this.analyzers.sort((a, b) => a.getPriority() - b.getPriority());

    logger.info(`Initialized ${this.analyzers.length} V2 analyzers`, {
      analyzers: this.analyzers.map(a => ({
        id: a.getId(),
        type: a.getType(),
        priority: a.getPriority(),
      })),
    });
  }

  /**
   * Initialize ambiguous validator if configured
   */
  private initializeValidator(): void {
    const validatorConfig = this.config.analyzersV2?.ambiguousValidator;
    
    if (validatorConfig?.enabled && validatorConfig.apiKey) {
      this.ambiguousValidator = new ConcursoAmbiguousValidatorService({
        apiKey: validatorConfig.apiKey,
        model: validatorConfig.model,
        confidenceThreshold: validatorConfig.confidenceThreshold,
      });

      logger.info('Initialized ambiguous concurso validator', {
        model: validatorConfig.model || 'gpt-4o-mini',
        confidenceThreshold: validatorConfig.confidenceThreshold || 0.7,
      });
    } else {
      logger.info('Ambiguous concurso validator not initialized (disabled or missing API key)');
    }
  }

  /**
   * Initialize abertura extractor if configured
   */
  private initializeAberturaExtractor(): void {
    const extractorConfig = this.config.analyzersV2?.aberturaExtractor;
    
    if (extractorConfig?.enabled && extractorConfig.apiKey) {
      this.aberturaExtractor = new AberturaExtractorService({
        apiKey: extractorConfig.apiKey,
        model: extractorConfig.model,
        timeout: extractorConfig.timeout,
        enabled: extractorConfig.enabled,
      });

      logger.info('Initialized abertura extractor service', {
        model: extractorConfig.model || 'gpt-4o-mini',
        timeout: extractorConfig.timeout || 30000,
      });
    } else {
      logger.info('Abertura extractor not initialized (disabled or missing API key)');
    }
  }

  /**
   * Generate config signature for deduplication (compatible with V1)
   */
  public async generateConfigSignature(config: AnalysisConfig, territoryId: string): Promise<AnalysisConfigSignature> {
    const enabledAnalyzers = Object.entries(config.analyzers)
      .filter(([, cfg]) => Boolean((cfg as { enabled?: boolean } | undefined)?.enabled))
      .map(([name]) => name)
      .sort();

    const signature: AnalysisConfigSignature = {
      version: '2.0.0', // V2 version
      enabledAnalyzers,
      customKeywords: [], // TODO: Load territory-specific keywords
      configHash: ''
    };

    // Generate hash from stable representation
    const hashInput = JSON.stringify({
      version: signature.version,
      analyzers: enabledAnalyzers,
      keywords: signature.customKeywords,
      territoryId,
    });

    // Use SHA-256 hash via Web Crypto API (available in Cloudflare Workers)
    const fullHash = await sha256Hash(hashInput);
    signature.configHash = fullHash.substring(0, 32); // Truncate to 32 chars for compatibility

    return signature;
  }

  /**
   * Analyze OCR result with V2 enhanced processing
   * Maintains same interface as original AnalysisOrchestrator
   */
  async analyze(
    ocrResult: OcrResult, 
    territoryId?: string, 
    jobId?: string,
    gazetteScope?: 'city' | 'state'
  ): Promise<GazetteAnalysis | GazetteAnalysis[]> {
    // Otherwise, single territory analysis
    return this.analyzeSingleTerritory(ocrResult, territoryId, jobId, gazetteScope);
  }

  /**
   * Analyze OCR result for a single territory with V2 enhancements
   */
  private async analyzeSingleTerritory(
    ocrResult: OcrResult, 
    territoryId?: string, 
    jobId?: string,
    gazetteScope?: 'city' | 'state'
  ): Promise<GazetteAnalysis> {
    const startTime = Date.now();
    const analysisJobId = jobId || `analysis-v2-${ocrResult.jobId}-${Date.now()}`;

    logger.info(`Starting V2 analysis orchestration for job ${ocrResult.jobId}`, {
      jobId: analysisJobId,
      ocrJobId: ocrResult.jobId,
      analyzersCount: this.analyzers.length,
    });

    const analyses: AnalysisResult[] = [];
    const context: AnalysisContextV2 = {
      documentTypes: [],
      categories: new Set<string>(),
      highConfidenceFindings: [],
      keyEntities: {},
      sectionsAnalyzed: 0,
      sectionFindings: new Map(),
    };

    // Run all V2 analyzers
    for (const analyzer of this.analyzers) {
      try {
        const result = await analyzer.analyze(ocrResult);
        analyses.push(result);
        this.updateContext(context, result);
      } catch (error: any) {
        logger.error(`V2 analyzer ${analyzer.getId()} failed`, error);
        analyses.push(this.createFailureResult(analyzer, error));
      }
    }

    // Validate ambiguous findings if validator is available
    if (this.ambiguousValidator) {
      const validatedFindings = await this.validateAmbiguousFindings(analyses);
      
      if (validatedFindings.length > 0) {
        // Add validated findings to the keyword analyzer results
        const keywordAnalyzerResult = analyses.find(a => a.analyzerId === 'concurso-keywords');
        if (keywordAnalyzerResult) {
          keywordAnalyzerResult.findings.push(...validatedFindings);
        }
      }
    }

    // Run category analyzer to categorize concurso findings
    const categoryFindings = await this.categorizeFindings(ocrResult, analyses);
    
    if (categoryFindings.length > 0) {
      // Add category analyzer results as a separate analysis result
      analyses.push({
        analyzerId: this.categoryAnalyzer.getId(),
        analyzerType: this.categoryAnalyzer.getType(),
        status: 'success',
        findings: categoryFindings,
        processingTimeMs: 0, // Time is included in overall processing
        metadata: this.categoryAnalyzer['getMetadata'](categoryFindings),
      });
    }

    console.log('abertura extractor', this.aberturaExtractor);
    // Extract detailed abertura data if we have abertura findings
    if (this.aberturaExtractor) {
      const aberturaFindings = this.collectAberturaFindings(analyses);
      if (aberturaFindings.length > 0) {
        console.log('aberturaFindings', aberturaFindings);
        logger.info(`Processing ${aberturaFindings.length} abertura findings for extraction`, {
          jobId: ocrResult.jobId,
        });

        const extractedFinding = await this.aberturaExtractor.processAberturaFindings(
          ocrResult,
          aberturaFindings
        );

        console.log('extractedFinding', extractedFinding);

        if (extractedFinding) {
          // Add abertura extraction as a separate analysis result
          analyses.push({
            analyzerId: 'abertura-extractor',
            analyzerType: 'concurso',
            status: 'success',
            findings: [extractedFinding],
            processingTimeMs: 0, // Time is included in overall processing
            metadata: {
              extractionMethod: extractedFinding.data.extractionMethod,
              source: 'keyword:concurso_abertura',
            },
          });

          console.log('extractedFinding added to analyses', extractedFinding);

          logger.info('Abertura extraction added to analyses', {
            jobId: ocrResult.jobId,
            hasOrgao: !!extractedFinding.data.concursoData?.orgao,
            hasEditalNumero: !!extractedFinding.data.concursoData?.editalNumero,
          });
        }
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
        gazetteScope: gazetteScope || 'city',
        textLengths: {
          originalOcrText: ocrResult.extractedText?.length || 0,
          consideredForAnalysis: ocrResult.extractedText?.length || 0,
          filtered: false,
        },
        v2Metadata: {
          sectionsAnalyzed: context.sectionsAnalyzed,
          version: '2.0.0',
        },
      },
    };

    const totalTime = Date.now() - startTime;

    logger.info(`V2 analysis orchestration completed for job ${ocrResult.jobId}`, {
      jobId: analysisJobId,
      ocrJobId: ocrResult.jobId,
      totalFindings: summary.totalFindings,
      totalTimeMs: totalTime,
    });

    return gazetteAnalysis;
  }
  /**
   * Get enabled analyzers
   */
  getAnalyzers(): BaseAnalyzerV2[] {
    return [...this.analyzers];
  }

  /**
   * Update analysis context with findings
   */
  private updateContext(context: AnalysisContextV2, result: AnalysisResult): void {
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
   * Create summary from analysis results
   */
  private createSummary(analyses: AnalysisResult[]): GazetteAnalysis['summary'] {
    const findingsByType: Record<string, number> = {};
    const categories = new Set<string>();
    const keywords = new Set<string>();
    let totalFindings = 0;
    let highConfidenceFindings = 0;
    let totalProcessingTime = 0;
    let totalConfidenceSum = 0;

    const totalAnalyzers = analyses.length;
    const successfulAnalyzers = analyses.filter(a => a.status === 'success').length;
    const failedAnalyzers = analyses.filter(a => a.status === 'failure').length;
    const analyzerFindings: Record<string, number> = {};
    const analyzerMetadata: Record<string, any> = {};

    for (const analysis of analyses) {
      totalProcessingTime += analysis.processingTimeMs;
      analyzerFindings[analysis.analyzerId] = analysis.findings.length;
      
      if (analysis.metadata) {
        analyzerMetadata[analysis.analyzerId] = analysis.metadata;
      }

      for (const finding of analysis.findings) {
        totalFindings++;
        totalConfidenceSum += finding.confidence;

        if (finding.confidence >= 0.8) {
          highConfidenceFindings++;
        }

        // Count findings by type
        findingsByType[finding.type] = (findingsByType[finding.type] || 0) + 1;

        // Extract categories and keywords
        if (finding.data.category) {
          categories.add(finding.data.category);
        }

        if (finding.type.startsWith('keyword:')) {
          const keyword = finding.data.keyword;
          if (keyword) {
            keywords.add(keyword);
          }
        }
      }
    }

    const averageConfidence = totalFindings > 0 ? totalConfidenceSum / totalFindings : 0;

    return {
      totalFindings,
      findingsByType,
      highConfidenceFindings,
      categories: Array.from(categories),
      keywords: Array.from(keywords).slice(0, 20),
      
      processingStats: {
        totalAnalyzers,
        successfulAnalyzers,
        failedAnalyzers,
        totalProcessingTime,
        analyzerFindings,
        skippedAnalyzers: [],
        warnings: [],
        analyzerMetadata,
      },
      
      qualityIndicators: {
        averageConfidence: Math.round(averageConfidence * 1000) / 1000,
        textCoverage: 0,
        entityDensity: 0,
      },
    };
  }

  /**
   * Create failure result for analyzer
   */
  private createFailureResult(analyzer: BaseAnalyzerV2, error: any): AnalysisResult {
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
   * Categorize concurso findings using the category analyzer
   */
  private async categorizeFindings(ocrResult: OcrResult, analyses: AnalysisResult[]): Promise<Finding[]> {
    try {
      // Collect all findings from all analyses
      const allFindings: Finding[] = [];
      for (const analysis of analyses) {
        allFindings.push(...analysis.findings);
      }

      if (allFindings.length === 0) {
        return [];
      }

      logger.info(`Running category analyzer on ${allFindings.length} findings`);

      // Run category analyzer with all findings
      const categoryFindings = await this.categoryAnalyzer.analyzeWithFindings(ocrResult, allFindings);

      logger.info(`Category analyzer produced ${categoryFindings.length} findings`);

      return categoryFindings;
    } catch (error: any) {
      logger.error('Category analyzer failed', error);
      return [];
    }
  }

  /**
   * Collect abertura findings from all analyses
   */
  private collectAberturaFindings(analyses: AnalysisResult[]): Finding[] {
    const aberturaFindings: Finding[] = [];

    
    
    for (const analysis of analyses) {
      for (const finding of analysis.findings) {
        console.log('finding', finding);
        if (finding.type === 'keyword:concurso_abertura') {
          aberturaFindings.push(finding);
        }
      }
    }
    
    return aberturaFindings;
  }

  /**
   * Validate ambiguous findings using AI
   */
  private async validateAmbiguousFindings(analyses: AnalysisResult[]): Promise<Finding[]> {
    const validatedFindings: Finding[] = [];
    
    if (!this.ambiguousValidator) {
      return validatedFindings;
    }

    // Extract ambiguous findings from all analyses
    const ambiguousFindings: Finding[] = [];
    for (const analysis of analyses) {
      for (const finding of analysis.findings) {
        if (finding.type === 'keyword:concurso_ambiguous') {
          ambiguousFindings.push(finding);
        }
      }
    }

    if (ambiguousFindings.length === 0) {
      return validatedFindings;
    }

    logger.info(`Validating ${ambiguousFindings.length} ambiguous concurso findings with AI`);

    // Validate each finding individually
    for (const finding of ambiguousFindings) {
      try {
        const context = finding.context || '';
        const keyword = finding.data.keyword || '';
        
        const validationResult = await this.ambiguousValidator.validateAmbiguousFinding(context, keyword);
        
        // If validated with sufficient confidence, create ai:concurso_publico finding
        if (validationResult.isValid && 
            validationResult.confidence >= this.ambiguousValidator.getConfidenceThreshold()) {
          
          validatedFindings.push({
            id: `ai-validated-${finding.id}`,
            type: 'ai:concurso_publico',
            confidence: validationResult.confidence,
            context: finding.context,
            data: {
              category: 'concurso_publico',
              keyword: finding.data.keyword,
              position: finding.data.position,
              weight: validationResult.confidence,
              validatedFrom: 'keyword:concurso_ambiguous',
              aiValidation: {
                confidence: validationResult.confidence,
                reason: validationResult.reason,
              },
            },
          });

          logger.info(`Validated ambiguous finding as concurso público`, {
            keyword: finding.data.keyword,
            confidence: validationResult.confidence,
            reason: validationResult.reason,
          });
        } else {
          logger.info(`Rejected ambiguous finding`, {
            keyword: finding.data.keyword,
            confidence: validationResult.confidence,
            reason: validationResult.reason,
          });
        }
      } catch (error: any) {
        logger.error(`Failed to validate ambiguous finding`, error, {
          findingId: finding.id,
          keyword: finding.data.keyword,
        });
      }
    }

    logger.info(`AI validation completed: ${validatedFindings.length} of ${ambiguousFindings.length} findings validated`);

    return validatedFindings;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AnalysisConfigV2>): void {
    this.config = { ...this.config, ...config };
    
    // Reinitialize analyzers if needed
    if (config.analyzers || config.analyzersV2) {
      this.analyzers = [];
      this.initializeAnalyzers();
    }
  }
}
