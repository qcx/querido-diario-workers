/**
 * Generic Orchestrator - Coordinates keyword detection and category classification
 * Main analyzer that should be registered in the analysis processor
 */

import { BaseAnalyzer, Finding } from '../base-analyzer';
import { AIIntegrationService } from '../ai-integration';
import { GenericKeywordAnalyzer } from './keyword';
import { GenericCategoryAnalyzer } from './category';
import { schema } from '../../../db';

interface GenericOrchestratorConfig {
  enabled: boolean;
  priority?: number;
  timeout?: number;
  aiService?: AIIntegrationService | null;
  useAI?: boolean;
}

export class GenericOrchestrator extends BaseAnalyzer {
  private aiService: AIIntegrationService | null;
  private keywordAnalyzer: GenericKeywordAnalyzer;
  private categoryAnalyzer: GenericCategoryAnalyzer;

  constructor(config: GenericOrchestratorConfig) {
    super('generic-orchestrator', 'generic', config);
    this.aiService = config.aiService || null;

    // Initialize child analyzers
    this.keywordAnalyzer = new GenericKeywordAnalyzer({
      enabled: true,
      priority: config.priority,
      timeout: Math.floor((config.timeout || 30000) * 0.5), // 50% of total timeout
    });

    this.categoryAnalyzer = new GenericCategoryAnalyzer({
      enabled: config.useAI !== false && !!this.aiService,
      priority: config.priority,
      timeout: Math.floor((config.timeout || 30000) * 0.5), // 50% of total timeout
      aiService: this.aiService,
    });
  }

  protected async performAnalysis(ocrResult: typeof schema.ocrResults.$inferSelect): Promise<Finding[]> {
    const allFindings: Finding[] = [];

    // Phase 1: Keyword Detection - Find all keyword matches
    const keywordResult = await this.keywordAnalyzer.analyze(ocrResult);
    
    if (keywordResult.status !== 'success' || keywordResult.findings.length === 0) {
      // No keywords detected - return empty (nothing to classify)
      return [];
    }

    // Add all keyword findings
    allFindings.push(...keywordResult.findings);

    // Phase 2: Category Classification - Determine primary category using AI
    if (this.aiService) {
      try {
        const categoryResult = await this.categoryAnalyzer.analyze(ocrResult);
        
        if (categoryResult.status === 'success' && categoryResult.findings.length > 0) {
          // Add category finding
          allFindings.push(...categoryResult.findings);
        }
      } catch (error) {
        // Classification failed, but we still have keyword findings
        console.error('Category classification failed:', error);
        // Continue with just keyword findings
      }
    }

    return allFindings;
  }

  /**
   * Get comprehensive metadata combining keyword detection and classification
   */
  protected getMetadata(findings: Finding[]): Record<string, any> {
    const baseMetadata = super.getMetadata(findings);

    // Extract keyword detection info
    const keywordFindings = findings.filter(f => f.type === 'generic:keyword');
    const categoryCounts: Record<string, number> = {};
    
    for (const finding of keywordFindings) {
      const category = finding.data.category as string;
      categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    }

    const detectedCategories = Object.keys(categoryCounts);

    // Extract classification info
    const categoryFinding = findings.find(f => f.type === 'generic:category');
    const primaryCategory = categoryFinding?.data.category || null;
    const categoryConfidence = categoryFinding?.confidence || 0;
    const categoryValidation = categoryFinding?.data.validationMethod || null;
    const aiSkipped = categoryFinding?.data.aiSkipped || false;
    const usedPatternOnly = categoryValidation === 'pattern';

    return {
      ...baseMetadata,
      
      // Keyword detection metadata
      keywordMatchesCount: keywordFindings.length,
      detectedCategories,
      detectedCategoriesCount: detectedCategories.length,
      categoryCounts,
      
      // Classification metadata
      hasClassification: !!categoryFinding,
      primaryCategory,
      categoryConfidence,
      categoryValidationMethod: categoryValidation,
      patternConfidence: categoryFinding?.data.patternConfidence,
      
      // Pipeline metadata
      pipelineStages: {
        keywordDetection: keywordFindings.length > 0 ? 'completed' : 'no-matches',
        classification: categoryFinding ? 'completed' : 'skipped',
      },
      
      // AI usage tracking
      usedAI: categoryValidation === 'hybrid-ai',
      
      // Cost optimization tracking
      costOptimization: {
        aiCallsAvoided: aiSkipped || usedPatternOnly ? 1 : 0,
        usedPatternOnly,
        usedHybridMode: categoryValidation?.includes('hybrid') || categoryValidation === 'pattern',
        patternsOnly: usedPatternOnly,
      },
    };
  }
}

/**
 * Factory function to create generic orchestrator
 */
export function createGenericOrchestrator(config: GenericOrchestratorConfig): GenericOrchestrator {
  return new GenericOrchestrator(config);
}
