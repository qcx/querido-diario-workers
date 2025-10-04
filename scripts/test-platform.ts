#!/usr/bin/env node
/**
 * CLI script to test all cities of a specific platform
 * 
 * Usage: npx tsx scripts/test-platform.ts <platform>
 * Example: npx tsx scripts/test-platform.ts doem
 */

import { TestRunner, createTestConfig, ConsoleReporter, JsonReporter, HtmlReporter } from '../src/testing';
import { SpiderType } from '../src/types';

async function main() {
  const platform = process.argv[2] as SpiderType;

  if (!platform) {
    console.error('❌ Error: Platform is required');
    console.log('\nUsage: npx tsx scripts/test-platform.ts <platform>');
    console.log('\nAvailable platforms:');
    console.log('  - doem');
    console.log('  - instar');
    console.log('  - dosp');
    console.log('  - diof');
    console.log('  - adiarios_v1');
    console.log('  - adiarios_v2');
    console.log('  - sigpub');
    console.log('  - barco_digital');
    console.log('  - siganet');
    console.log('  - diario_oficial_br');
    console.log('  - modernizacao');
    console.log('  - aplus');
    console.log('  - dioenet');
    console.log('  - administracao_publica');
    console.log('  - ptio');
    console.log('  - municipio_online');
    console.log('  - atende_v2');
    process.exit(1);
  }

  console.log(`🧪 Testing platform: ${platform}\n`);

  try {
    // Create test configuration for platform
    const config = createTestConfig('platform', {
      platform,
      verbose: false,
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
    const jsonReporter = new JsonReporter();
    await jsonReporter.generate(
      result,
      `./test-results/platform-${platform}-${timestamp}.json`
    );

    const htmlReporter = new HtmlReporter();
    await htmlReporter.generate(
      result,
      `./test-results/platform-${platform}-${timestamp}.html`
    );

    console.log(`\n📄 Reports saved to ./test-results/`);

    // Exit with appropriate code
    if (result.summary.successRate >= 90) {
      console.log(`\n✅ Platform ${platform} tests passed (${result.summary.successRate.toFixed(2)}% success rate)`);
      process.exit(0);
    } else {
      console.log(`\n⚠️  Platform ${platform} tests completed with warnings (${result.summary.successRate.toFixed(2)}% success rate)`);
      process.exit(1);
    }
  } catch (error: any) {
    console.error(`\n❌ Error testing platform: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
