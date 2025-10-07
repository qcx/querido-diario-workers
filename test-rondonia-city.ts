#!/usr/bin/env -S npx tsx

import { RondoniaSpider } from './src/spiders/base/rondonia-spider';
import { SpiderConfig, DateRange } from './src/types';

/**
 * Test RondoniaSpider with a specific city (Porto Velho)
 */
async function testPortoVelho() {
  console.log('🏛️ Testing RondoniaSpider with Porto Velho...\n');

  const spiderConfig: SpiderConfig = {
    id: "ro_1100288",
    name: "Porto Velho", 
    territoryId: "1100288",
    spiderType: "rondonia",
    config: {
      type: "rondonia",
      cityName: "Porto Velho",
      power: "executive_legislative"
    }
  };

  // Test with today's date
  const dateRange: DateRange = {
    start: "2025-10-06",
    end: "2025-10-06"
  };

  console.log(`📅 Testing: ${dateRange.start}`);
  console.log(`🏛️ City: ${spiderConfig.name} (ID: ${spiderConfig.territoryId})`);
  console.log(`🔍 Filter: ${(spiderConfig.config as any).cityName}\n`);

  try {
    const spider = new RondoniaSpider(spiderConfig, dateRange);
    
    console.log('🕷️ Starting crawl...\n');
    const gazettes = await spider.crawl();

    console.log('\n📊 Results:');
    console.log(`✅ Total gazettes found: ${gazettes.length}`);
    console.log(`📈 Request count: ${spider.getRequestCount()}`);

    if (gazettes.length > 0) {
      console.log('\n📄 Gazettes found:');
      gazettes.forEach((gazette, index) => {
        const type = gazette.isExtraEdition ? 'Supplementary' : 'Regular';
        console.log(`  ${index + 1}. ${gazette.date} - ${type}`);
        console.log(`     URL: ${gazette.fileUrl}`);
        console.log(`     Territory: ${gazette.territoryId}`);
        console.log(`     Power: ${gazette.power}`);
      });
    } else {
      console.log('\n⚠️  No gazettes found - this could be normal if there are no publications for Porto Velho today.');
    }

  } catch (error) {
    console.error('\n❌ Error during spider test:', error);
    process.exit(1);
  }

  console.log('\n✅ Test completed successfully!');
}

testPortoVelho().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
