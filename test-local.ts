/**
 * Local test script for testing spiders without deploying
 */

import { DoemSpider } from './src/spiders/base/doem-spider';
import { SpiderConfig, DateRange } from './src/types';

async function testDoemSpider() {
  console.log('Testing DOEM Spider...\n');

  const config: SpiderConfig = {
    id: 'ba_acajutiba',
    name: 'Acajutiba - BA',
    territoryId: '2900306',
    spiderType: 'doem',
    startDate: '2013-01-30',
    config: {
      type: 'doem',
      stateCityUrlPart: 'ba/acajutiba',
    },
  };

  const dateRange: DateRange = {
    start: '2024-09-01',
    end: '2024-09-30',
  };

  console.log('Config:', JSON.stringify(config, null, 2));
  console.log('Date Range:', JSON.stringify(dateRange, null, 2));
  console.log('\nStarting crawl...\n');

  const startTime = Date.now();

  try {
    const spider = new DoemSpider(config, dateRange);
    const gazettes = await spider.crawl();

    const executionTime = Date.now() - startTime;

    console.log('\n✅ Crawl completed successfully!');
    console.log(`\nResults:`);
    console.log(`- Total gazettes found: ${gazettes.length}`);
    console.log(`- Execution time: ${executionTime}ms`);
    console.log(`- Requests made: ${spider.getRequestCount()}`);

    if (gazettes.length > 0) {
      console.log(`\nFirst gazette:`);
      console.log(JSON.stringify(gazettes[0], null, 2));
    }

    if (gazettes.length > 1) {
      console.log(`\nLast gazette:`);
      console.log(JSON.stringify(gazettes[gazettes.length - 1], null, 2));
    }

  } catch (error) {
    console.error('\n❌ Crawl failed:');
    console.error(error);
    process.exit(1);
  }
}

testDoemSpider();
