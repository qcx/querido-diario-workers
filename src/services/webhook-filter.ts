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
  static async matches(
    analysis: GazetteAnalysis, 
    filters: WebhookFilters, 
    concursoRepo?: any
  ): Promise<boolean> {
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

    // Minimum confidence filter - check only relevant category findings
    if (filters.minConfidence !== undefined && filters.categories && filters.categories.length > 0) {
      // Get all findings from analysis
      const allFindings: Finding[] = analysis.analyses.flatMap(a => a.findings);
      
      // Filter findings by category (similar to extractFindings but without confidence filter)
      const categoryFindings = allFindings.filter(finding => {
        const findingCategory = finding.data.category || finding.type.split(':')[1];
        return filters.categories!.includes(findingCategory);
      });
      
      if (categoryFindings.length === 0) {
        logger.debug('No findings found for target categories', {
          filterCategories: filters.categories,
          totalFindings: allFindings.length,
        });
        return false;
      }
      
      // Calculate confidence ratio based on category-specific findings only
      const highConfidenceCount = categoryFindings.filter(f => f.confidence >= (filters.minConfidence ?? 0)).length;
      const categoryConfidenceRatio = highConfidenceCount / categoryFindings.length;
      
      if (categoryConfidenceRatio < 0.5) { // At least 50% of category findings should meet confidence
        logger.debug('Category findings do not meet minimum confidence', {
          categoryFindings: categoryFindings.length,
          highConfidenceCount,
          categoryConfidenceRatio,
          minConfidence: filters.minConfidence,
        });
        return false;
      }
      
      logger.debug('Category confidence check passed', {
        categoryFindings: categoryFindings.length,
        highConfidenceCount,
        categoryConfidenceRatio,
        minConfidence: filters.minConfidence,
      });
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

    // Concurso finding requirement filter - check database records with retry logic
    if (filters.requireConcursoFinding && concursoRepo) {
      const maxRetries = 3; // Default retry count
      const timeoutMs = 5000; // Default timeout (5 seconds)
      const strictMode = false; // Default to graceful degradation

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // Add timeout to database query
          const queryPromise = concursoRepo.getConcursoFindingsByAnalysisJobId(analysis.jobId);
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Database query timeout')), timeoutMs)
          );
          
          const concursoFindings = await Promise.race([queryPromise, timeoutPromise]);
          
          if (!concursoFindings || concursoFindings.length === 0) {
            logger.debug('Analysis does not have concurso_findings records in database', {
              analysisJobId: analysis.jobId,
              attempt,
            });
            return false;
          }
          
          logger.debug('Analysis has concurso_findings records in database', {
            analysisJobId: analysis.jobId,
            concursoFindingsCount: concursoFindings.length,
            attempt,
          });
          
          // Success - records found
          break;
        } catch (error) {
          
          if (attempt === maxRetries) {
            logger.error('Failed to check concurso findings in database after all retries', error as Error, {
              analysisJobId: analysis.jobId,
              attempts: maxRetries,
              timeoutMs,
            });
            
            // Handle database check failure based on strict mode
            if (strictMode) {
              logger.error('Blocking webhook due to database check failure (strict mode)', {
                analysisJobId: analysis.jobId,
                reason: 'strict_mode_enabled',
              });
              return false;
            } else {
              // Graceful degradation - allow webhook to proceed
              logger.warn('Allowing webhook to proceed due to database check failure (graceful degradation)', {
                analysisJobId: analysis.jobId,
                reason: 'graceful_degradation',
                strictMode: false,
              });
            }
          } else {
            logger.warn('Retrying concurso findings database check', {
              analysisJobId: analysis.jobId,
              attempt,
              maxRetries,
              error: (error as Error).message,
            });
            
            // Wait before retry (exponential backoff)
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 3000);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
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
      categories: [
        'concurso_publico',
        'concurso_publico_abertura',
        'concurso_publico_convocacao',
        'concurso_publico_homologacao',
        'concurso_publico_retificacao',
        'concurso_publico_prorrogacao',
        'concurso_publico_cancelamento',
        'concurso_publico_resultado',
      ],
      keywords: [
        'concurso público',
        'concurso',
        'edital de concurso',
        'edital de abertura',
        'seleção pública',
        'processo seletivo',
        'inscrições abertas',
        'vagas',
        'candidatos aprovados',
        'convocação',
        'homologação',
        'retificação',
        'prorrogação',
        'cancelamento',
        'resultado',
        'gabarito',
      ],
      minConfidence,
      minFindings: 1,
      territoryIds: territories,
      requireConcursoFinding: true,
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
