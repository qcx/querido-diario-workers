import { DoemSpider } from './src/spiders/base/doem-spider';
import { SpiderConfig, DoemConfig, DateRange } from './src/types';
import { logger } from './src/utils/logger';
import * as fs from 'fs';
import * as path from 'path';

interface IBGECity {
  id: string;
  nome: string;
  microrregiao: { mesorregiao: { UF: { sigla: string } } };
}

interface Top50BACity {
  rank: number;
  name: string;
  population: number;
}

function normalizeName(name: string): string {
  return name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/["'-]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function main() {
  logger.info('Starting generation and testing of top 50 Bahia DOEM cities...');

  // 1. Load IBGE municipalities
  const ibgeData: IBGECity[] = JSON.parse(fs.readFileSync('/tmp/ibge-municipios.json', 'utf-8'));
  const ibgeLookup = new Map<string, { id: string; name: string; state: string }>();
  for (const muni of ibgeData) {
    const stateCode = muni.microrregiao?.mesorregiao?.UF?.sigla;
    if (!stateCode) {
      logger.warn(`Skipping IBGE municipality ${muni.nome} (${muni.id}) due to missing state code.`);
      continue;
    }
    const cityName = muni.nome;
    const normalizedName = normalizeName(cityName);
    ibgeLookup.set(`${normalizedName}_${stateCode}`, { id: muni.id, name: cityName, state: stateCode });
  }
  logger.info(`Loaded ${ibgeLookup.size} IBGE municipalities.`);

  // 2. Load top 50 Bahia cities
  const top50BACities: Top50BACity[] = JSON.parse(fs.readFileSync('/tmp/top50-ba-cities.json', 'utf-8'));
  logger.info(`Loaded ${top50BACities.length} top 50 Bahia cities.`);

  // 3. Load existing DOEM configs
  const existingDoemConfigsPath = path.join(__dirname, 'src/spiders/configs/doem-cities.json');
  const existingDoemConfigs: SpiderConfig[] = JSON.parse(fs.readFileSync(existingDoemConfigsPath, 'utf-8'));
  const existingDoemIds = new Set(existingDoemConfigs.map(c => c.id));
  logger.info(`Loaded ${existingDoemIds.size} existing DOEM configs.`);

  const newDoemConfigs: SpiderConfig[] = [];
  const dateRange: DateRange = { start: '2024-09-01', end: '2024-09-30' };

  for (const city of top50BACities) {
    const cityName = city.name;
    const stateCode = 'BA';
    const normalizedCityName = normalizeName(cityName);
    const ibgeKey = `${normalizedCityName}_${stateCode}`;
    const ibgeInfo = ibgeLookup.get(ibgeKey);

    if (!ibgeInfo) {
      logger.warn(`Could not find IBGE info for ${cityName}, ${stateCode}. Skipping.`);
      continue;
    }

    // Construct the slug for DOEM
    let doemSlugPart = normalizedCityName.replace(/\s/g, '');
    // Apply specific transformations for known cases from previous Python script attempt
    doemSlugPart = doemSlugPart.replace(/da/g, 'Da').replace(/de/g, 'De').replace(/do/g, 'Do').replace(/dos/g, 'Dos').replace(/das/g, 'Das');
    doemSlugPart = `${stateCode.toLowerCase()}/${doemSlugPart}`;

    // Override with known correct slugs if necessary
    if (cityName === 'Feira de Santana') doemSlugPart = 'ba/feiraDeSantana';
    else if (cityName === 'Vitória da Conquista') doemSlugPart = 'ba/vitoriadaConquista';
    else if (cityName === 'Camaçari') doemSlugPart = 'ba/camacari';
    else if (cityName === 'Juazeiro') doemSlugPart = 'ba/juazeiro';
    else if (cityName === 'Salvador') doemSlugPart = 'ba/salvador';
    else if (cityName === 'Dias d\'Ávila') doemSlugPart = 'ba/diasDAvila';

    const spiderId = `${stateCode.toLowerCase()}_${normalizedCityName.replace(/\s/g, '_')}`.replace(/[^a-z0-9_]/g, '');

    const configEntry: SpiderConfig = {
      id: spiderId,
      name: `${ibgeInfo.name} - ${ibgeInfo.state}`,
      territoryId: ibgeInfo.id,
      spiderType: 'doem',
      startDate: '2013-01-02', // Default start date, can be refined later
      config: {
        type: 'doem',
        stateCityUrlPart: doemSlugPart,
      } as DoemConfig,
    };

    if (existingDoemIds.has(configEntry.id)) {
      logger.info(`Skipping existing city: ${configEntry.name} (${configEntry.id})`);
      continue;
    }

    logger.info(`Testing new city: ${configEntry.name} (${configEntry.id})...`);
    const spider = new DoemSpider(configEntry, dateRange);
    try {
      const startTime = Date.now();
      const gazettes = await spider.crawl();
      const duration = Date.now() - startTime;

      if (gazettes.length > 0) {
        logger.info(`✅ ${configEntry.name}: ${gazettes.length} gazettes found in ${duration}ms`);
        newDoemConfigs.push(configEntry);
      } else {
        logger.warn(`⚠️ ${configEntry.name}: 0 gazettes found in ${duration}ms. Skipping.`);
      }
    } catch (error) {
      logger.error(`❌ ${configEntry.name} failed:`, error);
    }
    await new Promise(resolve => setTimeout(resolve, 1000)); // Delay to avoid hammering the server
  }

  // Combine with existing configs and save
  const finalConfigs = existingDoemConfigs.concat(newDoemConfigs);
  const finalConfigsSorted = finalConfigs.sort((a, b) => a.id.localeCompare(b.id));

  fs.writeFileSync(existingDoemConfigsPath, JSON.stringify(finalConfigsSorted, null, 2), 'utf-8');
  logger.info(`
Generated ${newDoemConfigs.length} new DOEM configs for Bahia.`);
  logger.info(`Total DOEM configs now: ${finalConfigsSorted.length}`);
}

main();

