/**
 * Analysis Processor - Instantiates and orchestrates all analyzers
 */

import { BaseAnalyzer, AnalysisResult } from './base-analyzer';
import { ConcursoOrchestrator } from './concurso/classificator';
import { AIIntegrationService, createAIService } from './ai-integration';
import { type AnalysisConfig } from './config';
import { schema } from '../../db';

export interface ProcessorResult {
  analyzerResults: AnalysisResult[];
  totalFindings: number;
  totalProcessingTimeMs: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  // Cost optimization tracking
  totalAICost?: number;
  aiUsageBreakdown?: Array<{
    analyzerId: string;
    cost: number;
    callsAvoided: number;
  }>;
  costOptimizationSummary?: {
    totalAICallsAvoided: number;
    estimatedCostSaved: number;
    patternsOnlyCount: number;
  };
}

export class AnalysisProcessor {
  private analyzers: BaseAnalyzer[] = [];
  private aiService: AIIntegrationService | null = null;

  constructor(private config: AnalysisConfig) {
    this.initializeAIService();
    this.initializeAnalyzers();
  }

  /**
   * Initialize AI service if API key is available
   */
  private initializeAIService(): void {
    // Check both concurso and generic configs for AI settings
    const concursoConfig = this.config.analyzers.concurso;
    const genericConfig = this.config.analyzers.generic;
    
    // Use concurso config first, fallback to generic
    const aiConfig = concursoConfig?.useAI ? concursoConfig : genericConfig?.useAI ? genericConfig : null;
    
    if (aiConfig?.apiKey) {
      this.aiService = createAIService({
        apiKey: aiConfig.apiKey,
        model: aiConfig.model || 'gpt-4o-mini',
        temperature: aiConfig.temperature || 0.3,
        maxRetries: aiConfig.maxRetries || 2,
        timeout: aiConfig.timeout || 30000,
      });
    }
  }

  /**
   * Initialize analyzers based on configuration
   */
  private initializeAnalyzers(): void {
    // Concurso Orchestrator (detection + classification)
    if (this.config.analyzers.concurso?.enabled) {
      this.analyzers.push(
        new ConcursoOrchestrator({
          ...this.config.analyzers.concurso,
          aiService: this.aiService,
          detectionThreshold: this.config.analyzers.concurso.detectionThreshold,
          aiConfidenceThreshold: this.config.analyzers.concurso.aiConfidenceThreshold,
        })
      );
    }

    // Generic Orchestrator (keyword detection + AI classification)
    if (this.config.analyzers.generic?.enabled) {
      const { GenericOrchestrator } = require('./generic/classificator');
      this.analyzers.push(
        new GenericOrchestrator({
          ...this.config.analyzers.generic,
          aiService: this.aiService,
        })
      );
    }

    // Sort analyzers by priority (lower number = higher priority)
    this.analyzers.sort((a, b) => a.getPriority() - b.getPriority());
  }

  /**
   * Process OCR result through all enabled analyzers
   */
  async process(ocrResult: typeof schema.ocrResults.$inferSelect): Promise<ProcessorResult> {
    const startTime = Date.now();
    const analyzerResults: AnalysisResult[] = [];

    // Run each analyzer sequentially
    for (const analyzer of this.analyzers) {
      try {
        const result = await analyzer.analyze(ocrResult);
        analyzerResults.push(result);
      } catch (error) {
        analyzerResults.push({
          analyzerId: analyzer.getId(),
          analyzerType: analyzer.getType(),
          status: 'failure',
          findings: [],
          processingTimeMs: 0,
          error: {
            message: error instanceof Error ? error.message : 'Unknown error',
            code: 'ANALYZER_EXCEPTION',
          },
        });
      }
    }

    const totalProcessingTimeMs = Date.now() - startTime;

    // Aggregate results
    const totalFindings = analyzerResults.reduce(
      (sum, result) => sum + result.findings.length,
      0
    );

    const successCount = analyzerResults.filter(r => r.status === 'success').length;
    const failureCount = analyzerResults.filter(r => r.status === 'failure').length;
    const skippedCount = analyzerResults.filter(r => r.status === 'skipped').length;

    // Aggregate cost optimization metrics
    const costMetrics = this.aggregateCostMetrics(analyzerResults);

    // Get AI usage if available
    const aiUsage = this.aiService?.getUsageStats();
    
    // Log cost summary
    if (costMetrics.totalAICallsAvoided > 0 || (aiUsage && aiUsage.totalCost > 0)) {
      console.log('[V2 Processor] Cost optimization summary:', {
        totalAICost: aiUsage?.totalCost.toFixed(4) || '0.0000',
        aiCallsAvoided: costMetrics.totalAICallsAvoided,
        estimatedSaved: `$${costMetrics.estimatedCostSaved.toFixed(4)}`,
        patternsOnlyCount: costMetrics.patternsOnlyCount,
      });
    }

    return {
      analyzerResults,
      totalFindings,
      totalProcessingTimeMs,
      successCount,
      failureCount,
      skippedCount,
      totalAICost: aiUsage?.totalCost,
      aiUsageBreakdown: costMetrics.breakdown,
      costOptimizationSummary: {
        totalAICallsAvoided: costMetrics.totalAICallsAvoided,
        estimatedCostSaved: costMetrics.estimatedCostSaved,
        patternsOnlyCount: costMetrics.patternsOnlyCount,
      },
    };
  }

  /**
   * Aggregate cost optimization metrics from analyzer results
   */
  private aggregateCostMetrics(results: AnalysisResult[]): {
    totalAICallsAvoided: number;
    estimatedCostSaved: number;
    patternsOnlyCount: number;
    breakdown: Array<{ analyzerId: string; cost: number; callsAvoided: number }>;
  } {
    let totalAICallsAvoided = 0;
    let patternsOnlyCount = 0;
    const breakdown: Array<{ analyzerId: string; cost: number; callsAvoided: number }> = [];

    for (const result of results) {
      if (result.status !== 'success' || !result.metadata) continue;

      const costOpt = result.metadata.costOptimization;
      if (costOpt) {
        const callsAvoided = costOpt.aiCallsAvoided || 0;
        totalAICallsAvoided += callsAvoided;
        
        if (costOpt.patternsOnly) {
          patternsOnlyCount++;
        }

        // Track per-analyzer costs
        const aiUsage = result.metadata.aiUsage;
        const cost = aiUsage?.totalCost || 0;
        
        breakdown.push({
          analyzerId: result.analyzerId,
          cost,
          callsAvoided,
        });
      }
    }

    // Estimate cost saved (assume $0.002 per AI call avoided)
    const avgCostPerCall = 0.002;
    const estimatedCostSaved = totalAICallsAvoided * avgCostPerCall;

    return {
      totalAICallsAvoided,
      estimatedCostSaved,
      patternsOnlyCount,
      breakdown,
    };
  }

  /**
   * Get list of enabled analyzers
   */
  getEnabledAnalyzers(): string[] {
    return this.analyzers.map(a => a.getId());
  }

  /**
   * Get analyzer by ID
   */
  getAnalyzer(analyzerId: string): BaseAnalyzer | undefined {
    return this.analyzers.find(a => a.getId() === analyzerId);
  }
}

/**
 * Factory function to create analysis processor
 */
export function createAnalysisProcessor(config: AnalysisConfig): AnalysisProcessor {
  return new AnalysisProcessor(config);
}
