/**
 * HTML report generator
 */

import { TestSuiteResult, TestStatus } from '../types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Generates HTML reports
 */
export class HtmlReporter {
  /**
   * Generates an HTML report
   */
  async generate(result: TestSuiteResult, outputPath: string): Promise<void> {
    const html = this.buildHtml(result);

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, html, 'utf-8');
  }

  /**
   * Builds the HTML content
   */
  private buildHtml(result: TestSuiteResult): string {
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test Report - ${result.executionId}</title>
  <style>
    ${this.getStyles()}
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🧪 Test Execution Report</h1>
      <p class="execution-id">Execution ID: ${result.executionId}</p>
    </header>

    ${this.buildSummarySection(result)}
    ${this.buildPlatformSection(result)}
    ${this.buildResultsSection(result)}
    ${this.buildFailuresSection(result)}

    <footer>
      <p>Generated at ${new Date().toLocaleString()}</p>
      <p>Querido Diário Workers - Automated Testing System</p>
    </footer>
  </div>

  <script>
    ${this.getScripts()}
  </script>
</body>
</html>`;
  }

  /**
   * Builds summary section
   */
  private buildSummarySection(result: TestSuiteResult): string {
    const { summary } = result;
    const statusClass = summary.successRate >= 90 ? 'success' : summary.successRate >= 80 ? 'warning' : 'danger';

    return `
    <section class="summary">
      <h2>📊 Summary</h2>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${summary.totalTested}</div>
          <div class="stat-label">Total Tested</div>
        </div>
        <div class="stat-card success">
          <div class="stat-value">${summary.successful}</div>
          <div class="stat-label">Successful</div>
        </div>
        <div class="stat-card danger">
          <div class="stat-value">${summary.failed}</div>
          <div class="stat-label">Failed</div>
        </div>
        <div class="stat-card warning">
          <div class="stat-value">${summary.timeouts}</div>
          <div class="stat-label">Timeouts</div>
        </div>
      </div>

      <div class="success-rate ${statusClass}">
        <h3>Success Rate</h3>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${summary.successRate}%"></div>
        </div>
        <p class="percentage">${summary.successRate.toFixed(2)}%</p>
      </div>

      <div class="info-grid">
        <div class="info-item">
          <strong>Total Gazettes Found:</strong> ${summary.totalGazettesFound}
        </div>
        <div class="info-item">
          <strong>Avg Execution Time:</strong> ${this.formatDuration(summary.avgExecutionTime)}
        </div>
        <div class="info-item">
          <strong>Started:</strong> ${new Date(result.startedAt).toLocaleString()}
        </div>
        <div class="info-item">
          <strong>Completed:</strong> ${new Date(result.completedAt).toLocaleString()}
        </div>
      </div>
    </section>`;
  }

  /**
   * Builds platform section
   */
  private buildPlatformSection(result: TestSuiteResult): string {
    const { byPlatform } = result.summary;

    const rows = byPlatform
      .map(
        (p) => `
        <tr>
          <td>${p.platform}</td>
          <td>${p.total}</td>
          <td class="success">${p.successful}</td>
          <td class="danger">${p.failed}</td>
          <td>
            <div class="mini-progress">
              <div class="mini-progress-fill" style="width: ${p.successRate}%"></div>
            </div>
            ${p.successRate.toFixed(1)}%
          </td>
          <td>${this.formatDuration(p.avgExecutionTime)}</td>
        </tr>
      `
      )
      .join('');

    return `
    <section class="platforms">
      <h2>🏢 Platform Breakdown</h2>
      <table>
        <thead>
          <tr>
            <th>Platform</th>
            <th>Total</th>
            <th>Success</th>
            <th>Failed</th>
            <th>Success Rate</th>
            <th>Avg Time</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </section>`;
  }

  /**
   * Builds results section
   */
  private buildResultsSection(result: TestSuiteResult): string {
    const rows = result.results
      .slice(0, 100) // Show max 100 results
      .map(
        (r) => `
        <tr class="status-${r.status}">
          <td>${this.getStatusBadge(r.status)}</td>
          <td>${r.cityId}</td>
          <td>${r.cityName}</td>
          <td>${r.spiderType}</td>
          <td>${r.gazettesFound}</td>
          <td>${this.formatDuration(r.executionTime)}</td>
          <td>${r.error ? `<span class="error-msg">${r.error.message}</span>` : '-'}</td>
        </tr>
      `
      )
      .join('');

    return `
    <section class="results">
      <h2>📋 Test Results</h2>
      <div class="filter-buttons">
        <button onclick="filterResults('all')" class="active">All</button>
        <button onclick="filterResults('success')">Success</button>
        <button onclick="filterResults('failure')">Failed</button>
        <button onclick="filterResults('timeout')">Timeout</button>
        <button onclick="filterResults('error')">Error</button>
      </div>
      <table id="results-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>City ID</th>
            <th>City Name</th>
            <th>Platform</th>
            <th>Gazettes</th>
            <th>Time</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      ${result.results.length > 100 ? `<p class="note">Showing first 100 of ${result.results.length} results</p>` : ''}
    </section>`;
  }

  /**
   * Builds failures section
   */
  private buildFailuresSection(result: TestSuiteResult): string {
    const failures = result.results.filter(
      (r) => r.status === 'failure' || r.status === 'error' || r.status === 'timeout'
    );

    if (failures.length === 0) {
      return `
      <section class="failures">
        <h2>✅ No Failures</h2>
        <p class="success-message">All tests passed successfully!</p>
      </section>`;
    }

    const failureCards = failures
      .slice(0, 20)
      .map(
        (f) => `
        <div class="failure-card">
          <h4>${this.getStatusBadge(f.status)} ${f.cityId} - ${f.cityName}</h4>
          <p><strong>Platform:</strong> ${f.spiderType}</p>
          ${f.error ? `<p class="error-msg"><strong>Error:</strong> ${f.error.message}</p>` : ''}
          ${this.buildValidationsList(f)}
        </div>
      `
      )
      .join('');

    return `
    <section class="failures">
      <h2>❌ Failures (${failures.length})</h2>
      ${failureCards}
      ${failures.length > 20 ? `<p class="note">Showing first 20 of ${failures.length} failures</p>` : ''}
    </section>`;
  }

  /**
   * Builds validations list
   */
  private buildValidationsList(result: any): string {
    const failedValidations = result.validations.details.filter((d: any) => !d.passed);

    if (failedValidations.length === 0) {
      return '';
    }

    const items = failedValidations
      .map((v: any) => `<li>${v.name}: ${v.message}</li>`)
      .join('');

    return `
      <div class="validations">
        <strong>Failed Validations:</strong>
        <ul>${items}</ul>
      </div>`;
  }

  /**
   * Gets status badge HTML
   */
  private getStatusBadge(status: TestStatus): string {
    const badges: Record<TestStatus, string> = {
      success: '<span class="badge badge-success">✅ Success</span>',
      failure: '<span class="badge badge-danger">❌ Failure</span>',
      timeout: '<span class="badge badge-warning">⏱️ Timeout</span>',
      error: '<span class="badge badge-danger">⚠️ Error</span>',
      skipped: '<span class="badge badge-secondary">⏭️ Skipped</span>',
    };

    return badges[status] || '<span class="badge">❓ Unknown</span>';
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

  /**
   * Gets CSS styles
   */
  private getStyles(): string {
    return `
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; line-height: 1.6; }
      .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
      header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px; margin-bottom: 30px; }
      header h1 { font-size: 2em; margin-bottom: 10px; }
      .execution-id { opacity: 0.9; font-size: 0.9em; }
      section { background: white; padding: 30px; border-radius: 10px; margin-bottom: 30px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
      h2 { font-size: 1.5em; margin-bottom: 20px; color: #667eea; }
      .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
      .stat-card { background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; border-left: 4px solid #667eea; }
      .stat-card.success { border-left-color: #28a745; }
      .stat-card.danger { border-left-color: #dc3545; }
      .stat-card.warning { border-left-color: #ffc107; }
      .stat-value { font-size: 2.5em; font-weight: bold; color: #667eea; }
      .stat-card.success .stat-value { color: #28a745; }
      .stat-card.danger .stat-value { color: #dc3545; }
      .stat-card.warning .stat-value { color: #ffc107; }
      .stat-label { color: #666; margin-top: 5px; }
      .success-rate { margin: 30px 0; }
      .success-rate h3 { font-size: 1.2em; margin-bottom: 10px; }
      .progress-bar { background: #e9ecef; height: 30px; border-radius: 15px; overflow: hidden; }
      .progress-fill { height: 100%; background: linear-gradient(90deg, #28a745, #20c997); transition: width 0.3s; }
      .success-rate.warning .progress-fill { background: linear-gradient(90deg, #ffc107, #fd7e14); }
      .success-rate.danger .progress-fill { background: linear-gradient(90deg, #dc3545, #c82333); }
      .percentage { text-align: center; font-size: 1.5em; font-weight: bold; margin-top: 10px; }
      .info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px; margin-top: 20px; }
      .info-item { background: #f8f9fa; padding: 15px; border-radius: 5px; }
      table { width: 100%; border-collapse: collapse; margin-top: 20px; }
      th, td { padding: 12px; text-align: left; border-bottom: 1px solid #dee2e6; }
      th { background: #f8f9fa; font-weight: 600; color: #495057; }
      tr:hover { background: #f8f9fa; }
      .success { color: #28a745; }
      .danger { color: #dc3545; }
      .mini-progress { display: inline-block; width: 60px; height: 8px; background: #e9ecef; border-radius: 4px; overflow: hidden; vertical-align: middle; margin-right: 8px; }
      .mini-progress-fill { height: 100%; background: #28a745; }
      .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 0.85em; font-weight: 600; }
      .badge-success { background: #d4edda; color: #155724; }
      .badge-danger { background: #f8d7da; color: #721c24; }
      .badge-warning { background: #fff3cd; color: #856404; }
      .badge-secondary { background: #e2e3e5; color: #383d41; }
      .error-msg { color: #dc3545; font-size: 0.9em; }
      .filter-buttons { margin-bottom: 15px; }
      .filter-buttons button { padding: 8px 16px; margin-right: 10px; border: 1px solid #dee2e6; background: white; border-radius: 5px; cursor: pointer; }
      .filter-buttons button.active { background: #667eea; color: white; border-color: #667eea; }
      .failure-card { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 15px; border-left: 4px solid #dc3545; }
      .failure-card h4 { margin-bottom: 10px; }
      .validations { margin-top: 10px; }
      .validations ul { margin-left: 20px; margin-top: 5px; }
      .success-message { color: #28a745; font-size: 1.1em; text-align: center; padding: 20px; }
      .note { color: #666; font-style: italic; margin-top: 15px; text-align: center; }
      footer { text-align: center; color: #666; padding: 30px 0; font-size: 0.9em; }
      .status-success { background: #d4edda !important; }
      .status-failure { background: #f8d7da !important; }
      .status-timeout { background: #fff3cd !important; }
      .status-error { background: #f8d7da !important; }
    `;
  }

  /**
   * Gets JavaScript code
   */
  private getScripts(): string {
    return `
      function filterResults(status) {
        const table = document.getElementById('results-table');
        const rows = table.querySelectorAll('tbody tr');
        const buttons = document.querySelectorAll('.filter-buttons button');

        buttons.forEach(btn => btn.classList.remove('active'));
        event.target.classList.add('active');

        rows.forEach(row => {
          if (status === 'all' || row.classList.contains('status-' + status)) {
            row.style.display = '';
          } else {
            row.style.display = 'none';
          }
        });
      }
    `;
  }
}
