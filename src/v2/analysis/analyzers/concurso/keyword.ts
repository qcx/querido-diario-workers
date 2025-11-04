/**
 * Concurso Keyword Detector - Detects presence of "concurso público" in text
 * Phase 1: Detection before classification
 */

import { BaseAnalyzer, Finding, AnalysisResult } from '../base-analyzer';
import { AIIntegrationService } from '../ai-integration';
import { ContextExtractor } from '../../services/context-extractor';
import { schema } from '../../../db';

interface ConcursoKeywordConfig {
  enabled: boolean;
  priority?: number;
  timeout?: number;
  aiService?: AIIntegrationService | null;
  aiConfidenceThreshold?: number;
  hybridMode?: boolean; // Enable pattern+AI hybrid mode
  patternConfidenceThreshold?: number; // Threshold for pattern-only validation
}

interface KeywordMatch {
  keyword: string;
  position: number;
  context: string;
  confidence: number;
}

interface AIValidationResult {
  isValid: boolean;
  confidence: number;
  reasoning?: string;
}

export class ConcursoKeywordAnalyzer extends BaseAnalyzer {
  private aiService: AIIntegrationService | null;
  private aiConfidenceThreshold: number;
  private hybridMode: boolean;
  private patternConfidenceThreshold: number;

  constructor(config: ConcursoKeywordConfig) {
    super('concurso-keyword-detector', 'concurso', config);
    this.aiService = config.aiService || null;
    this.aiConfidenceThreshold = config.aiConfidenceThreshold || 0.85;
    this.hybridMode = config.hybridMode !== false; // Default true
    this.patternConfidenceThreshold = config.patternConfidenceThreshold || 0.7;
  }

  protected async performAnalysis(ocrResult: typeof schema.ocrResults.$inferSelect): Promise<Finding[]> {
    const text = ocrResult.extractedText || '';
    const lowerText = text.toLowerCase();

    // Phase 1: Check for high-confidence direct matches
    const directMatch = this.checkDirectMatch(lowerText);
    if (directMatch) {
      const matches = this.findAllMatches(text, directMatch.keywords);
      return [
        this.createFinding(
          'concurso:detection',
          {
            hasConcurso: true,
            confidence: directMatch.confidence,
            method: 'keyword',
            matchedTerms: matches.map(m => m.keyword),
            matchDetails: matches,
          },
          directMatch.confidence,
          matches[0]?.context
        ),
      ];
    }

    // Phase 2: Check for ambiguous terms
    const ambiguousMatch = this.checkAmbiguousTerms(lowerText);
    if (ambiguousMatch) {
      const matches = this.findAllMatches(text, ambiguousMatch.keywords);
      
      // Hybrid mode: Calculate pattern-based confidence first
      if (this.hybridMode) {
        const patternConfidence = this.calculatePatternConfidence(text, matches);
        const combinedConfidence = (ambiguousMatch.confidence + patternConfidence) / 2;
        
        // If pattern confidence is high enough, skip AI
        if (combinedConfidence >= this.patternConfidenceThreshold) {
          return [
            this.createFinding(
              'concurso:detection',
              {
                hasConcurso: true,
                confidence: combinedConfidence,
                method: 'hybrid-pattern',
                matchedTerms: ambiguousMatch.keywords,
                matchDetails: matches,
                keywordConfidence: ambiguousMatch.confidence,
                patternConfidence: patternConfidence,
                aiSkipped: true,
              },
              combinedConfidence,
              matches[0]?.context
            ),
          ];
        }
        
        // Pattern confidence low, use AI if available
        if (this.aiService) {
          const aiValidation = await this.validateConcurso(
            this.extractRelevantText(text, matches),
            ambiguousMatch.keywords
          );

          return [
            this.createFinding(
              'concurso:detection',
              {
                hasConcurso: aiValidation.isValid,
                confidence: aiValidation.confidence,
                method: aiValidation.isValid ? 'hybrid-ai-validated' : 'hybrid-ai-rejected',
                matchedTerms: ambiguousMatch.keywords,
                matchDetails: matches,
                aiReasoning: aiValidation.reasoning,
                keywordConfidence: ambiguousMatch.confidence,
                patternConfidence: patternConfidence,
              },
              aiValidation.confidence,
              matches[0]?.context
            ),
          ];
        }
      } else {
        // Legacy mode: use AI only based on threshold
        if (ambiguousMatch.confidence < this.aiConfidenceThreshold && this.aiService) {
          const aiValidation = await this.validateConcurso(
            this.extractRelevantText(text, matches),
            ambiguousMatch.keywords
          );

          return [
            this.createFinding(
              'concurso:detection',
              {
                hasConcurso: aiValidation.isValid,
                confidence: aiValidation.confidence,
                method: aiValidation.isValid ? 'ai-validated' : 'ai-rejected',
                matchedTerms: ambiguousMatch.keywords,
                matchDetails: matches,
                aiReasoning: aiValidation.reasoning,
                keywordConfidence: ambiguousMatch.confidence,
              },
              aiValidation.confidence,
              matches[0]?.context
            ),
          ];
        }
      }

      // Return ambiguous match without AI validation
      return [
        this.createFinding(
          'concurso:detection',
          {
            hasConcurso: true,
            confidence: ambiguousMatch.confidence,
            method: 'keyword',
            matchedTerms: ambiguousMatch.keywords,
            matchDetails: matches,
            note: 'Ambiguous match, consider manual verification',
          },
          ambiguousMatch.confidence,
          matches[0]?.context
        ),
      ];
    }

    // Phase 3: Check for contextual hints (very low confidence)
    const contextualHint = this.checkContextualHints(lowerText);
    if (contextualHint && this.aiService) {
      const matches = this.findAllMatches(text, contextualHint.keywords);
      
      // Always use AI for contextual hints
      const aiValidation = await this.validateConcurso(
        this.extractRelevantText(text, matches),
        contextualHint.keywords
      );

      if (aiValidation.isValid && aiValidation.confidence > 0.5) {
        return [
          this.createFinding(
            'concurso:detection',
            {
              hasConcurso: true,
              confidence: aiValidation.confidence,
              method: 'ai-validated',
              matchedTerms: contextualHint.keywords,
              matchDetails: matches,
              aiReasoning: aiValidation.reasoning,
              keywordConfidence: contextualHint.confidence,
            },
            aiValidation.confidence,
            matches[0]?.context
          ),
        ];
      }
    }

    // No concurso detected
    return [];
  }

  /**
   * Check for direct high-confidence matches
   */
  private checkDirectMatch(lowerText: string): { confidence: number; keywords: string[] } | null {
    const directTerms = [
      'concurso público',
      'concurso publico',
    ];

    for (const term of directTerms) {
      if (lowerText.includes(term)) {
        return {
          confidence: 0.95,
          keywords: [term],
        };
      }
    }

    return null;
  }

  /**
   * Check for ambiguous terms that might be concurso público
   */
  private checkAmbiguousTerms(lowerText: string): { confidence: number; keywords: string[] } | null {
    const ambiguousTerms = [
      { term: 'concurso', confidence: 0.6 },
      { term: 'seleção pública', confidence: 0.65 },
      { term: 'selecao publica', confidence: 0.65 },
      { term: 'processo seletivo', confidence: 0.55 },
      { term: 'seleção simplificada', confidence: 0.5 },
      { term: 'selecao simplificada', confidence: 0.5 },
      { term: 'processo seletivo simplificado', confidence: 0.5 },
    ];

    const matches: string[] = [];
    let maxConfidence = 0;

    for (const { term, confidence } of ambiguousTerms) {
      if (lowerText.includes(term)) {
        matches.push(term);
        maxConfidence = Math.max(maxConfidence, confidence);
      }
    }

    if (matches.length > 0) {
      // Boost confidence if multiple ambiguous terms found
      const finalConfidence = Math.min(0.8, maxConfidence + (matches.length - 1) * 0.05);
      return {
        confidence: finalConfidence,
        keywords: matches,
      };
    }

    return null;
  }

  /**
   * Check for contextual hints without explicit concurso mention
   */
  private checkContextualHints(lowerText: string): { confidence: number; keywords: string[] } | null {
    const contextualTerms = [
      'edital de abertura',
      'abertura de inscrições',
      'abertura de inscricoes',
      'inscrições abertas',
      'inscricoes abertas',
      'candidatos aprovados',
      'homologação do resultado',
      'homologacao do resultado',
    ];

    const matches: string[] = [];

    for (const term of contextualTerms) {
      if (lowerText.includes(term)) {
        matches.push(term);
      }
    }

    if (matches.length > 0) {
      return {
        confidence: 0.3,
        keywords: matches,
      };
    }

    return null;
  }

  /**
   * Calculate pattern-based confidence using supporting terms
   * Checks for co-occurrence of concurso-related terms to boost confidence
   */
  private calculatePatternConfidence(text: string, matches: KeywordMatch[]): number {
    const lowerText = text.toLowerCase();
    let confidence = 0;
    
    // Get context around matches (1000 chars before/after)
    const contextWindow = 1000;
    let relevantContext = '';
    
    for (const match of matches.slice(0, 3)) { // Check up to 3 matches
      const start = Math.max(0, match.position - contextWindow);
      const end = Math.min(text.length, match.position + contextWindow);
      relevantContext += ' ' + text.substring(start, end);
    }
    
    const contextLower = relevantContext.toLowerCase();
    
    // High-value supporting terms (strong indicators of concurso público)
    const strongSupport = [
      'vagas',
      'cargo',
      'cargos',
      'inscrições',
      'inscricoes',
      'candidatos',
      'servidor público',
      'servidor publico',
      'edital',
      'aprovados',
      'classificação',
      'classificacao',
      'homologação',
      'homologacao',
    ];
    
    // Medium-value supporting terms
    const mediumSupport = [
      'prova',
      'provas',
      'salário',
      'salario',
      'remuneração',
      'remuneracao',
      'requisitos',
      'escolaridade',
      'nível superior',
      'nivel superior',
      'ensino médio',
      'ensino medio',
    ];
    
    // Weak-value supporting terms
    const weakSupport = [
      'processo',
      'seleção',
      'selecao',
      'prazo',
      'data',
      'resultado',
    ];
    
    // Count matches for each category
    let strongCount = 0;
    let mediumCount = 0;
    let weakCount = 0;
    
    for (const term of strongSupport) {
      if (contextLower.includes(term)) strongCount++;
    }
    for (const term of mediumSupport) {
      if (contextLower.includes(term)) mediumCount++;
    }
    for (const term of weakSupport) {
      if (contextLower.includes(term)) weakCount++;
    }
    
    // Calculate weighted confidence
    // Strong terms: 0.15 each (cap at 0.6)
    // Medium terms: 0.08 each (cap at 0.3)
    // Weak terms: 0.03 each (cap at 0.1)
    confidence += Math.min(0.6, strongCount * 0.15);
    confidence += Math.min(0.3, mediumCount * 0.08);
    confidence += Math.min(0.1, weakCount * 0.03);
    
    // Negative indicators (should reduce confidence)
    const negativeIndicators = [
      'concurso cultural',
      'concurso de preços',
      'concurso de preco',
      'concurso fotográfico',
      'concurso fotografico',
      'concurso literário',
      'concurso literario',
      'concurso de beleza',
    ];
    
    for (const indicator of negativeIndicators) {
      if (contextLower.includes(indicator)) {
        confidence = Math.max(0, confidence - 0.4);
      }
    }
    
    return Math.min(1.0, confidence);
  }

  /**
   * Find all matches of given keywords in text
   */
  private findAllMatches(text: string, keywords: string[]): KeywordMatch[] {
    const lowerText = text.toLowerCase();
    const matches: KeywordMatch[] = [];

    for (const keyword of keywords) {
      const lowerKeyword = keyword.toLowerCase();
      let startIndex = 0;

      while (true) {
        const index = lowerText.indexOf(lowerKeyword, startIndex);
        if (index === -1) break;

        matches.push({
          keyword,
          position: index,
          context: this.extractContext(text, index, 200),
          confidence: 1.0,
        });

        startIndex = index + lowerKeyword.length;
      }
    }

    return matches.sort((a, b) => a.position - b.position);
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
   * Extract relevant text for AI validation (around matches)
   * Uses smart context extraction with keyword-density scoring
   */
  private extractRelevantText(text: string, matches: KeywordMatch[], maxLength: number = 2500): string {
    if (matches.length === 0) {
      // Return beginning of text
      return text.substring(0, maxLength);
    }

    // Use the first match position as a guide for extraction
    const firstMatch = matches[0];
    
    // Use ContextExtractor for smart extraction around the match
    return ContextExtractor.extractAroundPosition(
      text,
      firstMatch.position,
      Math.floor(maxLength / 2)
    ).substring(0, maxLength);
  }

  /**
   * Validate if text contains a "concurso público" announcement using AI
   */
  private async validateConcurso(text: string, matchedTerms: string[]): Promise<AIValidationResult> {
    if (!this.aiService) {
      return {
        isValid: false,
        confidence: 0.3,
        reasoning: 'AI service not available',
      };
    }

    try {
      const systemPrompt = 'You are an expert in analyzing Brazilian official gazette documents, specifically for identifying and classifying "concurso público" (public examination) announcements.';
      const userPrompt = this.buildValidationPrompt(text, matchedTerms);
      
      const response = await this.aiService.call({
        systemPrompt,
        userPrompt,
        temperature: 0.3,
      });

      return this.parseValidationResponse(response);
    } catch (error) {
      console.error('AI validation failed:', error);
      return {
        isValid: false,
        confidence: 0.3,
        reasoning: 'AI validation failed, falling back to keyword-only',
      };
    }
  }

  /**
   * Build prompt for concurso validation
   */
  private buildValidationPrompt(text: string, matchedTerms: string[]): string {
    // Truncate text if too long (keep first 3000 chars)
    const truncatedText = text.length > 3000 ? text.substring(0, 3000) + '...' : text;
    
    return `Analyze the following excerpt from a Brazilian official gazette and determine if it contains a "CONCURSO PÚBLICO" (public examination/competitive exam for public service positions) announcement.

Context: The text matched these potentially ambiguous terms: ${matchedTerms.join(', ')}

Text to analyze:
---
${truncatedText}
---

Respond in JSON format ONLY with this structure:
{
  "isValid": boolean,
  "confidence": number (0.0 to 1.0),
  "reasoning": "brief explanation"
}

A "concurso público" is a competitive examination for hiring public servants. It should NOT be confused with:
- "Concurso cultural" (cultural contests)
- "Concurso de preços" (price competition in procurement)
- "Processo seletivo simplificado" (simplified selection process, unless explicitly mentioned as concurso público)

Consider it a concurso público if:
- Explicitly mentions "concurso público"
- Discusses positions, vacancies ("vagas"), examination phases
- Mentions registration ("inscrições"), candidates ("candidatos"), public servants ("servidores")
- Contains official edital language about public hiring`;
  }

  /**
   * Parse AI validation response
   */
  private parseValidationResponse(response: string): AIValidationResult {
    try {
      // Try to extract JSON from response (sometimes AI adds extra text)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      
      return {
        isValid: Boolean(parsed.isValid),
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
        reasoning: parsed.reasoning || '',
      };
    } catch (error) {
      console.error('Failed to parse AI response:', error);
      return {
        isValid: false,
        confidence: 0.3,
        reasoning: 'Failed to parse AI response',
      };
    }
  }

  /**
   * Get metadata specific to keyword detection
   */
  protected getMetadata(findings: Finding[]): Record<string, any> {
    if (findings.length === 0) {
      return {
        ...super.getMetadata(findings),
        hasConcurso: false,
        detectionMethod: 'none',
        hybridModeEnabled: this.hybridMode,
      };
    }

    const finding = findings[0];
    const usedAI = finding.data.method?.includes('ai');
    const aiSkipped = finding.data.aiSkipped || false;
    
    return {
      ...super.getMetadata(findings),
      hasConcurso: finding.data.hasConcurso,
      detectionMethod: finding.data.method,
      matchedTermsCount: finding.data.matchedTerms?.length || 0,
      usedAI,
      aiSkipped,
      hybridModeEnabled: this.hybridMode,
      patternConfidence: finding.data.patternConfidence,
      keywordConfidence: finding.data.keywordConfidence,
      costOptimization: {
        aiCallsAvoided: aiSkipped ? 1 : 0,
        usedPatternOnly: finding.data.method === 'hybrid-pattern',
      },
    };
  }
}

