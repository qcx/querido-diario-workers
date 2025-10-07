import { SpiderConfig, SpiderType, DateRange } from '../types';
import { BaseSpider, DoemSpider, InstarSpider, DospSpider, DiofSpider, ADiariosV1Spider, SigpubSpider, BarcoDigitalSpider, SiganetSpider, RondoniaSpider, AcreSpider, EspiritoSantoSpider } from './base';
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

/**
 * Spider registry - maps spider IDs to configurations
 */
class SpiderRegistry {
  private configs: Map<string, SpiderConfig> = new Map();

  constructor() {
    this.loadConfigs();
  }

  /**
   * Loads all spider configurations
   */
  private loadConfigs(): void {
    // Load DOEM cities
    for (const config of doemCitiesConfig as SpiderConfig[]) {
      this.configs.set(config.id, config);
    }
    
    // Load Instar cities
    for (const config of instarCitiesConfig as SpiderConfig[]) {
      this.configs.set(config.id, config);
    }
    
    // Load DOSP cities
    for (const config of dospCitiesConfig as SpiderConfig[]) {
      this.configs.set(config.id, config);
    }
    
    // Load DIOF cities
    for (const config of diofCitiesConfig as SpiderConfig[]) {
      this.configs.set(config.id, config);
    }
    
    // Load ADiarios V1 cities
    for (const config of adiariosV1CitiesConfig as SpiderConfig[]) {
      this.configs.set(config.id, config);
    }
    
    // Load BarcoDigital cities
    for (const config of barcoDigitalCitiesConfig as SpiderConfig[]) {
      this.configs.set(config.id, config);
    }
    
    // Load Siganet cities
    for (const config of siganetCitiesConfig as SpiderConfig[]) {
      this.configs.set(config.id, config);
    }
    
    // Load DiarioOficialBR cities
    for (const config of diarioOficialBRCitiesConfig as SpiderConfig[]) {
      this.configs.set(config.id, config);
    }
    
    // Load Modernizacao cities
    for (const config of modernizacaoCitiesConfig as SpiderConfig[]) {
      this.configs.set(config.id, config);
    }
    
    // Load ADiarios V2 cities
    for (const config of adiariosV2CitiesConfig as SpiderConfig[]) {
      this.configs.set(config.id, config);
    }
    
    // Load Aplus cities
    for (const config of aplusCitiesConfig as SpiderConfig[]) {
      this.configs.set(config.id, config);
    }
    
    // Load Dioenet cities
    for (const config of dioenetCitiesConfig as SpiderConfig[]) {
      this.configs.set(config.id, config);
    }
    
    // Load AdministracaoPublica cities
    for (const config of administracaoPublicaCitiesConfig as SpiderConfig[]) {
      this.configs.set(config.id, config);
    }
    
    // Load PTIO cities
    for (const config of ptioCitiesConfig as SpiderConfig[]) {
      this.configs.set(config.id, config);
    }
    
    // Load MunicipioOnline cities
    for (const config of municipioOnlineCitiesConfig as SpiderConfig[]) {
      this.configs.set(config.id, config);
    }
    
    // Load AtendeV2 cities
    for (const config of atendeV2CitiesConfig as SpiderConfig[]) {
      this.configs.set(config.id, config);
    }
    
    // Load DOM/SC cities
    for (const config of domScCitiesConfig as SpiderConfig[]) {
      this.configs.set(config.id, config);
    }
    
    // Load Diário BA cities
    const diarioBaData = diarioBaCitiesConfig as any;
    for (const config of diarioBaData.municipalities as SpiderConfig[]) {
      this.configs.set(config.id, config);
    }
    
    // Load AMM-MT cities
    const ammMtData = ammMtCitiesConfig as any;
    for (const config of ammMtData.municipalities as SpiderConfig[]) {
      this.configs.set(config.id, config);
    }
    
    // Load SIGPub cities
    for (const config of sigpubCitiesConfig as SpiderConfig[]) {
      this.configs.set(config.id, config);
    }
    
    // Load DOE SP cities
    for (const config of doeSpCitiesConfig as SpiderConfig[]) {
      this.configs.set(config.id, config);
    }
    
    // Load Rondônia state gazette
    const rondoniaData = rondoniaCitiesConfig as any;
    for (const config of rondoniaData.municipalities as SpiderConfig[]) {
      this.configs.set(config.id, config);
    }
    
    // Load Acre state gazette
    const acreData = acreCitiesConfig as any;
    for (const config of acreData.municipalities as SpiderConfig[]) {
      this.configs.set(config.id, config);
    }
    
    // Load Espírito Santo state gazette (DOM - AMUNES)
    const espiritoSantoData = espiritoSantoCitiesConfig as any;
    for (const config of espiritoSantoData.municipalities as SpiderConfig[]) {
      this.configs.set(config.id, config);
    }
  }

  /**
   * Gets a spider configuration by ID
   */
  getConfig(spiderId: string): SpiderConfig | undefined {
    return this.configs.get(spiderId);
  }

  /**
   * Gets all spider configurations
   */
  getAllConfigs(): SpiderConfig[] {
    return Array.from(this.configs.values());
  }

  /**
   * Gets spider configurations by type
   */
  getConfigsByType(spiderType: SpiderType): SpiderConfig[] {
    return Array.from(this.configs.values()).filter(
      config => config.spiderType === spiderType
    );
  }

  /**
   * Creates a spider instance from configuration
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
        return new InstarSpider(config, dateRange);
        
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
      
      case 'custom':
        throw new Error(`Custom spider ${config.id} not implemented`);
      
      default:
        throw new Error(`Unknown spider type: ${config.spiderType}`);
    }
  }

  /**
   * Gets the total number of registered spiders
   */
  getCount(): number {
    return this.configs.size;
  }
}

// Singleton instance
export const spiderRegistry = new SpiderRegistry();
