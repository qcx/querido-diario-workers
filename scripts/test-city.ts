#!/usr/bin/env node
/**
 * CLI script to test a specific city
 * 
 * Usage: npx tsx scripts/test-city.ts <city-id>
 * Example: npx tsx scripts/test-city.ts ba_acajutiba
 */

import { TestRunner, createTestConfig, ConsoleReporter, JsonReporter } from '../src/testing';

async function main() {
  const cityId = process.argv[2];

  if (!cityId) {
    console.error('❌ Error: City ID is required');
    console.log('\nUsage: npx tsx scripts/test-city.ts <city-id>');
    console.log('Example: npx tsx scripts/test-city.ts ba_acajutiba');
    process.exit(1);
  }

  console.log(`🧪 Testing city: ${cityId}\n`);

  try {
    // Create test configuration for single city
    const config = createTestConfig('single', {
      cities: [cityId],
      verbose: true,
      outputDir: './test-results',
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
