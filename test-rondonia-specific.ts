#!/usr/bin/env -S npx tsx

import { RondoniaSpider } from './src/spiders/base/rondonia-spider';
import { SpiderConfig, DateRange } from './src/types';

/**
 * Test script for RondoniaSpider with a specific date we know has gazettes
 */
async function testSpecificDate() {
  console.log('🚀 Testing RondoniaSpider with specific date (25/09/2025)...\n');

  const spiderConfig: SpiderConfig = {
    id: "ro_state",
    name: "Estado de Rondônia - Diário Oficial",
    territoryId: "1100000",
    spiderType: "rondonia",
    startDate: "2007-01-01",
    config: {
      type: "rondonia",
      power: "executive"
    }
  };

  // Test with 25/09/2025 - we know this date has gazettes
  const dateRange: DateRange = {
    start: "2025-09-25",
    end: "2025-09-25"
  };

  console.log(`📅 Testing specific date: ${dateRange.start}`);
  console.log(`🏛️ Territory: ${spiderConfig.name}\n`);

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
        console.log(`     Power: ${gazette.power}`);
        console.log(`     Territory: ${gazette.territoryId}`);
      });
    } else {
      console.log('\n❌ No gazettes found - debugging needed');
      
      // Let's try to debug by manually testing the URL
      console.log('\n🔍 Debug info:');
      console.log('Expected URL: https://diof.ro.gov.br/diarios/?cf_time=25-09-2025');
      
      try {
        const response = await fetch('https://diof.ro.gov.br/diarios/?cf_time=25-09-2025');
        const html = await response.text();
        
        console.log(`Response status: ${response.status}`);
        console.log(`Response size: ${html.length} characters`);
        
        // Check for PDF links
        const pdfMatches = html.match(/href="[^"]*\.pdf"/g);
        console.log(`PDF links found in HTML: ${pdfMatches ? pdfMatches.length : 0}`);
        
        if (pdfMatches) {
          console.log('PDF URLs found:');
          pdfMatches.slice(0, 5).forEach((match, i) => {
            console.log(`  ${i + 1}. ${match}`);
          });
        }
        
        // Check for DOE patterns
        const doeMatches = html.match(/DOE[^"]*\.pdf/g);
        console.log(`DOE patterns found: ${doeMatches ? doeMatches.length : 0}`);
        
        if (doeMatches) {
          console.log('DOE patterns:');
          doeMatches.forEach((match, i) => {
            console.log(`  ${i + 1}. ${match}`);
          });
        }
        
      } catch (error) {
        console.error('Error during manual URL test:', error);
      }
    }

  } catch (error) {
    console.error('\n❌ Error during spider test:', error);
    process.exit(1);
  }
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
  testSpecificDate()
    .then(() => {
      console.log('\n✅ Test completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Test failed:', error);
      process.exit(1);
    });
}

