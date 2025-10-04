/**
 * Performance validator - validates spider performance metrics
 */

import { BaseSpider } from '../../spiders/base/base-spider';
import { ValidationDetail } from '../types';

export interface PerformanceValidationResult {
  passed: boolean;
  details: ValidationDetail[];
}

/**
 * Performance thresholds
 */
const PERFORMANCE_THRESHOLDS = {
  // Maximum acceptable execution time in milliseconds
  maxExecutionTime: 120000, // 2 minutes
  
  // Warning threshold for execution time
  warnExecutionTime: 60000, // 1 minute
  
  // Maximum acceptable requests per gazette
  maxRequestsPerGazette: 10,
  
  // Warning threshold for requests per gazette
  warnRequestsPerGazette: 5,
};

/**
 * Validates spider performance
 */
export class PerformanceValidator {
  /**
   * Validates performance metrics
   */
  validate(spider: BaseSpider, executionTime: number): PerformanceValidationResult {
    const details: ValidationDetail[] = [];

    // Validate execution time
    if (executionTime > PERFORMANCE_THRESHOLDS.maxExecutionTime) {
      details.push({
        name: 'execution_time',
        passed: false,
        message: `Execution time (${executionTime}ms) exceeds maximum threshold (${PERFORMANCE_THRESHOLDS.maxExecutionTime}ms)`,
        context: { executionTime, threshold: PERFORMANCE_THRESHOLDS.maxExecutionTime },
      });
    } else if (executionTime > PERFORMANCE_THRESHOLDS.warnExecutionTime) {
      details.push({
        name: 'execution_time',
        passed: true,
        message: `Execution time (${executionTime}ms) is acceptable but above warning threshold (${PERFORMANCE_THRESHOLDS.warnExecutionTime}ms)`,
        context: { executionTime, threshold: PERFORMANCE_THRESHOLDS.warnExecutionTime },
      });
    } else {
      details.push({
        name: 'execution_time',
        passed: true,
        message: `Execution time (${executionTime}ms) is within acceptable range`,
        context: { executionTime },
      });
    }

    // Validate request count (if available)
    if (spider.getRequestCount) {
      const requestCount = spider.getRequestCount();
      
      details.push({
        name: 'request_count',
        passed: true,
        message: `Spider made ${requestCount} HTTP requests`,
        context: { requestCount },
      });

      // Calculate requests per gazette (if we have gazette count)
      // Note: We don't have gazette count here, so we skip this validation
      // It could be added by passing gazette count to this method
    }

    // All performance checks passed if no failures
    const allPassed = details.every((d) => d.passed);

    return { passed: allPassed, details };
  }

  /**
   * Validates request efficiency
   */
  validateRequestEfficiency(
    requestCount: number,
    gazetteCount: number
  ): ValidationDetail {
    if (gazetteCount === 0) {
      return {
        name: 'request_efficiency',
        passed: true,
        message: 'No gazettes found, request efficiency not applicable',
      };
    }

    const requestsPerGazette = requestCount / gazetteCount;

    if (requestsPerGazette > PERFORMANCE_THRESHOLDS.maxRequestsPerGazette) {
      return {
        name: 'request_efficiency',
        passed: false,
        message: `Requests per gazette (${requestsPerGazette.toFixed(2)}) exceeds maximum threshold (${PERFORMANCE_THRESHOLDS.maxRequestsPerGazette})`,
        context: {
          requestsPerGazette,
          threshold: PERFORMANCE_THRESHOLDS.maxRequestsPerGazette,
        },
      };
    } else if (requestsPerGazette > PERFORMANCE_THRESHOLDS.warnRequestsPerGazette) {
      return {
        name: 'request_efficiency',
        passed: true,
        message: `Requests per gazette (${requestsPerGazette.toFixed(2)}) is acceptable but above warning threshold (${PERFORMANCE_THRESHOLDS.warnRequestsPerGazette})`,
        context: {
          requestsPerGazette,
          threshold: PERFORMANCE_THRESHOLDS.warnRequestsPerGazette,
        },
      };
    } else {
      return {
        name: 'request_efficiency',
        passed: true,
        message: `Requests per gazette (${requestsPerGazette.toFixed(2)}) is efficient`,
        context: { requestsPerGazette },
      };
    }
  }

  /**
   * Validates memory usage (if available)
   */
  validateMemoryUsage(memoryUsage: number): ValidationDetail {
    const maxMemory = 512 * 1024 * 1024; // 512 MB
    const warnMemory = 256 * 1024 * 1024; // 256 MB

    if (memoryUsage > maxMemory) {
      return {
        name: 'memory_usage',
        passed: false,
        message: `Memory usage (${(memoryUsage / 1024 / 1024).toFixed(2)} MB) exceeds maximum threshold (${maxMemory / 1024 / 1024} MB)`,
        context: { memoryUsage, threshold: maxMemory },
      };
    } else if (memoryUsage > warnMemory) {
      return {
        name: 'memory_usage',
        passed: true,
        message: `Memory usage (${(memoryUsage / 1024 / 1024).toFixed(2)} MB) is acceptable but above warning threshold (${warnMemory / 1024 / 1024} MB)`,
        context: { memoryUsage, threshold: warnMemory },
      };
    } else {
      return {
        name: 'memory_usage',
        passed: true,
        message: `Memory usage (${(memoryUsage / 1024 / 1024).toFixed(2)} MB) is within acceptable range`,
        context: { memoryUsage },
      };
    }
  }
}
