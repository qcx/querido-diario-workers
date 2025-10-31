/**
 * Concurso Validator - Uses AI to validate ambiguous concurso keywords
 * Determines if ambiguous terms like "concurso" or "processo seletivo" 
 * actually refer to public service competitions (concursos públicos)
 */

import { BaseAnalyzer } from './base-analyzer';
import { OcrResult, Finding, AnalyzerConfig } from '../types';
import { logger } from '../utils';

export interface ConcursoValidatorConfig extends AnalyzerConfig {
  apiKey: string;
  model?: string;
}

export class ConcursoValidator extends BaseAnalyzer {
  private apiKey: string;
  private model: string;

  constructor(config: ConcursoValidatorConfig) {
    super('concurso-validator', 'ai', config);
    
    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-4o-mini';
  }

  protected async performAnalysis(ocrResult: OcrResult): Promise<Finding[]> {
    const text = ocrResult.extractedText || '';
    const findings: Finding[] = [];

    // Extract sections with ambiguous keywords for validation
    const sectionsToValidate = this.extractAmbiguousSections(text);

    if (sectionsToValidate.length === 0) {
      return findings;
    }

    logger.info(`Validating ${sectionsToValidate.length} ambiguous concurso sections`);

    for (const section of sectionsToValidate) {
      try {
        const isValidConcurso = await this.validateSection(section);
        
        if (isValidConcurso.isValid) {
          findings.push({
            type: 'concurso_validated',
            confidence: isValidConcurso.confidence,
            data: {
              category: 'concurso_publico',
              keyword: section.keyword,
              context: section.context,
              validationReason: isValidConcurso.reason,
              position: section.position,
              aiUsage: isValidConcurso.usage,
            },
          });
        }
      } catch (error) {
        logger.error('Failed to validate concurso section', error as Error);
      }
    }

    return findings;
  }

  /**
   * Extract text sections containing ambiguous concurso keywords
   */
  private extractAmbiguousSections(text: string): Array<{
    keyword: string;
    context: string;
    position: number;
  }> {
    const sections: Array<{ keyword: string; context: string; position: number }> = [];
    const ambiguousKeywords = [
      'concurso',
      'processo seletivo',
      'seleção pública',
      'seleção simplificada',
      'processo seletivo simplificado',
    ];

    const lines = text.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineLower = line.toLowerCase();
      
      // Skip if line contains "concurso público" (already handled by main analyzer)
      if (lineLower.includes('concurso público') || lineLower.includes('concurso publico')) {
        continue;
      }
      
      for (const keyword of ambiguousKeywords) {
        if (lineLower.includes(keyword)) {
          // Extract context (3 lines before and after)
          const contextStart = Math.max(0, i - 3);
          const contextEnd = Math.min(lines.length - 1, i + 3);
          const context = lines.slice(contextStart, contextEnd + 1).join('\n');
          
          sections.push({
            keyword,
            context,
            position: i,
          });
          break; // Only one keyword per line
        }
      }
    }

    return sections;
  }

  /**
   * Validate if a section actually refers to a public service competition
   */
  private async validateSection(section: {
    keyword: string;
    context: string;
    position: number;
  }): Promise<{ isValid: boolean; confidence: number; reason: string; usage?: any }> {
    const prompt = `Analyze the following text excerpt from a Brazilian official gazette (diário oficial) to determine if the term "${section.keyword}" refers to a public service competition (concurso público) or something else.

Context:
${section.context}

Consider:
1. Is this about hiring public servants (servidores públicos)?
2. Is it a formal government selection process?
3. Are there mentions of positions (cargos), salaries, or requirements?
4. Or is it about contests, competitions, awards, or other non-employment uses?

Respond in JSON format:
{
  "isPublicServiceCompetition": true/false,
  "confidence": 0.0-1.0,
  "reason": "Brief explanation",
  "indicators": ["list", "of", "key", "indicators"]
}`;

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: 'You are an expert in Brazilian public administration and legal documents. Analyze text to determine if references to competitions are about public service hiring.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.1,
          max_tokens: 200,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }

      const result = await response.json() as any;
      const content = result.choices?.[0]?.message?.content;
      const usage = result.usage;

      if (!content) {
        throw new Error('No content in OpenAI response');
      }

      const analysis = JSON.parse(content);
      
      return {
        isValid: analysis.isPublicServiceCompetition === true,
        confidence: analysis.confidence || 0.5,
        reason: analysis.reason || 'No reason provided',
        usage, // Include token usage for cost tracking
      };
    } catch (error) {
      logger.error('AI validation failed', error as Error);
      // Default to false on error to avoid false positives
      return { isValid: false, confidence: 0, reason: 'Validation error' };
    }
  }

  protected getMetadata(findings: Finding[]): Record<string, any> {
    return {
      validatedSections: findings.length,
      confirmedConcursos: findings.filter(f => f.confidence >= 0.7).length,
    };
  }
}
