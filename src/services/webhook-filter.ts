/**
 * Webhook Filter Service
 * Filters analysis results based on webhook subscription criteria
 */

import { GazetteAnalysis, Finding } from '../types/analysis';
import { WebhookFilters, WebhookFinding } from '../types/webhook';
import { logger } from '../utils';

export class WebhookFilterService {
  /**
   * Check if analysis matches webhook filters
   */
  static matches(analysis: GazetteAnalysis, filters: WebhookFilters): boolean {
    // Category filter
    if (filters.categories && filters.categories.length > 0) {
      const hasMatchingCategory = analysis.summary.categories.some(cat =>
        filters.categories!.includes(cat)
      );
      if (!hasMatchingCategory) {
        logger.debug('Analysis does not match category filter', {
          analysisCategories: analysis.summary.categories,
          filterCategories: filters.categories,
        });
        return false;
      }
    }

    // Keyword filter
    if (filters.keywords && filters.keywords.length > 0) {
      const hasMatchingKeyword = analysis.summary.keywords.some(kw =>
        filters.keywords!.some(filterKw =>
          kw.toLowerCase().includes(filterKw.toLowerCase())
        )
      );
      if (!hasMatchingKeyword) {
        logger.debug('Analysis does not match keyword filter', {
          analysisKeywords: analysis.summary.keywords,
          filterKeywords: filters.keywords,
        });
        return false;
      }
    }

    // Minimum confidence filter
    if (filters.minConfidence !== undefined) {
      const highConfidenceRatio = analysis.summary.highConfidenceFindings / analysis.summary.totalFindings;
      if (highConfidenceRatio < filters.minConfidence) {
        logger.debug('Analysis does not meet minimum confidence', {
          highConfidenceRatio,
          minConfidence: filters.minConfidence,
        });
        return false;
      }
    }

    // Minimum findings filter
    if (filters.minFindings !== undefined) {
      if (analysis.summary.totalFindings < filters.minFindings) {
        logger.debug('Analysis does not meet minimum findings', {
          totalFindings: analysis.summary.totalFindings,
          minFindings: filters.minFindings,
        });
        return false;
      }
    }

    // Territory filter
    if (filters.territoryIds && filters.territoryIds.length > 0) {
      if (!filters.territoryIds.includes(analysis.territoryId)) {
        logger.debug('Analysis does not match territory filter', {
          territoryId: analysis.territoryId,
          filterTerritories: filters.territoryIds,
        });
        return false;
      }
    }

    // Spider filter
    if (filters.spiderIds && filters.spiderIds.length > 0) {
      const spiderId = analysis.metadata?.spiderId;
      if (!spiderId || !filters.spiderIds.includes(spiderId)) {
        logger.debug('Analysis does not match spider filter', {
          spiderId,
          filterSpiders: filters.spiderIds,
        });
        return false;
      }
    }

    return true;
  }

  /**
   * Extract relevant findings based on filters
   */
  static extractFindings(
    analysis: GazetteAnalysis,
    filters: WebhookFilters
  ): WebhookFinding[] {
    const allFindings: Finding[] = analysis.analyses.flatMap(a => a.findings);
    const filtered: WebhookFinding[] = [];

    for (const finding of allFindings) {
      // Category filter
      if (filters.categories && filters.categories.length > 0) {
        const findingCategory = finding.data.category || finding.type.split(':')[1];
        if (!filters.categories.includes(findingCategory)) {
          continue;
        }
      }

      // Keyword filter
      if (filters.keywords && filters.keywords.length > 0) {
        const keyword = finding.data.keyword?.toLowerCase() || '';
        const hasMatchingKeyword = filters.keywords.some(filterKw =>
          keyword.includes(filterKw.toLowerCase())
        );
        if (!hasMatchingKeyword) {
          continue;
        }
      }

      // Confidence filter
      if (filters.minConfidence !== undefined) {
        if (finding.confidence < filters.minConfidence) {
          continue;
        }
      }

      // Convert to webhook finding
      filtered.push({
        type: finding.type,
        confidence: finding.confidence,
        data: finding.data,
        context: finding.context,
        position: finding.data.position,
      });
    }

    return filtered;
  }

  /**
   * Create Qconcursos-specific filter
   */
  static createQconcursosFilter(
    minConfidence: number = 0.7,
    territories?: string[]
  ): WebhookFilters {
    return {
      categories: ['concurso_publico'],
      keywords: [
        'concurso público',
        'concurso',
        'edital de concurso',
        'seleção pública',
        'processo seletivo',
        'inscrições abertas',
        'vagas',
        'candidatos aprovados',
      ],
      minConfidence,
      minFindings: 1,
      territoryIds: territories,
    };
  }

  /**
   * Create Qlicitacao-specific filter
   */
  static createQlicitacaoFilter(
    minConfidence: number = 0.7,
    territories?: string[]
  ): WebhookFilters {
    return {
      categories: ['licitacao'],
      keywords: [
        'licitação',
        'pregão',
        'tomada de preços',
        'dispensa de licitação',
        'inexigibilidade',
        'edital de licitação',
      ],
      minConfidence,
      minFindings: 1,
      territoryIds: territories,
    };
  }

  /**
   * Create custom filter for any category
   */
  static createCustomFilter(
    categories: string[],
    keywords: string[],
    minConfidence: number = 0.7,
    territories?: string[]
  ): WebhookFilters {
    return {
      categories,
      keywords,
      minConfidence,
      minFindings: 1,
      territoryIds: territories,
    };
  }
}
