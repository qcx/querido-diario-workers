import { SpiderConfig, SpiderType, DateRange } from '../types';
import { BaseSpider } from './base';
import { SpiderRegistryV2 } from './v2/registry';
import { ExecutionStrategy } from './v2/types';
import { logger } from '../utils/logger';

// Import the original v1 registry class
import doemCitiesConfig from './configs/doem-cities.json';
import diarioBaCitiesConfig from './configs/diario-ba-cities.json';
import ammMtCitiesConfig from './configs/amm-mt-cities.json';
import instarCitiesConfig from './configs/instar-cities.json';
import dospCitiesConfig from './configs/dosp-cities.json';
import diofCitiesConfig from './configs/diof-cities.json';
import adiariosV1CitiesConfig from './configs/adiarios-v1-cities.json';
import barcoDigitalCitiesConfig from './configs/barco_digital_cities.json';
import siganetCitiesConfig from './configs/siganet_cities.json';
import diarioOficialBRCitiesConfig from './configs/diario-oficial-br-cities.json';
import modernizacaoCitiesConfig from './configs/modernizacao-cities.json';
import adiariosV2CitiesConfig from './configs/adiarios-v2-cities.json';
import aplusCitiesConfig from './configs/aplus-cities.json';
import dioenetCitiesConfig from './configs/dioenet-cities.json';
import administracaoPublicaCitiesConfig from './configs/administracao-publica-cities.json';
import ptioCitiesConfig from './configs/ptio-cities.json';
import municipioOnlineCitiesConfig from './configs/municipio-online-cities.json';
import atendeV2CitiesConfig from './configs/atende-v2-cities.json';
import domScCitiesConfig from './configs/dom-sc-cities.json';
import sigpubCitiesConfig from './configs/sigpub-cities.json';
import doeSpCitiesConfig from './configs/doe-sp-cities.json';
import rondoniaCitiesConfig from './configs/rondonia-cities.json';
import acreCitiesConfig from './configs/acre-cities.json';
import espiritoSantoCitiesConfig from './configs/espirito-santo-cities.json';
import domunicipalCitiesConfig from './configs/domunicipal-cities.json';

// Import spider classes for v1 compatibility
import { 
  DoemSpider, 
  InstarSpider, 
  DospSpider, 
  DiofSpider, 
  ADiariosV1Spider, 
  SigpubSpider, 
  BarcoDigitalSpider, 
  SiganetSpider, 
  RondoniaSpider, 
  AcreSpider, 
  EspiritoSantoSpider,
  DomunicipalSpider,
  ImprensaOficialJundiaiSpider,
  PrefeituraRioPretoSpider,
  ImprensaOficialMunicipalSpider,
  PrefeituraItirapuaSpider,
  KingDiarioSpider,
  PrefeituraNovaOdessaSpider,
  PrefeituraMogiDasCruzesSpider,
  PrefeituraSaoJoaoDaBoaVistaSpider,
  PrefeituraBatataisSpider,
  PrefeituraCajamarSpider,
  PrefeituraCosmopolisSpider,
  PrefeituraCotiaSpider,
  PrefeituraGuarulhosSpider,
  PrefeituraItatibaSpider,
  PrefeituraMairiporaSpider,
  PrefeituraNarandibaSpider,
  PrefeituraPirajuSpider,
  PrefeituraItaquaquecetubaSpider,
  PrefeituraPiraporadobomjesusSpider,
  EatosSpider
} from './base';
import { DiarioOficialBRSpider } from './base/diario-oficial-br-spider';
import { ModernizacaoSpider } from './base/modernizacao-spider';
import { ADiariosV2Spider } from './base/adiarios-v2-spider';
import { AplusSpider } from './base/aplus-spider';
import { DioenetSpider } from './base/dioenet-spider';
import { AdministracaoPublicaSpider } from './base/administracao-publica-spider';
import { PtioSpider } from './base/ptio-spider';
import { MunicipioOnlineSpider } from './base/municipio-online-spider';
import { AtendeV2Spider } from './base/atende-v2-spider';
import { DomScSpider } from './base/dom-sc-spider';
import { DiarioBaSpider } from './base/diario-ba-spider';
import { AmmMtSpider } from './base/amm-mt-spider';

/**
 * Version type for spider system
 */
export type SpiderVersion = 'v1' | 'v2';

/**
 * Spider resolution result
 */
export interface SpiderResolutionResult {
  version: SpiderVersion;
  configs: SpiderConfig[];
  executionStrategy?: ExecutionStrategy;
}

/**
 * Unified Spider Registry Manager
 * Combines V1 and V2 spider registries with version routing
 */
export class SpiderRegistryManager {
  private v1Configs: Map<string, SpiderConfig> = new Map();
  private v2Registry: SpiderRegistryV2;

  constructor() {
    this.loadV1Configs();
    this.v2Registry = new SpiderRegistryV2();
    
    logger.info(`Registry Manager initialized with ${this.v1Configs.size} v1 configs and ${this.v2Registry.getSpiderCount()} v2 configs`);
  }

  /**
   * Load V1 configurations (original spider registry logic)
   */
  private loadV1Configs(): void {
    // Load DOEM cities
    for (const config of doemCitiesConfig as SpiderConfig[]) {
      this.v1Configs.set(config.id, config);
    }
    
    // Load Instar cities
    for (const config of instarCitiesConfig as SpiderConfig[]) {
      this.v1Configs.set(config.id, config);
    }
    
    // Load DOSP cities
    for (const config of dospCitiesConfig as SpiderConfig[]) {
      this.v1Configs.set(config.id, config);
    }
    
    // Load DIOF cities
    for (const config of diofCitiesConfig as SpiderConfig[]) {
      this.v1Configs.set(config.id, config);
    }
    
    // Load ADiarios V1 cities
    for (const config of adiariosV1CitiesConfig as SpiderConfig[]) {
      this.v1Configs.set(config.id, config);
    }
    
    // Load BarcoDigital cities
    for (const config of barcoDigitalCitiesConfig as SpiderConfig[]) {
      this.v1Configs.set(config.id, config);
    }
    
    // Load Siganet cities
    for (const config of siganetCitiesConfig as SpiderConfig[]) {
      this.v1Configs.set(config.id, config);
    }
    
    // Load DiarioOficialBR cities
    for (const config of diarioOficialBRCitiesConfig as SpiderConfig[]) {
      this.v1Configs.set(config.id, config);
    }
    
    // Load Modernizacao cities
    for (const config of modernizacaoCitiesConfig as SpiderConfig[]) {
      this.v1Configs.set(config.id, config);
    }
    
    // Load ADiarios V2 cities
    for (const config of adiariosV2CitiesConfig as SpiderConfig[]) {
      this.v1Configs.set(config.id, config);
    }
    
    // Load Aplus cities
    for (const config of aplusCitiesConfig as SpiderConfig[]) {
      this.v1Configs.set(config.id, config);
    }
    
    // Load Dioenet cities
    for (const config of dioenetCitiesConfig as SpiderConfig[]) {
      this.v1Configs.set(config.id, config);
    }
    
    // Load AdministracaoPublica cities
    for (const config of administracaoPublicaCitiesConfig as SpiderConfig[]) {
      this.v1Configs.set(config.id, config);
    }
    
    // Load PTIO cities
    for (const config of ptioCitiesConfig as SpiderConfig[]) {
      this.v1Configs.set(config.id, config);
    }
    
    // Load MunicipioOnline cities
    for (const config of municipioOnlineCitiesConfig as SpiderConfig[]) {
      this.v1Configs.set(config.id, config);
    }
    
    // Load AtendeV2 cities
    for (const config of atendeV2CitiesConfig as SpiderConfig[]) {
      this.v1Configs.set(config.id, config);
    }
    
    // Load DOM/SC cities
    for (const config of domScCitiesConfig as SpiderConfig[]) {
      this.v1Configs.set(config.id, config);
    }
    
    // Load Diário BA cities
    const diarioBaData = diarioBaCitiesConfig as any;
    for (const config of diarioBaData.municipalities as SpiderConfig[]) {
      this.v1Configs.set(config.id, config);
    }
    
    // Load AMM-MT cities
    const ammMtData = ammMtCitiesConfig as any;
    for (const config of ammMtData.municipalities as SpiderConfig[]) {
      this.v1Configs.set(config.id, config);
    }
    
    // Load SIGPub cities
    for (const config of sigpubCitiesConfig as SpiderConfig[]) {
      this.v1Configs.set(config.id, config);
    }
    
    // Load DOE SP cities
    for (const config of doeSpCitiesConfig as SpiderConfig[]) {
      this.v1Configs.set(config.id, config);
    }
    
    // Load Rondônia state gazette
    const rondoniaData = rondoniaCitiesConfig as any;
    for (const config of rondoniaData.municipalities as SpiderConfig[]) {
      this.v1Configs.set(config.id, config);
    }
    
    // Load Acre state gazette
    const acreData = acreCitiesConfig as any;
    for (const config of acreData.municipalities as SpiderConfig[]) {
      this.v1Configs.set(config.id, config);
    }
    
    // Load Espírito Santo state gazette (DOM - AMUNES)
    const espiritoSantoData = espiritoSantoCitiesConfig as any;
    for (const config of espiritoSantoData.municipalities as SpiderConfig[]) {
      this.v1Configs.set(config.id, config);
    }
    
    // Load DOMunicipal cities
    for (const config of domunicipalCitiesConfig as SpiderConfig[]) {
      this.v1Configs.set(config.id, config);
    }
  }

  /**
   * Resolve spider IDs to configurations based on version
   */
  resolveSpiderIds(
    cities: string[] | 'all', 
    version?: SpiderVersion,
    executionStrategy?: ExecutionStrategy
  ): SpiderResolutionResult {
    
    // If no version specified, default to v1
    const resolvedVersion = version || 'v1';
    
    if (cities === 'all') {
      if (resolvedVersion === 'v2') {
        return {
          version: 'v2',
          configs: this.v2Registry.getAllSpiderConfigs(),
          executionStrategy
        };
      } else {
        return {
          version: 'v1',
          configs: Array.from(this.v1Configs.values())
        };
      }
    }

    const configs: SpiderConfig[] = [];
    let detectedVersion: SpiderVersion = resolvedVersion;

    for (const cityId of cities) {
      if (resolvedVersion === 'v2' || this.v2Registry.hasTerritoryConfigId(cityId)) {
        // V2: Territory-based resolution
        const territoryConfig = this.v2Registry.getTerritoryConfig(cityId);
        if (territoryConfig) {
          const territorySpiders = this.v2Registry.getActiveSpidersForTerritory(territoryConfig.territoryId);
          configs.push(...territorySpiders);
          detectedVersion = 'v2';
        } else {
          // Try as individual spider ID in v2
          const spiderConfig = this.v2Registry.getSpiderConfig(cityId);
          if (spiderConfig) {
            configs.push(spiderConfig);
            detectedVersion = 'v2';
          }
        }
      } else {
        // V1: Individual spider resolution
        const config = this.v1Configs.get(cityId);
        if (config) {
          configs.push(config);
        }
      }
    }

    return {
      version: detectedVersion,
      configs: configs.filter((config): config is NonNullable<typeof config> => config !== undefined),
      executionStrategy
    };
  }

  /**
   * Get spider configuration by ID (V1 compatibility)
   */
  getConfig(spiderId: string): SpiderConfig | undefined {
    // Try V1 first for backward compatibility
    const v1Config = this.v1Configs.get(spiderId);
    if (v1Config) {
      return v1Config;
    }
    
    // Try V2
    return this.v2Registry.getSpiderConfig(spiderId);
  }

  /**
   * Get all spider configurations (V1 compatibility)
   */
  getAllConfigs(): SpiderConfig[] {
    const v1Configs = Array.from(this.v1Configs.values());
    const v2Configs = this.v2Registry.getAllSpiderConfigs();
    return [...v1Configs, ...v2Configs];
  }

  /**
   * Get spider configurations by type (V1 compatibility)
   */
  getConfigsByType(spiderType: SpiderType): SpiderConfig[] {
    const v1Configs = Array.from(this.v1Configs.values()).filter(
      config => config.spiderType === spiderType
    );
    const v2Configs = this.v2Registry.getSpiderConfigsByType(spiderType);
    return [...v1Configs, ...v2Configs];
  }

  /**
   * Create spider instance from configuration (V1 compatibility)
   */
  createSpider(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher): BaseSpider {
    switch (config.spiderType) {
      case 'doem':
        return new DoemSpider(config, dateRange);
      
      case 'adiarios_v1':
        return new ADiariosV1Spider(config, dateRange);
        
      case 'adiarios_v2':
        const spider = new ADiariosV2Spider(config, dateRange);
        if (browser) {
          spider.setBrowser(browser);
        }
        return spider;
        
      case 'instar':
        const instarSpider = new InstarSpider(config, dateRange, browser);
        return instarSpider;
        
      case 'dosp':
        return new DospSpider(config, dateRange);
        
      case 'diof':
        return new DiofSpider(config, dateRange);
        
      case 'sigpub':
        return new SigpubSpider(config, dateRange);
      
      case 'barco_digital':
        return new BarcoDigitalSpider(config, dateRange);
      
      case 'siganet':
        return new SiganetSpider(config, dateRange);
      
      case 'diario_oficial_br':
        return new DiarioOficialBRSpider(config, dateRange);
      
      case 'modernizacao':
        return new ModernizacaoSpider(config, dateRange);
      
      case 'aplus':
        return new AplusSpider(config, dateRange);
      
      case 'dioenet':
        return new DioenetSpider(config, dateRange);
      
      case 'administracao_publica':
        return new AdministracaoPublicaSpider(config, dateRange);
      
      case 'ptio':
        return new PtioSpider(config, dateRange);
      
      case 'municipio_online':
        return new MunicipioOnlineSpider(config, dateRange);
      
      case 'atende_v2':
        return new AtendeV2Spider(config, dateRange);
      
      case 'dom_sc':
        return new DomScSpider(config, dateRange);
      
      case 'diario-ba':
        return new DiarioBaSpider(config, dateRange);
      
      case 'amm-mt':
        return new AmmMtSpider(config, dateRange);
      
      case 'rondonia':
        return new RondoniaSpider(config, dateRange);
      
      case 'acre':
        return new AcreSpider(config, dateRange);
      
      case 'espirito_santo':
        return new EspiritoSantoSpider(config, dateRange);
      
      case 'domunicipal':
        return new DomunicipalSpider(config, dateRange);
      
      case 'imprensaoficialjundiai':
        return new ImprensaOficialJundiaiSpider(config, dateRange);
      
      case 'prefeiturariopreto':
        const rioPretospider = new PrefeituraRioPretoSpider(config, dateRange);
        if (browser) {
          rioPretospider.setBrowser(browser);
        }
        return rioPretospider;
      
      case 'imprensaoficialmunicipal':
        const imprensaOficialMunicipalSpider = new ImprensaOficialMunicipalSpider(config, dateRange);
        if (browser) {
          imprensaOficialMunicipalSpider.setBrowser(browser);
        }
        return imprensaOficialMunicipalSpider;
      
      case 'prefeituraitirapua':
        const itirapuaSpider = new PrefeituraItirapuaSpider(config, dateRange);
        if (browser) {
          itirapuaSpider.setBrowser(browser);
        }
        return itirapuaSpider;
      
      case 'kingdiario':
        const kingDiarioSpider = new KingDiarioSpider(config, dateRange);
        if (browser) {
          kingDiarioSpider.setBrowser(browser);
        }
        return kingDiarioSpider;
      
      case 'prefeituranovaodessa':
        return new PrefeituraNovaOdessaSpider(config, dateRange);
      
      case 'prefeituramogidascruzes':
        return new PrefeituraMogiDasCruzesSpider(config, dateRange);
      
      case 'prefeiturasaojoaodaboavista':
        const saoJoaoSpider = new PrefeituraSaoJoaoDaBoaVistaSpider(config, dateRange);
        if (browser) {
          saoJoaoSpider.setBrowser(browser);
        }
        return saoJoaoSpider;
      
      case 'prefeiturabatais':
        return new PrefeituraBatataisSpider(config, dateRange);
      
      case 'prefeituracajamar':
        return new PrefeituraCajamarSpider(config, dateRange);
      
      case 'prefeituracosmopolis':
        return new PrefeituraCosmopolisSpider(config, dateRange);
      
      case 'prefeituracotia':
        const cotiaSpider = new PrefeituraCotiaSpider(config, dateRange);
        if (browser) {
          cotiaSpider.setBrowser(browser);
        }
        return cotiaSpider;
      
      case 'prefeituraguarulhos':
        const guarulhosSpider = new PrefeituraGuarulhosSpider(config, dateRange);
        if (browser) {
          guarulhosSpider.setBrowser(browser);
        }
        return guarulhosSpider;
      
      case 'prefeituraitaitiba':
        const itatibaSpider = new PrefeituraItatibaSpider(config, dateRange, browser);
        return itatibaSpider;
      
      case 'prefeituramaripora':
        const mairiporaSpider = new PrefeituraMairiporaSpider(config, dateRange, browser);
        return mairiporaSpider;
      
      case 'prefeituranarandiba':
        return new PrefeituraNarandibaSpider(config, dateRange);
      
      case 'prefeiturapiraju':
        const pirajuSpider = new PrefeituraPirajuSpider(config, dateRange, browser);
        return pirajuSpider;
      
      case 'prefeituraitaquaquecetuba':
        const itaquaquecetubaSpider = new PrefeituraItaquaquecetubaSpider(config, dateRange, browser);
        return itaquaquecetubaSpider;
      
      case 'prefeiturapiraporadobomjesus':
        return new PrefeituraPiraporadobomjesusSpider(config, dateRange);
      
      case 'eatos':
        const eatosSpider = new EatosSpider(config, dateRange);
        if (browser) {
          eatosSpider.setBrowser(browser);
        }
        return eatosSpider;
      
      case 'custom':
        throw new Error(`Custom spider ${config.id} not implemented`);
      
      default:
        throw new Error(`Unknown spider type: ${config.spiderType}`);
    }
  }

  /**
   * Get the total number of registered spiders (V1 compatibility)
   */
  getCount(): number {
    return this.v1Configs.size + this.v2Registry.getSpiderCount();
  }

  /**
   * Get V2 registry for advanced operations
   */
  getV2Registry(): SpiderRegistryV2 {
    return this.v2Registry;
  }

  /**
   * Check if a city ID exists in V2 system
   */
  isV2Territory(cityId: string): boolean {
    return this.v2Registry.hasTerritoryConfigId(cityId) || this.v2Registry.hasTerritoryId(cityId);
  }
}
