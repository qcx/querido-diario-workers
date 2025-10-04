import { SpiderConfig, SpiderType, DateRange } from '../types';
import { BaseSpider, DoemSpider, InstarSpider, DospSpider, DiofSpider, ADiariosV1Spider, SigpubSpider } from './base';
import doemCitiesConfig from './configs/doem-cities.json';
import instarCitiesConfig from './configs/instar-cities.json';
import dospCitiesConfig from './configs/dosp-cities.json';
import diofCitiesConfig from './configs/diof-cities.json';
import adiariosV1CitiesConfig from './configs/adiarios-v1-cities.json';

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
  createSpider(config: SpiderConfig, dateRange: DateRange): BaseSpider {
    switch (config.spiderType) {
      case 'doem':
        return new DoemSpider(config, dateRange);
      
      case 'adiarios_v1':
        return new ADiariosV1Spider(config, dateRange);
        
      case 'adiarios_v2':
        throw new Error(`Spider type ${config.spiderType} not implemented yet`);
        
      case 'instar':
        return new InstarSpider(config, dateRange);
        
      case 'dosp':
        return new DospSpider(config, dateRange);
        
      case 'diof':
        return new DiofSpider(config, dateRange);
        
      case 'sigpub':
        return new SigpubSpider(config, dateRange);
      
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
