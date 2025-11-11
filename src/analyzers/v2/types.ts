/**
 * V2 Analyzer System Types
 * Additional type definitions specific to the V2 analyzer system
 */

import { AnalysisConfig, Finding } from '../../types';
import { PreprocessorConfig, ParsedSection } from './text-preprocessor';
import { AnalyzerV2Config } from './base-analyzer-v2';
import { KeywordAnalyzerV2Config } from './keyword-analyzer-v2';

/**
 * Enhanced analysis configuration for V2 system
 */
export interface AnalysisConfigV2 extends AnalysisConfig {
  /** Text preprocessing configuration */
  preprocessor?: Partial<PreprocessorConfig>;
  
  /** V2-specific analyzer configurations */
  analyzersV2?: {
    keyword?: KeywordAnalyzerV2Config;
    ambiguousValidator?: {
      enabled: boolean;
      apiKey?: string;
      model?: string;
      confidenceThreshold?: number;
    };
    aberturaExtractor?: {
      enabled: boolean;
      apiKey?: string;
      model?: string;
      timeout?: number;
    };
    // Future V2 analyzers can be added here
    // ai?: AIAnalyzerV2Config;
    // entity?: EntityAnalyzerV2Config;
  };
  
  /** Global V2 settings */
  v2Settings?: {
    /** Enable section-based analysis globally */
    enableSectionAnalysis?: boolean;
    /** Minimum section relevance threshold */
    minSectionRelevance?: number;
    /** Maximum sections to analyze per document */
    maxSectionsPerDocument?: number;
    /** Enable enhanced context extraction */
    enableEnhancedContext?: boolean;
  };
}

/**
 * V2 Analysis Result with enhanced metadata
 */
export interface AnalysisResultV2 {
  /** Standard analysis result fields */
  analyzerId: string;
  analyzerType: string;
  status: 'success' | 'failure' | 'skipped';
  findings: SectionAwareFinding[];
  processingTimeMs: number;
  error?: {
    message: string;
    code?: string;
  };
  
  /** V2-specific metadata */
  metadata?: {
    /** Standard metadata */
    totalFindings: number;
    averageConfidence: number;
    
    /** V2-specific metadata */
    v2Metadata: {
      sectionsAnalyzed: number;
      sectionsSkipped: number;
      findingsWithSections: number;
      findingsWithoutSections: number;
      averageSectionRelevance: number;
      preprocessingApplied: boolean;
      preprocessingStats?: {
        originalLength: number;
        cleanedLength: number;
        reductionPercentage: number;
        headersRemoved: number;
        footersRemoved: number;
      };
    };
  };
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
  
  /** Section relevance score (0-1) */
  sectionRelevance?: number;
  
  /** Enhanced location information */
  location?: {
    /** Character position in original text */
    absolutePosition: number;
    /** Character position within section */
    sectionPosition: number;
    /** Line number in original text */
    lineNumber?: number;
    /** Column number in line */
    columnNumber?: number;
  };
  
  /** Enhanced context with section hierarchy */
  enhancedContext?: {
    /** Standard context */
    context: string;
    /** Section hierarchy path */
    sectionPath: string[];
    /** Surrounding sections */
    surroundingSections?: string[];
  };
}

/**
 * Section analysis statistics
 */
export interface SectionAnalysisStats {
  /** Total sections found in document */
  totalSections: number;
  
  /** Sections that were analyzed */
  analyzedSections: number;
  
  /** Sections that were skipped */
  skippedSections: number;
  
  /** Findings by section level */
  findingsByLevel: Record<number, number>;
  
  /** Findings by section title */
  findingsBySection: Record<string, number>;
  
  /** Average section relevance */
  averageSectionRelevance: number;
  
  /** Section coverage percentage */
  sectionCoverage: number;
}

/**
 * Text preprocessing statistics
 */
export interface PreprocessingStats {
  /** Original text length */
  originalLength: number;
  
  /** Cleaned text length after preprocessing */
  cleanedLength: number;
  
  /** Percentage of text removed */
  reductionPercentage: number;
  
  /** Number of headers removed */
  headersRemoved: number;
  
  /** Number of footers removed */
  footersRemoved: number;
  
  /** Sections found during parsing */
  sectionsFound: number;
  
  /** Processing time for preprocessing */
  preprocessingTimeMs: number;
}

/**
 * V2 Analyzer capabilities
 */
export interface AnalyzerV2Capabilities {
  /** Supports section-based analysis */
  supportsSectionAnalysis: boolean;
  
  /** Supports enhanced context extraction */
  supportsEnhancedContext: boolean;
  
  /** Supports relevance scoring */
  supportsRelevanceScoring: boolean;
  
  /** Supports text preprocessing */
  supportsPreprocessing: boolean;
  
  /** Analyzer version */
  version: string;
  
  /** Compatible with V1 analyzers */
  v1Compatible: boolean;
}

/**
 * V2 System configuration
 */
export interface V2SystemConfig {
  /** Enable V2 features globally */
  enableV2Features: boolean;
  
  /** Preprocessing configuration */
  preprocessing: PreprocessorConfig;
  
  /** Section analysis configuration */
  sectionAnalysis: {
    enabled: boolean;
    minRelevanceThreshold: number;
    maxSectionsPerDocument: number;
    enableHierarchyAnalysis: boolean;
  };
  
  /** Performance configuration */
  performance: {
    maxProcessingTimeMs: number;
    enableParallelProcessing: boolean;
    cachePreprocessingResults: boolean;
  };
  
  /** Compatibility settings */
  compatibility: {
    enableV1Fallback: boolean;
    v1CompatibilityMode: boolean;
    migrateV1Results: boolean;
  };
}

/**
 * Migration utilities for V1 to V2 transition
 */
export interface V1ToV2Migration {
  /** Convert V1 finding to V2 section-aware finding */
  convertFinding(v1Finding: Finding, section?: ParsedSection): SectionAwareFinding;
  
  /** Convert V1 config to V2 config */
  convertConfig(v1Config: AnalysisConfig): AnalysisConfigV2;
  
  /** Check if V1 analyzer can be upgraded to V2 */
  canUpgradeAnalyzer(analyzerId: string): boolean;
  
  /** Get migration recommendations */
  getMigrationRecommendations(currentConfig: AnalysisConfig): string[];
}

/**
 * V2 Performance metrics
 */
export interface V2PerformanceMetrics {
  /** Preprocessing performance */
  preprocessing: {
    averageTimeMs: number;
    averageReduction: number;
    successRate: number;
  };
  
  /** Section analysis performance */
  sectionAnalysis: {
    averageSectionsPerDocument: number;
    averageAnalysisTimePerSection: number;
    sectionRelevanceDistribution: Record<string, number>;
  };
  
  /** Overall V2 performance vs V1 */
  comparison: {
    speedImprovement: number;
    accuracyImprovement: number;
    findingsQualityScore: number;
  };
}

/**
 * Error types specific to V2 system
 */
export class V2AnalysisError extends Error {
  constructor(
    message: string,
    public readonly component: 'preprocessor' | 'analyzer' | 'orchestrator',
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'V2AnalysisError';
  }
}

export class PreprocessingError extends V2AnalysisError {
  constructor(message: string, originalError?: Error) {
    super(message, 'preprocessor', originalError);
    this.name = 'PreprocessingError';
  }
}

export class SectionAnalysisError extends V2AnalysisError {
  constructor(message: string, originalError?: Error) {
    super(message, 'analyzer', originalError);
    this.name = 'SectionAnalysisError';
  }
}
