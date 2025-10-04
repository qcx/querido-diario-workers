/**
 * Console report generator
 */

import { TestSuiteResult, TestStatus } from '../types';

/**
 * Generates console reports
 */
export class ConsoleReporter {
  /**
   * Generates a console report
   */
  generate(result: TestSuiteResult): void {
    console.log('\n' + '='.repeat(80));
    console.log('TEST EXECUTION REPORT');
    console.log('='.repeat(80));

    this.printHeader(result);
    this.printSummary(result);
    this.printPlatformBreakdown(result);
    this.printFailures(result);
    this.printFooter(result);
  }

  /**
   * Prints report header
   */
  private printHeader(result: TestSuiteResult): void {
    console.log('\n📋 Execution Information:');
    console.log(`   ID: ${result.executionId}`);
    console.log(`   Mode: ${result.config.mode}`);
    console.log(`   Started: ${new Date(result.startedAt).toLocaleString()}`);
    console.log(`   Completed: ${new Date(result.completedAt).toLocaleString()}`);
    console.log(
      `   Duration: ${this.formatDuration(result.totalExecutionTime)}`
    );
  }

  /**
   * Prints summary statistics
   */
  private printSummary(result: TestSuiteResult): void {
    const { summary } = result;

    console.log('\n📊 Summary Statistics:');
    console.log(`   Total Tested: ${summary.totalTested}`);
    console.log(
      `   ✅ Successful: ${summary.successful} (${summary.successRate.toFixed(2)}%)`
    );
    console.log(`   ❌ Failed: ${summary.failed}`);
    console.log(`   ⏱️  Timeouts: ${summary.timeouts}`);
    console.log(`   ⚠️  Errors: ${summary.errors}`);
    console.log(`   ⏭️  Skipped: ${summary.skipped}`);
    console.log(
      `   📄 Total Gazettes Found: ${summary.totalGazettesFound}`
    );
    console.log(
      `   ⏱️  Avg Execution Time: ${this.formatDuration(summary.avgExecutionTime)}`
    );

    // Visual success rate bar
    console.log('\n   Success Rate:');
    this.printProgressBar(summary.successRate);
  }

  /**
   * Prints platform breakdown
   */
  private printPlatformBreakdown(result: TestSuiteResult): void {
    const { byPlatform } = result.summary;

    if (byPlatform.length === 0) {
      return;
    }

    console.log('\n🏢 Platform Breakdown:');
    console.log(
      '   ' +
        '-'.repeat(78)
    );
    console.log(
      `   ${'Platform'.padEnd(25)} ${'Total'.padEnd(8)} ${'Success'.padEnd(10)} ${'Failed'.padEnd(10)} ${'Rate'.padEnd(10)} ${'Avg Time'.padEnd(10)}`
    );
    console.log(
      '   ' +
        '-'.repeat(78)
    );

    for (const platform of byPlatform) {
      const name = platform.platform.padEnd(25);
      const total = platform.total.toString().padEnd(8);
      const successful = platform.successful.toString().padEnd(10);
      const failed = platform.failed.toString().padEnd(10);
      const rate = `${platform.successRate.toFixed(1)}%`.padEnd(10);
      const avgTime = this.formatDuration(platform.avgExecutionTime).padEnd(10);

      console.log(
        `   ${name} ${total} ${successful} ${failed} ${rate} ${avgTime}`
      );
    }

    console.log(
      '   ' +
        '-'.repeat(78)
    );
  }

  /**
   * Prints failures
   */
  private printFailures(result: TestSuiteResult): void {
    const failures = result.results.filter(
      (r) =>
        r.status === 'failure' ||
        r.status === 'error' ||
        r.status === 'timeout'
    );

    if (failures.length === 0) {
      console.log('\n✅ No failures detected!');
      return;
    }

    console.log(`\n❌ Failures (${failures.length}):`);
    console.log(
      '   ' +
        '-'.repeat(78)
    );

    for (const failure of failures.slice(0, 20)) {
      // Show max 20 failures
      const statusIcon = this.getStatusIcon(failure.status);
      console.log(
        `   ${statusIcon} ${failure.cityId} (${failure.cityName})`
      );
      console.log(`      Platform: ${failure.spiderType}`);
      console.log(`      Status: ${failure.status}`);

      if (failure.error) {
        console.log(`      Error: ${failure.error.message}`);
      }

      // Show failed validations
      const failedValidations = failure.validations.details.filter(
        (d) => !d.passed
      );
      if (failedValidations.length > 0) {
        console.log(`      Failed Validations:`);
        for (const validation of failedValidations) {
          console.log(`         - ${validation.name}: ${validation.message}`);
        }
      }

      console.log('');
    }

    if (failures.length > 20) {
      console.log(`   ... and ${failures.length - 20} more failures`);
    }

    console.log(
      '   ' +
        '-'.repeat(78)
    );
  }

  /**
   * Prints report footer
   */
  private printFooter(result: TestSuiteResult): void {
    const { summary } = result;

    console.log('\n' + '='.repeat(80));

    if (summary.successRate >= 95) {
      console.log('🎉 EXCELLENT! Success rate is above 95%');
    } else if (summary.successRate >= 90) {
      console.log('✅ GOOD! Success rate is above 90%');
    } else if (summary.successRate >= 80) {
      console.log('⚠️  WARNING! Success rate is below 90%');
    } else {
      console.log('❌ CRITICAL! Success rate is below 80%');
    }

    console.log('='.repeat(80) + '\n');
  }

  /**
   * Prints a progress bar
   */
  private printProgressBar(percentage: number): void {
    const barLength = 50;
    const filledLength = Math.round((percentage / 100) * barLength);
    const emptyLength = barLength - filledLength;

    const filled = '█'.repeat(filledLength);
    const empty = '░'.repeat(emptyLength);

    const color = percentage >= 90 ? '✅' : percentage >= 80 ? '⚠️' : '❌';

    console.log(
      `   ${color} [${filled}${empty}] ${percentage.toFixed(2)}%`
    );
  }

  /**
   * Gets status icon
   */
  private getStatusIcon(status: TestStatus): string {
    switch (status) {
      case 'success':
        return '✅';
      case 'failure':
        return '❌';
      case 'timeout':
        return '⏱️';
      case 'error':
        return '⚠️';
      case 'skipped':
        return '⏭️';
      default:
        return '❓';
    }
  }

  /**
   * Formats duration in milliseconds to human-readable format
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms.toFixed(0)}ms`;
    } else if (ms < 60000) {
      return `${(ms / 1000).toFixed(2)}s`;
    } else {
      const minutes = Math.floor(ms / 60000);
      const seconds = ((ms % 60000) / 1000).toFixed(0);
      return `${minutes}m ${seconds}s`;
    }
  }

  /**
   * Generates a compact summary for CI/CD
   */
  generateCompactSummary(result: TestSuiteResult): string {
    const { summary } = result;

    return [
      `✅ ${summary.successful}/${summary.totalTested} tests passed (${summary.successRate.toFixed(1)}%)`,
      `❌ ${summary.failed} failed`,
      `⏱️ ${summary.timeouts} timeouts`,
      `⚠️ ${summary.errors} errors`,
      `📄 ${summary.totalGazettesFound} gazettes found`,
    ].join(' | ');
  }
}
