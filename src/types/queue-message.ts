import { SpiderType, SpiderPlatformConfig, DateRange } from './spider-config';

/**
 * Message sent to the crawl queue
 */
export interface QueueMessage {
  /** Spider identifier */
  spiderId: string;
  
  /** Territory IBGE code */
  territoryId: string;
  
  /** Spider type */
  spiderType: SpiderType;
  
  /** Platform-specific configuration */
  config: SpiderPlatformConfig;
  
  /** Date range to crawl */
  dateRange: DateRange;
  
  /** Optional retry count */
  retryCount?: number;
  
  /** Additional metadata */
  metadata?: {
    crawlJobId?: string;
    [key: string]: any;
  };
}

/**
 * Request body for the dispatcher endpoint
 */
export interface DispatchRequest {
  /** List of spider IDs to crawl (or "all" for all spiders) */
  cities: string[] | 'all';
  
  /** Optional date range (defaults to last 30 days) */
  startDate?: string;
  endDate?: string;
}

/**
 * Response from the dispatcher endpoint
 */
export interface DispatchResponse {
  success: boolean;
  tasksEnqueued: number;
  cities: string[];
  crawlJobId?: string;
  error?: string;
}
