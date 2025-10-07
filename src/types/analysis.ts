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
    deduplicationApplied?: boolean;
    duplicatesRemoved?: number;
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
 * Message for analysis queue (lightweight - references OCR result in KV)
 */
export interface AnalysisQueueMessage {
  jobId: string;
  ocrJobId: string; // Reference to OCR result in KV storage
  territoryId: string;
  gazetteDate: string;
  pdfUrl?: string;
  analyzers?: string[]; // Specific analyzers to run, or all if undefined
  queuedAt: string;
  metadata?: {
    crawlJobId?: string;
    [key: string]: any;
  };
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
    concurso?: AnalyzerConfig & {
      useAIExtraction?: boolean;
      apiKey?: string;
      model?: string;
    };
  };
}

/**
 * Concurso Document Types
 */
export type ConcursoDocumentType =
  | 'edital_abertura'      // New concurso being launched
  | 'edital_retificacao'   // Changes to existing edital
  | 'convocacao'           // Call for approved candidates
  | 'homologacao'          // Final result approval
  | 'prorrogacao'          // Deadline extension
  | 'cancelamento'         // Cancellation or suspension
  | 'resultado_parcial'    // Partial results
  | 'gabarito'             // Answer key
  | 'nao_classificado';    // Fallback: Document not classified

/**
 * Structured data extracted from concurso documents
 */
export interface ConcursoData {
  // Document classification
  documentType: ConcursoDocumentType;
  documentTypeConfidence: number; // 0-1
  
  // Basic information
  orgao?: string;              // Organization
  editalNumero?: string;       // Edital number
  
  // Job positions and vacancies
  vagas?: {
    total?: number;
    porCargo?: Array<{
      cargo: string;
      vagas: number;
      requisitos?: string;
      salario?: number;
      jornada?: string;
    }>;
    reservaPCD?: number;
    reservaAmplaConcorrencia?: number;
  };
  
  // Important dates
  datas?: {
    inscricoesInicio?: string;
    inscricoesFim?: string;
    prova?: string;
    provaObjetiva?: string;
    provaPratica?: string;
    resultado?: string;
    recursos?: string;
  };
  
  // Fees
  taxas?: Array<{
    cargo?: string;
    valor: number;
  }>;
  
  // Organizing institution
  banca?: {
    nome?: string;
    cnpj?: string;
  };
  
  // Multi-city support
  cidades?: Array<{
    nome: string;
    territoryId?: string;
    vagas?: number;
  }>;
  
  // Current status
  status?: string;
  
  // Additional context
  observacoes?: string[];
}

/**
 * Concurso-specific finding
 */
export interface ConcursoFinding extends Finding {
  type: 'concurso';
  data: {
    category: 'concurso_publico';
    concursoData?: ConcursoData;
    extractionMethod: 'pattern' | 'ai' | 'hybrid';
    [key: string]: any;
  };
}
