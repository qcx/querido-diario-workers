/**
 * Test script for ADiarios V2 Spider
 * 
 * Tests the ADiarios V2 implementation with one city
 */

import { spiderRegistry } from './src/spiders/registry';
import { DateRange } from './src/types';

async function testADiariosV2() {
  console.log('=== Testing ADiarios V2 Spider ===\n');

  // Test with Armação dos Búzios
  const cityId = 'rj_armacao_dos_buzios';
  const config = spiderRegistry.getConfig(cityId);

  if (!config) {
    console.error(`City ${cityId} not found in registry`);
    process.exit(1);
  }

  console.log(`Testing: ${config.name}`);
  console.log(`Territory ID: ${config.territoryId}`);
  console.log(`Spider Type: ${config.spiderType}`);
  console.log(`Base URL: ${(config.config as any).baseUrl}\n`);

  // Test with a short date range (last 7 days)
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7);

  const dateRange: DateRange = {
    start: startDate.toISOString().split('T')[0],
    end: endDate.toISOString().split('T')[0],
  };

  console.log(`Date range: ${dateRange.start} to ${dateRange.end}\n`);

  try {
    // Note: This test will fail because we don't have browser binding in local context
    // This is expected - the spider requires Cloudflare Workers environment
    console.log('Creating spider instance...');
    const spider = spiderRegistry.createSpider(config, dateRange);
    
    console.log('Note: ADiarios V2 requires Cloudflare Browser Rendering');
    console.log('This test will show the stub behavior without browser binding\n');
    
    console.log('Attempting to crawl...');
    const gazettes = await spider.crawl();

    console.log(`\n=== Results ===`);
    console.log(`Total gazettes found: ${gazettes.length}`);
    console.log(`Request count: ${spider.getRequestCount()}`);

    if (gazettes.length > 0) {
      console.log('\nFirst 3 gazettes:');
      gazettes.slice(0, 3).forEach((gazette, index) => {
        console.log(`\n${index + 1}. Date: ${gazette.date}`);
        console.log(`   Edition: ${gazette.editionNumber || 'N/A'}`);
        console.log(`   Extra: ${gazette.isExtraEdition ? 'Yes' : 'No'}`);
        console.log(`   URL: ${gazette.fileUrl}`);
      });
    }

    console.log('\n=== Test completed ===');
    console.log('To test with actual browser rendering, deploy to Cloudflare Workers');
    
  } catch (error) {
    console.error('\n=== Error ===');
    console.error((error as Error).message);
    console.error('\nThis is expected in local environment without browser binding');
  }
}

testADiariosV2().catch(console.error);
