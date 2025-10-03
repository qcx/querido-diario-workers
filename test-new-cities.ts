import { DoemSpider } from './src/spiders/base/doem-spider';
import { SpiderConfig } from './src/types';
import { logger } from './src/utils/logger';

// Test new cities from DOEM website that are NOT in the original repo
const newCities: SpiderConfig[] = [
  {
    id: 'ba_salvador',
    name: 'Salvador - BA',
    territoryId: '2927408',
    spiderType: 'doem',
    startDate: '2013-01-02',
    config: {
      type: 'doem',
      stateCityUrlPart: 'ba/salvador',
    },
  },
  {
    id: 'ba_feira_de_santana',
    name: 'Feira de Santana - BA',
    territoryId: '2910800',
    spiderType: 'doem',
    startDate: '2013-01-02',
    config: {
      type: 'doem',
      stateCityUrlPart: 'ba/feiraDeSantana',
    },
  },
  {
    id: 'ba_vitoria_da_conquista',
    name: 'Vitória da Conquista - BA',
    territoryId: '2933307',
    spiderType: 'doem',
    startDate: '2013-01-02',
    config: {
      type: 'doem',
      stateCityUrlPart: 'ba/vitoriadaConquista',
    },
  },
  {
    id: 'ba_camacari',
    name: 'Camaçari - BA',
    territoryId: '2905701',
    spiderType: 'doem',
    startDate: '2013-01-02',
    config: {
      type: 'doem',
      stateCityUrlPart: 'ba/camacari',
    },
  },
  {
    id: 'ba_juazeiro',
    name: 'Juazeiro - BA',
    territoryId: '2918407',
    spiderType: 'doem',
    startDate: '2013-01-02',
    config: {
      type: 'doem',
      stateCityUrlPart: 'ba/juazeiro',
    },
  },
];

async function testCity(config: SpiderConfig) {
  logger.info(`Testing ${config.name} (${config.id})...`);
  
  const dateRange = {
    start: '2024-09-01',
    end: '2024-09-30',
  };
  
  const spider = new DoemSpider(config, dateRange);
  
  try {
    const startTime = Date.now();
    const gazettes = await spider.crawl();
    const duration = Date.now() - startTime;
    
    logger.info(`✅ ${config.name}: ${gazettes.length} gazettes found in ${duration}ms`);
    
    if (gazettes.length > 0) {
      logger.info(`   First gazette: ${gazettes[0].date} - ${gazettes[0].fileUrl}`);
    }
    
    return { success: true, count: gazettes.length, duration };
  } catch (error) {
    logger.error(`❌ ${config.name} failed:`, error);
    return { success: false, error: error.message };
  }
}

async function main() {
  logger.info(`Testing ${newCities.length} new cities from DOEM website...\n`);
  
  const results = [];
  
  for (const city of newCities) {
    const result = await testCity(city);
    results.push({ city: city.name, ...result });
    console.log(''); // Empty line between tests
  }
  
  // Summary
  logger.info('\n=== SUMMARY ===');
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  logger.info(`✅ Successful: ${successful.length}/${newCities.length}`);
  logger.info(`❌ Failed: ${failed.length}/${newCities.length}`);
  
  if (successful.length > 0) {
    const totalGazettes = successful.reduce((sum, r) => sum + r.count, 0);
    const avgDuration = successful.reduce((sum, r) => sum + r.duration, 0) / successful.length;
    logger.info(`📊 Total gazettes: ${totalGazettes}`);
    logger.info(`⏱️  Average duration: ${Math.round(avgDuration)}ms`);
  }
  
  if (failed.length > 0) {
    logger.error('\nFailed cities:');
    failed.forEach(r => logger.error(`  - ${r.city}: ${r.error}`));
  }
}

main();
