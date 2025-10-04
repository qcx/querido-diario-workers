#!/usr/bin/env node
/**
 * CLI script to run automated tests
 * 
 * Usage: npx tsx scripts/run-tests.ts [mode] [options]
 * 
 * Modes:
 *   - sample: Run sample test (default, 10% of cities)
 *   - full: Run full test (all cities)
 *   - regression: Run regression test (previously failed cities)
 *   - until: Collect gazettes until target is reached
 * 
 * Options:
 *   --workers <n>: Number of parallel workers (default: 10)
 *   --days <n>: Number of days to search (default: 7)
 *   --sample <n>: Sample percentage for sample mode (default: 10)
 *   --target <n>: Target number of gazettes for until mode (default: 15)
 *   --verbose: Enable verbose logging
 * 
 * Examples:
 *   npx tsx scripts/run-tests.ts
 *   npx tsx scripts/run-tests.ts full
 *   npx tsx scripts/run-tests.ts sample --workers 15 --days 3
 *   npx tsx scripts/run-tests.ts until --target 20
 */

import {
  TestRunner,
  createTestConfig,
  ConsoleReporter,
  JsonReporter,
  HtmlReporter,
  MarkdownReporter,
  TrendAnalyzer,
  TestMode,
} from '../src/testing';

interface CliOptions {
  mode: TestMode;
  workers?: number;
  days?: number;
  sample?: number;
  target?: number;
  verbose?: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  
  const mode = (args[0] && !args[0].startsWith('--') ? args[0] : 'sample') as TestMode;
  
  const options: CliOptions = { mode };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--workers' && args[i + 1]) {
      options.workers = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--days' && args[i + 1]) {
      options.days = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--sample' && args[i + 1]) {
      options.sample = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--target' && args[i + 1]) {
      options.target = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--verbose') {
      options.verbose = true;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs();

  console.log('🧪 Querido Diário Workers - Automated Testing System\n');
  console.log(`Mode: ${options.mode}`);
  if (options.workers) console.log(`Workers: ${options.workers}`);
  if (options.days) console.log(`Search Days: ${options.days}`);
  if (options.sample) console.log(`Sample: ${options.sample}%`);
  if (options.target) console.log(`Target Gazettes: ${options.target}`);
  console.log('');

  try {
    // Create test configuration
    const config = createTestConfig(options.mode, {
      parallelWorkers: options.workers,
      searchDays: options.days,
      samplePercentage: options.sample,
      targetGazettes: options.target,
      verbose: options.verbose,
      outputDir: './test-results',
    });

    // Run tests
    const runner = new TestRunner(config);
    const result = await runner.run();

    // Generate console report
    const consoleReporter = new ConsoleReporter();
    consoleReporter.generate(result);

    // Save reports
    const timestamp = Date.now();
    const basePath = `./test-results/${options.mode}-${timestamp}`;

    console.log('\n📄 Generating reports...');

    const jsonReporter = new JsonReporter();
    await jsonReporter.generate(result, `${basePath}.json`);
    console.log(`   ✓ JSON report: ${basePath}.json`);

    const htmlReporter = new HtmlReporter();
    await htmlReporter.generate(result, `${basePath}.html`);
    console.log(`   ✓ HTML report: ${basePath}.html`);

    const markdownReporter = new MarkdownReporter();
    await markdownReporter.generate(result, `${basePath}.md`);
    console.log(`   ✓ Markdown report: ${basePath}.md`);

    // Save to history for trend analysis
    const trendAnalyzer = new TrendAnalyzer();
    await trendAnalyzer.addResult(result);

    // Analyze trends
    const trends = await trendAnalyzer.analyzeTrends();
    if (trends.hasEnoughData) {
      console.log(`\n📈 Trend Analysis: ${trends.message}`);
    }

    // Detect anomalies
    const anomalies = await trendAnalyzer.detectAnomalies();
    if (anomalies.length > 0) {
      console.log(`\n⚠️  Anomalies detected: ${anomalies.length}`);
      for (const anomaly of anomalies) {
        console.log(`   - ${anomaly.message} (${anomaly.severity})`);
      }
    }

    // Exit with appropriate code
    if (result.summary.successRate >= 90) {
      console.log(`\n✅ Tests completed successfully (${result.summary.successRate.toFixed(2)}% success rate)`);
      process.exit(0);
    } else if (result.summary.successRate >= 80) {
      console.log(`\n⚠️  Tests completed with warnings (${result.summary.successRate.toFixed(2)}% success rate)`);
      process.exit(0);
    } else {
      console.log(`\n❌ Tests failed (${result.summary.successRate.toFixed(2)}% success rate)`);
      process.exit(1);
    }
  } catch (error: any) {
    console.error(`\n❌ Error running tests: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
