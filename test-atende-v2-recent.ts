import { spiderRegistry } from './src/spiders/registry';
import { DateRange } from './src/types';

async function testAtendeV2() {
  console.log('\n=== Testing AtendeV2 Spider ===\n');
  
  const config = spiderRegistry.getConfig('pr_apucarana');
  
  if (!config) {
    console.error('Config not found for pr_apucarana');
    return;
  }
  
  console.log(`Testing: ${config.name}`);
  
  // Test with recent dates
  const dateRange: DateRange = {
    start: '2025-09-01',
    end: '2025-09-30',
  };
  
  console.log(`\nCrawling from ${dateRange.start} to ${dateRange.end}...\n`);
  
  try {
    const spider = spiderRegistry.createSpider(config, dateRange);
    const gazettes = await spider.crawl();
    
    console.log(`\n✅ Successfully crawled ${gazettes.length} gazettes`);
    
    if (gazettes.length > 0) {
      console.log('\nFirst gazette:');
      console.log(JSON.stringify(gazettes[0], null, 2));
    }
  } catch (error) {
    console.error('❌ Error during crawling:', error);
  }
}

testAtendeV2();
