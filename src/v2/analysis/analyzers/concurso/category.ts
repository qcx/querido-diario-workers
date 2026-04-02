/**
 * Concurso Category Classifier - Classifies type of concurso público announcement
 * Phase 2: Classification after detection confirms it's a concurso
 */

import { BaseAnalyzer, Finding } from '../base-analyzer';
import { AIIntegrationService } from '../ai-integration';
import { ContextExtractor } from '../../services/context-extractor';
import { schema } from '../../../db';

interface ConcursoCategoryConfig {
  enabled: boolean;
  priority?: number;
  timeout?: number;
  aiService?: AIIntegrationService | null;
  aiConfidenceThreshold?: number;
}

interface CategoryPattern {
  category: string;
  keywords: string[];
  weight: number;
}

interface KeywordMatch {
  keyword: string;
  position: number;
  context: string;
  category: string;
}

interface CategoryScore {
  category: string;
  count: number;
  confidence: number;
  matches: KeywordMatch[];
}

interface AICategoryResult {
  category: string;
  confidence: number;
  reasoning?: string;
  alternativeCategories?: Array<{ category: string; confidence: number }>;
}

export class ConcursoCategoryAnalyzer extends BaseAnalyzer {
  private aiService: AIIntegrationService | null;
  private aiConfidenceThreshold: number;
  private patterns: CategoryPattern[];

  constructor(config: ConcursoCategoryConfig) {
    super('concurso-category-classifier', 'concurso', config);
    this.aiService = config.aiService || null;
    this.aiConfidenceThreshold = config.aiConfidenceThreshold || 0.7;
    this.patterns = this.getCategoryPatterns();
  }

  protected async performAnalysis(ocrResult: typeof schema.ocrResults.$inferSelect): Promise<Finding[]> {
    const text = ocrResult.extractedText || '';
    const lowerText = text.toLowerCase();

    // Step 1: Find all keyword matches for each category
    const categoryScores = this.calculateCategoryScores(text, lowerText);

    // Step 2: Determine primary category
    const sortedCategories = categoryScores.sort((a, b) => b.confidence - a.confidence);
    
    if (sortedCategories.length === 0) {
      return [];
    }

    const topCategory = sortedCategories[0];
    const secondCategory = sortedCategories[1];

    // Step 3: Check if we need AI assistance
    const needsAI = this.shouldUseAI(topCategory, secondCategory);

    if (needsAI && this.aiService) {
      // Use AI to validate/improve classification
      const aiResult = await this.classifyCategory(
        this.extractRelevantText(text, topCategory.matches),
        sortedCategories.map(s => ({
          category: s.category,
          count: s.count,
          confidence: s.confidence,
        }))
      );

      // Create finding with AI-assisted classification
      return [
        this.createFinding(
          'concurso:category',
          {
            category: aiResult.category,
            confidence: aiResult.confidence,
            validationMethod: 'ai-assisted',
            keywordMatches: this.formatMatches(topCategory.matches),
            aiReasoning: aiResult.reasoning,
            alternativeCategories: aiResult.alternativeCategories,
            keywordConfidence: topCategory.confidence,
            allCategoryScores: sortedCategories.map(s => ({
              category: s.category,
              confidence: s.confidence,
              matchCount: s.count,
            })),
          },
          aiResult.confidence,
          topCategory.matches[0]?.context
        ),
      ];
    }

    // Step 4: Return keyword-based classification
    const findings: Finding[] = [];

    // Primary category
    findings.push(
      this.createFinding(
        'concurso:category',
        {
          category: topCategory.category,
          confidence: topCategory.confidence,
          validationMethod: 'keyword',
          keywordMatches: this.formatMatches(topCategory.matches),
          matchCount: topCategory.count,
          allCategoryScores: sortedCategories.slice(0, 3).map(s => ({
            category: s.category,
            confidence: s.confidence,
            matchCount: s.count,
          })),
        },
        topCategory.confidence,
        topCategory.matches[0]?.context
      )
    );

    // Add secondary categories if they have reasonable confidence
    for (let i = 1; i < Math.min(3, sortedCategories.length); i++) {
      const category = sortedCategories[i];
      if (category.confidence > 0.4) {
        findings.push(
          this.createFinding(
            'concurso:category:secondary',
            {
              category: category.category,
              confidence: category.confidence,
              validationMethod: 'keyword',
              keywordMatches: this.formatMatches(category.matches),
              matchCount: category.count,
            },
            category.confidence,
            category.matches[0]?.context
          )
        );
      }
    }

    return findings;
  }

  /**
   * Calculate scores for each category based on keyword matches
   * Enhanced with keyword density scoring and proximity analysis
   */
  private calculateCategoryScores(text: string, lowerText: string): CategoryScore[] {
    const scores: Map<string, CategoryScore> = new Map();
    const textLength = text.length;

    for (const pattern of this.patterns) {
      const matches: KeywordMatch[] = [];
      let uniqueKeywords = new Set<string>();
      
      for (const keyword of pattern.keywords) {
        const lowerKeyword = keyword.toLowerCase();
        let startIndex = 0;
        let foundInPattern = false;

        while (true) {
          const index = lowerText.indexOf(lowerKeyword, startIndex);
          if (index === -1) break;

          matches.push({
            keyword,
            position: index,
            context: this.extractContext(text, index, 200),
            category: pattern.category,
          });

          uniqueKeywords.add(lowerKeyword);
          foundInPattern = true;
          startIndex = index + lowerKeyword.length;
        }
      }

      if (matches.length > 0) {
        // Enhanced confidence calculation
        
        // 1. Base weight from pattern
        let confidence = pattern.weight;
        
        // 2. Match count bonus (diminishing returns)
        const matchBonus = Math.log(matches.length + 1) / Math.log(10);
        confidence += matchBonus * 0.08;
        
        // 3. Keyword diversity bonus (more unique keywords = higher confidence)
        const diversityRatio = uniqueKeywords.size / pattern.keywords.length;
        confidence += diversityRatio * 0.1;
        
        // 4. Keyword density (matches per 1000 chars)
        const density = (matches.length / textLength) * 1000;
        const densityBonus = Math.min(0.12, density * 0.02);
        confidence += densityBonus;
        
        // 5. Proximity bonus (if matches are close together, likely more relevant)
        if (matches.length >= 2) {
          const proximityScore = this.calculateProximityScore(matches);
          confidence += proximityScore * 0.08;
        }
        
        // Cap at 0.98 (leave room for AI to improve)
        confidence = Math.min(0.98, confidence);

        scores.set(pattern.category, {
          category: pattern.category,
          count: matches.length,
          confidence,
          matches,
        });
      }
    }

    return Array.from(scores.values());
  }

  /**
   * Calculate proximity score based on how close matches are to each other
   * Returns 0-1 score where 1 means matches are very close together
   */
  private calculateProximityScore(matches: KeywordMatch[]): number {
    if (matches.length < 2) return 0;
    
    // Sort by position
    const sorted = [...matches].sort((a, b) => a.position - b.position);
    
    // Calculate average distance between consecutive matches
    let totalDistance = 0;
    for (let i = 1; i < sorted.length; i++) {
      totalDistance += sorted[i].position - sorted[i-1].position;
    }
    const avgDistance = totalDistance / (sorted.length - 1);
    
    // Convert to score: closer matches = higher score
    // Distance < 500 chars = very close (1.0)
    // Distance > 5000 chars = far apart (0.0)
    const score = Math.max(0, Math.min(1, 1 - (avgDistance - 500) / 4500));
    
    return score;
  }

  /**
   * Determine if AI assistance is needed
   * Enhanced logic to reduce unnecessary AI calls
   */
  private shouldUseAI(topCategory: CategoryScore, secondCategory?: CategoryScore): boolean {
    if (!this.aiService) {
      return false;
    }

    // Stricter threshold: Only use AI if pattern confidence is truly low
    // Reduced from 0.7 to 0.6 to trust stronger pattern-based classifications
    const strictThreshold = Math.min(this.aiConfidenceThreshold, 0.6);
    
    if (topCategory.confidence < strictThreshold) {
      return true;
    }

    // Use AI if top two categories are very close (ambiguous)
    // Tightened from 0.15 to 0.12 to avoid AI for clear winners
    if (secondCategory) {
      const difference = topCategory.confidence - secondCategory.confidence;
      if (difference < 0.12) {
        return true;
      }
    }

    // Additional check: If top category has very few matches (< 2),
    // be more cautious even with high confidence
    if (topCategory.count < 2 && topCategory.confidence < 0.85) {
      return true;
    }

    return false;
  }

  /**
   * Extract relevant text for AI classification
   * Uses smart context extraction with keyword-density scoring
   */
  private extractRelevantText(text: string, matches: KeywordMatch[], maxLength: number = 2500): string {
    if (matches.length === 0) {
      return text.substring(0, maxLength);
    }

    // Extract keywords from matches for context scoring
    const keywords = matches.map(m => m.keyword);
    
    // Use ContextExtractor for intelligent chunk selection
    return ContextExtractor.extractRelevantContext(text, keywords, maxLength);
  }

  /**
   * Extract context around a position
   */
  private extractContext(text: string, position: number, contextLength: number): string {
    const start = Math.max(0, position - contextLength);
    const end = Math.min(text.length, position + contextLength);
    
    let context = text.substring(start, end);
    
    if (start > 0) context = '...' + context;
    if (end < text.length) context = context + '...';
    
    return context.trim();
  }

  /**
   * Format matches for output
   */
  private formatMatches(matches: KeywordMatch[]) {
    return matches.map(m => ({
      keyword: m.keyword,
      position: m.position,
      context: m.context.substring(0, 150), // Limit context length
    }));
  }

  /**
   * Get category patterns
   * Based on patterns from src/analyzers/keyword-analyzer.ts
   */
  private getCategoryPatterns(): CategoryPattern[] {
    return [
      // Edital de Abertura
      {
        category: 'edital_abertura',
        keywords: [
          'edital de abertura',
          'edital de concurso',
          'abertura de inscrições',
          'abertura de inscricoes',
          'inscrições abertas',
          'inscricoes abertas',
          'inscrições iniciadas',
          'inscricoes iniciadas',
          'realização de concurso público',
          'realizacao de concurso publico',
          'concurso público para provimento',
          'concurso publico para provimento',
          'torna público o edital',
          'torna publico o edital',
        ],
        weight: 0.85,
      },

      // Convocação
      {
        category: 'convocacao',
        keywords: [
          'candidatos aprovados',
          'candidatos convocados',
          'candidatos selecionados',
          'candidatos reprovados',
          'cadastro reserva',
          'cadastro de reserva',
          'chamada de candidatos',
          'convocação de candidatos',
          'convocacao de candidatos',
          'apresentação de candidatos',
          'apresentacao de candidatos',
          'lista de convocados',
          'relação de convocados',
          'relacao de convocados',
        ],
        weight: 0.82,
      },

      // Homologação
      {
        category: 'homologacao',
        keywords: [
          'homologação do resultado',
          'homologacao do resultado',
          'homologação do concurso',
          'homologacao do concurso',
          'homologa o resultado',
          'resultado final',
          'classificação final',
          'classificacao final',
          'aprovação do resultado',
          'aprovacao do resultado',
          'homologação final',
          'homologacao final',
        ],
        weight: 0.83,
      },

      // Retificação
      {
        category: 'retificacao',
        keywords: [
          'retificação do edital',
          'retificacao do edital',
          'retifica o edital',
          'alteração do edital',
          'alteracao do edital',
          'correção do edital',
          'correcao do edital',
          'errata do edital',
          'onde se lê',
          'onde se le',
          'leia-se',
          'leia-se',
        ],
        weight: 0.80,
      },

      // Prorrogação
      {
        category: 'prorrogacao',
        keywords: [
          'prorrogação das inscrições',
          'prorrogacao das inscricoes',
          'prorrogação do prazo',
          'prorrogacao do prazo',
          'prorrogação do edital',
          'prorrogacao do edital',
          'prorroga as inscrições',
          'prorroga as inscricoes',
          'extensão de prazo',
          'extensao de prazo',
          'adiamento da prova',
          'nova data',
          'alteração de data',
          'alteracao de data',
        ],
        weight: 0.78,
      },

      // Cancelamento
      {
        category: 'cancelamento',
        keywords: [
          'cancelamento do concurso',
          'cancelamento do edital',
          'cancela o concurso',
          'cancela o edital',
          'suspensão do concurso',
          'suspensao do concurso',
          'suspende o concurso',
          'anulação do concurso',
          'anulacao do concurso',
          'anula o concurso',
          'revogação do edital',
          'revogacao do edital',
          'revoga o edital',
        ],
        weight: 0.81,
      },

      // Resultado
      {
        category: 'resultado',
        keywords: [
          'resultado preliminar',
          'resultado parcial',
          'resultado da prova',
          'classificação preliminar',
          'classificacao preliminar',
          'lista de classificados',
          'lista de aprovados',
          'gabarito oficial',
          'gabarito preliminar',
          'nota dos candidatos',
          'pontuação dos candidatos',
          'pontuacao dos candidatos',
          'divulgação do resultado',
          'divulgacao do resultado',
        ],
        weight: 0.75,
      },
    ];
  }

  /**
   * Classify the category of a concurso público announcement using AI
   */
  private async classifyCategory(
    text: string,
    keywordMatches: Array<{ category: string; count: number; confidence: number }>
  ): Promise<AICategoryResult> {
    if (!this.aiService) {
      // Graceful fallback - return most likely category from keywords with reduced confidence
      const topCategory = keywordMatches.sort((a, b) => b.confidence - a.confidence)[0];
      return {
        category: topCategory?.category || 'unknown',
        confidence: Math.max(0.3, (topCategory?.confidence || 0.5) * 0.6),
        reasoning: 'AI service not available, using keyword-based fallback',
      };
    }

    try {
      const systemPrompt = 'You are an expert in analyzing Brazilian official gazette documents, specifically for identifying and classifying "concurso público" (public examination) announcements.';
      const userPrompt = this.buildCategoryPrompt(text, keywordMatches);
      
      const response = await this.aiService.call({
        systemPrompt,
        userPrompt,
        temperature: 0.2,
      });

      return this.parseCategoryResponse(response);
    } catch (error) {
      console.error('AI category classification failed:', error);
      // Graceful fallback - return most likely category from keywords with reduced confidence
      const topCategory = keywordMatches.sort((a, b) => b.confidence - a.confidence)[0];
      return {
        category: topCategory?.category || 'unknown',
        confidence: Math.max(0.3, (topCategory?.confidence || 0.5) * 0.6),
        reasoning: 'AI classification failed, using keyword-based fallback',
      };
    }
  }

  /**
   * Build prompt for category classification
   */
  private buildCategoryPrompt(
    text: string,
    keywordMatches: Array<{ category: string; count: number; confidence: number }>
  ): string {
    // Truncate text if too long
    const truncatedText = text.length > 3000 ? text.substring(0, 3000) + '...' : text;
    
    const categoryDescriptions = {
      'edital_abertura': 'Opening announcement/call for applications (edital de abertura, abertura de inscrições)',
      'convocacao': 'Calling/summoning approved candidates (convocação, candidatos aprovados)',
      'homologacao': 'Final result approval/ratification (homologação, resultado final)',
      'retificacao': 'Correction/amendment of previous edital (retificação, alteração do edital)',
      'prorrogacao': 'Extension/postponement of dates (prorrogação, adiamento)',
      'cancelamento': 'Cancellation or suspension (cancelamento, suspensão, anulação)',
      'resultado': 'Results, scores, classifications (resultado, gabarito, classificação)',
    };
    
    return `Analyze this excerpt from a Brazilian "concurso público" announcement and classify its PRIMARY category.

Keyword analysis detected these potential categories:
${keywordMatches.map(m => `- ${m.category}: ${m.count} matches, confidence ${m.confidence.toFixed(2)}`).join('\n')}

Text to analyze:
---
${truncatedText}
---

Available categories:
${Object.entries(categoryDescriptions).map(([cat, desc]) => `- ${cat}: ${desc}`).join('\n')}

Respond in JSON format ONLY:
{
  "category": "primary_category_name",
  "confidence": number (0.0 to 1.0),
  "reasoning": "brief explanation",
  "alternativeCategories": [
    {"category": "name", "confidence": number}
  ]
}

Choose the SINGLE most prominent category based on the main purpose of the announcement.`;
  }

  /**
   * Parse AI category classification response
   */
  private parseCategoryResponse(response: string): AICategoryResult {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      
      return {
        category: parsed.category || 'unknown',
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
        reasoning: parsed.reasoning || '',
        alternativeCategories: parsed.alternativeCategories || [],
      };
    } catch (error) {
      console.error('Failed to parse AI response:', error);
      return {
        category: 'unknown',
        confidence: 0.3,
        reasoning: 'Failed to parse AI response',
      };
    }
  }

  /**
   * Get metadata specific to category classification
   */
  protected getMetadata(findings: Finding[]): Record<string, any> {
    const baseMetadata = super.getMetadata(findings);

    if (findings.length === 0) {
      return {
        ...baseMetadata,
        primaryCategory: null,
        categoriesDetected: 0,
        enhancedPatternsUsed: true,
      };
    }

    const primaryFinding = findings.find(f => f.type === 'concurso:category');
    const secondaryFindings = findings.filter(f => f.type === 'concurso:category:secondary');
    const usedAI = primaryFinding?.data.validationMethod === 'ai-assisted';

    return {
      ...baseMetadata,
      primaryCategory: primaryFinding?.data.category,
      secondaryCategories: secondaryFindings.map(f => f.data.category),
      categoriesDetected: findings.length,
      usedAI,
      validationMethod: primaryFinding?.data.validationMethod,
      enhancedPatternsUsed: true,
      keywordConfidence: primaryFinding?.data.keywordConfidence,
      matchCount: primaryFinding?.data.matchCount,
      costOptimization: {
        aiCallsAvoided: !usedAI ? 1 : 0,
        usedEnhancedPatterns: !usedAI,
      },
    };
  }
}
