/**
 * Keyword Analyzer - Searches for specific keywords and patterns
 */

import { BaseAnalyzer } from './base-analyzer';
import { OcrResult, Finding, KeywordPattern, AnalyzerConfig } from '../types';

export class KeywordAnalyzer extends BaseAnalyzer {
  private patterns: KeywordPattern[];

  constructor(config: AnalyzerConfig & { patterns?: KeywordPattern[] } = { enabled: true }) {
    super('keyword-analyzer', 'keyword', config);
    
    // Default patterns for Brazilian official gazettes
    this.patterns = config.patterns || this.getDefaultPatterns();
  }

  protected async performAnalysis(ocrResult: OcrResult): Promise<Finding[]> {
    const findings: Finding[] = [];
    const text = ocrResult.extractedText || '';

    for (const pattern of this.patterns) {
      const matches = this.findMatches(text, pattern);
      findings.push(...matches);
    }

    return findings;
  }

  /**
   * Find matches for a keyword pattern
   */
  private findMatches(text: string, pattern: KeywordPattern): Finding[] {
    const findings: Finding[] = [];
    const searchText = pattern.caseSensitive ? text : text.toLowerCase();

    for (const keyword of pattern.keywords) {
      const searchKeyword = pattern.caseSensitive ? keyword : keyword.toLowerCase();
      
      // Create regex based on wholeWord option
      const regex = pattern.wholeWord
        ? new RegExp(`\\b${this.escapeRegex(searchKeyword)}\\b`, 'g')
        : new RegExp(this.escapeRegex(searchKeyword), 'g');

      let match;
      while ((match = regex.exec(searchText)) !== null) {
        const context = this.extractContext(text, match.index, 100);
        
        findings.push(
          this.createFinding(
            `keyword:${pattern.category}`,
            {
              category: pattern.category,
              keyword,
              position: match.index,
              weight: pattern.weight || 1.0,
            },
            pattern.weight || 1.0,
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
  private extractContext(text: string, position: number, contextLength: number): string {
    const start = Math.max(0, position - contextLength);
    const end = Math.min(text.length, position + contextLength);
    
    let context = text.substring(start, end);
    
    if (start > 0) context = '...' + context;
    if (end < text.length) context = context + '...';
    
    return context.trim();
  }

  /**
   * Escape regex special characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Get metadata with category breakdown
   */
  protected getMetadata(findings: Finding[]): Record<string, any> {
    const byCategory: Record<string, number> = {};
    
    for (const finding of findings) {
      const category = finding.data.category as string;
      byCategory[category] = (byCategory[category] || 0) + 1;
    }

    return {
      ...super.getMetadata(findings),
      categoryCounts: byCategory,
      uniqueCategories: Object.keys(byCategory),
    };
  }

  /**
   * Default keyword patterns for Brazilian gazettes
   */
  private getDefaultPatterns(): KeywordPattern[] {
    return [
      // Concursos Públicos
      {
        category: 'concurso_publico',
        keywords: [
          'concurso público',
          'concurso',
          'edital de concurso',
          'seleção pública',
          'processo seletivo',
          'inscrições abertas',
        ],
        caseSensitive: false,
        wholeWord: false,
        weight: 0.9,
      },
      
      // Licitações
      {
        category: 'licitacao',
        keywords: [
          'licitação',
          'pregão',
          'tomada de preços',
          'concorrência pública',
          'dispensa de licitação',
          'inexigibilidade',
          'chamamento público',
        ],
        caseSensitive: false,
        wholeWord: false,
        weight: 0.85,
      },
      
      // Contratos
      {
        category: 'contrato',
        keywords: [
          'contrato',
          'termo de contrato',
          'aditivo contratual',
          'rescisão contratual',
          'prorrogação de contrato',
        ],
        caseSensitive: false,
        wholeWord: false,
        weight: 0.8,
      },
      
      // Nomeações e Exonerações
      {
        category: 'nomeacao_exoneracao',
        keywords: [
          'nomear',
          'nomeação',
          'exonerar',
          'exoneração',
          'designar',
          'designação',
          'demitir',
          'demissão',
        ],
        caseSensitive: false,
        wholeWord: false,
        weight: 0.75,
      },
      
      // Decretos e Leis
      {
        category: 'legislacao',
        keywords: [
          'decreto',
          'lei municipal',
          'lei complementar',
          'portaria',
          'resolução',
          'instrução normativa',
        ],
        caseSensitive: false,
        wholeWord: false,
        weight: 0.7,
      },
      
      // Orçamento e Finanças
      {
        category: 'orcamento_financas',
        keywords: [
          'orçamento',
          'crédito adicional',
          'suplementação orçamentária',
          'dotação orçamentária',
          'empenho',
          'liquidação',
          'pagamento',
        ],
        caseSensitive: false,
        wholeWord: false,
        weight: 0.65,
      },
      
      // Convênios e Parcerias
      {
        category: 'convenio_parceria',
        keywords: [
          'convênio',
          'termo de cooperação',
          'parceria',
          'acordo de cooperação',
          'termo de fomento',
        ],
        caseSensitive: false,
        wholeWord: false,
        weight: 0.6,
      },
    ];
  }

  /**
   * Add custom pattern
   */
  addPattern(pattern: KeywordPattern): void {
    this.patterns.push(pattern);
  }

  /**
   * Get all patterns
   */
  getPatterns(): KeywordPattern[] {
    return [...this.patterns];
  }
}
