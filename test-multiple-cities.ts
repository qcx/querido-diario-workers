/**
 * Test multiple DOEM cities
 */

import { spiderRegistry } from './src/spiders/registry';
import { DateRange } from './src/types';

async function testMultipleCities() {
  const dateRange: DateRange = {
    start: '2024-09-01',
    end: '2024-09-30',
  };

  // Test a sample of cities from different states
  const citiesToTest = [
    'ba_acajutiba',        // Bahia
    'pe_petrolina',        // Pernambuco
    'pr_ipiranga',         // Paraná
    'se_nossa_senhora_do_socorro', // Sergipe
  ];

  console.log(`Testing ${citiesToTest.length} cities from DOEM platform\n`);
  console.log('Date Range:', dateRange);
  console.log('='.repeat(60));

  const results = [];

  for (const cityId of citiesToTest) {
    console.log(`\n📍 Testing: ${cityId}`);
    
    const config = spiderRegistry.getConfig(cityId);
    if (!config) {
      console.log(`❌ Config not found for ${cityId}`);
      continue;
    }

    const startTime = Date.now();

    try {
      const spider = spiderRegistry.createSpider(config, dateRange);
      const gazettes = await spider.crawl();
      const executionTime = Date.now() - startTime;

      const result = {
        cityId,
        cityName: config.name,
        success: true,
        gazettesFound: gazettes.length,
        executionTime,
        requestCount: spider.getRequestCount(),
      };

      results.push(result);

      console.log(`✅ Success: ${gazettes.length} gazettes found in ${executionTime}ms`);
    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      const result = {
        cityId,
        cityName: config.name,
        success: false,
        gazettesFound: 0,
        executionTime,
        error: (error as Error).message,
      };

      results.push(result);

      console.log(`❌ Failed: ${(error as Error).message}`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY\n');

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  const totalGazettes = successful.reduce((sum, r) => sum + r.gazettesFound, 0);
  const avgTime = successful.reduce((sum, r) => sum + r.executionTime, 0) / successful.length;

  console.log(`Total cities tested: ${results.length}`);
  console.log(`✅ Successful: ${successful.length}`);
  console.log(`❌ Failed: ${failed.length}`);
  console.log(`📄 Total gazettes found: ${totalGazettes}`);
  console.log(`⏱️  Average execution time: ${Math.round(avgTime)}ms`);

  if (failed.length > 0) {
    console.log('\n❌ Failed cities:');
    failed.forEach(r => {
      console.log(`  - ${r.cityId}: ${r.error}`);
    });
  }

  console.log('\n' + '='.repeat(60));
  console.log('✨ Test completed!');
}

testMultipleCities();
