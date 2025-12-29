import type { GazetteScope } from './gazette';

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
  | 'domunicipal'
  | 'imprensaoficialjundiai'
  | 'prefeiturariopreto'
  | 'imprensaoficialmunicipal'
  | 'prefeituraitirapua'
  | 'kingdiario'
  | 'prefeituranovaodessa'
  | 'prefeituramogidascruzes'
  | 'prefeiturasaojoaodaboavista'
  | 'prefeiturabatais'
  | 'prefeituracajamar'
  | 'prefeituracosmopolis'
  | 'prefeituracotia'
  | 'prefeituraguarulhos'
  | 'prefeituraitaitiba'
  | 'prefeituramaripora'
  | 'prefeituranarandiba'
  | 'prefeiturapiraju'
  | 'prefeituraitaquaquecetuba'
  | 'prefeiturapiraporadobomjesus'
  | 'eatos'
  | 'prefeiturapiracicaba'
  | 'prefeiturabauru'
  | 'prefeiturasorocaba'
  | 'diariomunicipiosjc'
  | 'prefeiturasantoandre'
  | 'prefeituracampinas'
  | 'prefeituraosasco'
  | 'prefeiturasantos'
  | 'prefeituramaua'
  | 'prefeituradiadema'
  | 'prefeituracarapicuiba'
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
  gazetteScope: GazetteScope;
  
  /** Whether this spider is active and should be used for crawling */
  active: boolean;
  
  /** Alternative names for text filtering in state gazettes (e.g., ["Alta Floresta", "Alta Floresta D Oeste"]) */
  aliases?: string[];
  
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
  | DomunicipalConfig
  | ImprensaOficialJundiaiConfig
  | PrefeituraRioPretoConfig
  | ImprensaOficialMunicipalConfig
  | PrefeituraItirapuaConfig
  | KingDiarioConfig
  | PrefeituraNovaOdessaConfig
  | PrefeituraMogiDasCruzesConfig
  | PrefeituraSaoJoaoDaBoaVistaConfig
  | PrefeituraBatataisConfig
  | PrefeituraCajamarConfig
  | PrefeituraCosmopolisConfig
  | PrefeituraCotiaConfig
  | PrefeituraGuarulhosConfig
  | PrefeituraItatibaConfig
  | PrefeituraMairiporaConfig
  | PrefeituraNarandibaConfig
  | PrefeituraPirajuConfig
  | PrefeituraItaquaquecetubaConfig
  | PrefeituraPiraporadobomjesusConfig
  | EatosConfig
  | PrefeituraPiracicabaConfig
  | PrefeituraBauruConfig
  | PrefeituraSorocabaConfig
  | DiarioMunicipioSJCConfig
  | PrefeiturasantoandreConfig
  | PrefeituracampinasConfig
  | PrefeituraosascoConfig
  | PrefeiturasantosConfig
  | PrefeituramauaConfig
  | PrefeituradiademaConfig
  | PrefeituracarapicuibaConfig
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
  /** Whether this spider requires client-side rendering (browser) for JavaScript-heavy pages */
  requiresClientRendering?: boolean;
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
  /** Power of the gazette (executive_legislative for municipal content) */
  power: 'executive' | 'legislative' | 'executive_legislative';
}

/**
 * Configuration for Espírito Santo state official gazette spider (DOM - AMUNES)
 * All municipalities publish through AMUNES centralized system with API access
 */
export interface EspiritoSantoConfig {
  type: 'espirito_santo';
  /** Power of the gazette (executive_legislative for municipal content) */
  power: 'executive' | 'legislative' | 'executive_legislative';
}

/**
 * Configuration for DOMunicipal platform spiders
 */
export interface DomunicipalConfig {
  type: 'domunicipal';
  /** Base URL for the DOMunicipal platform (e.g., "https://domunicipal.com.br") */
  baseUrl: string;
  /** Organization ID for the municipality (e.g., "3" for Cristais Paulista) */
  orgaoId: string;
}

/**
 * Configuration for Imprensa Oficial Jundiaí spider
 */
export interface ImprensaOficialJundiaiConfig {
  type: 'imprensaoficialjundiai';
  /** Base URL for the Imprensa Oficial Jundiaí platform */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Rio Preto spider
 */
export interface PrefeituraRioPretoConfig {
  type: 'prefeiturariopreto';
  /** Base URL for the Prefeitura Rio Preto platform */
  baseUrl: string;
}

/**
 * Configuration for Imprensa Oficial Municipal platform spider
 * Used by municipalities like Miguelópolis and Caiabu
 */
export interface ImprensaOficialMunicipalConfig {
  type: 'imprensaoficialmunicipal';
  /** Base URL for the Imprensa Oficial Municipal platform */
  baseUrl?: string;
  /** URL for the Imprensa Oficial Municipal platform (alternative to baseUrl for backward compatibility) */
  url?: string;
}

/**
 * Configuration for Prefeitura Itirapuã spider
 * ASP.NET/GeneXus platform requiring browser automation
 */
export interface PrefeituraItirapuaConfig {
  type: 'prefeituraitirapua';
  /** Base URL for the Prefeitura Itirapuã platform */
  baseUrl: string;
}

/**
 * Configuration for KingDiario platform spider
 * King Page platform requiring browser automation for form-based search
 */
export interface KingDiarioConfig {
  type: 'kingdiario';
  /** Base URL for the KingDiario platform */
  baseUrl?: string;
  /** URL for the KingDiario platform (alternative to baseUrl for backward compatibility) */
  url?: string;
}

/**
 * Configuration for Prefeitura Nova Odessa spider
 * Year-based pages with no date filter - all gazettes for a year on one page
 */
export interface PrefeituraNovaOdessaConfig {
  type: 'prefeituranovaodessa';
  /** Base URL for the Prefeitura Nova Odessa platform (e.g., "https://www.novaodessa.sp.gov.br/servicos/diario") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Mogi das Cruzes spider
 * Year and category-based pages with accordion structure
 */
export interface PrefeituraMogiDasCruzesConfig {
  type: 'prefeituramogidascruzes';
  /** Base URL for the Prefeitura Mogi das Cruzes platform (e.g., "https://diario-oficial.mogidascruzes.sp.gov.br/diarios/publicacoes") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de São João da Boa Vista spider
 * Vue.js/Vuetify application with year/month URL structure and pagination
 */
export interface PrefeituraSaoJoaoDaBoaVistaConfig {
  type: 'prefeiturasaojoaodaboavista';
  /** Base URL for the Prefeitura São João da Boa Vista platform (e.g., "https://publicacoes.boavista.rr.gov.br/diarios/2025/2") */
  baseUrl: string;
}

export interface PrefeituraBatataisConfig {
  type: 'prefeiturabatais';
  /** Base URL for the Prefeitura Batatais platform (e.g., "https://www.batatais.sp.gov.br/diario-oficial") */
  baseUrl: string;
}

export interface PrefeituraCajamarConfig {
  type: 'prefeituracajamar';
  /** Base URL for the Prefeitura Cajamar platform (e.g., "https://cajamar.sp.gov.br/diariooficial") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Cosmópolis spider
 * Paginated pages with date filtering during crawling
 */
export interface PrefeituraCosmopolisConfig {
  type: 'prefeituracosmopolis';
  /** Base URL for the Prefeitura Cosmópolis platform (e.g., "https://cosmopolis.sp.gov.br/semanario/") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Cotia spider
 * Browser-based calendar interaction on LeisMunicipais.com.br platform
 */
export interface PrefeituraCotiaConfig {
  type: 'prefeituracotia';
  /** Base URL for the Prefeitura Cotia platform (e.g., "https://leismunicipais.com.br/diario-oficial/sp/cotia") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Guarulhos spider
 * Browser-based calendar interaction with jQuery show/hide divs
 */
export interface PrefeituraGuarulhosConfig {
  type: 'prefeituraguarulhos';
  /** Base URL for the Prefeitura Guarulhos platform (e.g., "https://diariooficial.guarulhos.sp.gov.br/index.php") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Itatiba spider
 * Browser-based pagination with query parameters (dataDe, dataAte, pagina)
 */
export interface PrefeituraItatibaConfig {
  type: 'prefeituraitaitiba';
  /** Base URL for the Prefeitura Itatiba platform (e.g., "https://www.itatiba.sp.gov.br/ImprensaOficial") */
  url: string;
}

/**
 * Configuration for Prefeitura de Mairiporã spider
 * Browser-based infinite scroll with year-based URLs (/imprensa-oficial-{YEAR}-2/)
 */
export interface PrefeituraMairiporaConfig {
  type: 'prefeituramaripora';
  /** Base URL for the Prefeitura Mairiporã platform (e.g., "https://www.mairipora.sp.gov.br") */
  url: string;
}

/**
 * Configuration for Prefeitura de Narandiba spider
 * Simple HTML page with all gazettes listed (no pagination)
 */
export interface PrefeituraNarandibaConfig {
  type: 'prefeituranarandiba';
  /** Base URL for the Prefeitura Narandiba platform (e.g., "https://www.donarandiba.com.br/paginas/diario.php") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Piraju spider
 * Browser-based JSF/PrimeFaces application with date filters and pagination
 */
export interface PrefeituraPirajuConfig {
  type: 'prefeiturapiraju';
  /** Base URL for the Prefeitura Piraju platform (e.g., "https://diariooficialnovo.jelastic.saveincloud.net/paginas/public/diario_externo.xhtml?idCidade=3") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Itaquaquecetuba spider
 */
export interface PrefeituraItaquaquecetubaConfig {
  type: 'prefeituraitaquaquecetuba';
  /** Base URL for the Prefeitura Itaquaquecetuba platform (e.g., "https://www.itaquaquecetuba.sp.gov.br/diario-oficial/") */
  url: string;
}

/**
 * Configuration for Prefeitura de Pirapora do Bom Jesus spider
 */
export interface PrefeituraPiraporadobomjesusConfig {
  type: 'prefeiturapiraporadobomjesus';
  /** Base URL for the Prefeitura Pirapora do Bom Jesus platform (e.g., "https://imprensa.piraporadobomjesus.net.br/") */
  baseUrl: string;
}

/**
 * Configuration for EATOS (e-Atos) platform spider
 * Browser-based Nuxt.js application with calendar and list interface
 */
export interface EatosConfig {
  type: 'eatos';
  /** Base URL for the EATOS platform (e.g., "https://publicacoesmunicipais.com.br/eatos/ilhacomprida") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Piracicaba spider
 * 
 * Site structure:
 * - Page URL: https://diariooficial.piracicaba.sp.gov.br/{YYYY}/{MM}/{DD}/
 * - PDF URL: https://files.pmp.sp.gov.br/semad/diariooficial/{YYYY}/{MM}/{YYYYMMDD}.pdf
 */
export interface PrefeituraPiracicabaConfig {
  type: 'prefeiturapiracicaba';
  /** Base URL for the Prefeitura Piracicaba platform (e.g., "https://diariooficial.piracicaba.sp.gov.br/") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Bauru spider
 * 
 * Site structure:
 * - Page URL: https://www2.bauru.sp.gov.br/juridico/diariooficial.aspx
 * - PDF URL: https://www2.bauru.sp.gov.br/arquivos/sist_diariooficial/{YYYY}/{MM}/do_{YYYYMMDD}_{EDITION}.pdf
 * 
 * Requires browser rendering due to ASP.NET postback and JavaScript-rendered accordion menu
 */
export interface PrefeituraBauruConfig {
  type: 'prefeiturabauru';
  /** Base URL for the Prefeitura Bauru platform (e.g., "https://www2.bauru.sp.gov.br/juridico/diariooficial.aspx") */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Sorocaba spider
 * 
 * Site structure:
 * - Page URL: https://noticias.sorocaba.sp.gov.br/jornal/
 * 
 * Requires browser rendering for JavaScript-heavy pages
 */
export interface PrefeituraSorocabaConfig {
  type: 'prefeiturasorocaba';
  /** Base URL for the Prefeitura Sorocaba platform (e.g., "https://noticias.sorocaba.sp.gov.br/jornal/") */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Diário do Município de São José dos Campos spider
 * 
 * API Structure:
 * - Editions by date: {baseUrl}/apifront/portal/edicoes/edicoes_from_data/{YYYY-MM-DD}.json
 * - Download PDF: {baseUrl}/portal/edicoes/download/{id}
 * 
 * Response format:
 * {
 *   "erro": false,
 *   "msg": "",
 *   "itens": [{ "id": 2587, "data": "10/12/2025", "suplemento": 0, "numero": 3611, ... }]
 * }
 */
export interface DiarioMunicipioSJCConfig {
  type: 'diariomunicipiosjc';
  /** Base URL for the Diário do Município SJC platform (e.g., "https://diariodomunicipio.sjc.sp.gov.br") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura Santo André spider
 * 
 * Site Structure:
 * - Page URL: https://web.santoandre.sp.gov.br/portal/diario-oficial
 * - Search form with date range filters
 * - List of editions with "Ler online" and "Baixar" links
 * - Pattern: "Edição nº XXXX", date in format DD/MM/YYYY
 * 
 * Based on Instar-like pattern with custom implementation
 */
export interface PrefeiturasantoandreConfig {
  type: 'prefeiturasantoandre';
  /** Base URL for the Prefeitura Santo André platform */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Campinas spider
 * 
 * API Structure:
 * - Endpoint: https://portal-api.campinas.sp.gov.br/api/v1/publicacoes-dom/{type}/{YYYYMM}?_format=json
 * - Response: Array of objects with dom_id, dom_edicao, dom_data_pub, dom_arquivo
 * - PDF URL: https://portal-api.campinas.sp.gov.br{dom_arquivo}
 */
export interface PrefeituracampinasConfig {
  type: 'prefeituracampinas';
  /** Base API URL (e.g., "https://portal-api.campinas.sp.gov.br") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Osasco spider
 * 
 * Site Structure:
 * - URL: https://osasco.sp.gov.br/imprensa-oficial/
 * - Year tabs for filtering
 * - List of IOMO editions with links to PDFs
 * 
 * Requires browser rendering for JavaScript content
 */
export interface PrefeituraosascoConfig {
  type: 'prefeituraosasco';
  /** Base URL for the Prefeitura Osasco platform */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Santos spider
 * 
 * Site Structure:
 * - URL: https://diariooficial.santos.sp.gov.br/
 * - Date range filter (from/to)
 * - List of editions with "Leitura Digital" and "Download PDF" links
 * 
 * Requires browser rendering
 */
export interface PrefeiturasantosConfig {
  type: 'prefeiturasantos';
  /** Base URL for the Prefeitura Santos platform */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Mauá spider
 * 
 * Site Structure:
 * - URL: https://dom.maua.sp.gov.br/
 * - Filters by poder (executivo/legislativo) and categories
 * - List of publications with links
 * 
 * Requires browser rendering
 */
export interface PrefeituramauaConfig {
  type: 'prefeituramaua';
  /** Base URL for the Prefeitura Mauá platform */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Diadema spider
 * 
 * Site Structure:
 * - URL: https://diariooficial.diadema.sp.gov.br/
 * - Search form with tipo, secretaria, date range
 * - Grid of edition cards with links
 * 
 * Requires browser rendering
 */
export interface PrefeituradiademaConfig {
  type: 'prefeituradiadema';
  /** Base URL for the Prefeitura Diadema platform */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Carapicuíba spider
 * 
 * Site Structure:
 * - URL: https://diario.carapicuiba.sp.gov.br/
 * - Search by keyword, assunto, date range
 * - List of editions with links
 * 
 * Requires browser rendering
 */
export interface PrefeituracarapicuibaConfig {
  type: 'prefeituracarapicuiba';
  /** Base URL for the Prefeitura Carapicuíba platform */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

