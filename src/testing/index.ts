/**
 * Testing system exports
 */

// Core
export { TestRunner } from './test-runner';
export { createTestConfig, DEFAULT_TEST_CONFIG, TEST_PRESETS } from './test-config';

// Types
export * from './types';

// Validators
export { TestValidator } from './validators/test-validator';
export { StructureValidator } from './validators/structure-validator';
export { ContentValidator } from './validators/content-validator';
export { PerformanceValidator } from './validators/performance-validator';

// Reports
export {
  JsonReporter,
  HtmlReporter,
  MarkdownReporter,
  CsvReporter,
  ConsoleReporter,
} from './reports';

// Monitoring
export { HealthChecker } from './monitoring/health-checker';
export { TrendAnalyzer } from './monitoring/trend-analyzer';

// Utils
export * from './utils/test-helpers';
