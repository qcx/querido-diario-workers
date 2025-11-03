/**
 * Test script for concurso data enrichment
 * Run with: bun run scripts/test-concurso-enrichment.ts
 */

import { ConcursoDataValidator } from '../src/testing/validators/concurso-data-validator';
import { logger } from '../src/utils';

async function main() {
  console.log('\n🧪 Starting Concurso Data Enrichment Tests...\n');

  try {
    // Run all validation tests
    const report = await ConcursoDataValidator.runAllTests();
    
    // Print report
    ConcursoDataValidator.printReport(report);

    // Exit with appropriate code
    if (report.failed > 0) {
      console.error('\n❌ Some tests failed!\n');
      process.exit(1);
    } else {
      console.log('\n✅ All tests passed!\n');
      process.exit(0);
    }
  } catch (error) {
    logger.error('Test execution failed', error as Error);
    console.error('\n💥 Test execution failed:', error);
    process.exit(1);
  }
}

main();

