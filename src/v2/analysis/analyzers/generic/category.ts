/**
 * Generic Category Classifier - Determines primary category using AI
 * Phase 2: Classification after keyword detection finds potential categories
 */

import { BaseAnalyzer, Finding } from '../base-analyzer';
import { AIIntegrationService } from '../ai-integration';
import { ContextExtractor } from '../../services/context-extractor';
import { schema } from '../../../db';

interface GenericCategoryConfig {
  enabled: boolean;
  priority?: number;
  timeout?: number;
  aiService?: AIIntegrationService | null;
}

interface CategoryScore {
  category: string;
  count: number;
  keywords: string[];
  confidence: number;
}

interface AICategoryResult {
  category: string;
  confidence: number;
  reasoning?: string;
}

export class GenericCategoryAnalyzer extends BaseAnalyzer {
  private aiService: AIIntegrationService | null;

  constructor(config: GenericCategoryConfig) {
    super('generic-category-classifier', 'generic', config);
    this.aiService = config.aiService || null;
  }

  /**
   * Analyze text to determine primary category
   * Hybrid mode: Use pattern-based classification first, AI only when needed
   */
  protected async performAnalysis(ocrResult: typeof schema.ocrResults.$inferSelect): Promise<Finding[]> {
    const text = ocrResult.extractedText || '';

    // Detect categories with enhanced scoring
    const categoryScores = this.detectCategories(text);

    if (categoryScores.length === 0) {
      // No categories detected, nothing to classify
      return [];
    }

    // Sort by confidence
    const sortedCategories = categoryScores.sort((a, b) => b.confidence - a.confidence);
    const topCategory = sortedCategories[0];
    const secondCategory = sortedCategories[1];

    // Pattern confidence threshold
    const PATTERN_CONFIDENCE_THRESHOLD = 0.7;
    
    // Check if pattern-only classification is sufficient
    const usePatternOnly = this.shouldUsePatternOnly(topCategory, secondCategory, PATTERN_CONFIDENCE_THRESHOLD);

    if (usePatternOnly) {
      // High confidence pattern-based classification
      return [
        this.createFinding(
          'generic:category',
          {
            category: topCategory.category,
            confidence: topCategory.confidence,
            validationMethod: 'pattern',
            detectedCategories: sortedCategories.slice(0, 3).map(s => ({
              category: s.category,
              matchCount: s.count,
              keywords: s.keywords.slice(0, 5),
              confidence: s.confidence,
            })),
            patternConfidence: topCategory.confidence,
            aiSkipped: true,
          },
          topCategory.confidence,
          this.extractRelevantText(text, 500)
        ),
      ];
    }

    // Pattern confidence low or ambiguous, use AI if available
    if (!this.aiService) {
      // No AI available, use pattern-only with reduced confidence
      return [
        this.createFinding(
          'generic:category',
          {
            category: topCategory.category,
            confidence: topCategory.confidence * 0.8, // Reduce confidence
            validationMethod: 'pattern-fallback',
            detectedCategories: sortedCategories.slice(0, 3).map(s => ({
              category: s.category,
              matchCount: s.count,
              keywords: s.keywords.slice(0, 5),
              confidence: s.confidence,
            })),
            patternConfidence: topCategory.confidence,
            note: 'AI not available for validation',
          },
          topCategory.confidence * 0.8,
          this.extractRelevantText(text, 500)
        ),
      ];
    }

    // Use AI to determine primary category
    const aiResult = await this.classifyPrimaryCategory(text, categoryScores);

    if (!aiResult) {
      // AI failed, fall back to pattern-only
      return [
        this.createFinding(
          'generic:category',
          {
            category: topCategory.category,
            confidence: topCategory.confidence * 0.8,
            validationMethod: 'pattern-fallback',
            detectedCategories: sortedCategories.slice(0, 3).map(s => ({
              category: s.category,
              matchCount: s.count,
              keywords: s.keywords.slice(0, 5),
              confidence: s.confidence,
            })),
            patternConfidence: topCategory.confidence,
            note: 'AI classification failed',
          },
          topCategory.confidence * 0.8,
          this.extractRelevantText(text, 500)
        ),
      ];
    }

    // Create finding with AI classification
    return [
      this.createFinding(
        'generic:category',
        {
          category: aiResult.category,
          confidence: aiResult.confidence,
          validationMethod: 'hybrid-ai',
          detectedCategories: sortedCategories.slice(0, 3).map(s => ({
            category: s.category,
            matchCount: s.count,
            keywords: s.keywords.slice(0, 5),
            confidence: s.confidence,
          })),
          patternConfidence: topCategory.confidence,
          aiReasoning: aiResult.reasoning,
        },
        aiResult.confidence,
        this.extractRelevantText(text, 500)
      ),
    ];
  }

  /**
   * Determine if pattern-only classification is sufficient
   */
  private shouldUsePatternOnly(
    topCategory: CategoryScore,
    secondCategory: CategoryScore | undefined,
    threshold: number
  ): boolean {
    // High confidence pattern match
    if (topCategory.confidence >= threshold) {
      // If there's a second category, check if it's clearly lower
      if (secondCategory) {
        const difference = topCategory.confidence - secondCategory.confidence;
        // Clear winner: top category is significantly ahead
        return difference >= 0.2;
      }
      // Only one category detected with high confidence
      return true;
    }
    return false;
  }

  /**
   * Detect which categories are present in the text
   * Enhanced with confidence scoring based on keyword matches and weights
   */
  private detectCategories(text: string): CategoryScore[] {
    const lowerText = text.toLowerCase();
    const textLength = text.length;
    const scores: CategoryScore[] = [];

    // Define category keywords with weights
    const categoryPatterns = [
      {
        category: 'licitacao',
        keywords: ['licitação', 'pregão', 'tomada de preços', 'concorrência pública', 'dispensa de licitação', 'inexigibilidade', 'chamamento público'],
        baseWeight: 0.75,
      },
      {
        category: 'contrato',
        keywords: ['contrato', 'termo de contrato', 'aditivo contratual', 'rescisão contratual', 'prorrogação de contrato'],
        baseWeight: 0.73,
      },
      {
        category: 'nomeacao_exoneracao',
        keywords: ['nomear', 'nomeação', 'exonerar', 'exoneração', 'designar', 'designação', 'demitir', 'demissão'],
        baseWeight: 0.78,
      },
      {
        category: 'legislacao',
        keywords: ['decreto', 'lei municipal', 'lei complementar', 'portaria', 'resolução', 'instrução normativa'],
        baseWeight: 0.80,
      },
      {
        category: 'orcamento_financas',
        keywords: ['orçamento', 'crédito adicional', 'suplementação orçamentária', 'dotação orçamentária', 'empenho', 'liquidação', 'pagamento'],
        baseWeight: 0.76,
      },
      {
        category: 'convenio_parceria',
        keywords: ['convênio', 'termo de cooperação', 'parceria', 'acordo de cooperação', 'termo de fomento'],
        baseWeight: 0.74,
      },
    ];

    for (const pattern of categoryPatterns) {
      const matchedKeywords: string[] = [];
      let count = 0;
      const uniqueKeywords = new Set<string>();

      for (const keyword of pattern.keywords) {
        const lowerKeyword = keyword.toLowerCase();
        if (lowerText.includes(lowerKeyword)) {
          matchedKeywords.push(keyword);
          uniqueKeywords.add(lowerKeyword);
          // Count occurrences
          const regex = new RegExp(this.escapeRegex(lowerKeyword), 'g');
          const matches = lowerText.match(regex);
          count += matches ? matches.length : 0;
        }
      }

      if (matchedKeywords.length > 0) {
        // Calculate confidence
        let confidence = pattern.baseWeight;
        
        // Match count bonus (diminishing returns)
        const matchBonus = Math.log(count + 1) / Math.log(10);
        confidence += matchBonus * 0.08;
        
        // Keyword diversity bonus
        const diversityRatio = uniqueKeywords.size / pattern.keywords.length;
        confidence += diversityRatio * 0.12;
        
        // Keyword density bonus
        const density = (count / textLength) * 1000;
        const densityBonus = Math.min(0.10, density * 0.02);
        confidence += densityBonus;
        
        // Cap at 0.95
        confidence = Math.min(0.95, confidence);

        scores.push({
          category: pattern.category,
          count,
          keywords: matchedKeywords,
          confidence,
        });
      }
    }

    // Sort by confidence (highest first)
    return scores.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Use AI to classify the primary category
   */
  private async classifyPrimaryCategory(
    text: string,
    categoryScores: CategoryScore[]
  ): Promise<AICategoryResult | null> {
    if (!this.aiService) {
      return null;
    }

    try {
      const systemPrompt = 'You are an expert in analyzing Brazilian official gazette documents and determining their primary subject matter.';
      const userPrompt = this.buildCategoryPrompt(text, categoryScores);
      
      const response = await this.aiService.call({
        systemPrompt,
        userPrompt,
        temperature: 0.3,
        maxTokens: 300,
      });

      return this.parseCategoryResponse(response);
    } catch (error) {
      return null;
    }
  }

  /**
   * Build prompt for category classification
   */
  private buildCategoryPrompt(text: string, categoryScores: CategoryScore[]): string {
    // Truncate text if too long (keep first 2000 chars)
    const truncatedText = text.length > 2000 ? text.substring(0, 2000) + '...' : text;
    
    // Format detected categories
    const categoriesInfo = categoryScores
      .map(s => `- ${s.category}: ${s.count} matches (${s.keywords.slice(0, 3).join(', ')})`)
      .join('\n');

    return `Analyze the following excerpt from a Brazilian official gazette and determine the PRIMARY category.

Context: Keyword analysis detected the following categories:
${categoriesInfo}

Text to analyze:
---
${truncatedText}
---

Categories:
- licitacao: Procurement processes (licitações, pregões)
- contrato: Contracts and agreements
- nomeacao_exoneracao: Appointments and dismissals of public servants
- legislacao: Laws, decrees, and regulations
- orcamento_financas: Budget and financial matters
- convenio_parceria: Partnerships and cooperation agreements

Based on the text content, determine which ONE category is the PRIMARY subject matter.
Even if multiple categories are present, choose the most prominent one.

Respond in JSON format ONLY with this structure:
{
  "category": "category_name",
  "confidence": number (0.0 to 1.0),
  "reasoning": "brief explanation"
}`;
  }

  /**
   * Parse AI response for category classification
   */
  private parseCategoryResponse(response: string): AICategoryResult | null {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      
      // Validate category
      const validCategories = [
        'licitacao',
        'contrato',
        'nomeacao_exoneracao',
        'legislacao',
        'orcamento_financas',
        'convenio_parceria',
      ];

      if (!validCategories.includes(parsed.category)) {
        console.warn(`Invalid category from AI: ${parsed.category}, defaulting to first detected`);
        return null;
      }

      return {
        category: parsed.category,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.7)),
        reasoning: parsed.reasoning || '',
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract relevant text for context using smart context extraction
   */
  private extractRelevantText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    
    // For generic classification, return beginning of text
    // (keywords are already detected, so we don't need density scoring here)
    return text.substring(0, maxLength) + '...';
  }

  /**
   * Escape regex special characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Get metadata specific to category classification
   */
  protected getMetadata(findings: Finding[]): Record<string, any> {
    if (findings.length === 0) {
      return {
        ...super.getMetadata(findings),
        hasClassification: false,
        usedAI: false,
        hybridModeEnabled: true,
      };
    }

    const finding = findings[0];
    const usedAI = finding.data.validationMethod === 'hybrid-ai';
    const usedPatternOnly = finding.data.validationMethod === 'pattern';
    const aiSkipped = finding.data.aiSkipped || false;
    
    return {
      ...super.getMetadata(findings),
      hasClassification: true,
      primaryCategory: finding.data.category,
      detectedCategoriesCount: finding.data.detectedCategories?.length || 0,
      usedAI,
      usedPatternOnly,
      aiSkipped,
      validationMethod: finding.data.validationMethod,
      patternConfidence: finding.data.patternConfidence,
      hybridModeEnabled: true,
      costOptimization: {
        aiCallsAvoided: aiSkipped || usedPatternOnly ? 1 : 0,
        usedPatternOnly,
      },
    };
  }
}
