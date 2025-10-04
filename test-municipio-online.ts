import { spiderRegistry } from './src/spiders/registry';
import { DateRange } from './src/types';

async function testMunicipioOnline() {
  console.log('\n=== Testing MunicipioOnline Spider ===\n');
  
  // Test with Aquidaba - SE
  const config = spiderRegistry.getConfig('se_aquidaba');
  
  if (!config) {
    console.error('Config not found for se_aquidaba');
    return;
  }
  
  console.log(`Testing: ${config.name}`);
  console.log(`Territory ID: ${config.territoryId}`);
  console.log(`Start Date: ${config.startDate}`);
  console.log(`Config:`, config.config);
  
  // Test with a short date range
  const dateRange: DateRange = {
    start: '2024-01-01',
    end: '2024-01-31',
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
    
    console.log(`\nTotal requests made: ${spider.getRequestCount()}`);
  } catch (error) {
    console.error('❌ Error during crawling:', error);
  }
}

testMunicipioOnline();
