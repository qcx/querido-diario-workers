/**
 * Types for webhook notification system
 */

// import { GazetteAnalysis, Finding } from './analysis';

/**
 * Webhook subscription configuration
 */
export interface WebhookSubscription {
  /** Unique identifier for this subscription */
  id: string;
  
  /** Client identifier (e.g., "qconcursos") */
  clientId: string;
  
  /** Webhook URL to send notifications */
  webhookUrl: string;
  
  /** Filter configuration */
  filters: WebhookFilters;
  
  /** Authentication */
  auth?: {
    type: 'bearer' | 'basic' | 'custom';
    token?: string;
    username?: string;
    password?: string;
    headers?: Record<string, string>;
  };
  
  /** Retry configuration */
  retry?: {
    maxAttempts: number;
    backoffMs: number;
  };
  
  /** 
   * Maximum number of successful webhook deliveries per analysis result
   * - number (1, 2, 3, etc.): Send up to N times per analysis
   * - "always": No limit, send every time (default behavior)
   * - undefined: Defaults to "always" for backward compatibility
   */
  maxDeliveries?: number | "always";
  
  /** Active status */
  active: boolean;
  
  /** Created timestamp */
  createdAt: string;
}

/**
 * Webhook filters
 */
export interface WebhookFilters {
  /** Filter by categories */
  categories?: string[];
  
  /** Filter by keywords */
  keywords?: string[];
  
  /** Minimum confidence threshold (0-1) */
  minConfidence?: number;
  
  /** Minimum number of findings */
  minFindings?: number;
  
  /** Filter by territory IDs */
  territoryIds?: string[];
  
  /** Filter by spider IDs */
  spiderIds?: string[];
  
  /** Only send webhook when concurso findings are present */
  requireConcursoFinding?: boolean;
  
  /** Custom filter function name */
  customFilter?: string;
}

/**
 * Webhook notification payload
 */
export interface WebhookNotification {
  /** Notification ID */
  notificationId: string;
  
  /** Subscription ID */
  subscriptionId: string;
  
  /** Client ID */
  clientId: string;
  
  /** Event type */
  event: 'gazette.analyzed' | 'concurso.detected' | 'licitacao.detected';
  
  /** Timestamp */
  timestamp: string;
  
  /** Gazette information */
  gazette: {
    territoryId: string;
    territoryName: string;
    cityName: string;
    stateCode: string;
    stateName: string;
    region: string;
    formattedName: string;
    publicationDate: string;
    editionNumber?: string;
    pdfUrl: string;
    spiderId: string;
    spiderType: string;
  };
  
  /** Analysis summary */
  analysis: {
    jobId: string;
    totalFindings: number;
    highConfidenceFindings: number;
    categories: string[];
    processingTimeMs: number;
    analyzedAt: string;
    textLength: number;
  };
  
  /** Matched findings */
  findings: WebhookFinding[];
  
  /** Concurso-specific data (when event is concurso.detected) */
  concurso?: {
    totalVagas: number;
    cargos: Array<{
      cargo: string;
      vagas: number;
    }>;
    inscricoes?: any;
    provas?: any;
    taxas?: any[];
    keywords: string[];
  };
  
  /** Enhanced metadata */
  metadata: {
    power?: string;
    isExtraEdition?: boolean;
    webhookVersion: string;
    source: string;
    crawledAt: string;
  };
}

/**
 * Finding in webhook payload
 */
export interface WebhookFinding {
  /** Finding type */
  type: string;
  
  /** Confidence score (0-1) */
  confidence: number;
  
  /** Finding data */
  data: Record<string, any>;
  
  /** Context text */
  context?: string;
  
  /** Position in text */
  position?: number;
}

/**
 * Webhook queue message
 */
export interface WebhookQueueMessage {
  /** Message ID */
  messageId: string;
  
  /** Subscription ID */
  subscriptionId: string;
  
  /** Notification payload */
  notification: WebhookNotification;
  
  /** Queued timestamp */
  queuedAt: string;
  
  /** Attempt count */
  attempts?: number;
  
  /** Metadata for processing */
  metadata?: {
    /** Crawl job ID for telemetry */
    crawlJobId?: string;
    /** Territory ID for telemetry */
    territoryId?: string;
  };
}

/**
 * Webhook delivery result
 */
export interface WebhookDeliveryResult {
  /** Message ID */
  messageId: string;
  
  /** Subscription ID */
  subscriptionId: string;
  
  /** Delivery status - matches database webhook_status enum */
  status: 'sent' | 'failed' | 'retry' | 'pending';
  
  /** HTTP status code */
  statusCode?: number;
  
  /** Response body */
  responseBody?: string;
  
  /** Error message */
  error?: string;
  
  /** Delivery timestamp */
  deliveredAt: string;
  
  /** Delivery time in ms */
  deliveryTimeMs: number;
  
  /** Attempt number */
  attempt: number;
}

/**
 * Webhook configuration for Qconcursos
 */
export interface QconcursosWebhookConfig {
  /** Webhook URL */
  webhookUrl: string;
  
  /** Authentication token */
  authToken?: string;
  
  /** Filter only concurso findings */
  concursoOnly: boolean;
  
  /** Minimum confidence */
  minConfidence: number;
  
  /** Territory filter (optional) */
  territories?: string[];
  
  /** Notify immediately or batch */
  immediate: boolean;
}
