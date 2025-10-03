/**
 * Spider type identifier
 */
export type SpiderType = 
  | 'doem'
  | 'adiarios_v1'
  | 'adiarios_v2'
  | 'instar'
  | 'sigpub'
  | 'custom';

/**
 * Configuration for a spider
 */
export interface SpiderConfig {
  /** Unique spider identifier (e.g., "ba_acajutiba") */
  id: string;
  
  /** Human-readable name (e.g., "Acajutiba - BA") */
  name: string;
  
  /** IBGE territory code */
  territoryId: string;
  
  /** Type of spider/platform */
  spiderType: SpiderType;
  
  /** Earliest date available for this municipality (ISO format) */
  startDate: string;
  
  /** Platform-specific configuration */
  config: SpiderPlatformConfig;
}

/**
 * Platform-specific configuration
 */
export type SpiderPlatformConfig = 
  | DoemConfig
  | AdiariosConfig
  | InstarConfig
  | SigpubConfig
  | CustomConfig;

/**
 * Configuration for Instar platform spiders
 */
export interface InstarConfig {
  type: 'instar';
  /** Base URL for the Instar platform */
  url: string;
  // Add other Instar-specific configuration properties here if needed
}

/**
 * Configuration for Sigpub platform spiders
 */
export interface SigpubConfig {
  type: 'sigpub';
  /** Base URL for the Sigpub platform */
  url: string;
  // Add other Sigpub-specific configuration properties here if needed
}

/**
 * Configuration for DOEM platform spiders
 */
export interface DoemConfig {
  type: 'doem';
  
  /** State and city URL part (e.g., "ba/acajutiba") */
  stateCityUrlPart: string;
}

/**
 * Configuration for ADiarios platform spiders
 */
export interface AdiariosConfig {
  type: 'adiarios_v1' | 'adiarios_v2';
  
  /** Base URL for the municipality */
  baseUrl: string;
  
  /** Municipality identifier in the platform */
  municipalityId?: string;
}

/**
 * Configuration for custom spiders
 */
export interface CustomConfig {
  type: 'custom';
  
  /** Custom configuration object */
  [key: string]: any;
}

/**
 * Date range for crawling
 */
export interface DateRange {
  /** Start date (ISO format) */
  start: string;
  
  /** End date (ISO format) */
  end: string;
}
