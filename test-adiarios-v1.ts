/**
 * Test script for ADiarios V1 spiders
 * 
 * Usage: npx tsx test-adiarios-v1.ts [spider_id]
 * 
 * Examples:
 *   npx tsx test-adiarios-v1.ts ap_tartarugalzinho
 *   npx tsx test-adiarios-v1.ts ce_aurora
 *   npx tsx test-adiarios-v1.ts ce_caninde
 */

import { spiderRegistry } from './src/spiders/registry';
import { DateRange } from './src/types';

async function testSpider(spiderId: string) {
  console.log(`\n=== Testing spider: ${spiderId} ===\n`);
  
  const config = spiderRegistry.getConfig(spiderId);
  
  if (!config) {
    console.error(`Spider ${spiderId} not found in registry`);
    process.exit(1);
  }
  
  console.log(`Spider: ${config.name}`);
  console.log(`Territory ID: ${config.territoryId}`);
  console.log(`Type: ${config.spiderType}`);
  console.log(`Start date: ${config.startDate}`);
  console.log(`Config:`, JSON.stringify(config.config, null, 2));
  
  // Test with a small date range (last 7 days)
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7);
  
  const dateRange: DateRange = {
    start: startDate.toISOString().split('T')[0],
    end: endDate.toISOString().split('T')[0],
  };
  
  console.log(`\nDate range: ${dateRange.start} to ${dateRange.end}`);
  console.log(`\nCreating spider instance...`);
  
  try {
    const spider = spiderRegistry.createSpider(config, dateRange);
    
    console.log(`Spider instance created successfully`);
    console.log(`\nStarting crawl...`);
    
    const startTime = Date.now();
    const gazettes = await spider.crawl();
    const endTime = Date.now();
    
    console.log(`\n=== Crawl completed in ${(endTime - startTime) / 1000}s ===`);
    console.log(`Found ${gazettes.length} gazettes\n`);
    
    if (gazettes.length > 0) {
      console.log(`Sample gazette (first result):`);
      console.log(JSON.stringify(gazettes[0], null, 2));
      
      if (gazettes.length > 1) {
        console.log(`\nSample gazette (last result):`);
        console.log(JSON.stringify(gazettes[gazettes.length - 1], null, 2));
      }
    }
    
  } catch (error) {
    console.error(`\nError during crawl:`, error);
    process.exit(1);
  }
}

async function main() {
  const spiderId = process.argv[2];
  
  if (!spiderId) {
    console.log('Available ADiarios V1 spiders:');
    const adiariosConfigs = spiderRegistry.getConfigsByType('adiarios_v1');
    
    for (const config of adiariosConfigs) {
      console.log(`  - ${config.id} (${config.name})`);
    }
    
    console.log('\nUsage: npx tsx test-adiarios-v1.ts [spider_id]');
    process.exit(0);
  }
  
  await testSpider(spiderId);
}

main();
