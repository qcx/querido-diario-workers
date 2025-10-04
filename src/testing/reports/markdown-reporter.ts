/**
 * Markdown report generator
 */

import { TestSuiteResult } from '../types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Generates Markdown reports
 */
export class MarkdownReporter {
  /**
   * Generates a Markdown report
   */
  async generate(result: TestSuiteResult, outputPath: string): Promise<void> {
    const markdown = this.buildMarkdown(result);

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, markdown, 'utf-8');
  }

  /**
   * Builds the Markdown content
   */
  private buildMarkdown(result: TestSuiteResult): string {
    return `# 🧪 Test Execution Report

**Execution ID:** \`${result.executionId}\`

---

## 📋 Execution Information

- **Mode:** ${result.config.mode}
- **Started:** ${new Date(result.startedAt).toLocaleString()}
- **Completed:** ${new Date(result.completedAt).toLocaleString()}
- **Duration:** ${this.formatDuration(result.totalExecutionTime)}
- **Parallel Workers:** ${result.config.parallelWorkers}
- **Search Days:** ${result.config.searchDays}

---

## 📊 Summary Statistics

${this.buildSummarySection(result)}

---

## 🏢 Platform Breakdown

${this.buildPlatformTable(result)}

---

${this.buildFailuresSection(result)}

---

## 📈 Recommendations

${this.buildRecommendations(result)}

---

*Report generated at ${new Date().toLocaleString()}*
`;
  }

  /**
   * Builds summary section
   */
  private buildSummarySection(result: TestSuiteResult): string {
    const { summary } = result;
    const statusEmoji = summary.successRate >= 90 ? '✅' : summary.successRate >= 80 ? '⚠️' : '❌';

    return `
| Metric | Value |
|--------|-------|
| **Total Tested** | ${summary.totalTested} |
| **✅ Successful** | ${summary.successful} (${summary.successRate.toFixed(2)}%) |
| **❌ Failed** | ${summary.failed} |
| **⏱️ Timeouts** | ${summary.timeouts} |
| **⚠️ Errors** | ${summary.errors} |
| **⏭️ Skipped** | ${summary.skipped} |
| **📄 Total Gazettes** | ${summary.totalGazettesFound} |
| **⏱️ Avg Execution Time** | ${this.formatDuration(summary.avgExecutionTime)} |

### Success Rate: ${statusEmoji} ${summary.successRate.toFixed(2)}%

\`\`\`
${this.buildProgressBar(summary.successRate)}
\`\`\`
`;
  }

  /**
   * Builds platform table
   */
  private buildPlatformTable(result: TestSuiteResult): string {
    const { byPlatform } = result.summary;

    if (byPlatform.length === 0) {
      return '*No platform data available*';
    }

    let table = `
| Platform | Total | Success | Failed | Success Rate | Avg Time |
|----------|-------|---------|--------|--------------|----------|
`;

    for (const platform of byPlatform) {
      const rateEmoji = platform.successRate >= 90 ? '✅' : platform.successRate >= 80 ? '⚠️' : '❌';
      table += `| ${platform.platform} | ${platform.total} | ${platform.successful} | ${platform.failed} | ${rateEmoji} ${platform.successRate.toFixed(1)}% | ${this.formatDuration(platform.avgExecutionTime)} |\n`;
    }

    return table;
  }

  /**
   * Builds failures section
   */
  private buildFailuresSection(result: TestSuiteResult): string {
    const failures = result.results.filter(
      (r) => r.status === 'failure' || r.status === 'error' || r.status === 'timeout'
    );

    if (failures.length === 0) {
      return `## ✅ No Failures

All tests passed successfully! 🎉`;
    }

    let section = `## ❌ Failures (${failures.length})

`;

    // Group failures by platform
    const failuresByPlatform = new Map<string, typeof failures>();
    for (const failure of failures) {
      const platform = failure.spiderType;
      if (!failuresByPlatform.has(platform)) {
        failuresByPlatform.set(platform, []);
      }
      failuresByPlatform.get(platform)!.push(failure);
    }

    for (const [platform, platformFailures] of failuresByPlatform.entries()) {
      section += `### ${platform} (${platformFailures.length} failures)\n\n`;

      for (const failure of platformFailures.slice(0, 10)) {
        section += `#### ${failure.cityId} - ${failure.cityName}\n\n`;
        section += `- **Status:** ${this.getStatusEmoji(failure.status)} ${failure.status}\n`;
        
        if (failure.error) {
          section += `- **Error:** \`${failure.error.message}\`\n`;
        }

        const failedValidations = failure.validations.details.filter((d) => !d.passed);
        if (failedValidations.length > 0) {
          section += `- **Failed Validations:**\n`;
          for (const validation of failedValidations) {
            section += `  - ${validation.name}: ${validation.message}\n`;
          }
        }

        section += '\n';
      }

      if (platformFailures.length > 10) {
        section += `*... and ${platformFailures.length - 10} more failures for this platform*\n\n`;
      }
    }

    return section;
  }

  /**
   * Builds recommendations section
   */
  private buildRecommendations(result: TestSuiteResult): string {
    const { summary } = result;
    const recommendations: string[] = [];

    if (summary.successRate < 90) {
      recommendations.push('⚠️ **Success rate is below 90%.** Investigate failed tests and fix issues.');
    }

    if (summary.timeouts > summary.totalTested * 0.1) {
      recommendations.push('⏱️ **High timeout rate detected.** Consider increasing timeout values or investigating slow platforms.');
    }

    if (summary.errors > 0) {
      recommendations.push('⚠️ **Errors detected.** Review error messages and fix spider implementations.');
    }

    if (summary.avgExecutionTime > 60000) {
      recommendations.push('🐌 **Average execution time is high.** Consider optimizing spider performance or reducing search days.');
    }

    // Platform-specific recommendations
    for (const platform of summary.byPlatform) {
      if (platform.successRate < 80) {
        recommendations.push(`❌ **Platform \`${platform.platform}\` has low success rate (${platform.successRate.toFixed(1)}%).** Investigate this platform specifically.`);
      }
    }

    if (recommendations.length === 0) {
      return '✅ **All metrics look good!** No specific recommendations at this time.';
    }

    return recommendations.map((r) => `- ${r}`).join('\n');
  }

  /**
   * Builds a text progress bar
   */
  private buildProgressBar(percentage: number): string {
    const barLength = 50;
    const filledLength = Math.round((percentage / 100) * barLength);
    const emptyLength = barLength - filledLength;

    const filled = '█'.repeat(filledLength);
    const empty = '░'.repeat(emptyLength);

    return `[${filled}${empty}] ${percentage.toFixed(2)}%`;
  }

  /**
   * Gets status emoji
   */
  private getStatusEmoji(status: string): string {
    const emojis: Record<string, string> = {
      success: '✅',
      failure: '❌',
      timeout: '⏱️',
      error: '⚠️',
      skipped: '⏭️',
    };

    return emojis[status] || '❓';
  }

  /**
   * Formats duration
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
}
