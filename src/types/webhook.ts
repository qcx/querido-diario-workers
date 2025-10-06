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
}

/**
 * Webhook delivery result
 */
export interface WebhookDeliveryResult {
  /** Message ID */
  messageId: string;
  
  /** Subscription ID */
  subscriptionId: string;
  
  /** Delivery status */
  status: 'success' | 'failure' | 'retry';
  
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
