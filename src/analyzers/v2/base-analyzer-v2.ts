/**
 * Base V2 Analyzer - Enhanced base class with section-aware capabilities
 */

import { BaseAnalyzer } from '../base-analyzer';
import { OcrResult, AnalysisResult, Finding, AnalyzerConfig } from '../../types';
import { logger } from '../../utils';

/**
 * Represents a parsed section (moved from text-preprocessor)
 */
export interface ParsedSection {
  /** Section title/header */
  title: string;
  /** Section level (1 for #, 2 for ##, etc.) */
  level: number;
  /** Section content */
  content: string;
  /** Start position in original text */
  startPosition: number;
  /** End position in original text */
  endPosition: number;
  /** Normalized title for matching */
  normalizedTitle: string;
}

/**
 * Enhanced analyzer configuration for V2 system
 */
export interface AnalyzerV2Config extends AnalyzerConfig {
  /** Whether to use section-based analysis */
  useSectionAnalysis?: boolean;
  /** Minimum section relevance score to analyze */
  minSectionRelevance?: number;
}

/**
 * Enhanced finding with section context
 */
export interface SectionAwareFinding extends Finding {
  /** Section where the finding was made */
  section?: {
    title: string;
    level: number;
    normalizedTitle: string;
  };
  /** Position within the section */
  sectionPosition?: number;
  /** Section relevance score */
  sectionRelevance?: number;
}

/**
 * Result of section-based analysis
 */
export interface SectionAnalysisResult {
  /** Findings organized by section */
  findingsBySection: Map<string, SectionAwareFinding[]>;
  /** Sections that were analyzed */
  analyzedSections: ParsedSection[];
  /** Sections that were skipped */
  skippedSections: ParsedSection[];
  /** Findings from unassigned content */
  unassignedFindings: SectionAwareFinding[];
  /** Total sections processed */
  totalSections: number;
}

/**
 * Base class for V2 analyzers with section-aware capabilities
 */
export abstract class BaseAnalyzerV2 extends BaseAnalyzer {
  protected v2Config: AnalyzerV2Config;

  constructor(analyzerId: string, analyzerType: string, config: AnalyzerV2Config = { enabled: true }) {
    super(analyzerId, analyzerType, config);
    
    this.v2Config = {
      useSectionAnalysis: false, // Default to false since most analyzers handle their own section detection
      minSectionRelevance: 0.1,
      ...config,
    };
  }

  /**
   * Enhanced analyze method with preprocessing
   */
  async analyze(ocrResult: OcrResult): Promise<AnalysisResult> {
    if (!this.config.enabled) {
      return this.createSkippedResult('Analyzer is disabled');
    }

    if (!ocrResult.extractedText || ocrResult.extractedText.length === 0) {
      return this.createSkippedResult('No text to analyze');
    }

    const startTime = Date.now();

    try {
      logger.info(`Starting V2 analysis with ${this.analyzerId}`, {
        analyzerId: this.analyzerId,
        analyzerType: this.analyzerType,
        jobId: ocrResult.jobId,
        textLength: ocrResult.extractedText.length,
        useSectionAnalysis: this.v2Config.useSectionAnalysis,
      });

      let findings: Finding[];
      let analysisMetadata: Record<string, any> = {};

      // Use traditional analysis - subclasses can implement their own section logic
      findings = await this.performAnalysis(ocrResult);

      const processingTimeMs = Date.now() - startTime;

      logger.info(`V2 analysis completed with ${this.analyzerId}`, {
        analyzerId: this.analyzerId,
        jobId: ocrResult.jobId,
        findingsCount: findings.length,
        processingTimeMs,
      });

      return {
        analyzerId: this.analyzerId,
        analyzerType: this.analyzerType,
        status: 'success',
        findings,
        processingTimeMs,
        metadata: {
          ...this.getMetadata(findings),
          ...analysisMetadata,
        },
      };
    } catch (error: any) {
      const processingTimeMs = Date.now() - startTime;

      logger.error(`V2 analysis failed for ${this.analyzerId}`, error, {
        analyzerId: this.analyzerId,
        jobId: ocrResult.jobId,
        processingTimeMs,
      });

      return {
        analyzerId: this.analyzerId,
        analyzerType: this.analyzerType,
        status: 'failure',
        findings: [],
        processingTimeMs,
        error: {
          message: error.message,
          code: error.code,
        },
      };
    }
  }


  /**
   * Calculate relevance score for a section
   * Override in subclasses for analyzer-specific relevance calculation
   */
  protected calculateSectionRelevance(section: ParsedSection): number {
    // Default implementation - can be overridden by specific analyzers
    const titleRelevance = this.calculateTitleRelevance(section.title);
    const contentRelevance = this.calculateContentRelevance(section.content);
    const lengthRelevance = this.calculateLengthRelevance(section.content.length);

    return (titleRelevance * 0.4 + contentRelevance * 0.4 + lengthRelevance * 0.2);
  }

  /**
   * Calculate title relevance (override in subclasses)
   */
  protected calculateTitleRelevance(title: string): number {
    // Default implementation - all titles are equally relevant
    return 0.5;
  }

  /**
   * Calculate content relevance (override in subclasses)
   */
  protected calculateContentRelevance(content: string): number {
    // Default implementation - longer content is more relevant
    return Math.min(content.length / 1000, 1.0);
  }

  /**
   * Calculate length relevance
   */
  protected calculateLengthRelevance(length: number): number {
    // Sections that are too short or too long get lower relevance
    if (length < 50) return 0.1;
    if (length > 10000) return 0.7;
    return 1.0;
  }

  /**
   * Perform analysis on a specific section
   * Default implementation delegates to performAnalysis
   * Override in subclasses for section-specific analysis
   */
  protected async performSectionAnalysis(ocrResult: OcrResult, section: ParsedSection): Promise<Finding[]> {
    return this.performAnalysis(ocrResult);
  }

  /**
   * Create enhanced finding with section context
   */
  protected createSectionAwareFinding(
    type: string,
    data: Record<string, any>,
    confidence: number = 1.0,
    context?: string,
    section?: ParsedSection,
    sectionPosition?: number
  ): SectionAwareFinding {
    const baseFinding = this.createFinding(type, data, confidence, context);
    
    return {
      ...baseFinding,
      section: section ? {
        title: section.title,
        level: section.level,
        normalizedTitle: section.normalizedTitle,
      } : undefined,
      sectionPosition,
      sectionRelevance: section ? this.calculateSectionRelevance(section) : undefined,
    };
  }

  /**
   * Enhanced metadata with section information
   */
  protected getMetadata(findings: Finding[]): Record<string, any> {
    const baseMetadata = super.getMetadata(findings);
    
    // Add V2-specific metadata
    const sectionAwareFindings = findings as SectionAwareFinding[];
    const findingsWithSections = sectionAwareFindings.filter(f => f.section);
    const findingsByLevel = new Map<number, number>();
    
    for (const finding of findingsWithSections) {
      if (finding.section) {
        const level = finding.section.level;
        findingsByLevel.set(level, (findingsByLevel.get(level) || 0) + 1);
      }
    }

    return {
      ...baseMetadata,
      v2Metadata: {
        findingsWithSections: findingsWithSections.length,
        findingsWithoutSections: sectionAwareFindings.length - findingsWithSections.length,
        findingsByLevel: Object.fromEntries(findingsByLevel),
        averageSectionRelevance: findingsWithSections.length > 0
          ? findingsWithSections.reduce((sum, f) => sum + (f.sectionRelevance || 0), 0) / findingsWithSections.length
          : 0,
      },
    };
  }

}
