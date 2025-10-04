/**
 * Types and interfaces for the automated testing system
 */

import { SpiderConfig, SpiderType } from '../types';

/**
 * Test execution mode
 */
export type TestMode = 'full' | 'sample' | 'platform' | 'regression' | 'single' | 'until';

/**
 * Test result status
 */
export type TestStatus = 'success' | 'failure' | 'skipped' | 'timeout' | 'error';

/**
 * Test configuration
 */
export interface TestConfig {
  /** Test execution mode */
  mode: TestMode;
  
  /** Number of parallel workers */
  parallelWorkers: number;
  
  /** Timeout per city in milliseconds */
  timeoutPerCity: number;
  
  /** Number of days to search back from today */
  searchDays: number;
  
  /** Rate limit per domain (requests per second) */
  rateLimitPerDomain: number;
  
  /** Delay between requests in milliseconds */
  requestDelay: number;
  
  /** Number of retry attempts on failure */
  maxRetries: number;
  
  /** Cities to skip (IDs) */
  skipCities?: string[];
  
  /** Specific platform to test (for platform mode) */
  platform?: SpiderType;
  
  /** Specific cities to test (for single mode) */
  cities?: string[];
  
  /** Sample size percentage (for sample mode) */
  samplePercentage?: number;
  
  /** Target number of gazettes to collect (for until mode) */
  targetGazettes?: number;
  
  /** Enable verbose logging */
  verbose?: boolean;
  
  /** Output directory for reports */
  outputDir?: string;
}

/**
 * Result of a single city test
 */
export interface CityTestResult {
  /** City spider ID */
  cityId: string;
  
  /** City name */
  cityName: string;
  
  /** Territory IBGE code */
  territoryId: string;
  
  /** Spider type/platform */
  spiderType: SpiderType;
  
  /** Test status */
  status: TestStatus;
  
  /** Number of gazettes found */
  gazettesFound: number;
  
  /** Execution time in milliseconds */
  executionTime: number;
  
  /** Number of HTTP requests made */
  requestCount: number;
  
  /** Date range tested */
  dateRange: {
    start: string;
    end: string;
  };
  
  /** Error information if test failed */
  error?: {
    message: string;
    code?: string;
    stack?: string;
  };
  
  /** Validation results */
  validations: ValidationResults;
  
  /** Timestamp when test was executed */
  testedAt: string;
  
  /** Number of retry attempts */
  retries?: number;
}

/**
 * Validation results for a test
 */
export interface ValidationResults {
  /** Spider can access the platform URL */
  urlAccessible: boolean;
  
  /** Spider can fetch gazettes */
  canFetchGazettes: boolean;
  
  /** Returned data has valid structure */
  validStructure: boolean;
  
  /** Metadata is present and valid */
  validMetadata: boolean;
  
  /** PDF URLs are accessible */
  pdfUrlsAccessible: boolean;
  
  /** Individual validation details */
  details: ValidationDetail[];
}

/**
 * Individual validation detail
 */
export interface ValidationDetail {
  /** Validation name */
  name: string;
  
  /** Whether validation passed */
  passed: boolean;
  
  /** Error message if validation failed */
  message?: string;
  
  /** Additional context */
  context?: any;
}

/**
 * Overall test suite results
 */
export interface TestSuiteResult {
  /** Test execution ID */
  executionId: string;
  
  /** Test configuration used */
  config: TestConfig;
  
  /** Start timestamp */
  startedAt: string;
  
  /** End timestamp */
  completedAt: string;
  
  /** Total execution time in milliseconds */
  totalExecutionTime: number;
  
  /** Results for each city tested */
  results: CityTestResult[];
  
  /** Summary statistics */
  summary: TestSummary;
  
  /** System information */
  systemInfo?: {
    nodeVersion?: string;
    platform?: string;
    memory?: number;
  };
}

/**
 * Test summary statistics
 */
export interface TestSummary {
  /** Total cities tested */
  totalTested: number;
  
  /** Number of successful tests */
  successful: number;
  
  /** Number of failed tests */
  failed: number;
  
  /** Number of skipped tests */
  skipped: number;
  
  /** Number of timeouts */
  timeouts: number;
  
  /** Number of errors */
  errors: number;
  
  /** Success rate (0-100) */
  successRate: number;
  
  /** Average execution time per city */
  avgExecutionTime: number;
  
  /** Total gazettes found across all tests */
  totalGazettesFound: number;
  
  /** Breakdown by platform */
  byPlatform: PlatformSummary[];
  
  /** Breakdown by status */
  byStatus: {
    [key in TestStatus]: number;
  };
}

/**
 * Summary statistics per platform
 */
export interface PlatformSummary {
  /** Platform/spider type */
  platform: SpiderType;
  
  /** Total cities tested for this platform */
  total: number;
  
  /** Successful tests */
  successful: number;
  
  /** Failed tests */
  failed: number;
  
  /** Success rate */
  successRate: number;
  
  /** Average execution time */
  avgExecutionTime: number;
}

/**
 * Health check result for a platform
 */
export interface PlatformHealthCheck {
  /** Platform identifier */
  platform: SpiderType;
  
  /** Base URL checked */
  url: string;
  
  /** Whether platform is accessible */
  isAccessible: boolean;
  
  /** HTTP status code */
  statusCode?: number;
  
  /** Response time in milliseconds */
  responseTime?: number;
  
  /** Error message if check failed */
  error?: string;
  
  /** Timestamp of check */
  checkedAt: string;
}

/**
 * Trend analysis data point
 */
export interface TrendDataPoint {
  /** Execution ID */
  executionId: string;
  
  /** Timestamp */
  timestamp: string;
  
  /** Success rate */
  successRate: number;
  
  /** Total tests */
  totalTests: number;
  
  /** Average execution time */
  avgExecutionTime: number;
}

/**
 * Alert configuration
 */
export interface AlertConfig {
  /** Alert type */
  type: 'slack' | 'discord' | 'email' | 'webhook';
  
  /** Alert severity threshold */
  severity: 'critical' | 'warning' | 'info';
  
  /** Webhook URL or endpoint */
  endpoint?: string;
  
  /** Email recipients */
  recipients?: string[];
  
  /** Enable/disable alert */
  enabled: boolean;
}

/**
 * Alert message
 */
export interface AlertMessage {
  /** Alert severity */
  severity: 'critical' | 'warning' | 'info';
  
  /** Alert title */
  title: string;
  
  /** Alert message */
  message: string;
  
  /** Test execution ID */
  executionId: string;
  
  /** Timestamp */
  timestamp: string;
  
  /** Additional context */
  context?: any;
}

/**
 * Report format
 */
export type ReportFormat = 'json' | 'html' | 'markdown' | 'csv' | 'console';

/**
 * Report generation options
 */
export interface ReportOptions {
  /** Output format */
  format: ReportFormat;
  
  /** Output file path (if applicable) */
  outputPath?: string;
  
  /** Include detailed results */
  includeDetails?: boolean;
  
  /** Include system information */
  includeSystemInfo?: boolean;
  
  /** Include trend analysis */
  includeTrends?: boolean;
}
