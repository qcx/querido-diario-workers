/**
 * Test configuration and defaults
 */

import { TestConfig, TestMode } from './types';

/**
 * Default test configuration
 */
export const DEFAULT_TEST_CONFIG: TestConfig = {
  mode: 'sample',
  parallelWorkers: 10,
  timeoutPerCity: 60000, // 60 seconds
  searchDays: 7,
  rateLimitPerDomain: 5, // requests per second
  requestDelay: 500, // milliseconds
  maxRetries: 3,
  samplePercentage: 10,
  verbose: false,
  outputDir: './test-results',
};

/**
 * Configuration presets for different test modes
 */
export const TEST_PRESETS: Record<TestMode, Partial<TestConfig>> = {
  full: {
    mode: 'full',
    parallelWorkers: 15,
    timeoutPerCity: 90000,
    searchDays: 7,
    samplePercentage: 100,
  },
  
  sample: {
    mode: 'sample',
    parallelWorkers: 10,
    timeoutPerCity: 60000,
    searchDays: 7,
    samplePercentage: 10,
  },
  
  platform: {
    mode: 'platform',
    parallelWorkers: 10,
    timeoutPerCity: 60000,
    searchDays: 7,
  },
  
  regression: {
    mode: 'regression',
    parallelWorkers: 5,
    timeoutPerCity: 90000,
    searchDays: 7,
    maxRetries: 5,
  },
  
  single: {
    mode: 'single',
    parallelWorkers: 1,
    timeoutPerCity: 120000,
    searchDays: 7,
    verbose: true,
  },
};

/**
 * Rate limiting configuration per domain
 */
export const DOMAIN_RATE_LIMITS: Record<string, number> = {
  'doem.org.br': 3,
  'diariomunicipal.com.br': 5,
  'imprensaoficialmunicipal.com.br': 5,
  'adiarios.com.br': 3,
  'default': 5,
};

/**
 * Timeout configuration per spider type
 */
export const SPIDER_TIMEOUTS: Record<string, number> = {
  'adiarios_v2': 120000, // Puppeteer-based, needs more time
  'default': 60000,
};

/**
 * Cities to skip in automated tests (known issues, maintenance, etc.)
 */
export const SKIP_CITIES: string[] = [
  // Add city IDs here if they need to be skipped
  // Example: 'ba_acajutiba',
];

/**
 * Minimum number of gazettes expected for a test to be considered successful
 * Set to 0 to allow tests to pass even if no gazettes are found (useful for periods without publications)
 */
export const MIN_GAZETTES_THRESHOLD = 0;

/**
 * Success rate threshold for triggering alerts (percentage)
 */
export const SUCCESS_RATE_ALERT_THRESHOLD = 90;

/**
 * Maximum number of failed cities before stopping the test suite (0 = no limit)
 */
export const MAX_FAILED_CITIES_BEFORE_STOP = 0;

/**
 * Creates a test configuration by merging preset with custom options
 */
export function createTestConfig(
  mode: TestMode,
  customConfig?: Partial<TestConfig>
): TestConfig {
  const preset = TEST_PRESETS[mode];
  
  return {
    ...DEFAULT_TEST_CONFIG,
    ...preset,
    ...customConfig,
    skipCities: [
      ...(SKIP_CITIES || []),
      ...(customConfig?.skipCities || []),
    ],
  };
}

/**
 * Gets the rate limit for a specific domain
 */
export function getRateLimitForDomain(url: string): number {
  try {
    const domain = new URL(url).hostname;
    
    // Check for exact match
    if (DOMAIN_RATE_LIMITS[domain]) {
      return DOMAIN_RATE_LIMITS[domain];
    }
    
    // Check for partial match (e.g., subdomain)
    for (const [key, value] of Object.entries(DOMAIN_RATE_LIMITS)) {
      if (domain.includes(key)) {
        return value;
      }
    }
    
    return DOMAIN_RATE_LIMITS.default;
  } catch {
    return DOMAIN_RATE_LIMITS.default;
  }
}

/**
 * Gets the timeout for a specific spider type
 */
export function getTimeoutForSpider(spiderType: string): number {
  return SPIDER_TIMEOUTS[spiderType] || SPIDER_TIMEOUTS.default;
}

/**
 * Validates test configuration
 */
export function validateTestConfig(config: TestConfig): string[] {
  const errors: string[] = [];
  
  if (config.parallelWorkers < 1) {
    errors.push('parallelWorkers must be at least 1');
  }
  
  if (config.parallelWorkers > 50) {
    errors.push('parallelWorkers should not exceed 50 to avoid overloading servers');
  }
  
  if (config.timeoutPerCity < 10000) {
    errors.push('timeoutPerCity must be at least 10000ms (10 seconds)');
  }
  
  if (config.searchDays < 1) {
    errors.push('searchDays must be at least 1');
  }
  
  if (config.searchDays > 365) {
    errors.push('searchDays should not exceed 365 to avoid long execution times');
  }
  
  if (config.rateLimitPerDomain < 1) {
    errors.push('rateLimitPerDomain must be at least 1');
  }
  
  if (config.requestDelay < 0) {
    errors.push('requestDelay must be non-negative');
  }
  
  if (config.maxRetries < 0) {
    errors.push('maxRetries must be non-negative');
  }
  
  if (config.mode === 'platform' && !config.platform) {
    errors.push('platform must be specified when mode is "platform"');
  }
  
  if (config.mode === 'single' && (!config.cities || config.cities.length === 0)) {
    errors.push('cities must be specified when mode is "single"');
  }
  
  if (config.mode === 'sample' && config.samplePercentage) {
    if (config.samplePercentage < 1 || config.samplePercentage > 100) {
      errors.push('samplePercentage must be between 1 and 100');
    }
  }
  
  return errors;
}
