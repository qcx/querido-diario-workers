import type { SpiderType, SpiderPlatformConfig, GazetteScope } from '../../types';

/**
 * Territory configuration for V2 spider system
 */
export interface TerritoryConfigV2 {
  /** Unique territory identifier (e.g., "sp_cristais_paulista") */
  id: string;
  
  /** Human-readable name (e.g., "Cristais Paulista - SP") */
  name: string;
  
  /** IBGE territory code */
  territoryId: string;
  
  /** State code (e.g., "SP") - derived from filename if not present */
  stateCode?: string;
  
  /** Whether this territory is active and should be used for crawling */
  active: boolean;
  
  /** Array of spider definitions for this territory */
  spiders: SpiderDefinitionV2[];
}

/**
 * Spider definition within a territory configuration
 */
export interface SpiderDefinitionV2 {
  /** Type of spider/platform */
  spiderType: SpiderType;
  
  /** Priority for execution (lower number = higher priority) */
  priority: number;
  
  /** Whether this spider is active and should be used for crawling */
  active: boolean;
  
  /** Earliest date available for this spider (ISO format) */
  startDate?: string;
  
  /** Alternative names for text filtering in state gazettes */
  aliases?: string[];
  
  /** Gazette scope - city-specific or state-level (defaults to 'city') */
  gazetteScope?: GazetteScope;
  
  /** Platform-specific configuration */
  config: SpiderPlatformConfig;
}

/**
 * Execution strategy for V2 spider system
 */
export type ExecutionStrategy = 
  | 'priority-fallback'  // Execute highest priority first, fallback to others if it fails
  | 'all-parallel';      // Execute all spiders in parallel and merge results

/**
 * Array of territory configurations
 */
export type TerritoryConfigs = TerritoryConfigV2[];

