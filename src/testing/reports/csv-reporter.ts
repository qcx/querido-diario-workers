/**
 * CSV report generator
 */

import { TestSuiteResult } from '../types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Generates CSV reports
 */
export class CsvReporter {
  /**
   * Generates a CSV report
   */
  async generate(result: TestSuiteResult, outputPath: string): Promise<void> {
    const csv = this.buildCsv(result);

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, csv, 'utf-8');
  }

  /**
   * Builds the CSV content
   */
  private buildCsv(result: TestSuiteResult): string {
    const headers = [
      'City ID',
      'City Name',
      'Territory ID',
      'Spider Type',
      'Status',
      'Gazettes Found',
      'Execution Time (ms)',
      'Request Count',
      'Date Range Start',
      'Date Range End',
      'Error Message',
      'URL Accessible',
      'Can Fetch Gazettes',
      'Valid Structure',
      'Valid Metadata',
      'PDF URLs Accessible',
      'Tested At',
    ];

    const rows = result.results.map((r) => [
      this.escapeCsv(r.cityId),
      this.escapeCsv(r.cityName),
      this.escapeCsv(r.territoryId),
      this.escapeCsv(r.spiderType),
      this.escapeCsv(r.status),
      r.gazettesFound.toString(),
      r.executionTime.toString(),
      r.requestCount.toString(),
      this.escapeCsv(r.dateRange.start),
      this.escapeCsv(r.dateRange.end),
      this.escapeCsv(r.error?.message || ''),
      r.validations.urlAccessible ? 'true' : 'false',
      r.validations.canFetchGazettes ? 'true' : 'false',
      r.validations.validStructure ? 'true' : 'false',
      r.validations.validMetadata ? 'true' : 'false',
      r.validations.pdfUrlsAccessible ? 'true' : 'false',
      this.escapeCsv(r.testedAt),
    ]);

    const csvLines = [headers.join(','), ...rows.map((r) => r.join(','))];

    return csvLines.join('\n');
  }

  /**
   * Escapes CSV values
   */
  private escapeCsv(value: string): string {
    if (!value) {
      return '';
    }

    // If value contains comma, quote, or newline, wrap in quotes and escape quotes
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }

    return value;
  }

  /**
   * Generates a summary CSV
   */
  async generateSummary(result: TestSuiteResult, outputPath: string): Promise<void> {
    const headers = ['Metric', 'Value'];

    const rows = [
      ['Execution ID', result.executionId],
      ['Mode', result.config.mode],
      ['Started At', result.startedAt],
      ['Completed At', result.completedAt],
      ['Total Execution Time (ms)', result.totalExecutionTime.toString()],
      ['Total Tested', result.summary.totalTested.toString()],
      ['Successful', result.summary.successful.toString()],
      ['Failed', result.summary.failed.toString()],
      ['Timeouts', result.summary.timeouts.toString()],
      ['Errors', result.summary.errors.toString()],
      ['Skipped', result.summary.skipped.toString()],
      ['Success Rate (%)', result.summary.successRate.toFixed(2)],
      ['Total Gazettes Found', result.summary.totalGazettesFound.toString()],
      ['Avg Execution Time (ms)', result.summary.avgExecutionTime.toFixed(2)],
    ];

    const csvLines = [
      headers.join(','),
      ...rows.map((r) => r.map((v) => this.escapeCsv(v)).join(',')),
    ];

    const csv = csvLines.join('\n');

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, csv, 'utf-8');
  }
}
