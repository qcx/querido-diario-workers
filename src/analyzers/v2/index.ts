/**
 * V2 Analyzer System - Export all V2 components
 */

// Core components
export { BaseAnalyzerV2 } from './base-analyzer-v2';
export type { 
  AnalyzerV2Config, 
  SectionAwareFinding, 
  SectionAnalysisResult 
} from './base-analyzer-v2';

// V2 Patterns
export * from './patterns/concurso-patterns-v2';

// V2 Services
export { ConcursoAmbiguousValidatorService } from './concurso-ambiguous-validator';
export type { AmbiguousValidationResult, AmbiguousValidatorConfig } from './concurso-ambiguous-validator';

export { AberturaExtractorService } from './abertura-extractor';
export type { AberturaExtractorConfig } from './abertura-extractor';

export { AnalysisOrchestratorV2 } from './orchestrator-v2';
export type { AnalysisConfigV2 } from './types';

// Convenience re-exports for compatibility
export type { 
  OcrResult, 
  AnalysisResult, 
  Finding, 
  GazetteAnalysis,
  AnalysisConfig,
  AnalysisConfigSignature,
  AnalyzerConfig
} from '../../types';
