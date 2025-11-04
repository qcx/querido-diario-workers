/**
 * Concurso Validator - Uses AI to validate ambiguous concurso keywords
 * Determines if ambiguous terms like "concurso" or "processo seletivo" 
 * actually refer to public service competitions (concursos públicos)
 * When validated, triggers ConcursoAnalyzer to extract structured data
 */

import { BaseAnalyzer } from './base-analyzer';
import { ConcursoAnalyzer, ConcursoAnalyzerConfig } from './concurso-analyzer';
import { OcrResult, Finding, AnalyzerConfig } from '../types';
import { logger } from '../utils';
import { ProximityAnalyzer } from './utils/proximity-analyzer';

export interface ConcursoValidatorConfig extends AnalyzerConfig {
  apiKey: string;
  model?: string;
  useAIExtraction?: boolean; // For ConcursoAnalyzer
}

export class ConcursoValidator extends BaseAnalyzer {
  private apiKey: string;
  private model: string;
  private concursoAnalyzer: ConcursoAnalyzer;

  constructor(config: ConcursoValidatorConfig) {
    super('concurso-validator', 'ai', config);
    
    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-4o-mini';
    
    // Initialize ConcursoAnalyzer for extracting structured data from validated sections
    const analyzerConfig: ConcursoAnalyzerConfig = {
      enabled: true,
      useAIExtraction: config.useAIExtraction,
      apiKey: config.apiKey,
      model: config.model,
    };
    this.concursoAnalyzer = new ConcursoAnalyzer(analyzerConfig);
    
    logger.info('ConcursoValidator initialized with ConcursoAnalyzer for data extraction');
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
          // Add validation finding (for tracking and metadata)
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
              validated: isValidConcurso.isValid
            },
          });

          // Now trigger ConcursoAnalyzer to extract structured data
          // This will create a 'concurso' type finding that gets stored in the database
          logger.info('Triggering ConcursoAnalyzer for validated section', {
            keyword: section.keyword,
            confidence: isValidConcurso.confidence,
          });

          try {
            const concursoFinding = await this.concursoAnalyzer.analyzeTextSection(
              section.context,
              {
                keyword: section.keyword,
                validationReason: isValidConcurso.reason,
                validationConfidence: isValidConcurso.confidence,
              }
            );

            if (concursoFinding) {
              findings.push(concursoFinding);
              logger.info('Successfully created concurso finding from validated section', {
                keyword: section.keyword,
                documentType: concursoFinding.data.documentType,
                confidence: concursoFinding.confidence,
              });
            } else {
              logger.warn('ConcursoAnalyzer could not extract structured data from validated section', {
                keyword: section.keyword,
              });
            }
          } catch (error) {
            logger.error('Failed to extract concurso data from validated section', error as Error, {
              keyword: section.keyword,
            });
          }
        }
      } catch (error) {
        logger.error('Failed to validate concurso section', error as Error);
      }
    }

    return findings;
  }

  /**
   * Extract text sections containing ambiguous concurso keywords
   * Enhanced version with document structure awareness for large PDFs
   */
  private extractAmbiguousSections(text: string): Array<{
    keyword: string;
    context: string;
    position: number;
    sectionBoundaries?: { start: number; end: number };
  }> {
    const sections: Array<{ 
      keyword: string; 
      context: string; 
      position: number;
      sectionBoundaries?: { start: number; end: number };
    }> = [];
    
    const ambiguousKeywords = [
      'concurso',
      'processo seletivo',
      'seleção pública',
      'seleção simplificada',
      'processo seletivo simplificado',
    ];

    // Extract document structure for better context boundaries
    const structure = ProximityAnalyzer.extractDocumentStructure(text);
    
    // Split text into lines for processing
    const lines = text.split('\n');
    
    // Build a map of line positions to help with context extraction
    const linePositions: number[] = [];
    let currentPos = 0;
    for (const line of lines) {
      linePositions.push(currentPos);
      currentPos += line.length + 1; // +1 for newline
    }
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineLower = line.toLowerCase();
      
      // Skip if line contains "concurso público" (already handled by main analyzer)
      if (lineLower.includes('concurso público') || lineLower.includes('concurso publico')) {
        continue;
      }
      
      for (const keyword of ambiguousKeywords) {
        if (lineLower.includes(keyword)) {
          // Find the section this line belongs to using document structure
          const sectionBoundaries = this.findSectionBoundaries(
            linePositions[i],
            structure,
            text
          );
          
          // Extract context with adaptive sizing
          const context = this.extractAdaptiveContext(
            text,
            i,
            lines,
            linePositions,
            sectionBoundaries
          );
          
          sections.push({
            keyword,
            context,
            position: i,
            sectionBoundaries,
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
    // Enhanced prompt with specific criteria
    const prompt = `Analyze the following text excerpt from a Brazilian official gazette (diário oficial) to determine if the term "${section.keyword}" refers to a formal public service competition (concurso público) or a temporary/simplified selection process (processo seletivo).

Context:
${section.context}

IMPORTANT DISTINCTION:
- "Concurso Público" = Formal competition for permanent public servant positions (cargos efetivos). Requires formal edital, standardized tests, public notice, permanent positions.
- "Processo Seletivo" = Simplified selection process, often for temporary positions, substitutions, or specific short-term needs. Can be for temporary contracts (contratos temporários), substitutions (substituições), or specific projects.

Consider these indicators:

FOR CONCURSO PÚBLICO (formal, permanent):
✓ Mentions "concurso público" explicitly
✓ Permanent positions (cargos efetivos)
✓ References to Lei 8.112/1990 or similar public service laws
✓ Mentions of formal edital with numbered reference
✓ Indicates standardized tests (provas objetivas, dissertativas)
✓ References to public notice requirements
✓ Mentions of permanent hiring (nomeação em cargos efetivos)
✓ Long-term positions with career progression

FOR PROCESSO SELETIVO (temporary/simplified):
✗ Temporary positions (substituição, contrato temporário)
✗ Short-term assignments (e.g., "30 dias", "período determinado")
✗ Mentions "gratificação" or temporary payment
✗ Simplified selection (análise de documentos e entrevistas)
✗ No formal edital structure
✗ References to "cadastro reserva" for temporary needs
✗ Specific replacement scenarios (e.g., "férias", "licença")

INDICATORS TO IGNORE (not about hiring):
- Contests, competitions, awards
- Cultural events
- Academic competitions
- Sports events

Respond in JSON format:
{
  "isPublicServiceCompetition": true/false,
  "isProcessoSeletivo": true/false,
  "isConcursoPublico": true/false,
  "confidence": 0.0-1.0,
  "reason": "Brief explanation of why this is/isn't a concurso público",
  "indicators": ["list", "of", "key", "indicators", "found"],
  "temporaryIndicators": ["any", "temporary", "indicators", "found"]
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
              content: 'You are an expert in Brazilian public administration and legal documents. You must distinguish between formal public service competitions (concursos públicos) and temporary/simplified selection processes (processos seletivos).',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.1,
          max_tokens: 300, // Increased for more detailed responses
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
      
      // Only validate as concurso público if explicitly marked as such
      // Reject if it's a processo seletivo
      const isValid = analysis.isConcursoPublico === true && 
                      analysis.isProcessoSeletivo !== true;
      
      return {
        isValid,
        confidence: analysis.confidence || 0.5,
        reason: analysis.reason || 'No reason provided',
        usage,
      };
    } catch (error) {
      logger.error('AI validation failed', error as Error);
      // Default to false on error to avoid false positives
      return { isValid: false, confidence: 0, reason: 'Validation error' };
    }
  }

  /**
   * Find section boundaries for a given position
   */
  private findSectionBoundaries(
    position: number,
    structure: { titles: Array<{ text: string; position: number; confidence: number }>; sections: Array<{ text: string; position: number; level: number }> },
    text: string
  ): { start: number; end: number } {
    // Find the nearest title before this position
    let startPos = 0;
    let endPos = text.length;
    
    // Find the title that comes before this position
    for (let i = structure.titles.length - 1; i >= 0; i--) {
      const title = structure.titles[i];
      if (title.position < position) {
        startPos = title.position;
        // Look for the next title after this one
        if (i + 1 < structure.titles.length) {
          endPos = structure.titles[i + 1].position;
        }
        break;
      }
    }
    
    // Also check for section markers (numbered sections)
    for (let i = structure.sections.length - 1; i >= 0; i--) {
      const section = structure.sections[i];
      if (section.position < position && section.position > startPos) {
        startPos = section.position;
      }
    }
    
    // Look for common section delimiters in gazettes
    // Patterns like "COMUNICADO DA", "EDITAL DE", "PORTARIA Nº"
    const sectionStartPattern = /(?:^|\n)(?:COMUNICADO|EDITAL|PORTARIA|RESOLUÇÃO|DECRETO|LEI)[^\n]{0,200}\n/gi;
    const matches = Array.from(text.matchAll(sectionStartPattern));
    
    for (const match of matches) {
      if (match.index !== undefined && match.index < position && match.index > startPos) {
        startPos = match.index;
      }
      if (match.index !== undefined && match.index > position && match.index < endPos) {
        endPos = match.index;
        break;
      }
    }
    
    return { start: startPos, end: endPos };
  }

  /**
   * Extract adaptive context around a keyword
   * Uses section boundaries when available, falls back to line-based context
   */
  private extractAdaptiveContext(
    text: string,
    lineIndex: number,
    lines: string[],
    linePositions: number[],
    sectionBoundaries?: { start: number; end: number }
  ): string {
    // If we have section boundaries, use them (preferred for large PDFs)
    if (sectionBoundaries) {
      const sectionText = text.substring(
        sectionBoundaries.start,
        sectionBoundaries.end
      );
      
      // Limit section text to reasonable size (max 8000 chars for AI processing)
      if (sectionText.length <= 8000) {
        return sectionText;
      }
      
      // If section is too large, extract around the keyword position
      const keywordPos = linePositions[lineIndex];
      const contextStart = Math.max(
        sectionBoundaries.start,
        keywordPos - 4000
      );
      const contextEnd = Math.min(
        sectionBoundaries.end,
        keywordPos + 4000
      );
      
      return text.substring(contextStart, contextEnd);
    }
    
    // Fallback: use adaptive line-based context
    // Use more lines for better context (10 lines before/after instead of 3)
    const contextLines = 10;
    const contextStart = Math.max(0, lineIndex - contextLines);
    const contextEnd = Math.min(lines.length - 1, lineIndex + contextLines);
    
    // But limit total size to ~8000 characters
    let context = lines.slice(contextStart, contextEnd + 1).join('\n');
    
    if (context.length > 8000) {
      // If still too large, extract around the keyword line
      const keywordLineStart = linePositions[lineIndex];
      const contextStart = Math.max(0, keywordLineStart - 4000);
      const contextEnd = Math.min(text.length, keywordLineStart + 4000);
      context = text.substring(contextStart, contextEnd);
    }
    
    return context;
  }

  protected getMetadata(findings: Finding[]): Record<string, any> {
    const validatedFindings = findings.filter(f => f.type === 'concurso_validated');
    const extractedFindings = findings.filter(f => f.type === 'concurso');
    
    return {
      validatedSections: validatedFindings.length,
      confirmedConcursos: validatedFindings.filter(f => f.confidence >= 0.7).length,
      extractedConcursos: extractedFindings.length,
      totalFindings: findings.length,
    };
  }
}
