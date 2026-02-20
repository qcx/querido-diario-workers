/**
 * Concurso Category Analyzer
 * Categorizes concurso findings by document type (e.g., edital de abertura)
 */

import { BaseAnalyzerV2 } from './base-analyzer-v2';
import { OcrResult, Finding } from '../../types';
import { CONCURSO_PATTERNS_V2, ConcursoPatternV2 } from './patterns/concurso-patterns-v2';
import { logger } from '../../utils';

/**
 * Analyzer that categorizes concurso findings based on pattern matching
 */
export class ConcursoCategoryAnalyzer extends BaseAnalyzerV2 {
  private aberturaPattern: ConcursoPatternV2 | undefined;

  constructor() {
    super('concurso-category', 'concurso-category', { enabled: true });
    
    // Load the edital_abertura pattern
    this.aberturaPattern = CONCURSO_PATTERNS_V2.find(
      p => p.documentType === 'edital_abertura'
    );

    if (!this.aberturaPattern) {
      logger.warn('Could not find edital_abertura pattern in CONCURSO_PATTERNS_V2');
    }
  }

  /**
   * Override getPriority to ensure this runs after keyword analyzer
   */
  getPriority(): number {
    return 2; // Run after keyword analyzer (priority 1)
  }

  /**
   * Perform analysis - this will be called with previous findings
   */
  protected async performAnalysis(_ocrResult: OcrResult): Promise<Finding[]> {
    // This method won't be directly used since we need previous findings
    // The orchestrator will call analyzeWithFindings instead
    return [];
  }

  /**
   * Analyze concurso findings and categorize them
   * This is the main method that should be called with previous findings
   */
  async analyzeWithFindings(_ocrResult: OcrResult, previousFindings: Finding[]): Promise<Finding[]> {
    const categoryFindings: Finding[] = [];

    if (!this.aberturaPattern) {
      logger.warn('Abertura pattern not available, skipping categorization');
      return categoryFindings;
    }

    // Filter for concurso público findings
    const concursoFindings = previousFindings.filter(
      f => f.type === 'keyword:concurso_publico' || f.type === 'ai:concurso_publico'
    );

    if (concursoFindings.length === 0) {
      logger.info('No concurso público findings to categorize');
      return categoryFindings;
    }

    logger.info(`Categorizing ${concursoFindings.length} concurso findings`);

    // Check each finding against edital_abertura patterns
    for (const finding of concursoFindings) {
      if (this.matchesAberturaPattern(finding)) {
        const categoryFinding = this.createFinding(
          'keyword:concurso_abertura',
          {
            category: 'concurso_abertura',
            documentType: 'edital_abertura',
            keyword: finding.data.keyword,
            position: finding.data.position,
            weight: 0.95,
            sourceType: finding.type,
            matchedPatterns: this.getMatchedPatternTypes(finding),
          },
          this.calculateAberturaConfidence(finding),
          finding.context
        );

        categoryFindings.push(categoryFinding);

        logger.info(`Categorized finding as edital_abertura`, {
          sourceKeyword: finding.data.keyword,
          sourceType: finding.type,
          confidence: categoryFinding.confidence,
        });
      }
    }

    logger.info(`Categorization complete: ${categoryFindings.length} edital_abertura findings created`);

    return categoryFindings;
  }

  /**
   * Check if a finding matches the edital_abertura pattern
   */
  private matchesAberturaPattern(finding: Finding): boolean {
    if (!this.aberturaPattern || !finding.context) {
      return false;
    }

    const context = finding.context.toLowerCase();
    const pattern = this.aberturaPattern;

    // Check for strong keywords
    const hasStrongKeyword = pattern.strongKeywords.some(keyword => 
      context.includes(keyword.toLowerCase())
    );

    // Check for regex patterns
    const matchesPattern = pattern.patterns.some(regex => regex.test(context));

    // Check for exclude patterns (should NOT match)
    const hasExcludePattern = pattern.excludePatterns?.some(regex => regex.test(context)) || false;

    // Check for conflict keywords (should NOT match)
    const hasConflictKeyword = pattern.conflictKeywords?.some(keyword => 
      context.includes(keyword.toLowerCase())
    ) || false;

    // Must have strong keyword OR match pattern, but NOT have exclude patterns or conflicts
    const matches = (hasStrongKeyword || matchesPattern) && !hasExcludePattern && !hasConflictKeyword;

    return matches;
  }

  /**
   * Calculate confidence for abertura categorization
   */
  private calculateAberturaConfidence(finding: Finding): number {
    if (!this.aberturaPattern || !finding.context) {
      return 0.5;
    }

    const context = finding.context.toLowerCase();
    const pattern = this.aberturaPattern;

    let confidence = 0.5; // Base confidence

    // Count strong keywords
    const strongKeywordCount = pattern.strongKeywords.filter(keyword => 
      context.includes(keyword.toLowerCase())
    ).length;

    // Count moderate keywords
    const moderateKeywordCount = pattern.moderateKeywords?.filter(keyword => 
      context.includes(keyword.toLowerCase())
    ).length || 0;

    // Count pattern matches
    const patternMatchCount = pattern.patterns.filter(regex => regex.test(context)).length;

    // Calculate confidence based on matches
    if (strongKeywordCount > 0) {
      confidence += 0.3 * Math.min(strongKeywordCount, 3); // Up to +0.9
    }

    if (moderateKeywordCount > 0) {
      confidence += 0.1 * Math.min(moderateKeywordCount, 2); // Up to +0.2
    }

    if (patternMatchCount > 0) {
      confidence += 0.05 * Math.min(patternMatchCount, 2); // Up to +0.1
    }

    // Apply pattern weight
    confidence *= pattern.weight;

    // Cap at 1.0
    return Math.min(confidence, 1.0);
  }

  /**
   * Get types of patterns that matched
   */
  private getMatchedPatternTypes(finding: Finding): string[] {
    if (!this.aberturaPattern || !finding.context) {
      return [];
    }

    const matched: string[] = [];
    const context = finding.context.toLowerCase();
    const pattern = this.aberturaPattern;

    // Check which strong keywords matched
    const matchedStrongKeywords = pattern.strongKeywords.filter(keyword => 
      context.includes(keyword.toLowerCase())
    );

    if (matchedStrongKeywords.length > 0) {
      matched.push(`strong_keywords(${matchedStrongKeywords.length})`);
    }

    // Check which patterns matched
    const matchedPatterns = pattern.patterns.filter(regex => regex.test(context));

    if (matchedPatterns.length > 0) {
      matched.push(`regex_patterns(${matchedPatterns.length})`);
    }

    return matched;
  }

  /**
   * Override getMetadata to provide category-specific info
   */
  protected getMetadata(findings: Finding[]): Record<string, any> {
    const baseMetadata = super.getMetadata(findings);

    const aberturaFindings = findings.filter(f => f.type === 'keyword:concurso_abertura');

    return {
      ...baseMetadata,
      categoryMetadata: {
        totalCategorized: aberturaFindings.length,
        aberturaFindings: aberturaFindings.length,
        averageAberturaConfidence: aberturaFindings.length > 0
          ? aberturaFindings.reduce((sum, f) => sum + f.confidence, 0) / aberturaFindings.length
          : 0,
      },
    };
  }
}
