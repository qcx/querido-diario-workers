export enum SpiderScope {
  CITY = 'city',
  STATE = 'state',
}

/**
 * Spider type identifier
 */
export type SpiderType = 
  | 'doem'
  | 'adiarios_v1'
  | 'adiarios_v2'
  | 'instar'
  | 'dosp'
  | 'diof'
  | 'sigpub'
  | 'barco_digital'
  | 'siganet'
  | 'diario_oficial_br'
  | 'modernizacao'
  | 'aplus'
  | 'dioenet'
  | 'administracao_publica'
  | 'ptio'
  | 'municipio_online'
  | 'atende_v2'
  | 'dom_sc'
  | 'diario-ba'
  | 'amm-mt'
  | 'rondonia'
  | 'acre'
  | 'espirito_santo'
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
  
  /** Gazette scope - city-specific or state-level */
  gazetteScope: SpiderScope;
  
  /** Earliest date available for this municipality (ISO format) */
  startDate?: string;
  
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
  | DospConfig
  | DiofConfig
  | SigpubConfig
  | BarcoDigitalConfig
  | SiganetConfig
  | DiarioOficialBRConfig
  | ModernizacaoConfig
  | AplusConfig
  | DioenetConfig
  | AdministracaoPublicaConfig
  | PtioConfig
  | MunicipioOnlineConfig
  | AtendeV2Config
  | DomScConfig
  | DiarioBaConfig
  | AmmMtConfig
  | RondoniaConfig
  | AcreConfig
  | EspiritoSantoConfig
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
 * Configuration for DOSP platform spiders
 */
export interface DospConfig {
  type: 'dosp';
  /** Start URL for the municipality (e.g., "https://www.imprensaoficialmunicipal.com.br/horizonte") */
  url?: string;
  /** API URL for DOE SP direct access (e.g., "https://do-api-web-search.doe.sp.gov.br/v2/summary/structured") */
  apiUrl?: string;
  /** Journal ID for DOE SP API (defaults to Municípios) */
  journalId?: string;
  /** Section ID for DOE SP API (defaults to Atos Municipais) */
  sectionId?: string;
  /** Territory ID filter for specific municipalities in DOE SP */
  territoryFilter?: string;
}

/**
 * Configuration for DIOF platform spiders
 */
export interface DiofConfig {
  type: 'diof';
  /** Website URL for the municipality (e.g., "https://diario.igaci.al.gov.br") */
  website: string;
  /** Power of the gazette (executive, legislative, or executive_legislative) */
  power: 'executive' | 'legislative' | 'executive_legislative';
}

/**
 * Configuration for Sigpub platform spiders
 */
export interface SigpubConfig {
  type: 'sigpub';
  /** Base URL for the Sigpub platform */
  url: string;
  /** Entity ID for the association (e.g., "365" for AMUPE) */
  entityId: string;
  /** City name to search for in the gazette content (for state-level gazettes) */
  cityName?: string;
  /** Regex pattern for matching city in gazette text */
  cityRegex?: string;
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

export interface BarcoDigitalConfig {
  type: 'barco_digital';
  baseUrl: string;
}

export interface SiganetConfig {
  type: 'siganet';
  baseUrl: string;
}

export interface DiarioOficialBRConfig {
  type: 'diario_oficial_br';
  baseUrl: string;
}

export interface ModernizacaoConfig {
  type: 'modernizacao';
  domain: string;
  verSubpath?: string;
  power?: 'executive' | 'legislative' | 'executive_legislative';
}

export interface AplusConfig {
  type: 'aplus';
  baseUrl: string;
}

export interface DioenetConfig {
  type: 'dioenet';
  baseUrl: string;
}

export interface AdministracaoPublicaConfig {
  type: 'administracao_publica';
  token: string;
}

export interface PtioConfig {
  type: 'ptio';
  baseUrl: string;
}

export interface MunicipioOnlineConfig {
  type: 'municipio_online';
  urlUf: string;
  urlCity: string;
}

export interface AtendeV2Config {
  type: 'atende_v2';
  citySubdomain: string;
}

export interface DomScConfig {
  type: 'dom_sc';
  /** Base URL for the DOM/SC platform */
  url: string;
  /** Entity name for search (e.g., "Prefeitura Municipal de Florianópolis") */
  entityName: string;
}

export interface DiarioBaConfig {
  /** Base URL for the Diário Oficial BA platform */
  url: string;
  /** City name as used in the site dropdown (e.g., "SALVADOR") */
  cityName: string;
}

export interface AmmMtConfig {
  /** Base URL for the AMM-MT platform */
  url: string;
  /** City name for the municipality */
  cityName: string;
}

export interface RondoniaConfig {
  type: 'rondonia';
  /** City name to search for in the gazette content */
  cityName: string;
  /** Regex pattern for matching city in gazette text */
  cityRegex?: string;
  /** Power of the gazette (executive_legislative for municipal content) */
  power: 'executive' | 'legislative' | 'executive_legislative';
}

/**
 * Configuration for Acre state official gazette spider
 * All municipalities publish in a single centralized state gazette
 */
export interface AcreConfig {
  type: 'acre';
  /** City name to search for in the gazette content */
  cityName: string;
  /** Regex pattern for matching city in gazette text */
  cityRegex?: string;
  /** Power of the gazette (executive_legislative for municipal content) */
  power: 'executive' | 'legislative' | 'executive_legislative';
}

/**
 * Configuration for Espírito Santo state official gazette spider (DOM - AMUNES)
 * All municipalities publish through AMUNES centralized system with API access
 */
export interface EspiritoSantoConfig {
  type: 'espirito_santo';
  /** City name to search for in the gazette content (if filtering) */
  cityName?: string;
  /** Regex pattern for matching city in gazette text */
  cityRegex?: string;
  /** Power of the gazette (executive_legislative for municipal content) */
  power: 'executive' | 'legislative' | 'executive_legislative';
}
