import type { GazetteScope } from './gazette';

/**
 * Spider type identifier
 */
export type SpiderType = 
  | 'doem'
  | 'adiarios_v1'
  | 'adiarios_v2'
  | 'instar'
  | 'instar_portal'
  | 'mentor'
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
  | 'gdoe'
  | 'onedom'
  | 'assistech'
  | 'cespro'
  | 'geosiap'
  | 'geosiap_api'
  | 'legislacaodigital'
  | 'prefeiturasaopaulo'
  | 'prefeiturasaovicente'
  | 'prefeiturafranca'
  | 'prefeituraguaruja'
  | 'prefeituraamericana'
  | 'prefeiturapresidenteprudente'
  | 'ecrie'
  | 'prefeituraserranegra'
  | 'prefeituraibiuna'
  | 'prefeiturafrancodarocha'
  | 'prefeituralvaresmachado'
  | 'prefeituraserrana'
  | 'prefeituracamposdojordao'
  | 'prefeituracapaobonito'
  | 'prefeituraju'
  | 'prefeituramogimirim'
  | 'prefeituratatatui'
  | 'prefeituraleme'
  | 'prefeituracaieiras'
  | 'prefeituraubatuba'
  | 'prefeiturasocorro'
  | 'prefeituracapivari'
  | 'prefeituratiete'
  | 'prefeiturapirassununga'
  | 'prefeituraperuibe'
  | 'prefeiturabertioga'
  | 'prefeituraitanhaem'
  | 'prefeituracaraguatatuba'
  | 'prefeituracubatao'
  | 'prefeiturasaocaetanodosul'
  | 'govbrdioenet'
  | 'prefeiturasuzano'
  | 'prefeituradescalvado'
  | 'prefeiturabarueri'
  | 'prefeiturasumare'
  | 'prefeiturasaocarlos'
  | 'prefeituraindaiatuba'
  | 'prefeituraferrazdevasconcelos'
  | 'prefeituraatibaia'
  | 'prefeiturafranciscomorato'
  | 'prefeiturabarretos'
  | 'portalcomunicacao'
  | 'prefeituravarzeapaulista'
  | 'prefeiturailhasolteira'
  | 'prefeiturasaosebastiao'
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
  | MentorConfig
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
  | GdoeConfig
  | OnedomConfig
  | AssistechConfig
  | CesproConfig
  | GeosiapConfig
  | GeosiapApiConfig
  | LegislacaoDigitalConfig
  | PrefeiturasaopauloConfig
  | PrefeiturasaovicenteConfig
  | PrefeiturafrancaConfig
  | PrefeituraguarujaConfig
  | PrefeituraAmericanaConfig
  | PrefeituraPresidentePrudenteConfig
  | EcrieConfig
  | IperoConfig
  | EcrieDiarioOficialConfig
  | PrefeituraSerranegraConfig
  | PrefeituraIbiunaConfig
  | PrefeituraFrancoDaRochaConfig
  | PrefeituraSerranaConfig
  | PrefeituracamposdojordaoConfig
  | PrefeituraCapaoBonitoConfig
  | PrefeituraJauConfig
  | PrefeituraMogiMirimConfig
  | PrefeituraTatuiConfig
  | PrefeituraLemeConfig
  | PrefeituracaieirasConfig
  | PrefeituraUbatubaConfig
  | PrefeiturasocorroConfig
  | PrefeituraCapivariConfig
  | PrefeituratieteeConfig
  | PrefeiturapirassunungaConfig
  | PrefeituraPeruibeConfig
  | PrefeituraBertiogaConfig
  | PrefeituraItanhaemConfig
  | PrefeituraCaraguatatubaConfig
  | PrefeituracubataoConfig
  | PrefeiturasaocaetanodosulConfig
  | GovbrDioenetConfig
  | PrefeituraDescalvadoConfig
  | PrefeituraBarueriConfig
  | PrefeiturasaocarlosConfig
  | PrefeituraIndaiatubaConfig
  | PrefeituraFerrazDeVasconcelosConfig
  | PrefeituraFranciscoMoratoConfig
  | PrefeituraAtibaiaConfig
  | PrefeituraBarretosConfig
  | PortalComunicacaoConfig
  | PrefeituraVarzeaPaulistaConfig
  | PrefeituraIlhaSolteiraConfig
  | PrefeiturasaosebastiaoeConfig
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
 * Configuration for Mentor/Metaway platform spiders
 * 
 * The Mentor platform uses a REST API to serve gazette data.
 * Base URL pattern: https://{city}.mentor.metaway.com.br
 */
export interface MentorConfig {
  type: 'mentor';
  /** Base URL for the Mentor platform (e.g., "https://lencois.mentor.metaway.com.br") */
  baseUrl: string;
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
  /** City ID used in the dioenet API (e.g., 36 for Praia Grande) */
  cityId: number;
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
 * Configuration for Prefeitura de Francisco Morato spider
 * Uses custom API: {baseUrl}/ServDiario?pAno=YYYY&pMes=MM&pOpcao=consultaEdicao
 * PDFs are at: {baseUrl}/anexos/{nomeArquivo}
 */
export interface PrefeituraFranciscoMoratoConfig {
  type: 'prefeiturafranciscomorato';
  /** Base URL for the Prefeitura Francisco Morato platform (e.g., "http://imprensaoficial.franciscomorato.sp.gov.br") */
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

/**
 * Configuration for GDOE platform spider
 * Used by municipalities like Assis and Artur Nogueira
 */
export interface GdoeConfig {
  type: 'gdoe';
  /** Base URL for the GDOE platform (e.g., "https://www.gdoe.com.br/assis") */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for 1DOM platform spider
 * Used by municipalities like Araraquara and Pindamonhangaba
 */
export interface OnedomConfig {
  type: 'onedom';
  /** Base URL for the 1DOM platform (e.g., "https://araraquara.1dom.com.br") */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Assistech Publicações platform spider
 * Used by municipalities like Araras
 */
export interface AssistechConfig {
  type: 'assistech';
  /** Base URL for the Assistech platform (e.g., "https://assistechpublicacoes.com.br/app/pmararassp/diario-oficial") */
  baseUrl: string;
}

/**
 * Configuration for CESPRO platform spider
 * Used by municipalities like Ribeirão Preto and São Sebastião
 */
export interface CesproConfig {
  type: 'cespro';
  /** Base URL for the CESPRO platform */
  baseUrl: string;
  /** Municipality code in CESPRO system (e.g., "9314" for Ribeirão Preto) */
  cdMunicipio: string;
}

/**
 * Configuration for GeoSIAP platform spider
 * Used by municipalities like Jacareí
 */
export interface GeosiapConfig {
  type: 'geosiap';
  /** Base URL for the GeoSIAP platform (e.g., "https://boletinsoficiais.geosiap.net/pmjacarei/public/publicacoes") */
  baseUrl: string;
}

/**
 * Configuration for GeoSIAP API-based spider
 * Uses the JSON API for listing and browser for getting presigned URLs
 */
export interface GeosiapApiConfig {
  type: 'geosiap_api';
  /** Base URL for the GeoSIAP platform (e.g., "https://boletinsoficiais.geosiap.net/pmjacarei/public/publicacoes") */
  baseUrl: string;
  /** City prefix in the GeoSIAP system (e.g., "pmjacarei") - optional, will be extracted from URL if not provided */
  cityPrefix?: string;
}

/**
 * Configuration for Legislação Digital platform spider
 * Used by municipalities like Arujá
 */
export interface LegislacaoDigitalConfig {
  type: 'legislacaodigital';
  /** Base URL for the Legislação Digital platform (e.g., "https://www.legislacaodigital.com.br/Aruja-SP/") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de São Paulo spider
 * The capital has a unique portal structure
 */
export interface PrefeiturasaopauloConfig {
  type: 'prefeiturasaopaulo';
  /** Base URL for the Prefeitura São Paulo platform */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de São Vicente spider
 * 
 * Site uses Plone CMS (gov.cidades theme) with PDF listings
 * PDFs are at: /transparencia/bom/bom-edicao-{EDITION}-{DDMMYYYY}-versaoimpressao.pdf/view
 */
export interface PrefeiturasaovicenteConfig {
  type: 'prefeiturasaovicente';
  /** Base URL for the São Vicente BOM page */
  baseUrl: string;
}

/**
 * Alias for Plone portal config (used by some spiders)
 */
export type PlonePortalConfig = PrefeiturasaovicenteConfig;

/**
 * Configuration for Prefeitura de Franca spider
 * 
 * Site uses custom AngularJS app with REST API
 * API: /pmf-diario/rest/diario/buscaPorArquivo/DD-MM-YYYY
 * PDFs at: https://webpmf.franca.sp.gov.br/arquivos/diario-oficial/documentos/
 */
export interface PrefeiturafrancaConfig {
  type: 'prefeiturafranca';
  /** Base URL for the Franca portal */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Guarujá spider
 * 
 * Site uses WordPress with custom API
 * API: /list-diario-oficial?data=YYYY-MM
 * Returns JSON with PDFs in metas.pdf
 */
export interface PrefeituraguarujaConfig {
  type: 'prefeituraguaruja';
  /** Base URL for the Guarujá portal */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Americana spider
 * 
 * Site has a calendar-based interface showing editions
 * Calendar: /diario-oficial-edicaoAnterior.php?mes={MM}&ano={YYYY}
 * Extra editions: /diario-oficial-edicaoExtra.php?mes={MM}&ano={YYYY}
 * PDFs: https://www.americana.sp.gov.br/download/diarioOficial/{hash}.pdf
 */
export interface PrefeituraAmericanaConfig {
  type: 'prefeituraamericana';
  /** Base URL for the Americana portal */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Presidente Prudente spider
 * 
 * Site uses Yii2 framework with list and search interface
 * List: /diario-oficial/index?page={N}
 * Search: /diario-oficial?BuscaSearch[data_inicio]={YYYY-MM-DD}&BuscaSearch[data_fim]={YYYY-MM-DD}
 * PDF: /diario-oficial/versao-pdf/{id}
 */
export interface PrefeituraPresidentePrudenteConfig {
  type: 'prefeiturapresidenteprudente';
  /** Base URL for the Presidente Prudente portal */
  baseUrl: string;
}

/**
 * Configuration for Ecrie platform spider
 * 
 * Used by municipalities like Boituva, Porto Ferreira, Guararema, Jarinu, 
 * Araçoiaba da Serra, and Embu-Guaçu
 * 
 * Site Structure:
 * - URL: {cidade}.sp.gov.br/diariooficial
 * - PDFs hosted on ecrie.com.br
 * - "Visualizar edição" buttons for each gazette
 * - Search form with date range and edition filters
 * - Calendar-based navigation in some cases
 * 
 * Requires browser rendering for JavaScript-heavy pages
 */
export interface EcrieConfig {
  type: 'ecrie';
  /** Base URL for the Ecrie platform (e.g., "https://boituva.sp.gov.br/diario-oficial") */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
  /** Pagination parameter name (default: 'p', some sites use 'pagina') */
  paginationParam?: 'p' | 'pagina';
}

/**
 * Configuration for Iperó spider
 * 
 * Specific spider for Iperó and similar municipalities that use a year-based
 * navigation structure with ecrie.com.br PDFs.
 * 
 * Site Structure:
 * - Main URL lists years (2026, 2025, etc.)
 * - Year pages have tables with edition links organized by month
 * - PDFs are on ecrie.com.br with format: a_XXX_X_X_DDMMYYYYHHMMSS.pdf
 * 
 * Requires browser rendering due to JavaScript-rendered content.
 */
export interface IperoConfig {
  type: 'ipero';
  /** Base URL for the Iperó-style platform (e.g., "https://www.ipero.sp.gov.br/jornal-oficial") */
  baseUrl: string;
}

/**
 * Configuration for EcrieDiarioOficial spider
 * 
 * Specifically for municipalities using ecriediariooficial.com.br platform
 * which has a different structure than the standard ecrie platform.
 * 
 * Used by municipalities like Biritiba Mirim.
 * 
 * Site Structure:
 * - URL: https://ecriediariooficial.com.br/{cidade}
 * - PDFs hosted on ecrie.com.br with ASS_u_* prefix
 * - Article cards with .list-item class
 * - Date in .list-item__date element
 * - Edition in .list-item__title
 * - View button with .list-item__button class
 */
export interface EcrieDiarioOficialConfig {
  type: 'ecriediariooficial';
  /** Base URL for the ecriediariooficial platform (e.g., "https://ecriediariooficial.com.br/biritibamirim") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Serra Negra spider
 * 
 * Site Structure:
 * - URL: https://serranegra.sp.gov.br/servicos/diario-oficial
 * - Listing page with article elements containing gazette titles
 * - Titles in format: "Diário Oficial - DD de MMMM de YYYY"
 * - Each article links to a detail page containing the PDF link
 * - PDFs hosted on ecrie.com.br
 * - Pagination with select dropdown
 * 
 * Requires browser rendering due to JavaScript content and navigation to detail pages.
 */
export interface PrefeituraSerranegraConfig {
  type: 'prefeituraserranegra';
  /** Base URL for the gazette listing page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Ibiúna spider
 * 
 * Site uses WordPress Download Manager plugin
 * - List page: https://ibiuna.sp.gov.br/diario-oficial/
 * - Download page: https://ibiuna.sp.gov.br/download/ed-XXXX-DD-MM-YYYY/
 * - Direct download: ?wpdmdl={ID}&refresh={token}
 */
export interface PrefeituraIbiunaConfig {
  type: 'prefeituraibiuna';
  /** Base URL for the Prefeitura Ibiúna platform */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Franco da Rocha spider
 * 
 * Site uses WordPress with custom theme
 * - Listing: /diariooficial/ with ul.noticias-lista
 * - Detail page: /diariooficial/YYYY/MM/DD/diario-oficial-edicao-XXX/
 * - PDFs: div.wp-block-file > a[href$=".pdf"]
 */
export interface PrefeituraFrancoDaRochaConfig {
  type: 'prefeiturafrancodarocha';
  /** Base URL for the Prefeitura Franco da Rocha platform */
  url?: string;
  /** Base URL for the Prefeitura Franco da Rocha platform (alternative) */
  baseUrl?: string;
}

/**
 * Configuration for Prefeitura de Serrana spider
 * 
 * Site uses DataTables-based table with pagination
 * - Table columns: Numero (edition), Data publicação, Arquivo (PDF link)
 * - Date format: "5 de Janeiro de 2026" (Portuguese month names)
 * - PDF URL: https://www.serrana.sp.gov.br/media/uploads/diario_oficial/diario_oficial_{edition}.pdf
 * 
 * Requires browser rendering for JavaScript-rendered table
 */
export interface PrefeituraSerranaConfig {
  type: 'prefeituraserrana';
  /** Base URL for the Prefeitura Serrana platform */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Campos do Jordão spider
 * 
 * Site uses HTML table-based listing with pagination
 * - Table columns: Edição/Mês, Data, Título (with PDF link)
 * - PDFs at: https://camposdojordao.sp.gov.br/Arquivos_Publicacoes/Diario-Oficial/{hash}.pdf
 * - Pagination: "Primeira", "1", "2", "3", ..., "Ultima"
 * 
 * Requires browser rendering for JavaScript-heavy pages
 */
export interface PrefeituracamposdojordaoConfig {
  type: 'prefeituracamposdojordao';
  /** Base URL for the Prefeitura Campos do Jordão platform */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Capão Bonito spider
 * 
 * Site uses WordPress with WP-FileBase plugin
 * - REST API: /wp-json/wp/v2/posts
 * - PDFs: /wp-content/uploads/filebase/imprensa_oficial/{YYYY}/edicao-{numero}.pdf
 */
export interface PrefeituraCapaoBonitoConfig {
  type: 'prefeituracapaobonito';
  /** Base URL for the Prefeitura Capão Bonito platform */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Jaú spider
 * 
 * Site Structure:
 * - Page URL: https://www.jau.sp.gov.br/diario-oficial
 * - Search: ?pesquisa_data_inicial=DD/MM/YYYY&pesquisa_data_final=DD/MM/YYYY
 * - PDFs at: https://www.jau.sp.gov.br/uploads/diario_oficial/edicoes/{YYYY}/{MM}/{DD}_{Edition}_{hash}.pdf
 * 
 * The site shows a list of editions with download buttons.
 * Each edition has: edition number, publication date, type (Ordinária/Extra), and download link.
 */
export interface PrefeituraJauConfig {
  type: 'prefeituraju';
  /** Base URL for the Prefeitura Jaú platform (e.g., "https://www.jau.sp.gov.br/diario-oficial") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Mogi Mirim spider
 * 
 * Site Structure (Dynamika Web CMS):
 * - Page URL: https://www.mogimirim.sp.gov.br/jornal
 * - Pagination: ?page=N
 * - PDFs: Direct links to /uploads/jornal/{id}/{hash}.pdf
 * - Titles: "Jornal Oficial de Mogi Mirim - {edition}" or "Jornal Oficial Extra de Mogi Mirim - {edition}"
 * - Dates are obtained from PDF's Last-Modified header (not in HTML)
 */
export interface PrefeituraMogiMirimConfig {
  type: 'prefeituramogimirim';
  /** Base URL for the Prefeitura Mogi Mirim platform (e.g., "https://www.mogimirim.sp.gov.br/jornal") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura Tatuí platform spiders
 */
export interface PrefeituraTatuiConfig {
  type: 'prefeituratatatui';
  /** Base URL for the Prefeitura Tatuí diário oficial (e.g., "http://tatui.sp.gov.br/diario-oficial") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Leme spider
 * 
 * Site Structure:
 * - Page URL: https://www.leme.sp.gov.br/imprensa
 * - Accordion with years (tabs) and months (nested accordions)
 * - PDFs: links with text pattern "EDIÇÃO Nº XXXX, DE DD/MM/YYYY PDF (XXX KB)"
 * - Direct PDF URLs: https://www.leme.sp.gov.br/assets/files/imprensas/{hash}.pdf
 * 
 * Requires browser rendering for JavaScript-rendered accordion structure
 */
export interface PrefeituraLemeConfig {
  type: 'prefeituraleme';
  /** Base URL for the Prefeitura Leme platform (e.g., "https://www.leme.sp.gov.br/imprensa") */
  baseUrl: string;
}

export interface PrefeituracaieirasConfig {
  type: 'prefeituracaieiras';
  /** Base URL for the Prefeitura Caieiras platform (e.g., "https://www.caieiras.sp.gov.br") */
  url?: string;
  /** Alternative base URL for the Prefeitura Caieiras platform */
  baseUrl?: string;
}

/**
 * Configuration for Prefeitura de Ubatuba spider
 * 
 * Site uses Zion3 platform with DataTables-based table
 * - Table columns: NUMERO, DATA, EMENTA, TIPO, RELACIONADOS, ARQUIVO
 * - Date format: "DD/MM/YYYY" (e.g., "06/01/2026")
 * - PDF links in the ARQUIVO column ("Ver" button)
 * 
 * Requires browser rendering for JavaScript-rendered table
 */
export interface PrefeituraUbatubaConfig {
  type: 'prefeituraubatuba';
  /** Base URL for the Prefeitura Ubatuba platform (e.g., "https://www.ubatuba.sp.gov.br/diario-oficial/") */
  baseUrl?: string;
  /** Alternative URL for the Prefeitura Ubatuba platform */
  url?: string;
}

/**
 * Configuration for Prefeitura de Socorro spider
 * 
 * Site uses WordPress blog with posts for each gazette edition
 * - Listing page: https://socorro.sp.gov.br/jornal/
 * - Detail page: /jornal/edicao/edicao-{EDITION}-{DD}-{MM}-{YYYY}/
 * - PDFs: /jornal/wp-content/uploads/{YYYY}/{MM}/{EDITION}.pdf
 * 
 * Each article on the listing page links to a detail page where the PDF download is available.
 */
export interface PrefeiturasocorroConfig {
  type: 'prefeiturasocorro';
  /** Base URL for the Prefeitura Socorro platform (e.g., "https://socorro.sp.gov.br/jornal/") */
  baseUrl?: string;
  /** Alternative URL for the Prefeitura Socorro platform */
  url?: string;
}

/**
 * Configuration for Prefeitura de Capivari spider
 * 
 * Site uses WordPress with elFinder (File Manager Advanced plugin)
 * - Page URL: https://capivari.sp.gov.br/portal/servicos/diario-oficial/
 * - elFinder interface with folder structure by year/month
 * - PDFs are organized in /Diario Oficial/YYYY/MM/ folders
 * 
 * Requires browser rendering for JavaScript-rendered elFinder interface
 */
export interface PrefeituraCapivariConfig {
  type: 'prefeituracapivari';
  /** Base URL for the Prefeitura Capivari platform */
  url?: string;
  /** Alternative base URL for the Prefeitura Capivari platform */
  baseUrl?: string;
  /** Whether this spider requires client-side rendering (browser) */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Tietê spider
 * 
 * Site Structure:
 * - Page URL: https://www.tiete.sp.gov.br/diariooficial.php
 * - List of months with edition links
 * - PDFs at: https://www.tiete.sp.gov.br/imprensa_oficial/{YYYY}_{MM}_{EDITION}.pdf
 * 
 * Each month heading (e.g., "Dezembro / 2025") contains multiple edition links
 * (e.g., "Edição 342-A", "Edição 342-B", etc.)
 * 
 * Requires browser rendering for JavaScript content extraction
 */
export interface PrefeituratieteeConfig {
  type: 'prefeituratiete';
  /** Base URL for the Prefeitura Tietê platform (e.g., "https://www.tiete.sp.gov.br/diariooficial.php") */
  url?: string;
  /** Alternative base URL for the Prefeitura Tietê platform */
  baseUrl?: string;
}

/**
 * Configuration for Prefeitura de Pirassununga spider
 * 
 * Site Structure:
 * - Page URL: https://pirassununga.sp.gov.br/servicos/governamental/diario-oficial
 * - Year listing: Links to /diario-oficial/{YYYY}-{ID}
 * - Year pages: Table with PDF links to ecrie.com.br
 * - PDF name format: YYYY-MM-DD - Diário Eletrônico nº XXX - DD de Mês de YYYY.pdf
 * 
 * Requires fetch-based crawling (no browser needed)
 */
export interface PrefeiturapirassunungaConfig {
  type: 'prefeiturapirassununga';
  /** Base URL for the Prefeitura Pirassununga platform (e.g., "https://pirassununga.sp.gov.br/servicos/governamental/diario-oficial") */
  url?: string;
  /** Alternative base URL for the Prefeitura Pirassununga platform */
  baseUrl?: string;
}

/**
 * Configuration for Prefeitura de Peruíbe spider
 * 
 * Site Structure (WordPress with "The Post Grid Pro" plugin):
 * - Page URL: https://www.peruibe.sp.gov.br/diario-oficial-do-municipio-dom-e/
 * - Posts at: https://www.peruibe.sp.gov.br/YYYY/MM/diario-oficial-do-municipio-dom-e-edicao-XXX/
 * - PDFs at: https://www.peruibe.sp.gov.br/portal/wp-content/uploads/YYYY/MM/DOM-E_-_XXX_assinado.pdf
 * 
 * Each gazette is listed as a WordPress post with a link to the PDF
 */
export interface PrefeituraPeruibeConfig {
  type: 'prefeituraperuibe';
  /** Base URL for the Prefeitura Peruíbe platform (e.g., "https://www.peruibe.sp.gov.br") */
  baseUrl?: string;
  /** Alternative URL for the Prefeitura Peruíbe platform */
  url?: string;
}

/**
 * Configuration for Prefeitura de Bertioga spider
 * 
 * Site developed by KBRTEC using custom WordPress theme
 * 
 * Site Structure:
 * - Page URL: https://www.bertioga.sp.gov.br/boletim-oficial
 * - Pagination: ?page=N
 * - List of gazette items with date, title and PDF download
 * - Date format: "DD de MMMM de YYYY" (Portuguese month names)
 * - PDFs: /wp/wp-content/uploads/YYYY/MM/{filename}.pdf
 */
export interface PrefeituraBertiogaConfig {
  type: 'prefeiturabertioga';
  /** Base URL for the Prefeitura Bertioga platform (e.g., "https://www.bertioga.sp.gov.br/boletim-oficial") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Itanhaém spider
 * 
 * Site uses WordPress REST API with custom post type 'boletim_oficial'
 * 
 * API Structure:
 * - Endpoint: /wp-json/wp/v2/boletim_oficial?per_page=100
 * - Response: Array of posts with date, title.rendered, content.rendered
 * - PDF URL: Extracted from iframe src in content.rendered
 * - PDFs: /wp-content/uploads/YYYY/MM/{edition}.pdf
 */
export interface PrefeituraItanhaemConfig {
  type: 'prefeituraitanhaem';
  /** Base URL for the Prefeitura Itanhaém platform (e.g., "https://www.itanhaem.sp.gov.br") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Caraguatatuba spider
 * 
 * Site structure:
 * - Page URL: https://diariooficial.caraguatatuba.sp.gov.br/public/consulta
 * - Search: ?dataInicial={YYYY-MM-DD}&dataFinal={YYYY-MM-DD}
 * - PDF URL: /public/consulta/diario/pdf/{id}
 */
export interface PrefeituraCaraguatatubaConfig {
  type: 'prefeituracaraguatatuba';
  /** Base URL for the Prefeitura Caraguatatuba platform */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Cubatão spider
 * 
 * Site uses DSJ Soluções Digitais platform
 * 
 * Site structure:
 * - Page URL: https://diariooficial.cubatao.sp.gov.br/
 * - Search: POST to search_s.php with dtinicial/dtfinal (DD/MM/YYYY)
 * - Edition details: search_sres.php?id={base64_id}
 */
export interface PrefeituracubataoConfig {
  type: 'prefeituracubatao';
  /** Base URL for the Prefeitura Cubatão platform */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de São Caetano do Sul spider
 * 
 * Site uses ASP.NET WebForms with calendar-based navigation
 * 
 * Site structure:
 * - Page URL: https://diariooficial.saocaetanodosul.sp.gov.br/publico/Default.aspx
 * - Calendar with clickable dates
 * - PDFs open in popup windows
 * 
 * Requires browser rendering
 */
export interface PrefeiturasaocaetanodosulConfig {
  type: 'prefeiturasaocaetanodosul';
  /** Base URL for the Prefeitura São Caetano do Sul platform */
  baseUrl: string;
}

/**
 * Configuration for GOVBR DIOENET platform spider
 * 
 * Site structure (different from plenussistemas.dioenet.com.br):
 * - Listing URL: https://www.govbrdioenet.com.br/list/{city-slug}
 * - View URL: https://www.govbrdioenet.com.br/uploads/view/{id}?utm_edicao={edition}
 * - PDF embedded in iframe with viewer.php?file= parameter
 */
export interface GovbrDioenetConfig {
  type: 'govbrdioenet';
  /** Base URL for the GOVBR DIOENET platform (e.g., "https://www.govbrdioenet.com.br/list/osvaldo-cruz") */
  baseUrl: string;
  /** City slug in the URL (e.g., "osvaldo-cruz") - optional, will be extracted from baseUrl if not provided */
  citySlug?: string;
}

/**
 * Configuration for Prefeitura de Suzano spider
 * WordPress-based site with Cloudflare protection
 * Requires browser rendering to bypass Cloudflare and extract gazettes
 */
export interface PrefeiturasuzanoConfig {
  type: 'prefeiturasuzano';
  /** Base URL for the Suzano imprensa oficial page (default: https://suzano.sp.gov.br/imprensa-oficial/) */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Descalvado spider
 * 
 * Site uses AleProgramas platform with DataTables JSON API
 * 
 * API Structure:
 * - Endpoint: {baseUrl}/index.php/functions/ajax_lista_diario/{MM-YYYY}
 * - Method: POST
 * - Response: { data: [[edição, data, descrição, html_com_link_pdf], ...] }
 */
export interface PrefeituraDescalvadoConfig {
  type: 'prefeituradescalvado';
  /** Base URL for the Descalvado portal (e.g., "https://www.descalvado.sp.gov.br/novoportal/prefeitura") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Barueri spider
 * 
 * Site uses custom HTML structure with gazette cards
 * 
 * Site structure:
 * - Page URL: https://portal.barueri.sp.gov.br/diario
 * - Cards with edition info, date, and PDF links
 * - PDF URL: https://servicos.barueri.sp.gov.br/cms/Upload/Diario/pdf/{filename}.pdf
 * - Date format: DD/MM/YYYY in diarioTopoText
 * - Edition number: in diarioTopoText with label "Edição:"
 */
export interface PrefeituraBarueriConfig {
  type: 'prefeiturabarueri';
  /** Base URL for the Prefeitura Barueri platform (e.g., "https://portal.barueri.sp.gov.br/diario") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de São Carlos spider
 * 
 * Site uses a custom DOM (Diário Oficial do Município) platform with JSON API
 * 
 * API Structure:
 * - Endpoint: https://cidadao.saocarlos.sp.gov.br/servicos/jornal/include/publicacoes.php
 * - Parameters: 
 *   - calendario=true: Required to get gazette list
 *   - permissao=0: Public access
 *   - start={YYYY-MM-DD}: Start date (ISO format)
 *   - end={YYYY-MM-DD}: End date (ISO format)
 * 
 * Response format:
 * [{ "title": "02934", "start": "2026-01-06", "description": "arquivo/2026/DO02934_2026_assinado.pdf" }]
 */
export interface PrefeiturasaocarlosConfig {
  type: 'prefeiturasaocarlos';
  /** Base URL for the Prefeitura São Carlos platform (e.g., "https://cidadao.saocarlos.sp.gov.br/servicos/jornal") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Indaiatuba spider
 * 
 * The Indaiatuba official gazette portal has a custom structure:
 * - URL: https://www.indaiatuba.sp.gov.br/comunicacao/imprensa-oficial/edicoes/
 * - Supports POST requests with date range filters (i_datainicial, i_datafinal, env)
 * - Returns HTML with links in format: <a href="/download/{id}/" title="Download da Edição N.º XXXX">Edição N.º XXXX - Publicada em DD/MM/YYYY</a>
 * - Download links return PDF files directly
 * 
 * Date filter parameters:
 * - i_datainicial: Start date (DD/MM/YYYY)
 * - i_datafinal: End date (DD/MM/YYYY)
 * - env: Must be "1" to enable the search
 */
export interface PrefeituraIndaiatubaConfig {
  type: 'prefeituraindaiatuba';
  /** Base URL for the Prefeitura Indaiatuba platform (e.g., "https://www.indaiatuba.sp.gov.br/comunicacao/imprensa-oficial/edicoes/") */
  url: string;
}

/**
 * Configuration for Prefeitura de Ferraz de Vasconcelos spider
 * 
 * Site structure (WordPress/Elementor/JetEngine):
 * - Page URL: https://ferrazdevasconcelos.sp.gov.br/web/home/boletins-oficiais/
 * - PDF links in: div.jet-listing-dynamic-field p.jet-listing-dynamic-field__content a
 * - Text format: "Edição Digital Nº {number}"
 * - PDF URL: https://ferrazdevasconcelos.sp.gov.br/web/wp-content/uploads/{YYYY}/{MM}/BOM_EDICAO_{number}.pdf
 */
export interface PrefeituraFerrazDeVasconcelosConfig {
  type: 'prefeituraferrazdevasconcelos';
  /** Base URL for the Ferraz de Vasconcelos diário oficial page */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Atibaia spider
 * 
 * Site Structure (MaterializeCSS-based):
 * - Page URL: https://www.prefeituradeatibaia.com.br/imprensa/numero.php?ano=YYYY
 * - Editions are listed in blockquote elements with PDF links
 * - PDF URL pattern: pdf/YYYY/NNNN_hash.pdf (relative to base)
 * - Link text: "Edição <b>NNNN</b> de [dia da semana], DD de Mês de YYYY"
 * - Extra editions have B, C, D suffix (e.g., 2910B, 2910C)
 */
export interface PrefeituraAtibaiaConfig {
  type: 'prefeituraatibaia';
  /** Base URL for the Prefeitura Atibaia platform (e.g., "https://www.prefeituradeatibaia.com.br/imprensa/") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Barretos spider
 * 
 * Site Structure:
 * - Base URL: http://barretos.sp.gov.br/folha-de-barretos
 * - Year pages: http://barretos.sp.gov.br/folha-de-barretos/{YYYY}
 * - PDF URL: https://files.barretos.sp.gov.br/pdf/newspaper/{hash}.pdf
 * - Edition format: "Edição {number} - {DD} de {Month} de {YYYY}"
 */
export interface PrefeituraBarretosConfig {
  type: 'prefeiturabarretos';
  /** Base URL for the Folha de Barretos (e.g., "http://barretos.sp.gov.br/folha-de-barretos") */
  baseUrl: string;
}

/**
 * Configuration for Portal Comunicação platform spider
 * 
 * Used by Santana de Parnaíba and potentially other municipalities
 * 
 * Site Structure:
 * - Base URL: https://prefeitura.santanadeparnaiba.sp.gov.br/PortalComunicacao/imprensa-oficial
 * - Year filter dropdown
 * - Cards with: Edition name, date range, download link
 * - Download URL: /PortalComunicacao/arquivo/download/{hash}
 * - Date format: "De DD a DD de mês de YYYY"
 * 
 * Requires browser rendering for JavaScript-heavy pages and Cloudflare protection
 */
export interface PortalComunicacaoConfig {
  type: 'portalcomunicacao';
  /** Base URL for the Portal Comunicação platform */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Várzea Paulista spider
 * 
 * Site Structure (WordPress GOVe5 theme):
 * - Page URL: https://transparencia.varzeapaulista.sp.gov.br/imprensa-oficial/
 * - Listings with links: ?nm_ano=YYYY&nm_mes=0&nm_edicao=NNNN
 * - Meta refresh redirect to PDF
 * - PDF URL: https://transparencia5.varzeapaulista.sp.gov.br/include/imprensa/pdf/{YYYY}_{NNNN}.pdf
 * - Date format: DD/MM/YYYY
 * 
 * The site lists editions with thumbnails showing edition number and date.
 * PDF URLs follow a predictable pattern: {year}_{edition}.pdf
 */
export interface PrefeituraVarzeaPaulistaConfig {
  type: 'prefeituravarzeapaulista';
  /** Base URL for the Prefeitura Várzea Paulista platform */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Ilha Solteira spider
 * 
 * Site Structure:
 * - WordPress site with yearly pages for SOEM (Semanário Oficial Eletrônico Municipal)
 * - Pages: https://ilhasolteira.sp.gov.br/soem-{YEAR}
 * - PDFs listed using wp-block-file blocks
 * - Title format: "SOEM YYYY N. {edição} – {dia} de {mês}"
 */
export interface PrefeituraIlhaSolteiraConfig {
  type: 'prefeiturailhasolteira';
  /** Base URL for the Prefeitura Ilha Solteira site */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de São Sebastião spider
 * 
 * Site Structure:
 * - Simple HTML page with list of gazette links
 * - URL: https://www.saosebastiao.sp.gov.br/doem.asp
 * - PDFs in format: doem/DOEM_{edition}_{YYYYMMDD}_{HHMMSS}.pdf
 * - Example: doem/DOEM_2136_20260105_233316.pdf
 */
export interface PrefeiturasaosebastiaoeConfig {
  type: 'prefeiturasaosebastiao';
  /** Base URL for the Prefeitura São Sebastião site */
  baseUrl: string;
}

