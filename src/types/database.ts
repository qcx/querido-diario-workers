/**
 * Comprehensive type definitions for database JSON fields
 * Replaces all 'any' types with proper structured types
 */

import type { 
  Finding, 
  EntityType 
} from './analysis';
import type { GazettePower } from './gazette';

// =============================================================================
// METADATA TYPES
// =============================================================================

/**
 * Base metadata interface - common fields across all metadata objects
 */
export interface BaseMetadata {
  version?: string;
  source?: string;
  timestamp?: string;
  [key: string]: unknown; // Allow for future extensions
}

/**
 * Crawl job metadata
 */
export interface CrawlJobMetadata extends BaseMetadata {
  /** Manual crawl initiated by user */
  initiatedBy?: string;
  /** Original start/end dates for scheduled crawls */
  originalDateRange?: {
    start: string;
    end: string;
  };
  /** Configuration overrides */
  config?: {
    maxRetries?: number;
    timeout?: number;
    concurrency?: number;
  };
  /** Filters applied */
  filters?: {
    platforms?: string[];
    territories?: string[];
    excludeWeekends?: boolean;
  };
}

/**
 * Crawl telemetry metadata
 */
export interface CrawlTelemetryMetadata extends BaseMetadata {
  /** Spider configuration used */
  spiderConfig?: {
    baseUrl?: string;
    timeout?: number;
    retryCount?: number;
  };
  /** HTTP request details */
  httpDetails?: {
    requestCount?: number;
    averageResponseTime?: number;
    statusCodes?: Record<string, number>;
  };
  /** Performance metrics */
  performance?: {
    memoryUsage?: number;
    cpuTime?: number;
    networkLatency?: number;
  };
  /** Debugging information */
  debug?: {
    userAgent?: string;
    cookies?: boolean;
    javascript?: boolean;
  };
}

/**
 * Gazette metadata
 */
export interface GazetteMetadata extends BaseMetadata {
  /** Spider-specific data */
  spiderData?: {
    originalUrl?: string;
    pageNumber?: number;
    totalPages?: number;
    extractedFromList?: boolean;
  };
  /** File information */
  fileInfo?: {
    sizeBytes?: number;
    contentType?: string;
    encoding?: string;
    pages?: number;
  };
  /** Content preview */
  preview?: {
    title?: string;
    firstLine?: string;
    hasImages?: boolean;
    estimatedWords?: number;
  };
  /** Quality indicators */
  quality?: {
    isComplete?: boolean;
    hasWatermark?: boolean;
    isReadable?: boolean;
    confidenceScore?: number;
  };
}

/**
 * OCR metadata
 */
export interface OcrMetadata extends BaseMetadata {
  /** Mistral API details */
  mistralData?: {
    model?: string;
    requestId?: string;
    processingTime?: number;
    estimatedCost?: number;
  };
  /** PDF processing details */
  pdfInfo?: {
    originalPages?: number;
    processedPages?: number;
    skippedPages?: number[];
    fileSize?: number;
  };
  /** Quality assessment */
  quality?: {
    averageConfidence?: number;
    lowConfidencePages?: number[];
    blankPages?: number[];
    imageOnlyPages?: number[];
  };
  /** Performance metrics */
  performance?: {
    downloadTime?: number;
    uploadTime?: number;
    processingTime?: number;
    queueTime?: number;
  };
}

/**
 * Analysis metadata
 */
export interface AnalysisMetadata extends BaseMetadata {
  /** Analysis configuration */
  config?: {
    analyzersUsed?: string[];
    deduplicationEnabled?: boolean;
    confidenceThreshold?: number;
    maxFindings?: number;
  };
  /** Processing details */
  processing?: {
    totalSteps?: number;
    skippedAnalyzers?: string[];
    warnings?: string[];
  };
  /** Source information (overrides parent source field) */
  sourceInfo?: {
    spiderId: string;
    editionNumber?: string;
    power?: GazettePower;
    isExtraEdition?: boolean;
  };
  /** Quality metrics */
  quality?: {
    textLength?: number;
    averageConfidence?: number;
    duplicatesRemoved?: number;
  };
}

/**
 * Webhook delivery metadata
 */
export interface WebhookMetadata extends BaseMetadata {
  /** Request details */
  request?: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    bodySize?: number;
  };
  /** Response details */
  response?: {
    statusCode?: number;
    headers?: Record<string, string>;
    bodySize?: number;
    timing?: number;
  };
  /** Retry information */
  retry?: {
    attempt?: number;
    nextRetryAt?: string;
    backoffMs?: number;
    reason?: string;
  };
  /** Client information */
  client?: {
    clientId?: string;
    version?: string;
    userAgent?: string;
  };
}

/**
 * Error log context
 */
export interface ErrorContext extends BaseMetadata {
  /** Request context */
  request?: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  };
  /** User context */
  user?: {
    id?: string;
    role?: string;
    permissions?: string[];
  };
  /** System context */
  system?: {
    hostname?: string;
    version?: string;
    environment?: string;
    memoryUsage?: number;
  };
  /** Operation context */
  operation?: {
    name?: string;
    step?: string;
    parameters?: Record<string, unknown>;
    duration?: number;
  };
  /** Related entities */
  relatedIds?: {
    crawlJobId?: string;
    ocrJobId?: string;
    analysisJobId?: string;
    gazetteId?: string;
  };
}

// =============================================================================
// FINDINGS AND ANALYSIS TYPES
// =============================================================================

/**
 * Structured analysis summary
 */
export interface AnalysisSummary {
  /** Total number of findings */
  totalFindings: number;
  /** Number of high-confidence findings */
  highConfidenceFindings: number;
  /** Findings grouped by type */
  findingsByType: Record<string, number>;
  /** Categories found */
  categories: string[];
  /** Keywords extracted */
  keywords: string[];
  /** Deduplication info */
  deduplicationApplied?: boolean;
  duplicatesRemoved?: number;
  /** Processing statistics */
  processingStats?: {
    totalAnalyzers: number;
    successfulAnalyzers: number;
    failedAnalyzers: number;
    totalProcessingTime: number;
  };
  /** Quality indicators */
  qualityIndicators?: {
    averageConfidence: number;
    textCoverage: number; // Percentage of text analyzed
    entityDensity: number; // Entities per 1000 words
  };
}

/**
 * Structured finding with proper typing
 */
export interface StructuredFinding extends Finding {
  /** Finding metadata */
  metadata?: {
    analyzer?: string;
    model?: string;
    pattern?: string;
    entityType?: EntityType;
    extractionMethod?: 'pattern' | 'ai' | 'nlp' | 'rule-based';
  };
  /** Validation status */
  validation?: {
    isValidated?: boolean;
    validatedBy?: string;
    validatedAt?: string;
    validationNotes?: string;
  };
  /** Geographic context */
  geography?: {
    territoryId?: string;
    cityName?: string;
    stateName?: string;
    region?: string;
  };
}

// =============================================================================
// CONCURSO SPECIFIC TYPES
// =============================================================================

/**
 * Structured cargo (position) information
 */
export interface ConcursoCargo {
  /** Position name */
  cargo: string;
  /** Number of positions */
  vagas: number;
  /** Requirements */
  requisitos?: string;
  /** Salary */
  salario?: number;
  /** Working hours */
  jornada?: string;
  /** Education level required */
  escolaridade?: string;
  /** Location */
  local?: string;
  /** Additional benefits */
  beneficios?: string[];
}

/**
 * Structured date information for concursos
 */
export interface ConcursoDatas {
  /** Registration period */
  inscricoesInicio?: string;
  inscricoesFim?: string;
  /** Exam dates */
  prova?: string;
  provaObjetiva?: string;
  provaPratica?: string;
  provaOral?: string;
  /** Results */
  resultado?: string;
  resultadoPreliminar?: string;
  resultadoFinal?: string;
  /** Appeals */
  recursos?: string;
  recursosGabarito?: string;
  /** Other important dates */
  homologacao?: string;
  convocacao?: string;
  posse?: string;
}

/**
 * Structured tax/fee information
 */
export interface ConcursoTaxa {
  /** Position or category */
  cargo?: string;
  /** Fee amount */
  valor: number;
  /** Currency (default BRL) */
  moeda?: string;
  /** Payment deadline */
  prazoVencimento?: string;
  /** Payment methods */
  formasPagamento?: string[];
  /** Discount conditions */
  descontos?: {
    tipo: string; // 'isencao', 'reducao'
    valor?: number; // Percentage or amount
    condicoes: string;
  }[];
}

/**
 * Structured examining board information
 */
export interface ConcursoBanca {
  /** Organization name */
  nome?: string;
  /** CNPJ */
  cnpj?: string;
  /** Contact information */
  contato?: {
    telefone?: string;
    email?: string;
    site?: string;
    endereco?: string;
  };
  /** Previous experience */
  experiencia?: {
    outrosConcursos?: string[];
    especializacoes?: string[];
  };
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

/**
 * Union type for all metadata types
 */
export type AnyMetadata = 
  | CrawlJobMetadata
  | CrawlTelemetryMetadata  
  | GazetteMetadata
  | OcrMetadata
  | AnalysisMetadata
  | WebhookMetadata
  | ErrorContext;

/**
 * Type-safe JSON value
 */
export type JsonValue = 
  | string 
  | number 
  | boolean 
  | null 
  | JsonObject 
  | JsonArray;

export interface JsonObject {
  [Key in string]?: JsonValue;
}

export interface JsonArray extends Array<JsonValue> {}

/**
 * Generic result type for operations
 */
export interface OperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  metadata?: {
    timestamp: string;
    duration?: number;
    operation: string;
  };
}
