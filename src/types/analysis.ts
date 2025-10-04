/**
 * Types for post-OCR analysis system
 */

import { OcrResult } from './ocr';

/**
 * Analysis result from a specific analyzer
 */
export interface AnalysisResult {
  analyzerId: string;
  analyzerType: string;
  status: 'success' | 'failure' | 'skipped';
  findings: Finding[];
  metadata?: Record<string, any>;
  processingTimeMs: number;
  error?: {
    message: string;
    code?: string;
  };
}

/**
 * A finding from analysis
 */
export interface Finding {
  type: string;
  confidence: number; // 0-1
  data: Record<string, any>;
  location?: {
    page?: number;
    line?: number;
    offset?: number;
  };
  context?: string; // Surrounding text
}

/**
 * Complete analysis of an OCR result
 */
export interface GazetteAnalysis {
  jobId: string;
  ocrJobId: string;
  territoryId: string;
  publicationDate: string;
  analyzedAt: string;
  
  // OCR data
  extractedText: string;
  textLength: number;
  
  // Analysis results
  analyses: AnalysisResult[];
  
  // Aggregated findings
  summary: {
    totalFindings: number;
    findingsByType: Record<string, number>;
    highConfidenceFindings: number;
    categories: string[];
    keywords: string[];
  };
  
  // Metadata
  metadata: {
    spiderId: string;
    editionNumber?: string;
    power?: string;
    isExtraEdition?: boolean;
  };
}

/**
 * Configuration for an analyzer
 */
export interface AnalyzerConfig {
  enabled: boolean;
  priority?: number; // Lower = higher priority
  timeout?: number;
  options?: Record<string, any>;
}

/**
 * Keyword patterns for KeywordAnalyzer
 */
export interface KeywordPattern {
  category: string;
  keywords: string[];
  caseSensitive?: boolean;
  wholeWord?: boolean;
  weight?: number; // Importance weight
}

/**
 * AI analysis prompt configuration
 */
export interface AIAnalysisPrompt {
  name: string;
  prompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Entity types for extraction
 */
export type EntityType = 
  | 'person'
  | 'organization'
  | 'location'
  | 'date'
  | 'money'
  | 'cpf'
  | 'cnpj'
  | 'law_reference'
  | 'decree_reference';

/**
 * Message for analysis queue
 */
export interface AnalysisQueueMessage {
  jobId: string;
  ocrResult: OcrResult;
  analyzers?: string[]; // Specific analyzers to run, or all if undefined
  queuedAt: string;
}

/**
 * Analysis configuration
 */
export interface AnalysisConfig {
  analyzers: {
    keyword?: AnalyzerConfig & {
      patterns?: KeywordPattern[];
    };
    ai?: AnalyzerConfig & {
      prompts?: AIAnalysisPrompt[];
      apiKey?: string;
    };
    entity?: AnalyzerConfig & {
      entityTypes?: EntityType[];
    };
    category?: AnalyzerConfig & {
      categories?: string[];
    };
  };
}
