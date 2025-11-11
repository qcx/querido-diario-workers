import { BaseAnalyzerV2 } from './base-analyzer-v2';
import { OcrResult, Finding } from '../../types';

export class ConcursoKeywordsAnalyzerV2 extends BaseAnalyzerV2 {
  constructor() {
    super('concurso-keywords', 'concurso-keywords', { enabled: true });
  }

  protected async performAnalysis(ocrResult: OcrResult): Promise<Finding[]> {
    const text = ocrResult.extractedText || '';
    
    if (!text) {
      return [];
    }

    // Find both types of keywords
    const concursoFindings = this.findConcursoPublico(ocrResult);
    const ambiguousFindings = this.findAmbiguousConcurso(ocrResult);

    // Combine and return all findings
    return [...concursoFindings, ...ambiguousFindings];
  }

  /**
   * Find "concurso público" and "concursos públicos" matches
   */
  private findConcursoPublico(ocrResult: OcrResult): Finding[] {
    const findings: Finding[] = [];
    const text = ocrResult.extractedText || '';
    
    if (!text) {
      return findings;
    }

    // Match "concurso público" or "concursos públicos" (with accent variations)
    const regex = /concursos?\s+p[uú]blicos?/gi;
    
    let match;
    while ((match = regex.exec(text)) !== null) {
      const context = this.extractContext(text, match.index, 300);
      
      findings.push(
        this.createFinding(
          'keyword:concurso_publico',
          {
            category: 'concurso_publico',
            keyword: match[0],
            position: match.index,
            weight: 1.0,
          },
          1.0,
          context
        )
      );
    }

    return findings;
  }

  /**
   * Find ambiguous concurso-related keywords that may or may not be public contests
   * Includes: processo seletivo, processo de escolha, seleção pública, seleção simplificada,
   * processo seletivo simplificado, processo de seleção, and isolated "concurso/concursos"
   */
  private findAmbiguousConcurso(ocrResult: OcrResult): Finding[] {
    const findings: Finding[] = [];
    const text = ocrResult.extractedText || '';
    
    if (!text) {
      return findings;
    }

    // Define all regex patterns
    const patterns = [
      // Match "processo seletivo", "processos seletivos", "processo de escolha"
      /processos?\s+(seletivos?|de\s+escolha)/gi,
      
      // Match "processo seletivo simplificado", "processos seletivos simplificados"
      /processos?\s+seletivos?\s+simplificados?/gi,
      
      // Match "processo de seleção", "processos de seleção"
      /processos?\s+de\s+sele[cç][aã]o/gi,
      
      // Match "seleção pública", "seleções públicas"
      /sele[cç][oõ]es?\s+p[uú]blicas?/gi,
      
      // Match "seleção simplificada", "seleções simplificadas"
      /sele[cç][oõ]es?\s+simplificadas?/gi,
      
      // Match isolated "concurso" or "concursos" (NOT followed by "público/publico")
      /\bconcursos?(?!\s+p[uú]blicos?)\b/gi,
    ];

    // Execute all patterns and collect findings
    for (const regex of patterns) {
      let match;
      while ((match = regex.exec(text)) !== null) {
        const context = this.extractContext(text, match.index, 300);
        
        findings.push(
          this.createFinding(
            'keyword:concurso_ambiguous',
            {
              category: 'concurso_ambiguous',
              keyword: match[0],
              position: match.index,
              weight: 1.0,
            },
            1.0,
            context
          )
        );
      }
    }

    return findings;
  }

  /**
   * Extract context around a match
   */
  private extractContext(text: string, position: number, contextLength: number = 300): string {
    const start = Math.max(0, position - contextLength);
    const end = Math.min(text.length, position + contextLength);
    
    let context = text.substring(start, end);
    
    if (start > 0) context = '...' + context;
    if (end < text.length) context = context + '...';
    
    return context.trim();
  }
}