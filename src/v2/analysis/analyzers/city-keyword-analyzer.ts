/**
 * City Keyword Analyzer - Filters state gazette content by city
 * Used as a pre-processor for state-level gazettes to extract city-specific content
 */

import { BaseAnalyzer } from '../../../analyzers/base-analyzer';
import { OcrResult, Finding, AnalyzerConfig } from '../../../types';
import { logger } from '../../../utils';

export interface CityKeywordAnalyzerConfig extends AnalyzerConfig {
  /** City name to search for */
  cityName: string;
  
  /** Regex pattern for matching city in text */
  cityRegex: string;
  
  /** Territory ID for this city */
  territoryId: string;
  
  /** Context window size (characters before/after match) */
  contextWindow?: number;
  
  /** Minimum match score to include a section */
  minMatchScore?: number;
}

/**
 * Analyzer that filters gazette content to extract city-specific sections
 * This is used as a pre-processor, not a regular analyzer
 */
export class CityKeywordAnalyzer extends BaseAnalyzer {
  private cityConfig: CityKeywordAnalyzerConfig;
  private cityRegexPattern: RegExp;
  
  constructor(config: CityKeywordAnalyzerConfig) {
    super(`city-keyword-${config.territoryId}`, 'city-keyword', config);
    this.cityConfig = {
      contextWindow: 500, // Default 500 chars before/after
      minMatchScore: 0.1, // At least 10% of paragraphs should mention city
      ...config
    };
    
    // Compile regex pattern
    try {
      this.cityRegexPattern = new RegExp(this.cityConfig.cityRegex, 'gi');
    } catch (error) {
      logger.error('Invalid city regex pattern', error as Error, {
        cityRegex: this.cityConfig.cityRegex,
        cityName: this.cityConfig.cityName
      });
      // Fallback to simple city name search
      const escapedCityName = this.cityConfig.cityName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      this.cityRegexPattern = new RegExp(escapedCityName, 'gi');
    }
  }
  
  /**
   * Extract only text sections that mention the city
   * This method is the main filtering logic
   */
  extractCityContent(fullText: string): string {
    if (!fullText || fullText.length === 0) {
      return '';
    }
    
    // Split text into paragraphs/sections
    const paragraphs = this.splitIntoParagraphs(fullText);
    const relevantParagraphs: string[] = [];
    const matchedIndices = new Set<number>();
    
    // First pass: find paragraphs with direct matches
    paragraphs.forEach((paragraph, index) => {
      if (this.cityRegexPattern.test(paragraph)) {
        matchedIndices.add(index);
        // Also include surrounding paragraphs for context
        if (index > 0) matchedIndices.add(index - 1);
        if (index < paragraphs.length - 1) matchedIndices.add(index + 1);
      }
    });
    
    // Reset regex lastIndex after test
    this.cityRegexPattern.lastIndex = 0;
    
    // Collect matched paragraphs in order
    const sortedIndices = Array.from(matchedIndices).sort((a, b) => a - b);
    for (const index of sortedIndices) {
      relevantParagraphs.push(paragraphs[index]);
    }
    
    // Join with double newlines to maintain structure
    const filteredText = relevantParagraphs.join('\n\n');
    
    logger.info('City content extraction completed', {
      cityName: this.cityConfig.cityName,
      territoryId: this.cityConfig.territoryId,
      originalLength: fullText.length,
      filteredLength: filteredText.length,
      reductionPercent: Math.round((1 - filteredText.length / fullText.length) * 100),
      matchedParagraphs: matchedIndices.size,
      totalParagraphs: paragraphs.length
    });
    
    return filteredText;
  }
  
  /**
   * Pre-filter OCR result to contain only city-specific content
   * This is the main method used by the analysis handler
   */
  filterOcrResult(ocrResult: OcrResult): OcrResult {
    const filteredText = this.extractCityContent(ocrResult.extractedText || '');
    
    return {
      ...ocrResult,
      extractedText: filteredText,
      metadata: {
        ...ocrResult.metadata,
        cityFiltered: true,
        cityName: this.cityConfig.cityName,
        territoryId: this.cityConfig.territoryId,
        originalTextLength: ocrResult.extractedText?.length || 0,
        filteredTextLength: filteredText.length
      }
    };
  }
  
  /**
   * Split text into paragraphs for analysis
   */
  private splitIntoParagraphs(text: string): string[] {
    // Split by double newlines or common section markers
    const paragraphs = text.split(/\n\s*\n|\n(?=(?:Art\.|CAPÍTULO|SEÇÃO|TÍTULO|ANEXO))/);
    
    // Filter out empty paragraphs and trim
    return paragraphs
      .map(p => p.trim())
      .filter(p => p.length > 0);
  }
  
  /**
   * Perform analysis - returns city mention findings
   * This is used when CityKeywordAnalyzer is used as a regular analyzer
   */
  protected async performAnalysis(ocrResult: OcrResult): Promise<Finding[]> {
    const findings: Finding[] = [];
    const text = ocrResult.extractedText || '';
    
    // Find all matches with context
    const matches = this.findMatchesWithContext(text);
    
    // Create findings for city mentions
    if (matches.length > 0) {
      findings.push({
        type: `city-mention:${this.cityConfig.territoryId}`,
        confidence: this.calculateConfidence(matches.length, text.length),
        data: {
          cityName: this.cityConfig.cityName,
          territoryId: this.cityConfig.territoryId,
          matchCount: matches.length,
          matches: matches.slice(0, 10), // First 10 matches for reference
          coverage: this.calculateCoverage(matches, text)
        }
      });
    }
    
    return findings;
  }
  
  /**
   * Find all matches with surrounding context
   */
  private findMatchesWithContext(text: string): Array<{match: string; context: string; position: number}> {
    const matches: Array<{match: string; context: string; position: number}> = [];
    let match;
    
    // Reset regex
    this.cityRegexPattern.lastIndex = 0;
    
    while ((match = this.cityRegexPattern.exec(text)) !== null) {
      const position = match.index;
      const matchText = match[0];
      
      // Extract context
      const contextStart = Math.max(0, position - (this.cityConfig.contextWindow || 500));
      const contextEnd = Math.min(text.length, position + matchText.length + (this.cityConfig.contextWindow || 500));
      const context = text.substring(contextStart, contextEnd);
      
      matches.push({
        match: matchText,
        context,
        position
      });
    }
    
    return matches;
  }
  
  /**
   * Calculate confidence score based on match frequency
   */
  private calculateConfidence(matchCount: number, textLength: number): number {
    // Base confidence on match density (matches per 1000 chars)
    const density = (matchCount / textLength) * 1000;
    
    // Normalize to 0-1 range (assuming 1 match per 1000 chars is high confidence)
    return Math.min(1, density);
  }
  
  /**
   * Calculate text coverage by city mentions
   */
  private calculateCoverage(matches: Array<{match: string; context: string; position: number}>, text: string): number {
    if (matches.length === 0) return 0;
    
    // Calculate total characters covered by contexts (avoiding overlaps)
    const coveredRanges: Array<[number, number]> = [];
    const contextWindow = this.cityConfig.contextWindow || 500;
    
    for (const match of matches) {
      const start = Math.max(0, match.position - contextWindow);
      const end = Math.min(text.length, match.position + match.match.length + contextWindow);
      
      // Merge with existing ranges if overlapping
      let merged = false;
      for (let i = 0; i < coveredRanges.length; i++) {
        const [rangeStart, rangeEnd] = coveredRanges[i];
        if (start <= rangeEnd && end >= rangeStart) {
          // Overlapping - merge
          coveredRanges[i] = [Math.min(start, rangeStart), Math.max(end, rangeEnd)];
          merged = true;
          break;
        }
      }
      
      if (!merged) {
        coveredRanges.push([start, end]);
      }
    }
    
    // Calculate total covered length
    const totalCovered = coveredRanges.reduce((sum, [start, end]) => sum + (end - start), 0);
    
    return totalCovered / text.length;
  }
  
  /**
   * Get analyzer metadata
   */
  protected getMetadata(findings: Finding[]): Record<string, any> {
    const baseMetadata = super.getMetadata(findings);
    
    return {
      ...baseMetadata,
      cityName: this.cityConfig.cityName,
      territoryId: this.cityConfig.territoryId,
      cityRegex: this.cityConfig.cityRegex
    };
  }
}
