import { spiderRegistry } from './src/spiders/registry';

async function test() {
  // Test BarcoDigital
  console.log('\n=== Testing BarcoDigital ===');
  const barcoConfigs = spiderRegistry.getConfigsByType('barco_digital');
  if (barcoConfigs.length > 0) {
    const config = barcoConfigs[0];
    console.log(`Testing: ${config.name} (${config.id})`);
    const spider = spiderRegistry.createSpider(config, {
      start: '2025-09-27',
      end: '2025-10-04'
    });
    const gazettes = await spider.crawl();
    console.log(`Found ${gazettes.length} gazettes`);
  }
  
  // Test Siganet
  console.log('\n=== Testing Siganet ===');
  const siganetConfigs = spiderRegistry.getConfigsByType('siganet');
  if (siganetConfigs.length > 0) {
    const config = siganetConfigs[0];
    console.log(`Testing: ${config.name} (${config.id})`);
    const spider = spiderRegistry.createSpider(config, {
      start: '2025-09-27',
      end: '2025-10-04'
    });
    const gazettes = await spider.crawl();
    console.log(`Found ${gazettes.length} gazettes`);
  }
}

test().catch(console.error);
