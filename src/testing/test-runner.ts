/**
 * Main test runner for automated spider testing
 */

import { spiderRegistry } from '../spiders/registry';
import { SpiderConfig, DateRange } from '../types';
import {
  TestConfig,
  TestSuiteResult,
  CityTestResult,
  TestStatus,
  TestSummary,
  PlatformSummary,
} from './types';
import { validateTestConfig } from './test-config';
import { TestValidator } from './validators/test-validator';
import { subDays, format } from 'date-fns';

/**
 * Test runner class
 */
export class TestRunner {
  private config: TestConfig;
  private validator: TestValidator;
  private results: CityTestResult[] = [];
  private startTime: number = 0;
  private executionId: string = '';

  constructor(config: TestConfig) {
    // Validate configuration
    const errors = validateTestConfig(config);
    if (errors.length > 0) {
      throw new Error(`Invalid test configuration:\n${errors.join('\n')}`);
    }

    this.config = config;
    this.validator = new TestValidator();
    this.executionId = this.generateExecutionId();
  }

  /**
   * Generates a unique execution ID
   */
  private generateExecutionId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substring(2, 8);
    return `test-${timestamp}-${random}`;
  }

  /**
   * Runs the test suite
   */
  async run(): Promise<TestSuiteResult> {
    this.startTime = Date.now();
    this.results = [];

    this.log('info', `Starting test execution: ${this.executionId}`);
    this.log('info', `Mode: ${this.config.mode}`);

    // Get cities to test based on mode
    const citiesToTest = this.getCitiesToTest();
    this.log('info', `Total cities to test: ${citiesToTest.length}`);

    // Run tests in parallel with worker pool
    await this.runTestsInParallel(citiesToTest);

    // Generate summary
    const summary = this.generateSummary();

    // Create final result
    const result: TestSuiteResult = {
      executionId: this.executionId,
      config: this.config,
      startedAt: new Date(this.startTime).toISOString(),
      completedAt: new Date().toISOString(),
      totalExecutionTime: Date.now() - this.startTime,
      results: this.results,
      summary,
      systemInfo: {
        nodeVersion: process.version,
        platform: process.platform,
        memory: process.memoryUsage().heapUsed,
      },
    };

    this.log('info', `Test execution completed: ${this.executionId}`);
    this.log('info', `Success rate: ${summary.successRate.toFixed(2)}%`);

    return result;
  }

  /**
   * Gets the list of cities to test based on configuration
   */
  private getCitiesToTest(): SpiderConfig[] {
    const allConfigs = spiderRegistry.getAllConfigs();

    switch (this.config.mode) {
      case 'full':
        return this.filterSkippedCities(allConfigs);

      case 'sample':
        return this.getSampleCities(allConfigs);

      case 'platform':
        if (!this.config.platform) {
          throw new Error('Platform must be specified for platform mode');
        }
        return this.filterSkippedCities(
          allConfigs.filter((c) => c.spiderType === this.config.platform)
        );

      case 'single':
        if (!this.config.cities || this.config.cities.length === 0) {
          throw new Error('Cities must be specified for single mode');
        }
        return this.filterSkippedCities(
          allConfigs.filter((c) => this.config.cities!.includes(c.id))
        );

      case 'regression':
        // For regression mode, we would load previously failed cities
        // For now, return empty array (to be implemented with persistent storage)
        this.log('warn', 'Regression mode not yet fully implemented, running sample instead');
        return this.getSampleCities(allConfigs);

      default:
        throw new Error(`Unknown test mode: ${this.config.mode}`);
    }
  }

  /**
   * Filters out cities that should be skipped
   */
  private filterSkippedCities(configs: SpiderConfig[]): SpiderConfig[] {
    if (!this.config.skipCities || this.config.skipCities.length === 0) {
      return configs;
    }

    return configs.filter((c) => !this.config.skipCities!.includes(c.id));
  }

  /**
   * Gets a random sample of cities
   */
  private getSampleCities(allConfigs: SpiderConfig[]): SpiderConfig[] {
    const filtered = this.filterSkippedCities(allConfigs);
    const sampleSize = Math.ceil(
      (filtered.length * (this.config.samplePercentage || 10)) / 100
    );

    // Shuffle and take sample
    const shuffled = [...filtered].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, sampleSize);
  }

  /**
   * Runs tests in parallel with worker pool
   */
  private async runTestsInParallel(cities: SpiderConfig[]): Promise<void> {
    const workers = this.config.parallelWorkers;
    const chunks: SpiderConfig[][] = [];

    // Split cities into chunks for parallel processing
    for (let i = 0; i < cities.length; i += workers) {
      chunks.push(cities.slice(i, i + workers));
    }

    // Process each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      this.log(
        'info',
        `Processing batch ${i + 1}/${chunks.length} (${chunk.length} cities)`
      );

      // Run tests in parallel for this chunk
      const promises = chunk.map((city) => this.testCity(city));
      const chunkResults = await Promise.allSettled(promises);

      // Process results
      chunkResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          this.results.push(result.value);
        } else {
          // Create error result for rejected promise
          const city = chunk[index];
          this.results.push(this.createErrorResult(city, result.reason));
        }
      });

      // Add delay between chunks to respect rate limiting
      if (i < chunks.length - 1) {
        await this.sleep(this.config.requestDelay);
      }
    }
  }

  /**
   * Tests a single city
   */
  private async testCity(config: SpiderConfig): Promise<CityTestResult> {
    const startTime = Date.now();
    const dateRange = this.getDateRange();

    this.log('debug', `Testing ${config.id} (${config.name})`);

    try {
      // Create spider instance
      const spider = spiderRegistry.createSpider(config, dateRange);

      // Run test with timeout
      const result = await this.runWithTimeout(
        () => this.validator.validateSpider(spider, config, dateRange),
        this.config.timeoutPerCity
      );

      const executionTime = Date.now() - startTime;

      this.log(
        'debug',
        `✓ ${config.id}: ${result.status} (${result.gazettesFound} gazettes, ${executionTime}ms)`
      );

      return {
        ...result,
        executionTime,
      };
    } catch (error: any) {
      const executionTime = Date.now() - startTime;

      this.log('debug', `✗ ${config.id}: ${error.message}`);

      return this.createErrorResult(config, error, executionTime);
    }
  }

  /**
   * Runs a function with timeout
   */
  private async runWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Test timeout')), timeoutMs)
      ),
    ]);
  }

  /**
   * Creates an error result for a failed test
   */
  private createErrorResult(
    config: SpiderConfig,
    error: any,
    executionTime: number = 0
  ): CityTestResult {
    const isTimeout = error.message?.includes('timeout');

    return {
      cityId: config.id,
      cityName: config.name,
      territoryId: config.territoryId,
      spiderType: config.spiderType,
      status: isTimeout ? 'timeout' : 'error',
      gazettesFound: 0,
      executionTime,
      requestCount: 0,
      dateRange: this.getDateRange(),
      error: {
        message: error.message || 'Unknown error',
        code: error.code,
        stack: error.stack,
      },
      validations: {
        urlAccessible: false,
        canFetchGazettes: false,
        validStructure: false,
        validMetadata: false,
        pdfUrlsAccessible: false,
        details: [],
      },
      testedAt: new Date().toISOString(),
    };
  }

  /**
   * Gets the date range for testing
   */
  private getDateRange(): DateRange {
    const end = new Date();
    const start = subDays(end, this.config.searchDays);

    return {
      start: format(start, 'yyyy-MM-dd'),
      end: format(end, 'yyyy-MM-dd'),
    };
  }

  /**
   * Generates summary statistics
   */
  private generateSummary(): TestSummary {
    const total = this.results.length;
    const successful = this.results.filter((r) => r.status === 'success').length;
    const failed = this.results.filter((r) => r.status === 'failure').length;
    const skipped = this.results.filter((r) => r.status === 'skipped').length;
    const timeouts = this.results.filter((r) => r.status === 'timeout').length;
    const errors = this.results.filter((r) => r.status === 'error').length;

    const successRate = total > 0 ? (successful / total) * 100 : 0;

    const avgExecutionTime =
      total > 0
        ? this.results.reduce((sum, r) => sum + r.executionTime, 0) / total
        : 0;

    const totalGazettesFound = this.results.reduce(
      (sum, r) => sum + r.gazettesFound,
      0
    );

    // Group by platform
    const platformMap = new Map<string, CityTestResult[]>();
    for (const result of this.results) {
      const platform = result.spiderType;
      if (!platformMap.has(platform)) {
        platformMap.set(platform, []);
      }
      platformMap.get(platform)!.push(result);
    }

    const byPlatform: PlatformSummary[] = Array.from(platformMap.entries()).map(
      ([platform, results]) => {
        const platformTotal = results.length;
        const platformSuccessful = results.filter(
          (r) => r.status === 'success'
        ).length;
        const platformFailed = results.filter(
          (r) => r.status === 'failure' || r.status === 'error' || r.status === 'timeout'
        ).length;
        const platformSuccessRate =
          platformTotal > 0 ? (platformSuccessful / platformTotal) * 100 : 0;
        const platformAvgTime =
          platformTotal > 0
            ? results.reduce((sum, r) => sum + r.executionTime, 0) / platformTotal
            : 0;

        return {
          platform: platform as any,
          total: platformTotal,
          successful: platformSuccessful,
          failed: platformFailed,
          successRate: platformSuccessRate,
          avgExecutionTime: platformAvgTime,
        };
      }
    );

    return {
      totalTested: total,
      successful,
      failed,
      skipped,
      timeouts,
      errors,
      successRate,
      avgExecutionTime,
      totalGazettesFound,
      byPlatform,
      byStatus: {
        success: successful,
        failure: failed,
        skipped,
        timeout: timeouts,
        error: errors,
      },
    };
  }

  /**
   * Logs a message
   */
  private log(level: 'info' | 'warn' | 'error' | 'debug', message: string): void {
    if (level === 'debug' && !this.config.verbose) {
      return;
    }

    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

    console.log(`${prefix} ${message}`);
  }

  /**
   * Sleeps for a specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Gets the execution ID
   */
  getExecutionId(): string {
    return this.executionId;
  }

  /**
   * Gets the current results
   */
  getResults(): CityTestResult[] {
    return this.results;
  }
}
