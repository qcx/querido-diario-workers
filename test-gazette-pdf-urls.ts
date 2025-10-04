/**
 * Test to verify that gazettes have valid PDF URLs
 */

import { TestRunner } from './src/testing/test-runner';
import { createTestConfig } from './src/testing/test-config';

async function testGazettePdfUrls() {
  console.log('🔍 Testing Gazette PDF URLs\n');
  console.log('='.repeat(80));

  // Create test config for sample mode (10% of cities)
  const config = createTestConfig({
    mode: 'sample',
    sampleSize: 10, // Test 10 cities only
    parallelWorkers: 5,
    searchDays: 3,
  });

  const runner = new TestRunner(config);
  const testResults = await runner.run();

  console.log('\n' + '='.repeat(80));
  console.log('📊 Analysis of PDF URLs\n');

  let totalGazettes = 0;
  let gazettesWithPdfUrls = 0;
  let gazettesWithoutPdfUrls = 0;
  const urlPatterns: Record<string, number> = {};

  // Get results from test results directory
  const results = testResults.results || [];

  for (const result of results) {
    if (result.status === 'success' && result.gazettes) {
      for (const gazette of result.gazettes) {
        totalGazettes++;
        
        const url = gazette.fileUrl.toLowerCase();
        
        if (url.includes('.pdf')) {
          gazettesWithPdfUrls++;
        } else {
          gazettesWithoutPdfUrls++;
          console.log(`⚠️  Non-PDF URL found:`);
          console.log(`   City: ${result.spiderId}`);
          console.log(`   URL: ${gazette.fileUrl}`);
          console.log(`   Date: ${gazette.date}`);
          console.log('');
        }

        // Track URL patterns
        const extension = url.match(/\.([a-z0-9]+)(\?|$)/i)?.[1] || 'no-extension';
        urlPatterns[extension] = (urlPatterns[extension] || 0) + 1;
      }
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('📈 Summary\n');
  console.log(`Total Gazettes: ${totalGazettes}`);
  console.log(`With PDF URLs: ${gazettesWithPdfUrls} (${((gazettesWithPdfUrls / totalGazettes) * 100).toFixed(2)}%)`);
  console.log(`Without PDF URLs: ${gazettesWithoutPdfUrls} (${((gazettesWithoutPdfUrls / totalGazettes) * 100).toFixed(2)}%)`);
  
  console.log('\n📋 URL Patterns:');
  Object.entries(urlPatterns)
    .sort((a, b) => b[1] - a[1])
    .forEach(([ext, count]) => {
      console.log(`  .${ext}: ${count} (${((count / totalGazettes) * 100).toFixed(2)}%)`);
    });

  console.log('\n' + '='.repeat(80));

  if (gazettesWithoutPdfUrls > 0) {
    console.log('\n⚠️  WARNING: Some gazettes do not have PDF URLs!');
    console.log('   OCR system will only work with PDF URLs.');
  } else {
    console.log('\n✅ All gazettes have PDF URLs!');
  }

  console.log('\n');
}

testGazettePdfUrls()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
