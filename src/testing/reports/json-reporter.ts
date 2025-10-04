/**
 * JSON report generator
 */

import { TestSuiteResult } from '../types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Generates JSON reports
 */
export class JsonReporter {
  /**
   * Generates a JSON report
   */
  async generate(result: TestSuiteResult, outputPath?: string): Promise<string> {
    const json = JSON.stringify(result, null, 2);

    if (outputPath) {
      await this.writeToFile(json, outputPath);
    }

    return json;
  }

  /**
   * Generates a summary JSON report (without detailed results)
   */
  async generateSummary(result: TestSuiteResult, outputPath?: string): Promise<string> {
    const summary = {
      executionId: result.executionId,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      totalExecutionTime: result.totalExecutionTime,
      summary: result.summary,
      config: {
        mode: result.config.mode,
        parallelWorkers: result.config.parallelWorkers,
        searchDays: result.config.searchDays,
      },
    };

    const json = JSON.stringify(summary, null, 2);

    if (outputPath) {
      await this.writeToFile(json, outputPath);
    }

    return json;
  }

  /**
   * Generates a failures-only JSON report
   */
  async generateFailuresReport(
    result: TestSuiteResult,
    outputPath?: string
  ): Promise<string> {
    const failures = result.results.filter(
      (r) => r.status === 'failure' || r.status === 'error' || r.status === 'timeout'
    );

    const failuresReport = {
      executionId: result.executionId,
      totalFailures: failures.length,
      failures: failures.map((f) => ({
        cityId: f.cityId,
        cityName: f.cityName,
        spiderType: f.spiderType,
        status: f.status,
        error: f.error,
        validations: f.validations.details.filter((d) => !d.passed),
      })),
    };

    const json = JSON.stringify(failuresReport, null, 2);

    if (outputPath) {
      await this.writeToFile(json, outputPath);
    }

    return json;
  }

  /**
   * Writes JSON to file
   */
  private async writeToFile(json: string, outputPath: string): Promise<void> {
    const dir = path.dirname(outputPath);

    // Create directory if it doesn't exist
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, json, 'utf-8');
  }
}
