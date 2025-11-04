/**
 * Concurso Orchestrator - Coordinates detection and classification pipeline
 * Main analyzer that should be registered in the analysis processor
 */

import { BaseAnalyzer, Finding, AnalysisResult } from '../base-analyzer';
import { AIIntegrationService } from '../ai-integration';
import { ConcursoKeywordAnalyzer } from './keyword';
import { ConcursoCategoryAnalyzer } from './category';
import { schema } from '../../../db';

interface ConcursoOrchestratorConfig {
  enabled: boolean;
  priority?: number;
  timeout?: number;
  aiService?: AIIntegrationService | null;
  detectionThreshold?: number;
  aiConfidenceThreshold?: number;
}

export class ConcursoOrchestrator extends BaseAnalyzer {
  private aiService: AIIntegrationService | null;
  private detectionThreshold: number;
  private aiConfidenceThreshold: number;
  private keywordAnalyzer: ConcursoKeywordAnalyzer;
  private categoryAnalyzer: ConcursoCategoryAnalyzer;

  constructor(config: ConcursoOrchestratorConfig) {
    super('concurso-orchestrator', 'concurso', config);
    this.aiService = config.aiService || null;
    this.detectionThreshold = config.detectionThreshold || 0.7;
    this.aiConfidenceThreshold = config.aiConfidenceThreshold || 0.7;

    // Initialize child analyzers
    this.keywordAnalyzer = new ConcursoKeywordAnalyzer({
      enabled: true,
      priority: config.priority,
      timeout: Math.floor((config.timeout || 30000) * 0.4), // 40% of total timeout
      aiService: this.aiService,
      aiConfidenceThreshold: 0.85,
    });

    this.categoryAnalyzer = new ConcursoCategoryAnalyzer({
      enabled: true,
      priority: config.priority,
      timeout: Math.floor((config.timeout || 30000) * 0.6), // 60% of total timeout
      aiService: this.aiService,
      aiConfidenceThreshold: this.aiConfidenceThreshold,
    });
  }

  protected async performAnalysis(ocrResult: typeof schema.ocrResults.$inferSelect): Promise<Finding[]> {
    const allFindings: Finding[] = [];

    // Phase 1: Detection - Check if this is a concurso público announcement
    const detectionResult = await this.keywordAnalyzer.analyze(ocrResult);
    
    if (detectionResult.status !== 'success' || detectionResult.findings.length === 0) {
      // No concurso detected
      return [];
    }

    const detectionFinding = detectionResult.findings[0];
    allFindings.push(detectionFinding);

    // Check if detection confidence meets threshold
    const hasConcurso = detectionFinding.data.hasConcurso;
    const detectionConfidence = detectionFinding.confidence;

    if (!hasConcurso || detectionConfidence < this.detectionThreshold) {
      // Confidence too low to proceed with classification
      return allFindings;
    }

    // Phase 2: Classification - Determine the type of concurso announcement
    try {
      const classificationResult = await this.categoryAnalyzer.analyze(ocrResult);
      
      if (classificationResult.status === 'success' && classificationResult.findings.length > 0) {
        // Add classification findings
        allFindings.push(...classificationResult.findings);
      }
    } catch (error) {
      // Classification failed, but we still have detection findings
      console.error('Category classification failed:', error);
      // Continue with just detection findings
    }

    return allFindings;
  }

  /**
   * Get comprehensive metadata combining detection and classification
   */
  protected getMetadata(findings: Finding[]): Record<string, any> {
    const baseMetadata = super.getMetadata(findings);

    // Extract detection info
    const detectionFinding = findings.find(f => f.type === 'concurso:detection');
    const hasConcurso = detectionFinding?.data.hasConcurso || false;
    const detectionMethod = detectionFinding?.data.method || 'none';
    const detectionConfidence = detectionFinding?.confidence || 0;
    const detectionAISkipped = detectionFinding?.data.aiSkipped || false;

    // Extract classification info
    const categoryFinding = findings.find(f => f.type === 'concurso:category');
    const primaryCategory = categoryFinding?.data.category || null;
    const categoryConfidence = categoryFinding?.confidence || 0;
    const categoryValidation = categoryFinding?.data.validationMethod || null;

    // Extract all categories (primary + secondary)
    const allCategories = findings
      .filter(f => f.type === 'concurso:category' || f.type === 'concurso:category:secondary')
      .map(f => ({
        category: f.data.category,
        confidence: f.confidence,
        isPrimary: f.type === 'concurso:category',
      }));

    // Calculate overall confidence
    // If we have both detection and classification, combine them
    let overallConfidence = detectionConfidence;
    if (categoryFinding) {
      // Average of detection and classification confidence, weighted towards classification
      overallConfidence = (detectionConfidence * 0.3) + (categoryConfidence * 0.7);
    }

    // Aggregate cost optimization metrics
    const aiUsedDetection = detectionMethod?.includes('ai');
    const aiUsedClassification = categoryValidation === 'ai-assisted';
    const aiCallsAvoided = (detectionAISkipped ? 1 : 0) + (categoryFinding?.data.aiSkipped ? 1 : 0);
    
    return {
      ...baseMetadata,
      
      // Detection metadata
      hasConcurso,
      detectionConfidence,
      detectionMethod,
      detectionThresholdMet: detectionConfidence >= this.detectionThreshold,
      
      // Classification metadata
      hasClassification: !!categoryFinding,
      primaryCategory,
      categoryConfidence,
      categoryValidationMethod: categoryValidation,
      allCategories,
      categoriesCount: allCategories.length,
      
      // Overall metadata
      overallConfidence,
      pipelineStages: {
        detection: 'completed',
        classification: categoryFinding ? 'completed' : 'skipped',
      },
      
      // AI usage tracking
      usedAI: aiUsedDetection || aiUsedClassification,
      aiUsedIn: [
        aiUsedDetection ? 'detection' : null,
        aiUsedClassification ? 'classification' : null,
      ].filter(Boolean),
      
      // Cost optimization tracking
      costOptimization: {
        aiCallsAvoided,
        usedHybridMode: detectionMethod?.includes('hybrid') || false,
        usedEnhancedPatterns: categoryValidation === 'keyword',
        patternsOnly: !aiUsedDetection && !aiUsedClassification,
      },
    };
  }

}

/**
 * Factory function to create concurso orchestrator
 */
export function createConcursoOrchestrator(config: ConcursoOrchestratorConfig): ConcursoOrchestrator {
  return new ConcursoOrchestrator(config);
}
