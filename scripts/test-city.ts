#!/usr/bin/env node
/**
 * CLI script to test a specific city
 * 
 * Usage: npx tsx scripts/test-city.ts <city-id> [start-date] [end-date]
 * Example: npx tsx scripts/test-city.ts ba_acajutiba
 * Example with dates: npx tsx scripts/test-city.ts rj_itatiaia 2025-02-20 2025-02-25
 */

import { TestRunner, createTestConfig, ConsoleReporter, JsonReporter } from '../src/testing';

async function main() {
  const cityId = process.argv[2];
  const startDate = process.argv[3];
  const endDate = process.argv[4];

  if (!cityId) {
    console.error('❌ Error: City ID is required');
    console.log('\nUsage: npx tsx scripts/test-city.ts <city-id> [start-date] [end-date]');
    console.log('Example: npx tsx scripts/test-city.ts ba_acajutiba');
    console.log('Example with dates: npx tsx scripts/test-city.ts rj_itatiaia 2025-02-20 2025-02-25');
    process.exit(1);
  }

  console.log(`🧪 Testing city: ${cityId}\n`);

  // Build custom date range if both dates provided
  const customDateRange = startDate && endDate
    ? { start: startDate, end: endDate }
    : undefined;

  if (customDateRange) {
    console.log(`📅 Using custom date range: ${startDate} to ${endDate}\n`);
  }

  try {
    // Create test configuration for single city
    const config = createTestConfig('single', {
      cities: [cityId],
      verbose: true,
      outputDir: './test-results',
      customDateRange,
    });

    // Run tests
    const runner = new TestRunner(config);
    const result = await runner.run();

    // Generate console report
    const consoleReporter = new ConsoleReporter();
    consoleReporter.generate(result);

    // Save JSON report
    const jsonReporter = new JsonReporter();
    await jsonReporter.generate(
      result,
      `./test-results/${cityId}-${Date.now()}.json`
    );

    // Exit with appropriate code
    if (result.summary.successRate === 100) {
      console.log(`\n✅ Test passed for ${cityId}`);
      process.exit(0);
    } else {
      console.log(`\n❌ Test failed for ${cityId}`);
      process.exit(1);
    }
  } catch (error: any) {
    console.error(`\n❌ Error testing city: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
