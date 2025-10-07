#!/usr/bin/env -S npx tsx

import { RondoniaSpider } from './src/spiders/base/rondonia-spider';
import { SpiderConfig, DateRange } from './src/types';

/**
 * Test script for RondoniaSpider
 * 
 * This tests the Rondônia state gazette spider implementation
 */
async function testRondoniaSpider() {
  console.log('🚀 Testing RondoniaSpider...\n');

  // Test configuration for Rondônia state
  const spiderConfig: SpiderConfig = {
    id: "ro_state",
    name: "Estado de Rondônia - Diário Oficial",
    territoryId: "1100000", // Rondônia state IBGE code
    spiderType: "rondonia",
    startDate: "2007-01-01",
    config: {
      type: "rondonia",
      power: "executive"
    }
  };

  // Test with recent dates (last 7 days)
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 7);

  const dateRange: DateRange = {
    start: startDate.toISOString().split('T')[0],
    end: endDate.toISOString().split('T')[0]
  };

  console.log(`📅 Testing date range: ${dateRange.start} to ${dateRange.end}`);
  console.log(`🏛️ Territory: ${spiderConfig.name} (ID: ${spiderConfig.territoryId})\n`);

  try {
    // Create spider instance
    const spider = new RondoniaSpider(spiderConfig, dateRange);

    // Run crawl
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
        console.log(`     Power: ${gazette.power}`);
      });
    } else {
      console.log('\n⚠️  No gazettes found in the specified date range.');
      console.log('💡 This might be normal if there are no publications for recent dates.');
      console.log('   Try expanding the date range or check specific dates from the website.');
    }

  } catch (error) {
    console.error('\n❌ Error during spider test:', error);
    process.exit(1);
  }

  console.log('\n✅ Test completed successfully!');
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
  testRondoniaSpider()
    .then(() => {
      console.log('\n🎉 All tests passed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Test failed:', error);
      process.exit(1);
    });
}

