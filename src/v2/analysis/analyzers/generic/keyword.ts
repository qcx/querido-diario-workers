/**
 * Generic Keyword Detector - Detects general gazette keywords
 * Phase 1: Detection of general categories (licitação, contrato, etc.)
 */

import { BaseAnalyzer, Finding } from '../base-analyzer';
import { schema } from '../../../db';

interface GenericKeywordConfig {
  enabled: boolean;
  priority?: number;
  timeout?: number;
}

interface KeywordPattern {
  category: string;
  keywords: string[];
  caseSensitive: boolean;
  wholeWord: boolean;
  weight: number;
}

interface KeywordMatch {
  keyword: string;
  position: number;
  context: string;
  category: string;
  weight: number;
}

export class GenericKeywordAnalyzer extends BaseAnalyzer {
  private patterns: KeywordPattern[];

  constructor(config: GenericKeywordConfig) {
    super('generic-keyword-detector', 'generic', config);
    this.patterns = this.getGeneralPatterns();
  }

  protected async performAnalysis(ocrResult: typeof schema.ocrResults.$inferSelect): Promise<Finding[]> {
    const text = ocrResult.extractedText || '';
    const findings: Finding[] = [];

    // Find matches for each pattern
    for (const pattern of this.patterns) {
      const matches = this.findMatches(text, pattern);
      
      // Create findings for all matches
      for (const match of matches) {
        findings.push(
          this.createFinding(
            'generic:keyword',
            {
              category: match.category,
              keyword: match.keyword,
              position: match.position,
              weight: match.weight,
            },
            match.weight,
            match.context
          )
        );
      }
    }

    return findings;
  }

  /**
   * Find matches for a keyword pattern
   */
  private findMatches(text: string, pattern: KeywordPattern): KeywordMatch[] {
    const matches: KeywordMatch[] = [];
    const searchText = pattern.caseSensitive ? text : text.toLowerCase();

    for (const keyword of pattern.keywords) {
      const searchKeyword = pattern.caseSensitive ? keyword : keyword.toLowerCase();
      
      // Create regex based on wholeWord option
      const regex = pattern.wholeWord
        ? new RegExp(`\\b${this.escapeRegex(searchKeyword)}\\b`, 'g')
        : new RegExp(this.escapeRegex(searchKeyword), 'g');

      let match;
      while ((match = regex.exec(searchText)) !== null) {
        matches.push({
          keyword,
          position: match.index,
          context: this.extractContext(text, match.index, 300),
          category: pattern.category,
          weight: pattern.weight,
        });
      }
    }

    return matches;
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
   * Get general patterns for Brazilian gazettes
   */
  private getGeneralPatterns(): KeywordPattern[] {
    return [
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
      totalMatches: findings.length,
    };
  }
}
