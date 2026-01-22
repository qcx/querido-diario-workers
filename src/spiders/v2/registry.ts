import { SpiderConfig, SpiderType } from '../../types';
import { TerritoryConfigV2 } from './types';
import { logger } from '../../utils/logger';

// Import all state config files
import spConfigs from './configs/sp.json';
import mgConfigs from './configs/mg.json';
import esConfigs from './configs/es.json';
import rjConfigs from './configs/rj.json';
import ceConfigs from './configs/ce.json';

/**
 * Registry of all state configuration files
 * Add new state imports here and include them in the STATE_CONFIGS object
 */
const STATE_CONFIGS = {
  'SP': spConfigs,
  'MG': mgConfigs,
  'ES': esConfigs,
  'RJ': rjConfigs,
  'CE': ceConfigs,
  // Add more states here as needed:
  // etc.
} as const;

/**
 * Spider registry for V2 territory-based configuration system
 */
export class SpiderRegistryV2 {
  private territoryConfigs: Map<string, TerritoryConfigV2> = new Map();
  private spiderConfigs: Map<string, SpiderConfig> = new Map();
  private territoryIdToConfigId: Map<string, string> = new Map();

  constructor() {
    this.loadTerritoryConfigs();
  }

  /**
   * Load territory configurations from imported state config files
   * and generate individual spider configs
   */
  private loadTerritoryConfigs(): void {
    const allConfigs: TerritoryConfigV2[] = [];
    let loadedStatesCount = 0;
    
    // Process each state configuration
    for (const [stateCode, stateConfigs] of Object.entries(STATE_CONFIGS)) {
      try {
        // Process each territory config in the state file
        for (const territoryConfig of stateConfigs as TerritoryConfigV2[]) {
          // Ensure the territory config has the correct state prefix
          if (!territoryConfig.id.startsWith(stateCode.toLowerCase() + '_')) {
            logger.warn(`Territory config ${territoryConfig.id} in ${stateCode} doesn't follow expected naming convention (${stateCode.toLowerCase()}_*)`);
          }
          
          // Add stateCode property if not present
          const configWithState = {
            ...territoryConfig,
            stateCode: territoryConfig.stateCode || stateCode
          };
          
          allConfigs.push(configWithState);
        }
        
        logger.info(`Loaded ${stateConfigs.length} territory configurations from ${stateCode} state`);
        loadedStatesCount++;
      } catch (error) {
        logger.error(`Failed to load config for state ${stateCode}:`, error as Error);
      }
    }
    
    // Process all loaded configurations
    for (const territoryConfig of allConfigs) {
      // Store territory config
      this.territoryConfigs.set(territoryConfig.id, territoryConfig);
      this.territoryIdToConfigId.set(territoryConfig.territoryId, territoryConfig.id);
      
      // Generate individual spider configs for backward compatibility
      territoryConfig.spiders.forEach((spider, index) => {
        const spiderConfig: SpiderConfig = {
          id: `${territoryConfig.id}_${spider.spiderType}_${index}`,
          name: `${territoryConfig.name} - ${spider.spiderType.toUpperCase()}`,
          territoryId: territoryConfig.territoryId,
          spiderType: spider.spiderType,
          gazetteScope: spider.gazetteScope || 'city',
          active: territoryConfig.active && spider.active,
          aliases: spider.aliases,
          startDate: spider.startDate,
          config: spider.config
        };
        
        this.spiderConfigs.set(spiderConfig.id, spiderConfig);
      });
    }

    logger.info(`Loaded ${allConfigs.length} territory configurations from ${loadedStatesCount} states with ${this.spiderConfigs.size} individual spider configs`);
  }

  /**
   * Get territory configuration by ID
   */
  getTerritoryConfig(territoryId: string): TerritoryConfigV2 | undefined {
    return this.territoryConfigs.get(territoryId);
  }

  /**
   * Get territory configuration by IBGE territory ID
   */
  getTerritoryConfigByTerritoryId(territoryId: string): TerritoryConfigV2 | undefined {
    const configId = this.territoryIdToConfigId.get(territoryId);
    return configId ? this.territoryConfigs.get(configId) : undefined;
  }

  /**
   * Get all territory configurations
   */
  getAllTerritoryConfigs(): TerritoryConfigV2[] {
    return Array.from(this.territoryConfigs.values());
  }

  /**
   * Get all active territory configurations
   */
  getActiveTerritoryConfigs(): TerritoryConfigV2[] {
    return this.getAllTerritoryConfigs().filter(config => config.active);
  }

  /**
   * Get individual spider configuration by ID (for backward compatibility)
   */
  getSpiderConfig(spiderId: string): SpiderConfig | undefined {
    return this.spiderConfigs.get(spiderId);
  }

  /**
   * Get all individual spider configurations (for backward compatibility)
   */
  getAllSpiderConfigs(): SpiderConfig[] {
    return Array.from(this.spiderConfigs.values());
  }

  /**
   * Get spider configurations for a specific territory
   */
  getSpidersForTerritory(territoryId: string): SpiderConfig[] {
    return Array.from(this.spiderConfigs.values()).filter(
      config => config.territoryId === territoryId
    );
  }

  /**
   * Get active spider configurations for a specific territory, sorted by priority
   */
  getActiveSpidersForTerritory(territoryId: string): SpiderConfig[] {
    const territoryConfig = this.getTerritoryConfigByTerritoryId(territoryId);
    if (!territoryConfig || !territoryConfig.active) {
      return [];
    }

    return this.getSpidersForTerritory(territoryId)
      .filter(config => config.active)
      .sort((a, b) => {
        // Get priority from territory config
        const spiderA = territoryConfig.spiders.find(s => s.spiderType === a.spiderType);
        const spiderB = territoryConfig.spiders.find(s => s.spiderType === b.spiderType);
        
        return (spiderA?.priority || 999) - (spiderB?.priority || 999);
      });
  }

  /**
   * Get spider configurations by type
   */
  getSpiderConfigsByType(spiderType: SpiderType): SpiderConfig[] {
    return Array.from(this.spiderConfigs.values()).filter(
      config => config.spiderType === spiderType
    );
  }

  /**
   * Check if a territory ID exists in V2 system
   */
  hasTerritoryId(territoryId: string): boolean {
    return this.territoryIdToConfigId.has(territoryId);
  }

  /**
   * Check if a territory config ID exists in V2 system
   */
  hasTerritoryConfigId(configId: string): boolean {
    return this.territoryConfigs.has(configId);
  }

  /**
   * Get priority for a specific spider in a territory
   */
  getSpiderPriority(territoryId: string, spiderType: SpiderType): number {
    const territoryConfig = this.getTerritoryConfigByTerritoryId(territoryId);
    if (!territoryConfig) return 999;
    
    const spider = territoryConfig.spiders.find(s => s.spiderType === spiderType);
    return spider?.priority || 999;
  }

  /**
   * Get the total number of territories
   */
  getTerritoryCount(): number {
    return this.territoryConfigs.size;
  }

  /**
   * Get the total number of individual spider configs
   */
  getSpiderCount(): number {
    return this.spiderConfigs.size;
  }

  /**
   * Get all territory configurations for a specific state
   */
  getTerritoriesByState(stateCode: string): TerritoryConfigV2[] {
    return this.getAllTerritoryConfigs().filter(
      config => config.stateCode?.toUpperCase() === stateCode.toUpperCase()
    );
  }

  /**
   * Get all unique state codes
   */
  getAvailableStates(): string[] {
    const states = new Set<string>();
    this.getAllTerritoryConfigs().forEach(config => {
      if (config.stateCode) {
        states.add(config.stateCode.toUpperCase());
      }
    });
    return Array.from(states).sort();
  }

  /**
   * Get territory configurations by state code prefix in ID
   */
  getTerritoriesByStatePrefix(statePrefix: string): TerritoryConfigV2[] {
    const prefix = statePrefix.toLowerCase() + '_';
    return this.getAllTerritoryConfigs().filter(
      config => config.id.startsWith(prefix)
    );
  }

  /**
   * Get all configured state codes from the registry
   */
  getConfiguredStates(): string[] {
    return Object.keys(STATE_CONFIGS);
  }
}
