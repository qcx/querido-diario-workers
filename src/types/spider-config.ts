import type { GazetteScope } from "./gazette";

/**
 * Spider type identifier
 */
export type SpiderType =
  | "doem"
  | "adiarios_v1"
  | "adiarios_v2"
  | "instar"
  | "instar_portal"
  | "instar_dados_abertos"
  | "diario_parauapebas_pa"
  | "doc_castanhal"
  | "mentor"
  | "dosp"
  | "diof"
  | "sigpub"
  | "sigpub-ac"
  | "sigpub_se"
  | "sigpub_mt"
  | "sigpub_pa"
  | "agm"
  | "planaltina_go"
  | "santo_antonio_descoberto_go"
  | "barco_digital"
  | "siganet"
  | "diariooficialmunicipal"
  | "diario_oficial_br"
  | "modernizacao"
  | "aplus"
  | "dioenet"
  | "administracao_publica"
  | "ptio"
  | "municipio_online"
  | "atende_v2"
  | "dom_sc"
  | "diario-ba"
  | "amm-mt"
  | "rondonia"
  | "acre"
  | "espirito_santo"
  | "dodf"
  | "domeletronico"
  | "amunes"
  | "aemerj"
  | "aprece"
  | "domunicipal"
  | "imprensaoficialjundiai"
  | "prefeiturariopreto"
  | "imprensaoficialmunicipal"
  | "prefeituraitirapua"
  | "kingdiario"
  | "prefeituranovaodessa"
  | "prefeituramogidascruzes"
  | "prefeiturasaojoaodaboavista"
  | "prefeituraboavista"
  | "prefeiturabatais"
  | "prefeituracajamar"
  | "camaramanaus"
  | "dommanaus"
  | "prefeituracosmopolis"
  | "prefeituracotia"
  | "prefeituraguarulhos"
  | "prefeituraitaitiba"
  | "prefeituramaripora"
  | "prefeituranarandiba"
  | "prefeiturapiraju"
  | "supernova"
  | "prefeituraitaquaquecetuba"
  | "prefeiturapiraporadobomjesus"
  | "eatos"
  | "prefeiturapiracicaba"
  | "prefeiturabauru"
  | "prefeiturabentogoncalves"
  | "prefeiturasorocaba"
  | "diariomunicipiosjc"
  | "gazetamunicipal"
  | "diariooficialguarantadonorte"
  | "diariooficialcaldasnovas"
  | "prefeiturasantoandre"
  | "prefeituracampinas"
  | "prefeituraosasco"
  | "prefeiturasantos"
  | "prefeituramaua"
  | "prefeituradiadema"
  | "prefeituracarapicuiba"
  | "gdoe"
  | "onedom"
  | "assistech"
  | "cespro"
  | "geosiap"
  | "geosiap_api"
  | "geosiap_portal"
  | "legislacaodigital"
  | "prefeiturasaopaulo"
  | "prefeiturasaovicente"
  | "prefeiturafranca"
  | "prefeituraguaruja"
  | "prefeituraamericana"
  | "prefeiturapresidenteprudente"
  | "ecrie"
  | "prefeituraserranegra"
  | "prefeituraibiuna"
  | "prefeiturafrancodarocha"
  | "prefeituralvaresmachado"
  | "prefeituraserrana"
  | "prefeituracamposdojordao"
  | "prefeituracapaobonito"
  | "prefeituraju"
  | "prefeituramogimirim"
  | "prefeituratatatui"
  | "prefeituraleme"
  | "prefeituracaieiras"
  | "prefeituraubatuba"
  | "prefeiturasocorro"
  | "prefeituracapivari"
  | "prefeituratiete"
  | "prefeiturapirassununga"
  | "prefeituraperuibe"
  | "prefeiturabertioga"
  | "prefeituraitanhaem"
  | "prefeituracaraguatatuba"
  | "prefeituracubatao"
  | "prefeiturasaocaetanodosul"
  | "govbrdioenet"
  | "prefeiturasuzano"
  | "prefeituradescalvado"
  | "prefeiturabarueri"
  | "prefeiturasumare"
  | "prefeiturasaocarlos"
  | "prefeituraindaiatuba"
  | "prefeituraferrazdevasconcelos"
  | "prefeituraatibaia"
  | "prefeiturafranciscomorato"
  | "prefeiturabarretos"
  | "portalcomunicacao"
  | "prefeituravarzeapaulista"
  | "prefeiturailhasolteira"
  | "prefeiturasaosebastiao"
  | "prefeiturabelohorizonte"
  | "prefeiturabetim"
  | "prefeiturajuizdefora"
  | "prefeiturauberlandia"
  | "prefeituramontesclaros"
  | "prefeituraipatinga"
  | "prefeituragovernadovaladares"
  | "prefeiturasantaluziamg"
  | "prefeiturauberaba"
  | "prefeiturapocosdecaldas"
  | "prefeiturabarbacena"
  | "prefeituraaraguari"
  | "folhadesabara"
  | "prefeiturasabara"
  | "prefeituracoronelfabriciano"
  | "prefeituraaraxa"
  | "prefeituralavras"
  | "prefeituranolalima"
  | "prefeituraitauna"
  | "prefeiturauba"
  | "prefeituraituiutaba"
  | "prefeituraparademinas"
  | "prefeiturasaojoaodelrei"
  | "prefeiturapatrocinio"
  | "prefeituracaratinga"
  | "prefeiturabomdespacho"
  | "prefeituraunai"
  | "prefeituraesmeraldas"
  | "prefeituratimoteo"
  | "prefeituraitajuba"
  | "prefeituramanhuacu"
  | "prefeituraalfenas"
  | "prefeituraalfenasatosoficiais"
  | "prefeituravicosa"
  | "prefeituraouropreto"
  | "prefeiturajanauba"
  | "prefeiturajanaubapublicacoes"
  | "prefeituramariana"
  | "prefeituracataguases"
  | "prefeiturafrutal"
  | "prefeituraextrema"
  | "prefeituracongonhas"
  | "prefeiturabaraodecocais"
  | "prefeituraespinosa"
  | "prefeituraeloi_mendes"
  | "prefeituraconceicaodasalagoas_concursos"
  | "prefeituraconceicaodasalagoas_atos"
  | "plenus_dioenet"
  | "portalfacil"
  | "diario_oficial_link"
  | "prefeituraalegre"
  | "prefeituravitoria"
  | "prefeituracariacica"
  | "prefeiturlinhares"
  | "prefeituracastelo"
  | "prefeituraguacui"
  | "prefeituravilavelha"
  | "prefeituracachoeiro"
  | "prefeituraserra"
  | "prefeituramarataizes"
  | "prefeituraguanhaes"
  | "prefeituraniiteroi"
  | "prefeiturariodejaneiro"
  | "prefeiturasaogoncalo"
  | "prefeituraduquedecaxias"
  | "prefeituracamposdosgoytacazes"
  | "prefeiturasaojoaodemeriti"
  | "prefeituravoltaredonda"
  | "prefeitrapetropolis"
  | "prefeituramacae"
  | "prefeituramage"
  | "prefeituraitaborai"
  | "prefeituracabofrio"
  | "prefeituramarica"
  | "prefeituranovafriburgo"
  | "domweb"
  | "prefeiturabarramansa"
  | "prefeituraangradosreis"
  | "prefeituramesquita"
  | "prefeiturateresopolis"
  | "prefeiturarjodasostras"
  | "prefeituranilopolis"
  | "prefeituraqueimados"
  | "prefeiturarjararuama"
  | "prefeiturarjresende"
  | "prefeiturarjitaguai"
  | "prefeiturarjsaopedrodaaldeia"
  | "prefeiturarjitaperuna"
  | "prefeiturarjjaperi"
  | "prefeiturarjbarradopirai"
  | "prefeiturarjsaquarema"
  | "prefeiturarjseropedica"
  | "prefeiturarjtresrios"
  | "prefeiturarjvalenca"
  | "prefeiturarjcachoeirasdemacacu"
  | "prefeiturarjriobonito"
  | "prefeiturarjguapimirim"
  | "prefeiturarjcasimirodeabreu"
  | "prefeiturarjparaty"
  | "prefeiturarjsaofranciscodeitabapoana"
  | "prefeiturarjparaibadosul"
  | "prefeiturarjparaibadosulv2"
  | "prefeiturarjparacambi"
  | "prefeiturarjparacambiv2"
  | "prefeiturarjsantoantoniopadua"
  | "prefeiturarjmangaratiba"
  | "prefeiturarjarmacaodosbuzios"
  | "prefeiturarjsaofidelis"
  | "prefeiturarjsaofidelisv2"
  | "prefeiturarjsaojoaodabarra"
  | "prefeiturarjsaojoaodabarrav2"
  | "prefeiturarjbomjesusdoitabapoana"
  | "prefeiturarjvassouras"
  | "prefeiturarjtangua"
  | "prefeiturarjarraialdocabo"
  | "prefeiturarjarraialdocabov2"
  | "prefeiturarjitatiaia"
  | "prefeiturarjpatydoalferes"
  | "prefeiturarjbomjardim"
  | "prefeiturarjiguabagrande"
  | "prefeiturarjmiracema"
  | "prefeiturarjmiguelpereira"
  | "prefeiturarjpirai"
  | "diario_oficial_online"
  | "phocadownload"
  | "npibrasil"
  | "prefeiturace"
  | "prefeituracaucaia"
  | "prefeiturasobral"
  | "prefeituracrato"
  | "plugtecnologia"
  | "wordpress_publicacoes"
  | "diariooficialms"
  | "prefeituracampogrande"
  | "prefeituradourados"
  | "prefeiturapontapora"
  | "prefeituranovaandradina"
  | "prefeituraaquidauana"
  | "edocman"
  | "prefeiturasalvador"
  | "prefeituravitoiriadaconquista"
  | "prefeiturabarreiras"
  | "prefeiturateixeiradefreitas"
  | "prefeituraportoseguro"
  | "prefeiturailheus"
  | "prefeituracamacari"
  | "prefeiturapauloafonso"
  | "portalgov"
  | "imprensaoficial"
  | "transparenciaoficialba"
  | "prefeiturairece"
  | "ibdmtransparencia"
  | "procede"
  | "domunicipio"
  | "portaliop"
  | "indap"
  | "impublicacoes"
  | "institutopublicacoes"
  | "prefeiturarecife"
  | "prefeiturajaboatao"
  | "prefeituracaruaru"
  | "prefeiturasantacruzdocapibaribe"
  | "prefeituracamaragibe"
  | "airdoc"
  | "prefeiturateresina"
  | "prefeiturapnarnaiba"
  | "diariooficialdasprefeituras"
  | "prefeituraaraipina"
  | "prefeiturabezerros"
  | "softagon"
  | "directus_portal"
  | "sogotecnologia"
  | "prefeituraimperatriz"
  | "prefeiturasaoluis"
  | "prefeituranatal"
  | "prefeituramossoro"
  | "prefeiturasaogoncalorn"
  | "prefeituramacaiba"
  | "prefeituraparnamirim"
  | "prefeituraassu"
  | "prefeiturasantaines"
  | "prefeiturapinheiro"
  | "prefeiturabarradocorda"
  | "prefeiturachapadinha"
  | "prefeituragrajau"
  | "prefeiturabarreirinhas"
  | "prefeiturasantaluziama"
  | "prefeituracaxias"
  | "prefeiturapacodolumiar"
  | "prefeituraportoalegre"
  | "camaracachoeirinha"
  | "prefeituracaxiasdosul"
  | "prefeituracanoas"
  | "prefeiturapelotas"
  | "prefeiturasantamaria"
  | "prefeituranovohamburgo"
  | "prefeiturasaoleopoldo"
  | "prefeiturapassofundo"
  | "prefeituratimon"
  | "prefeiturabacabal"
  | "prefeituratransparente"
  | "dom_orbitap"
  | "vfmtransparencia"
  | "megasofttransparencia"
  | "prefeiturajoaopessoa"
  | "prefeiturabayeux"
  | "prefeituracajazeiras"
  | "prefeituraguarabirapb"
  | "mssolucoes"
  | "prefeiturasousa"
  | "prefeituraqueimadaspb"
  | "prefeiturapedrasdefogo"
  | "prefeiturasaobentopb"
  | "prefeituralagoaseca"
  | "prefeiturapresidentedutra"
  | "prefeituraamarante"
  | "prefeituracoelhoneto"
  | "famem"
  | "diarioio"
  | "diariomunicipalalwordpress"
  | "kalana"
  | "prefeituracoruripe"
  | "iose"
  | "prefeituaraaracaju"
  | "agape"
  | "diariodomunicipioinfo"
  | "prefeituramacapa"
  | "prefeiturasantanaap"
  | "prefeituralaranjaldojari"
  | "diagramacao"
  | "prefeiturapalmas"
  | "prefeituragurupi"
  | "nucleogov"
  | "prefeituraaraguaina"
  | "prefeituraportonacional"
  | "prefeiturarondonopolis"
  | "prefeituragoiania"
  | "goianesia"
  | "prefeiturajatai"
  | "prefeituraprimaveradoleste"
  | "prefeituraNovoGama"
  | "prefeiturajaragua"
  | "santa_helena_go"
  | "morrinhos_go"
  | "padre_bernardo_go"
  | "pires_do_rio_go"
  | "sao_luis_montes_belos_go"
  | "prefeituravilhena"
  | "cristalina_go"
  | "dom_sc_edicao"
  | "prefeiturajoinville_sc"
  | "prefeituraflorianopolis_sc"
  | "prefeiturablumenau_sc"
  | "prefeiturasaojose_sc"
  | "prefeituraitajai_sc"
  | "prefeiturachapeco_sc"
  | "prefeiturapalhoca_sc"
  | "prefeituracriciuma_sc"
  | "prefeiturajaraguadosul_sc"
  | "prefeituralages_sc"
  | "prefeituraananindeua"
  | "prefeituracameta"
  | "prefeituraaltamira"
  | "prefeituraaugustocorrea"
  | "prefeiturapacaja"
  | "prefeituraportodemoz"
  | "prefeituraigarapeacu"
  | "prefeituravigia"
  | "prefeituraalmeirim"
  | "prefeituracurralinho"
  | "prefeituraoeirasdopara"
  | "prefeituraourilandianorte"
  | "prefeituraipixunadopara"
  | "prefeituralimoeirodoajuru"
  | "prefeituramedicilandia"
  | "prefeituraconcordiadopara"
  | "prefeituragoianesiadopara"
  | "prefeituramaracana"
  | "prefeiturasaosebastiaodaboavista"
  | "prefeituramelgaco"
  | "prefeituraulianopolis"
  | "prefeituasantanaaraguaia"
  | "prefeiturasaodomingosdocapim"
  | "portalcr2"
  | "portalcr2co"
  | "prefeiturabeelem"
  | "prefeituracuritiba"
  | "prefeituralondrina"
  | "prefeiturapontagrossa"
  | "prefeituracascavel"
  | "prefeiturasjp"
  | "prefeiturafoz"
  | "prefeituraguarapuava"
  | "prefeituraraucaria"
  | "prefeituramaringa"
  | "prefeituratoledo"
  | "prefeituracambe"
  | "prefeiturafranciscobeltrao"
  | "prefeituracianorte"
  | "prefeituratelemacoborba"
  | "prefeitureibipora"
  | "prefeituraprudentopolis"
  | "dioems"
  | "prefeiturajacarezinho"
  | "prefeiturajaguariaiva"
  | "prefeiturapalotina"
  | "prefeiturapinhao"
  | "prefeituraarapoti"
  | "prefeiturasantahelenapr"
  | "serpro_doe"
  | "ingadigital"
  | "custom";

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
  | DiarioParauapebasPaConfig
  | DocCastanhalConfig
  | MentorConfig
  | DospConfig
  | DiofConfig
  | SigpubConfig
  | AgmConfig
  | PlanaltinaGoConfig
  | SantoAntonioDescobertoGoConfig
  | BarcoDigitalConfig
  | CamaraManausConfig
  | DomManausConfig
  | SiganetConfig
  | DiarioOficialMunicipalConfig
  | DiarioOficialBRConfig
  | ModernizacaoConfig
  | AplusConfig
  | DioenetConfig
  | PlenusDioenetConfig
  | AdministracaoPublicaConfig
  | PtioConfig
  | PrefeituramaringaConfig
  | MunicipioOnlineConfig
  | TresTecnosConfig
  | AtendeV2Config
  | DomScConfig
  | PrefeituraScCityConfig
  | PrefeituraAnanindeuaConfig
  | PrefeituracametaConfig
  | PrefeituraAltamiraConfig
  | PrefeituraPaPublicacoesConfig
  | PrefeituraUlianopolisConfig
  | PrefeituraSantanaAraguaiaConfig
  | PrefeituraSaodomingosdocapimConfig
  | PrefeituraBelemConfig
  | PortalCr2Config
  | PortalCr2CoConfig
  | DiarioBaConfig
  | AmmMtConfig
  | FamemConfig
  | DiariodomunicipioinfoConfig
  | RondoniaConfig
  | AcreConfig
  | EspiritoSantoConfig
  | AmunesConfig
  | AemerjConfig
  | ApreceConfig
  | DomunicipalConfig
  | ImprensaOficialJundiaiConfig
  | PrefeituraRioPretoConfig
  | ImprensaOficialMunicipalConfig
  | PrefeituraItirapuaConfig
  | KingDiarioConfig
  | PrefeituraNovaOdessaConfig
  | PrefeituraMogiDasCruzesConfig
  | PrefeituraSaoJoaoDaBoaVistaConfig
  | PrefeituraBoaVistaConfig
  | PrefeituraBatataisConfig
  | PrefeituraCajamarConfig
  | PrefeituraCosmopolisConfig
  | PrefeituraCotiaConfig
  | PrefeituraGuarulhosConfig
  | PrefeituraItatibaConfig
  | PrefeituraMairiporaConfig
  | PrefeituraNarandibaConfig
  | PrefeituraPirajuConfig
  | SupernovaConfig
  | PrefeituraItaquaquecetubaConfig
  | PrefeituraPiraporadobomjesusConfig
  | EatosConfig
  | PrefeituraPiracicabaConfig
  | PrefeituraBauruConfig
  | PrefeiturabentogoncalvesConfig
  | PrefeituraSorocabaConfig
  | DiarioMunicipioSJCConfig
  | GazetaMunicipalConfig
  | DiarioOficialGuarantadonorteConfig
  | DiarioOficialMSConfig
  | PrefeituraCampoGrandeConfig
  | PrefeituraDouradosConfig
  | PrefeituraPontaPoraConfig
  | PrefeituraNovaAndradinaConfig
  | PrefeituraAquidauanaConfig
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
  | GeosiapPortalConfig
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
  | PrefeituraBeloHorizonteConfig
  | PrefeiturabetimConfig
  | PrefeituraJuizDeForaConfig
  | PrefeiturauberlandiaConfig
  | PrefeituramontesclarosConfig
  | PrefeituraIpatingaConfig
  | PrefeituraGovernadorValadaresConfig
  | PrefeiturasantaluziamgConfig
  | PrefeiturauberabaConfig
  | PrefeituraPocosdecaldasConfig
  | PrefeiturabarbacenaConfig
  | PrefeituraAraguariConfig
  | FolhadesabaraConfig
  | PrefeiturasabaraConfig
  | PrefeituraCoronelFabricianoConfig
  | PrefeituraAraxaConfig
  | PrefeituraLavrasConfig
  | PrefeituraNovaLimaConfig
  | PrefeituraItaunaConfig
  | PrefeituraUbaConfig
  | PrefeituraItuiutabaConfig
  | PrefeituraParademinasConfig
  | PrefeituraSaoJoaoDelReiConfig
  | PrefeituraPatrocinioConfig
  | PrefeituraCaratingaConfig
  | PrefeituraUnaiConfig
  | PrefeituraBrumadinhoConfig
  | PrefeituraEsmeraldasConfig
  | PrefeituraTimoteoConfig
  | PrefeituraItajubaConfig
  | PrefeituraManhuacuConfig
  | PrefeituraAlfenasConfig
  | PrefeituraAlfenasAtosOficiaisConfig
  | PrefeituraVicosaConfig
  | PrefeituraOuroPretoConfig
  | PrefeituraJanaubaConfig
  | PrefeituraJanaubaPublicacoesConfig
  | PrefeituraMarianaConfig
  | PrefeituraCataguasesConfig
  | PrefeituraFrutalConfig
  | PrefeituraExtremaConfig
  | PrefeituraCongonhasConfig
  | PrefeituraBaraoDeCocaisConfig
  | PrefeituraEspinosaConfig
  | PrefeituraEloiMendesConfig
  | PrefeituraConceicaoDasAlagoasConcursosConfig
  | PrefeituraConceicaoDasAlagoasAtosConfig
  | SimpleSSConfig
  | PortalfacilConfig
  | DiarioOficialLinkConfig
  | PrefeituraAlegreConfig
  | PrefeituraVitoriaConfig
  | PrefeituraCariacicaConfig
  | PrefeituraLinharesConfig
  | PrefeituraCasteloConfig
  | PrefeituraGuacuiConfig
  | PrefeituraVilaVelhaConfig
  | PrefeituraCachoeiroConfig
  | PrefeituraSerraConfig
  | PrefeituraMarataizesConfig
  | PrefeituraNiteroiConfig
  | PrefeituraRioDeJaneiroConfig
  | PrefeituraSaoGoncaloConfig
  | PrefeituraDuqueDeCaxiasConfig
  | PrefeituraCamposDosGoytacazesConfig
  | PrefeituraSaoJoaoDeMeritiConfig
  | PrefeituraVoltaRedondaConfig
  | PrefeituraPetropolisConfig
  | PrefeituraMacaeConfig
  | PrefeituraMageConfig
  | PrefeituraItaboraiConfig
  | PrefeituraCaboFrioConfig
  | PrefeituraMaricaConfig
  | PrefeituraNovaFriburgoConfig
  | DomWebConfig
  | PrefeituraBarraMansaConfig
  | PrefeituraAngraDosReisConfig
  | PrefeituraMesquitaConfig
  | PrefeituraTeresopolisConfig
  | PrefeituraRjOdasOstrasConfig
  | PrefeituraNilopolisConfig
  | PrefeituraQueimadosConfig
  | PrefeituraRjAraruamaConfig
  | PrefeituraRjResendeConfig
  | PrefeituraRjItaguaiConfig
  | PrefeituraRjSaoPedroDaAldeiaConfig
  | PrefeituraRjItaperunaConfig
  | PrefeituraRjJaperiConfig
  | PrefeituraRjBarraDoPixaiConfig
  | PrefeituraRjSaquaremaConfig
  | PrefeituraRjSeropedicaConfig
  | PrefeituraRjTresRiosConfig
  | PrefeituraRjValencaConfig
  | PrefeituraRjCachoeirasDeMacacuConfig
  | PrefeituraRjRioBonitoConfig
  | PrefeituraRjGuapimirimConfig
  | PrefeituraRjCasimiroDeAbreuConfig
  | PrefeituraRjParatyConfig
  | PrefeituraRjSaoFranciscoDeItabapoanaConfig
  | PrefeituraRjParaibaDoSulConfig
  | PrefeituraRjParaibaDoSulV2Config
  | PrefeituraRjParacambiConfig
  | PrefeituraRjSantoAntonioDePaduaConfig
  | PrefeituraRjMangaratibaConfig
  | PrefeituraRjArmacaoDosBuziosConfig
  | PrefeituraRjSaoFidelisConfig
  | PrefeituraRjSaoFidelisV2Config
  | PrefeituraRjSaoJoaoDaBarraConfig
  | PrefeituraRjSaoJoaoDaBarraV2Config
  | PrefeituraRjBomJesusDoItabapoanaConfig
  | PrefeituraRjVassourasConfig
  | PrefeituraRjTanguaConfig
  | PrefeituraRjArraialDoCaboConfig
  | PrefeituraRjArraialDoCaboV2Config
  | PrefeituraRjItatiaiaConfig
  | PrefeituraRjPatyDoAlferesConfig
  | PrefeituraRjBomJardimConfig
  | PrefeituraRjIguabaGrandeConfig
  | PrefeituraRjMiracemaConfig
  | PrefeituraRjMiguelPereiraConfig
  | PrefeituraRjPiraiConfig
  | DiarioOficialOnlineConfig
  | PhocaDownloadConfig
  | NPIBrasilConfig
  | PrefeituraCEConfig
  | AssesiConfig
  | ProcedeConfig
  | DomunicipioConfig
  | PrefeituraJuazeiroDoNorteConfig
  | PrefeituraSobralConfig
  | PrefeituraCratoConfig
  | PlugTecnologiaConfig
  | WordPressPublicacoesConfig
  | EdocmanConfig
  | PrefeiturasalvadorConfig
  | PrefeituraVitoriadaConquistaConfig
  | PrefeituraBarreirasConfig
  | PrefeiturateixeiraDeFreitasConfig
  | PrefeituraPortoSeguroConfig
  | PrefeituraIlheusConfig
  | PrefeituraFeiraDesantanaConfig
  | PrefeituracamacariConfig
  | PrefeituraPauloAfonsoConfig
  | PortalGovConfig
  | ImprensaOficialConfig
  | TransparenciaOficialBaConfig
  | PrefeituraIreceConfig
  | IbdmTransparenciaConfig
  | PortalIopConfig
  | IndapConfig
  | CustomConfig
  | ImpublicacoesConfig
  | InstitutoPublicacoesConfig
  | AirdocConfig
  | PrefeituraAnageConfig
  | PrefeituraRecifeConfig
  | PrefeituraJaboataoConfig
  | PrefeituraCaruaruConfig
  | PrefeituracamaragibeConfig
  | PrefeiturareTeresinhaConfig
  | PrefeituraParnaraibaConfig
  | DiarioOficialDasPrefeiturasConfig
  | DiarioOficialDosMunicipiosAPPMConfig
  | PrefeituaAraripina
  | PrefeituraBezerrosConfig
  | SoftagonConfig
  | DirectusPortalConfig
  | SogoTecnologiaConfig
  | PrefeituraImperatrizConfig
  | PrefeituraTimonConfig
  | PrefeiturabacabalConfig
  | PrefeituratransparenteConfig
  | DomOrbitapConfig
  | VFMTransparenciaConfig
  | MegasoftTransparenciaConfig
  | PrefeturaSaoLuisConfig
  | PrefeituraNatalConfig
  | PrefeituraMossoroConfig
  | PrefeituraSaoGoncaloRNConfig
  | PrefeituraMacaibaConfig
  | PrefeituraParnamirimConfig
  | PrefeituraAssuConfig
  | PrefeituramacaurnConfig
  | PrefeituraVilhenaConfig
  | DODFConfig
  | DomeletronicConfig
  | PrefeiturasantainesConfig
  | PrefeiturapinheiroConfig
  | PrefeiturabarradocordaConfig
  | PrefeiturachapadinhaConfig
  | PrefeituragrajauConfig
  | PrefeiturabarreirinhasConfig
  | PrefeiturasantaluziamaConfig
  | PrefeituracaxiasConfig
  | PrefeiturapacodolumiarConfig
  | PrefeituraportoalegreConfig
  | CamaraCachoerinhaConfig
  | PrefeituracaxiasdosulConfig
  | PrefeituracanoasConfig
  | PrefeiturapelotasConfig
  | PrefeiturasantamariaConfig
  | PrefeituranovohamburgoConfig
  | PrefeiturasaoleopoldoConfig
  | PrefeiturapassofundoConfig
  | PrefeituraJoaoPessoaConfig
  | PrefeiturabayeuxConfig
  | PrefeituracajazeirasConfig
  | PrefeituraguarabirapbConfig
  | MsSolucoesConfig
  | PrefeiturasousaConfig
  | PrefeituraQueimadasPBConfig
  | PrefeiturasaobentopbConfig
  | PrefeituraLagoaSecaConfig
  | EasywebPortalConfig
  | PrefeiturapedrasdefogoConfig
  | DiarioIOConfig
  | DiarioMunicipalALWordpressConfig
  | KalanaConfig
  | PrefeituraCoruripeeConfig
  | PrefeituraAmaranteConfig
  | IOSEConfig
  | PrefeituraAracajuConfig
  | DOMWordPressConfig
  | AgapeConfig
  | PrefeituramacapaConfig
  | PrefeiturasantanaapConfig
  | PrefeituralaranjaldojariConfig
  | DiagramacaoConfig
  | PrefeiturapalmastConfig
  | PrefeituragurupiConfig
  | NucleogovConfig
  | PrefeituraNovoGamaConfig
  | PrefeituraJaraguaConfig
  | MorrinhosGoConfig
  | PadreBernardoGoConfig
  | PiresDoRioGoConfig
  | SaoLuisMontesBelosGoConfig
  | PrefeituraaraguainaConfig
  | PrefeituraportonacionalConfig
  | PrefeiturarondonopolisConfig
  | PrefeituragoianiaConfig
  | GoianesiaConfig
  | CristalinaGoConfig
  | PrefeituraJataiConfig
  | PrefeituraprimaveradolesteConfig
  | DomScEdicaoConfig
  | PrefeituratoledoConfig
  | PrefeituracambeConfig
  | PrefeiturafranciscobeltraoConfig
  | InstarDadosAbertosConfig
  | PrefeiturapinhaoConfig
  | PrefeituraarapotiConfig
  | PrefeiturasantahelenaprConfig
  | SerproDoeConfig
  | IngaDigitalConfig;

/**
 * Configuration for SERPRO DOE (Documento Oficial Eletrônico) spider
 * Platform: cidadesdoe.serpro.gov.br (OutSystems SPA)
 * Used by municipalities that publish via the gov.br DOE platform
 */
export interface SerproDoeConfig {
  type: "serpro_doe";
  /** Hash identifying the municipality on the SERPRO platform */
  hash: string;
  /** Whether the site requires client-side rendering - always true */
  requiresClientRendering?: boolean;
}

export interface PrefeiturapinhaoConfig {
  type: "prefeiturapinhao";
  baseUrl: string;
  apiBaseUrl: string;
  publicacaoId?: number;
  entidadeId?: number;
}

export interface PrefeituraarapotiConfig {
  type: "prefeituraarapoti";
  baseUrl: string;
}

export interface PrefeiturasantahelenaprConfig {
  type: "prefeiturasantahelenapr";
  baseUrl: string;
}

/**
 * Configuration for DODF (Diário Oficial do Distrito Federal) spider
 */
export interface DODFConfig {
  type: "dodf";
  /** Base URL for the DODF portal (default: https://dodf.df.gov.br/dodf/jornal/pastas) */
  baseUrl: string;
  /** Whether the site requires client-side rendering (browser mode) - always true for DODF */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Dom Eletrônico spider
 *
 * Platform: Dom Eletrônico (domeletronico.com.br)
 * Structure:
 * - Main page: /views/site/diario.php
 * - PDF URLs: /views/site/diario_pdf.php?data={base64}&ticket={id}
 * - Date parameter is base64-encoded YYYY-MM-DD
 */
export interface DomeletronicConfig {
  type: "domeletronico";
  /** Base URL for the Dom Eletrônico municipality portal (e.g., "https://pmfarroupilha.domeletronico.com.br") */
  baseUrl: string;
  /** Optional municipality code for reference */
  municipioCode?: string;
  /** Whether the site requires client-side rendering (browser mode) */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Instar platform spiders
 */
export interface InstarConfig {
  type: "instar";
  /** Base URL for the Instar platform */
  url: string;
  /** Whether the site requires client-side rendering (browser mode) */
  requiresClientRendering?: boolean;
  // Add other Instar-specific configuration properties here if needed
}

/**
 * Configuration for Instar municipalities that expose the "dados abertos" JSON API.
 * Uses HTTP-only mode — no browser required.
 *
 * API pattern:  {dadosAbertosUrl}/{year}
 * HTML pattern: {baseUrl}/{page}/{startDate}/{endDate}/0/0/
 */
export interface InstarDadosAbertosConfig {
  type: "instar_dados_abertos";
  /** Base URL for the diário oficial listing page (e.g. "https://www.viamao.rs.gov.br/portal/diario-oficial") */
  baseUrl: string;
  /** URL for the dados abertos JSON API (e.g. "https://www.viamao.rs.gov.br/portal/dados-abertos/diario-oficial") */
  dadosAbertosUrl: string;
}

/**
 * Configuration for Diário Oficial Parauapebas (PA) - MudBlazor layout
 */
export interface DiarioParauapebasPaConfig {
  type: "diario_parauapebas_pa";
  /** Base URL (e.g. https://diario.parauapebas.pa.gov.br) */
  url: string;
}

/**
 * Configuration for Diário Oficial de Castanhal (PA) - Google Sites
 * URL: https://sites.google.com/castanhal.pa.gov.br/doc-diario-oficial-castanhal/inicio
 */
export interface DocCastanhalConfig {
  type: "doc_castanhal";
  /** Base URL of the Google Sites page (início) */
  url: string;
  /** Whether the site requires client-side rendering (browser) */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Mentor/Metaway platform spiders
 *
 * The Mentor platform uses a REST API to serve gazette data.
 * Base URL pattern: https://{city}.mentor.metaway.com.br
 */
export interface MentorConfig {
  type: "mentor";
  /** Base URL for the Mentor platform (e.g., "https://lencois.mentor.metaway.com.br") */
  baseUrl: string;
}

/**
 * Configuration for DOSP platform spiders
 */
export interface DospConfig {
  type: "dosp";
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
  type: "diof";
  /** Website URL for the municipality (e.g., "https://diario.igaci.al.gov.br") */
  website: string;
  /** Power of the gazette (executive, legislative, or executive_legislative) */
  power: "executive" | "legislative" | "executive_legislative";
  /** Optional client ID - if provided, skips automatic extraction from website */
  clientId?: string;
}

/**
 * Configuration for Sigpub platform spiders
 */
export interface SigpubConfig {
  type: "sigpub";
  /** Base URL for the Sigpub platform */
  url: string;
  /** Entity ID for the association (e.g., "365" for AMUPE) */
  entityId: string;
  /** Municipality name for metadata (optional) */
  cityName?: string;
}

/**
 * Configuration for AGM (Associação Goiana de Municípios) - Diário Oficial em diariomunicipal.com.br/agm/
 * Uses calendar URLs ?dia=DD&mes=MM&ano=YYYY to fetch editions by date.
 */
export interface AgmConfig {
  type: "agm";
  /** Base URL (e.g. https://www.diariomunicipal.com.br/agm/) */
  url: string;
  /** Municipality name for metadata (e.g. "Catalão") */
  cityName: string;
}

/**
 * Configuration for Planaltina-GO spider (BSIT/SIGEP legislation portal).
 * Atos normativos em planaltina.bsit-br.com.br/portal/legislation.jsf
 */
export interface PlanaltinaGoConfig {
  type: "planaltina_go";
  /** Base URL do portal (e.g. https://planaltina.bsit-br.com.br/portal) */
  baseUrl: string;
}

/**
 * Configuration for Santo Antônio do Descoberto (GO) - Diário Oficial no portal da prefeitura.
 * URL: https://santoantoniododescoberto.go.gov.br/diario-oficial/
 */
export interface SantoAntonioDescobertoGoConfig {
  type: "santo_antonio_descoberto_go";
  /** Base URL do portal (e.g. https://santoantoniododescoberto.go.gov.br) */
  baseUrl: string;
  /** Path da página do diário oficial (default: diario-oficial) */
  diarioPath?: string;
}

/**
 * Configuration for DOEM platform spiders
 */
export interface DoemConfig {
  type: "doem";

  /** State and city URL part (e.g., "ba/acajutiba") */
  stateCityUrlPart: string;
}

/**
 * Configuration for ADiarios platform spiders
 */
export interface AdiariosConfig {
  type: "adiarios_v1" | "adiarios_v2";

  /** Base URL for the municipality */
  baseUrl: string;

  /** Municipality identifier in the platform */
  municipalityId?: string;
}

/**
 * Configuration for NPI Brasil transparency portal spiders
 *
 * The NPI Brasil platform is commonly used by municipalities in Rio de Janeiro.
 * URL pattern: transparencia.{city}.rj.gov.br/jornal.php
 */
export interface NPIBrasilConfig {
  type: "npibrasil";
  /** Base URL for the transparency portal */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for custom spiders
 */
export interface CustomConfig {
  type: "custom";

  /** Custom configuration object */
  [key: string]: any;
}

/**
 * Configuration for Plataforma de Diagramação spider
 * Used by municipalities in Tocantins (Colinas, Araguatins)
 */
export interface DiagramacaoConfig {
  type: "diagramacao";
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Palmas spider
 */
export interface PrefeiturapalmastConfig {
  type: "prefeiturapalmas";
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Gurupi spider
 */
export interface PrefeituragurupiConfig {
  type: "prefeituragurupi";
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/**
 * Configuration for NúcleoGov platform spider
 * Used by Paraíso do Tocantins and other municipalities
 */
export interface NucleogovConfig {
  type: "nucleogov";
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Araguaína spider
 */
export interface PrefeituraaraguainaConfig {
  type: "prefeituraaraguaina";
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Porto Nacional spider
 */
export interface PrefeituraportonacionalConfig {
  type: "prefeituraportonacional";
  baseUrl: string;
  requiresClientRendering?: boolean;
}

export interface PrefeiturarondonopolisConfig {
  type: "prefeiturarondonopolis";
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Goiânia spider (Sileg)
 * Diário Oficial via Casa Civil: goiania.go.gov.br/casa-civil/diario-oficial/
 * Consulta: sileg.goiania.go.gov.br
 */
export interface PrefeituragoianiaConfig {
  type: "prefeituragoiania";
  baseUrl: string;
  silegUrl: string;
  /** URL da página do Diário Oficial (Casa Civil). Se omitido, usa baseUrl + "/casa-civil/diario-oficial/". */
  diarioOficialUrl?: string;
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Diário Oficial / Editais e Publicações de Goianésia - GO.
 * Portal: goianesia.go.gov.br/editais-e-publicacoes/ (não usa AGM).
 */
export interface GoianesiaConfig {
  type: "goianesia";
  /** Base URL do site (ex: https://www.goianesia.go.gov.br) */
  baseUrl: string;
  /** Caminhos relativos das páginas de editais (default: editais-e-publicacoes, editais-e-publicacoes2) */
  listPaths?: string[];
}

/**
 * Configuration for Cristalina - GO spider (Diário Oficial).
 * Fonte: prefeitura-de-cristalina.webnode.page/diario-oficial/ (Webnode).
 * Não utiliza AGM; extrai PDFs das páginas configuradas.
 */
export interface CristalinaGoConfig {
  type: "cristalina_go";
  /** Base URL (ex: https://prefeitura-de-cristalina.webnode.page/diario-oficial) */
  baseUrl: string;
  /** Caminhos relativos das páginas com links de PDF (default: [""] = página base) */
  listPaths?: string[];
}

/**
 * Configuration for Diário Oficial de Jataí - GO (intranet da prefeitura).
 * Listagem em intranet.jatai.go.gov.br/intranet/sistemas/diario-oficial/diario-site.php (tabela com edições e PDFs).
 */
export interface PrefeituraJataiConfig {
  type: "prefeiturajatai";
  /** URL base do sistema (ex: https://intranet.jatai.go.gov.br/intranet/sistemas/diario-oficial/) */
  baseUrl: string;
}

export interface PrefeituraprimaveradolesteConfig {
  type: "prefeituraprimaveradoleste";
  baseUrl: string;
  listPath?: string;
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura Novo Gama - GO
 * Portal: acessoainformacao.novogama.go.gov.br (NúcleoGov)
 */
export interface PrefeituraNovoGamaConfig {
  type: "prefeituraNovoGama";
  baseUrl: string;
}

/**
 * Configuration for Jaraguá - GO
 * Portal: acessoainformacao.jaragua.go.gov.br (NúcleoGov, exige header X-NucleoGov-Services)
 * Jaraguá não utiliza AGM.
 */
export interface PrefeituraJaraguaConfig {
  type: "prefeiturajaragua";
  baseUrl: string;
}

/**
 * Configuration for Santa Helena de Goiás - GO
 * Diário Oficial no portal próprio (não utiliza AGM).
 * Portal tipicamente NúcleoGov: acessoainformacao.santahelena.go.gov.br ou dom.santahelena.go.gov.br
 */
export interface SantaHelenaGoConfig {
  type: "santa_helena_go";
  baseUrl: string;
}

/**
 * Configuration for Morrinhos - GO
 * Portal: acessoainformacao.morrinhos.go.gov.br (NúcleoGov)
 * Diário Oficial via API /api/diarios. Não utiliza AGM.
 */
export interface MorrinhosGoConfig {
  type: "morrinhos_go";
  baseUrl: string;
}

/**
 * Configuration for Padre Bernardo - GO
 * Portal: acessoainformacao.padrebernardo.go.gov.br (NúcleoGov).
 * Diário Oficial via API /api/diarios quando disponível.
 */
export interface PadreBernardoGoConfig {
  type: "padre_bernardo_go";
  baseUrl: string;
}

/**
 * Configuration for Pires do Rio - GO
 * Portal: acessoainformacao.piresdorio.go.gov.br (NúcleoGov).
 * Diário Oficial via API /api/diarios quando disponível.
 */
export interface PiresDoRioGoConfig {
  type: "pires_do_rio_go";
  baseUrl: string;
}

/**
 * Configuration for São Luís de Montes Belos - GO
 * Portal: saoluisdemontesbelos.go.gov.br / portal.saoluisdemontesbelos.go.gov.br.
 * Diário Oficial via API /api/diarios quando disponível.
 */
export interface SaoLuisMontesBelosGoConfig {
  type: "sao_luis_montes_belos_go";
  baseUrl: string;
}

/**
 * Configuration for IM Publicações platform spider
 * Platform: impublicacoes.org
 * Used by municipalities in Bahia and other states
 */
export interface ImpublicacoesConfig {
  type: "impublicacoes";

  /** IBGE territory ID (will be double base64 encoded for the municipio parameter) */
  territoryId: string;

  /** Type of entity: 'pref' for prefeitura, 'cama' for câmara */
  entityType?: "pref" | "cama";

  /** Whether client rendering is required (always true for this platform) */
  requiresClientRendering: boolean;
}

/**
 * Configuration for Instituto de Publicações platform spider
 * Platform: ruybarbosa.ba.gov.br and similar sites
 * Used by municipalities in Bahia with Instituto de Publicações system
 *
 * The platform provides a paginated HTML list with PDF links.
 * Requires JavaScript rendering to load content.
 */
export interface InstitutoPublicacoesConfig {
  type: "institutopublicacoes";

  /** Full URL for the gazette page (e.g., "http://www.ruybarbosa.ba.gov.br/diario?codCategoria=0&codSubcategoria=0") */
  url: string;

  /** Whether the site requires client-side JavaScript rendering (default: true) */
  requiresClientRendering?: boolean;
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
  type: "barco_digital";
  baseUrl: string;
}

export interface SiganetConfig {
  type: "siganet";
  baseUrl: string;
}

/**
 * Configuration for DiarioOficialMunicipal platform spiders
 *
 * DiarioOficialMunicipal is a gazette publishing platform used by municipalities.
 * It provides a Laravel-based JSON API with pagination.
 *
 * Frontend: https://{citySlug}.diariooficialmunicipal.com
 * API: https://paniel-{citySlug}.diariooficialmunicipal.com/api/diarios
 */
export interface DiarioOficialMunicipalConfig {
  type: "diariooficialmunicipal";
  /** City slug used in the subdomain (e.g., "parnarama" for parnarama.diariooficialmunicipal.com) */
  citySlug: string;
}

export interface DiarioOficialBRConfig {
  type: "diario_oficial_br";
  baseUrl: string;
}

export interface ModernizacaoConfig {
  type: "modernizacao";
  domain: string;
  verSubpath?: string;
  power?: "executive" | "legislative" | "executive_legislative";
}

export interface AplusConfig {
  type: "aplus";
  baseUrl: string;
}

export interface DioenetConfig {
  type: "dioenet";
  baseUrl: string;
  /** City ID used in the dioenet API (e.g., 36 for Praia Grande) */
  cityId: number;
}

export interface PlenusDioenetConfig {
  type: "plenus_dioenet";
  /** Base URL for the list page (e.g., "https://plenussistemas.dioenet.com.br/list/sacramento") */
  baseUrl: string;
}

export interface AdministracaoPublicaConfig {
  type: "administracao_publica";
  token: string;
}

export interface PtioConfig {
  type: "ptio";
  baseUrl: string;
}

export interface PrefeituramaringaConfig {
  type: "prefeituramaringa";
  baseUrl: string;
}

export interface MunicipioOnlineConfig {
  type: "municipio_online";
  urlUf: string;
  urlCity: string;
}

export interface TresTecnosConfig {
  type: "3tecnos";
  urlUf: string;
  urlCity: string;
  requiresClientRendering?: boolean;
}

export interface AtendeV2Config {
  type: "atende_v2";
  citySubdomain: string;
}

export interface DomScConfig {
  type: "dom_sc";
  /** Base URL for the DOM/SC platform */
  url: string;
  /** Entity name for search (e.g., "Prefeitura Municipal de Florianópolis") */
  entityName: string;
}

/**
 * Config for DOM/SC Edição Ordinária spider.
 * Fetches the per-municipality compiled gazette PDF from the Edição Ordinária page.
 * URL pattern: ?r=site/edicoes&edicao=DD/MM/YYYY&cod_municipio={municipioId}
 * PDF hosted at: https://edicao.dom.sc.gov.br/{year}/{month}/{hash}_edicao_{municipioId}_{editionNumber}_assinada.pdf
 */
export interface DomScEdicaoConfig {
  type: "dom_sc_edicao";
  /** Base URL for the DOM/SC platform (default: https://diariomunicipal.sc.gov.br/) */
  baseUrl: string;
  /** DOM/SC internal municipality ID (different from IBGE code). Used in ?r=site/edicoes&edicao=...&cod_municipio={municipioId} */
  municipioId: number;
  /** Municipality name (used for logging) */
  municipioName: string;
}

/**
 * Config for SC city spiders (site da prefeitura, sem DOM/SC).
 * baseUrl = site da prefeitura; diarioPath = path relativo do diário oficial quando não é a raiz.
 */
export type PrefeituraScCityConfig = {
  type:
    | "prefeiturajoinville_sc"
    | "prefeituraflorianopolis_sc"
    | "prefeiturablumenau_sc"
    | "prefeiturasaojose_sc"
    | "prefeituraitajai_sc"
    | "prefeiturachapeco_sc"
    | "prefeiturapalhoca_sc"
    | "prefeituracriciuma_sc"
    | "prefeiturajaraguadosul_sc"
    | "prefeituralages_sc";
  /** Base URL do site da prefeitura (ex: https://www.joinville.sc.gov.br) */
  baseUrl: string;
  /** Path do diário oficial no site (ex: /jornal, /diario-oficial). Se vazio, usa baseUrl. */
  diarioPath?: string;
};

/**
 * Configuration for Ananindeua-PA official gazette (Prefeitura de Ananindeua).
 * List page: ananindeua.pa.gov.br/diario_oficial with PDF links and "Data da Publicação: DD/MM/YYYY".
 */
export interface PrefeituraAnanindeuaConfig {
  type: "prefeituraananindeua";
  baseUrl: string;
}

/**
 * Configuration for Cametá-PA official gazette (Prefeitura de Cametá).
 * WordPress list with direct PDF links: prefeituradecameta.pa.gov.br/diario-oficial-do-municipio/
 */
export interface PrefeituracametaConfig {
  type: "prefeituracameta";
  baseUrl: string;
}

/**
 * Configuration for Altamira-PA official gazette (Prefeitura de Altamira).
 * List of edition pages at altamira.pa.gov.br/c/diario-oficial/; each page has PDF link in content.
 */
export interface PrefeituraAltamiraConfig {
  type: "prefeituraaltamira";
  baseUrl: string;
}

/**
 * Configuration for PA cities with WordPress publicações (Portel, Vigia, etc.).
 * List page at baseUrl/listPath; each post may contain PDF in wp-content/uploads.
 */
export interface PrefeituraPaPublicacoesConfig {
  type:
    | "prefeituraaugustocorrea"
    | "prefeiturapacaja"
    | "prefeituraportodemoz"
    | "prefeituraigarapeacu"
    | "prefeituravigia"
    | "prefeituraalmeirim"
    | "prefeituracurralinho"
    | "prefeituraoeirasdopara"
    | "prefeituraourilandianorte"
    | "prefeituraipixunadopara"
    | "prefeituralimoeirodoajuru"
    | "prefeituramedicilandia"
    | "prefeituraconcordiadopara"
    | "prefeituragoianesiadopara"
    | "prefeituramaracana"
    | "prefeiturasaosebastiaodaboavista";
  baseUrl: string;
  /** e.g. "c/publicacoes/demais" or "c/publicacoes" */
  listPath?: string;
}

/**
 * Configuration for Ulianópolis-PA Diário Oficial.
 * List: diariooficial.php; each edition diariooficial.php?id=N; PDF at arquivos_download.php?id=N&pg=diariooficial.
 */
export interface PrefeituraUlianopolisConfig {
  type: "prefeituraulianopolis";
  /** Base URL (e.g. https://www.ulianopolis.pa.gov.br) */
  baseUrl: string;
}

/**
 * Configuration for Santana do Araguaia-PA Diário Oficial.
 * Site: https://diariooficial.pmsaraguaia.pa.gov.br/ with list of PDFs DOMSA-DDMMYYYY-EN-NNN.pdf.
 */
export interface PrefeituraSantanaAraguaiaConfig {
  type: "prefeituasantanaaraguaia";
  baseUrl: string;
}

/**
 * Configuration for São Domingos do Capim-PA.
 * Site: saodomingosdocapim.pa.gov.br with leis.php, decretos.php, portaria.php, diariaslista.php.
 */
export interface PrefeituraSaodomingosdocapimConfig {
  type: "prefeiturasaodomingosdocapim" | "prefeituramelgaco";
  baseUrl: string;
}

/**
 * Configuration for Portal CR2 (portalcr2.com.br): Leis e Atos + Concursos e Processos Seletivos.
 * Used by Portel-PA and other municipalities on the same platform.
 */
export interface PortalCr2Config {
  type: "portalcr2";
  /** URL da lista de Leis e Atos (ex.: https://www.portalcr2.com.br/leis-e-atos/leis-portel) */
  leisEAtosUrl: string;
  /** URL da lista de Concursos e Processos Seletivos (ex.: https://www.portalcr2.com.br/concurso-processo-seletivo/concursos-e-pss-portel) */
  concursosUrl: string;
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Portal CR2 (portal.cr2.co): single URL for "Leis e Atos Normativos" (diários oficiais).
 * Used by Vigia-PA and other municipalities on this variant of the CR2 platform.
 */
export interface PortalCr2CoConfig {
  type: "portalcr2co";
  /** URL da lista de Leis e Atos Normativos / Diários Oficiais (ex.: portal.cr2.co/...?entidade=vigia&modulo=Leis%20e%20Atos%20Normativos) */
  diariosUrl: string;
  /** URL opcional da lista de Concursos e Processos Seletivos (ex.: ...?entidade=XXX&modulo=Concursos%20e%20Processos%20Seletivos) */
  concursosUrl?: string;
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Belém-PA official gazette (PGM Belém).
 * Site: https://pgm.belem.pa.gov.br/diario-oficial-do-municipio/
 */
export interface PrefeituraBelemConfig {
  type: "prefeiturabeelem";
  baseUrl: string;
  /** Requires browser to navigate and select gazettes for extraction. */
  requiresClientRendering?: boolean;
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
  type: "rondonia";
  /** City name to search for in the gazette content */
  cityName: string;
  /** Power of the gazette (executive_legislative for municipal content) */
  power: "executive" | "legislative" | "executive_legislative";
}

/**
 * Configuration for Acre state official gazette spider
 * All municipalities publish in a single centralized state gazette
 */
export interface AcreConfig {
  type: "acre";
  /** City name to search for in the gazette content */
  cityName: string;
  /** Power of the gazette (executive_legislative for municipal content) */
  power: "executive" | "legislative" | "executive_legislative";
  /** Whether to use browser rendering (required for Cloudflare Workers due to IP blocking) */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Espírito Santo state official gazette spider (DOM - AMUNES)
 * All municipalities publish through AMUNES centralized system with API access
 */
export interface EspiritoSantoConfig {
  type: "espirito_santo";
  /** Power of the gazette (executive_legislative for municipal content) */
  power: "executive" | "legislative" | "executive_legislative";
}

/**
 * Configuration for AMUNES consortium spider (Associação dos Municípios do Espírito Santo)
 * Consórcio dos municípios do Espírito Santo que publicam no sistema centralizado AMUNES
 */
export interface AmunesConfig {
  type: "amunes";
  /** Power of the gazette (executive_legislative for municipal content) */
  power: "executive" | "legislative" | "executive_legislative";
}

/**
 * Configuration for AEMERJ consortium spider (Associação Estadual de Municípios do Rio de Janeiro)
 * Consórcio dos municípios do Rio de Janeiro que publicam no sistema centralizado AEMERJ
 * URL: https://www.diariomunicipal.com.br/aemerj/
 */
export interface AemerjConfig {
  type: "aemerj";
  /** Power of the gazette (executive_legislative for municipal content) */
  power: "executive" | "legislative" | "executive_legislative";
  /** Entity name as it appears in the AEMERJ system (e.g., "Prefeitura Municipal de Vassouras") */
  entityName: string;
}

/**
 * Configuration for APRECE (Associação dos Municípios do Estado do Ceará) spiders
 *
 * This spider collects gazettes from the centralized APRECE system
 * using the SIGPub platform from Vox Tecnologia.
 *
 * URL: https://www.diariomunicipal.com.br/aprece/
 */
export interface ApreceConfig {
  type: "aprece";
  /** Power of the gazette (executive_legislative for municipal content) */
  power: "executive" | "legislative" | "executive_legislative";
  /** Entity name as it appears in the APRECE system (e.g., "Prefeitura Municipal de Iguatu") */
  entityName: string;
}

/**
 * Configuration for DOMunicipal platform spiders
 */
export interface DomunicipalConfig {
  type: "domunicipal";
  /** Base URL for the DOMunicipal platform (e.g., "https://domunicipal.com.br") */
  baseUrl: string;
  /** Organization ID for the municipality (e.g., "3" for Cristais Paulista) */
  orgaoId: string;
}

/**
 * Configuration for Imprensa Oficial Jundiaí spider
 */
export interface ImprensaOficialJundiaiConfig {
  type: "imprensaoficialjundiai";
  /** Base URL for the Imprensa Oficial Jundiaí platform */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Rio Preto spider
 */
export interface PrefeituraRioPretoConfig {
  type: "prefeiturariopreto";
  /** Base URL for the Prefeitura Rio Preto platform */
  baseUrl: string;
}

/**
 * Configuration for Imprensa Oficial Municipal platform spider
 * Used by municipalities like Miguelópolis and Caiabu
 */
export interface ImprensaOficialMunicipalConfig {
  type: "imprensaoficialmunicipal";
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
  type: "prefeituraitirapua";
  /** Base URL for the Prefeitura Itirapuã platform */
  baseUrl: string;
}

/**
 * Configuration for KingDiario platform spider
 * King Page platform requiring browser automation for form-based search
 */
export interface KingDiarioConfig {
  type: "kingdiario";
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
  type: "prefeituranovaodessa";
  /** Base URL for the Prefeitura Nova Odessa platform (e.g., "https://www.novaodessa.sp.gov.br/servicos/diario") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Mogi das Cruzes spider
 * Year and category-based pages with accordion structure
 */
export interface PrefeituraMogiDasCruzesConfig {
  type: "prefeituramogidascruzes";
  /** Base URL for the Prefeitura Mogi das Cruzes platform (e.g., "https://diario-oficial.mogidascruzes.sp.gov.br/diarios/publicacoes") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de São João da Boa Vista spider
 * Vue.js/Vuetify application with year/month URL structure and pagination
 */
export interface PrefeituraSaoJoaoDaBoaVistaConfig {
  type: "prefeiturasaojoaodaboavista";
  /** Base URL for the Prefeitura São João da Boa Vista platform (e.g., "https://publicacoes.boavista.rr.gov.br/diarios/2025/2") */
  baseUrl: string;
}

export interface PrefeituraBoaVistaConfig {
  type: "prefeituraboavista";
  /** Base URL for the Prefeitura de Boa Vista RR API (e.g., "https://publicacoes.boavista.rr.gov.br") */
  baseUrl: string;
}

export interface PrefeituraBatataisConfig {
  type: "prefeiturabatais";
  /** Base URL for the Prefeitura Batatais platform (e.g., "https://www.batatais.sp.gov.br/diario-oficial") */
  baseUrl: string;
}

export interface PrefeituraCajamarConfig {
  type: "prefeituracajamar";
  /** Base URL for the Prefeitura Cajamar platform (e.g., "https://cajamar.sp.gov.br/diariooficial") */
  baseUrl: string;
}

/**
 * Configuration for Câmara Municipal de Manaus - Diário Oficial (e-DOLM)
 * List page with "Edição: e-DOLM NNNN" and "Data: DD/MM/YYYY", PDFs at wp-content/uploads
 */
export interface CamaraManausConfig {
  type: "camaramanaus";
  /** Base URL for the diário oficial list (e.g., "https://www.cmm.am.gov.br/diario-oficial") */
  baseUrl: string;
  /** Site blocks Cloudflare Workers IPs; use browser binding when available */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for DOM Manaus (Diário Oficial do Município - Prefeitura, Plone)
 * List page: baseUrl with table "Data de efetivação", "Título", "Tamanho". Pagination: b_start=0,20,40...
 */
export interface DomManausConfig {
  type: "dommanaus";
  /** Base URL for the DOM list (e.g., "https://dom.manaus.am.gov.br/?go=dom") */
  baseUrl: string;
  /** Site may block Cloudflare Workers IPs; use browser binding when available */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Francisco Morato spider
 * Uses custom API: {baseUrl}/ServDiario?pAno=YYYY&pMes=MM&pOpcao=consultaEdicao
 * PDFs are at: {baseUrl}/anexos/{nomeArquivo}
 */
export interface PrefeituraFranciscoMoratoConfig {
  type: "prefeiturafranciscomorato";
  /** Base URL for the Prefeitura Francisco Morato platform (e.g., "http://imprensaoficial.franciscomorato.sp.gov.br") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Cosmópolis spider
 * Paginated pages with date filtering during crawling
 */
export interface PrefeituraCosmopolisConfig {
  type: "prefeituracosmopolis";
  /** Base URL for the Prefeitura Cosmópolis platform (e.g., "https://cosmopolis.sp.gov.br/semanario/") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Cotia spider
 * Browser-based calendar interaction on LeisMunicipais.com.br platform
 */
export interface PrefeituraCotiaConfig {
  type: "prefeituracotia";
  /** Base URL for the Prefeitura Cotia platform (e.g., "https://leismunicipais.com.br/diario-oficial/sp/cotia") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Guarulhos spider
 * Browser-based calendar interaction with jQuery show/hide divs
 */
export interface PrefeituraGuarulhosConfig {
  type: "prefeituraguarulhos";
  /** Base URL for the Prefeitura Guarulhos platform (e.g., "https://diariooficial.guarulhos.sp.gov.br/index.php") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Itatiba spider
 * Browser-based pagination with query parameters (dataDe, dataAte, pagina)
 */
export interface PrefeituraItatibaConfig {
  type: "prefeituraitaitiba";
  /** Base URL for the Prefeitura Itatiba platform (e.g., "https://www.itatiba.sp.gov.br/ImprensaOficial") */
  url: string;
}

/**
 * Configuration for Prefeitura de Mairiporã spider
 * Browser-based infinite scroll with year-based URLs (/imprensa-oficial-{YEAR}-2/)
 */
export interface PrefeituraMairiporaConfig {
  type: "prefeituramaripora";
  /** Base URL for the Prefeitura Mairiporã platform (e.g., "https://www.mairipora.sp.gov.br") */
  url: string;
}

/**
 * Configuration for Prefeitura de Narandiba spider
 * Simple HTML page with all gazettes listed (no pagination)
 */
export interface PrefeituraNarandibaConfig {
  type: "prefeituranarandiba";
  /** Base URL for the Prefeitura Narandiba platform (e.g., "https://www.donarandiba.com.br/paginas/diario.php") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Piraju spider
 * Browser-based JSF/PrimeFaces application with date filters and pagination
 */
export interface PrefeituraPirajuConfig {
  type: "prefeiturapiraju";
  /** Base URL for the Prefeitura Piraju platform (e.g., "https://diariooficialnovo.jelastic.saveincloud.net/paginas/public/diario_externo.xhtml?idCidade=3") */
  baseUrl: string;
}

/**
 * Configuration for Supernova/Moderna Portal da Transparência spider
 * Browser-based JSF/PrimeFaces application with dropdown filters and pagination
 */
export interface SupernovaConfig {
  type: "supernova";
  /** Base URL for the Supernova portal (e.g., "https://webtangua.supernova.com.br:8443/contaspublicas/pages/publicacao_demais_relatorio.xhtml?faces-redirect=true&idTipoRelatorio=1") */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Itaquaquecetuba spider
 */
export interface PrefeituraItaquaquecetubaConfig {
  type: "prefeituraitaquaquecetuba";
  /** Base URL for the Prefeitura Itaquaquecetuba platform (e.g., "https://www.itaquaquecetuba.sp.gov.br/diario-oficial/") */
  url: string;
}

/**
 * Configuration for Prefeitura de Pirapora do Bom Jesus spider
 */
export interface PrefeituraPiraporadobomjesusConfig {
  type: "prefeiturapiraporadobomjesus";
  /** Base URL for the Prefeitura Pirapora do Bom Jesus platform (e.g., "https://imprensa.piraporadobomjesus.net.br/") */
  baseUrl: string;
}

/**
 * Configuration for EATOS (e-Atos) platform spider
 * Browser-based Nuxt.js application with calendar and list interface
 */
export interface EatosConfig {
  type: "eatos";
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
  type: "prefeiturapiracicaba";
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
  type: "prefeiturabauru";
  /** Base URL for the Prefeitura Bauru platform (e.g., "https://www2.bauru.sp.gov.br/juridico/diariooficial.aspx") */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Bento Gonçalves spider
 *
 * Site structure:
 * - Platform: Elotech OXY
 * - Page URL: https://bentogoncalves.oxy.elotech.com.br/portaltransparencia/1/diario-oficial
 * - API: {baseUrl}/portaltransparencia/api/legislacao/diarios-oficiais/publicados
 *
 * Supports HTTP-based API access
 */
export interface PrefeiturabentogoncalvesConfig {
  type: "prefeiturabentogoncalves";
  /** Base URL for the Prefeitura Bento Gonçalves platform (e.g., "https://bentogoncalves.oxy.elotech.com.br") */
  baseUrl: string;
  /** Optional GED API URL for file download (defaults to Bento Gonçalves GED) */
  gedApiUrl?: string;
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
  type: "prefeiturasorocaba";
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
  type: "diariomunicipiosjc";
  /** Base URL for the Diário do Município SJC platform (e.g., "https://diariodomunicipio.sjc.sp.gov.br") */
  baseUrl: string;
}

/** Gazeta Municipal (Sistema de Publicação Oficial - API variant used by Cuiabá/MT) */
export interface GazetaMunicipalConfig {
  type: "gazetamunicipal";
  /** Base URL (e.g., "https://gazetamunicipal.cuiaba.mt.gov.br") */
  baseUrl: string;
}

/** Diário Oficial de Guarantã do Norte - MT (tabela HTML em /edicoes/ com paginação ?p=N) */
export interface DiarioOficialGuarantadonorteConfig {
  type: "diariooficialguarantadonorte";
  baseUrl: string;
}

/**
 * Diário Oficial de Caldas Novas - GO (diariooficialcal1.websiteseguro.com).
 * Calendário por data: ?data=DD/MM/YYYY.
 */
export interface DiarioOficialCaldasNovasConfig {
  type: "diariooficialcaldasnovas";
  /** Base URL (e.g. https://diariooficialcal1.websiteseguro.com) */
  baseUrl: string;
}

/** Diário Oficial MS (Assomasul) - plataforma centralizada para municípios de MS */
export interface DiarioOficialMSConfig {
  type: "diariooficialms";
  baseUrl: string;
  cityName: string;
  requiresClientRendering?: boolean;
}

/** Diogrande - Diário Oficial de Campo Grande MS */
export interface PrefeituraCampoGrandeConfig {
  type: "prefeituracampogrande";
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/** DO Dourados MS - WordPress lista de edições */
export interface PrefeituraDouradosConfig {
  type: "prefeituradourados";
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/** Diário Oficial Ponta Porã MS - WordPress lista + PDFs */
export interface PrefeituraPontaPoraConfig {
  type: "prefeiturapontapora";
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/** Nova Andradina MS - publicacoesmunicipais.inf.br */
export interface PrefeituraNovaAndradinaConfig {
  type: "prefeituranovaandradina";
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/** Aquidauana MS - legado.aquidauana.ms.gov.br/edoem */
export interface PrefeituraAquidauanaConfig {
  type: "prefeituraaquidauana";
  baseUrl: string;
  requiresClientRendering?: boolean;
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
  type: "prefeiturasantoandre";
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
  type: "prefeituracampinas";
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
  type: "prefeituraosasco";
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
  type: "prefeiturasantos";
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
  type: "prefeituramaua";
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
  type: "prefeituradiadema";
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
  type: "prefeituracarapicuiba";
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
  type: "gdoe";
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
  type: "onedom";
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
  type: "assistech";
  /** Base URL for the Assistech platform (e.g., "https://assistechpublicacoes.com.br/app/pmararassp/diario-oficial") */
  baseUrl: string;
}

/**
 * Configuration for CESPRO platform spider
 * Used by municipalities like Ribeirão Preto and São Sebastião
 */
export interface CesproConfig {
  type: "cespro";
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
  type: "geosiap";
  /** Base URL for the GeoSIAP platform (e.g., "https://boletinsoficiais.geosiap.net/pmjacarei/public/publicacoes") */
  baseUrl: string;
}

/**
 * Configuration for GeoSIAP API-based spider
 * Uses the JSON API for listing and browser for getting presigned URLs
 */
export interface GeosiapApiConfig {
  type: "geosiap_api";
  /** Base URL for the GeoSIAP platform (e.g., "https://boletinsoficiais.geosiap.net/pmjacarei/public/publicacoes") */
  baseUrl: string;
  /** City prefix in the GeoSIAP system (e.g., "pmjacarei") - optional, will be extracted from URL if not provided */
  cityPrefix?: string;
}

/**
 * Configuration for GeoSIAP Portal de Transparência spider
 * Used by municipalities like Japeri-RJ
 *
 * URL pattern: https://{city}.geosiap.net.br/portal-transparencia/...
 * API: /api/default/publicacoes/publicacoes?id_publicacao_tipo=7&id_entidade={entityId}
 * Download: /api/default/publicacoes/get_arquivo.anexo?id_publicacao={id}
 */
export interface GeosiapPortalConfig {
  type: "geosiap_portal";
  /** Base URL for the GeoSIAP Portal de Transparência (e.g., "https://japeri.geosiap.net.br/portal-transparencia/...") */
  baseUrl: string;
  /** Entity ID in the portal (default: 10 for Prefeitura Municipal) */
  entityId?: number;
  /** Publication type ID (default: 7 for Diário Oficial) */
  publicationTypeId?: number;
}

/**
 * Configuration for Legislação Digital platform spider
 * Used by municipalities like Arujá
 */
export interface LegislacaoDigitalConfig {
  type: "legislacaodigital";
  /** Base URL for the Legislação Digital platform (e.g., "https://www.legislacaodigital.com.br/Aruja-SP/") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de São Paulo spider
 * The capital has a unique portal structure
 */
export interface PrefeiturasaopauloConfig {
  type: "prefeiturasaopaulo";
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
  type: "prefeiturasaovicente";
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
  type: "prefeiturafranca";
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
  type: "prefeituraguaruja";
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
  type: "prefeituraamericana";
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
  type: "prefeiturapresidenteprudente";
  /** Base URL for the Presidente Prudente portal */
  baseUrl: string;
  /** Whether this site requires client-side rendering (browser) */
  requiresClientRendering?: boolean;
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
  type: "ecrie";
  /** Base URL for the Ecrie platform (e.g., "https://boituva.sp.gov.br/diario-oficial") */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
  /** Pagination parameter name (default: 'p', some sites use 'pagina') */
  paginationParam?: "p" | "pagina";
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
  type: "ipero";
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
  type: "ecriediariooficial";
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
  type: "prefeituraserranegra";
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
  type: "prefeituraibiuna";
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
  type: "prefeiturafrancodarocha";
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
  type: "prefeituraserrana";
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
  type: "prefeituracamposdojordao";
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
  type: "prefeituracapaobonito";
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
  type: "prefeituraju";
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
  type: "prefeituramogimirim";
  /** Base URL for the Prefeitura Mogi Mirim platform (e.g., "https://www.mogimirim.sp.gov.br/jornal") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura Tatuí platform spiders
 */
export interface PrefeituraTatuiConfig {
  type: "prefeituratatatui";
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
  type: "prefeituraleme";
  /** Base URL for the Prefeitura Leme platform (e.g., "https://www.leme.sp.gov.br/imprensa") */
  baseUrl: string;
}

export interface PrefeituracaieirasConfig {
  type: "prefeituracaieiras";
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
  type: "prefeituraubatuba";
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
  type: "prefeiturasocorro";
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
  type: "prefeituracapivari";
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
  type: "prefeituratiete";
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
  type: "prefeiturapirassununga";
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
  type: "prefeituraperuibe";
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
  type: "prefeiturabertioga";
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
  type: "prefeituraitanhaem";
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
  type: "prefeituracaraguatatuba";
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
  type: "prefeituracubatao";
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
  type: "prefeiturasaocaetanodosul";
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
  type: "govbrdioenet";
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
  type: "prefeiturasuzano";
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
  type: "prefeituradescalvado";
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
  type: "prefeiturabarueri";
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
  type: "prefeiturasaocarlos";
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
  type: "prefeituraindaiatuba";
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
  type: "prefeituraferrazdevasconcelos";
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
  type: "prefeituraatibaia";
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
  type: "prefeiturabarretos";
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
  type: "portalcomunicacao";
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
  type: "prefeituravarzeapaulista";
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
  type: "prefeiturailhasolteira";
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
  type: "prefeiturasaosebastiao";
  /** Base URL for the Prefeitura São Sebastião site */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Belo Horizonte spider
 *
 * Site Structure:
 * - Vue.js frontend at https://dom-web.pbh.gov.br/
 * - API backend at https://api-dom.pbh.gov.br/api/v1/
 * - API protected by GoCache WAF - requires browser rendering
 *
 * API Endpoints:
 * - /edicoes/buscarultimapublicacao - Get latest publication
 * - /edicoes?dataInicio={date}&dataFim={date} - Search editions by date
 * - /edicoes/{id}/sumario - Get edition summary
 * - /documentos/{hash}/download?prefix={YYYYMMDD} - Download PDF
 */
export interface PrefeituraBeloHorizonteConfig {
  type: "prefeiturabelohorizonte";
  /** Base URL for the web frontend */
  baseUrl: string;
  /** API base URL */
  apiBaseUrl?: string;
  /** Whether client rendering is required */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Betim spider
 *
 * Site Structure:
 * - URL: https://www.betim.mg.gov.br/portal/diario-oficial/
 * - Uses SIGPub/voxtecnologia platform embedded in the page
 * - Calendar-based navigation with month/year selectors
 * - List of editions with "Ler online" and "Baixar" links
 * - PDFs hosted on www-storage.voxtecnologia.com.br
 */
export interface PrefeiturabetimConfig {
  type: "prefeituraBetim";
  /** Base URL for the Prefeitura Betim diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Juiz de Fora spider
 *
 * Site Structure:
 * - URL: https://www.pjf.mg.gov.br/e_atos/e_atos.php
 * - Government acts published daily with individual PDFs
 * - Search form with date range and type filters
 * - Anos anteriores: https://www.pjf.mg.gov.br/e_atos/anos_anteriores.php
 * - PDFs attached to individual acts: ./anexos/{filename}.pdf
 *
 * The site publishes "Atos do Governo" which is the official DOM of Juiz de Fora.
 * Acts are published individually, with some having PDF attachments.
 */
export interface PrefeituraJuizDeForaConfig {
  type: "prefeiturajuizdefora";
  /** Base URL for the Prefeitura Juiz de Fora e-atos page */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Uberlândia spider
 *
 * Site structure:
 * - Diário Oficial published as WordPress custom post type
 * - URLs: https://www.uberlandia.mg.gov.br/diariooficial/edicao-{number}/
 * - Redirects to PDF: https://docs.uberlandia.mg.gov.br/wp-content/uploads/{YYYY}/{MM}/{number}.pdf
 *
 * The spider iterates over edition numbers to find available gazettes.
 */
export interface PrefeiturauberlandiaConfig {
  type: "prefeiturauberlandia";
  /** Base URL for the municipality site */
  baseUrl: string;
  /** Starting edition number to crawl from (for reference) */
  startEdition?: number;
  /** Current/latest known edition number */
  currentEdition?: number;
}

/**
 * Configuration for Prefeitura de Montes Claros spider
 *
 * Site Structure:
 * - Base URL: https://diariooficial.montesclaros.mg.gov.br/
 * - Uses BEE platform (custom municipal portal system)
 * - Listing pages: /exercicio-{YYYY} for each year
 * - Gazette pages: /{YYYY}/{mes}/{slug} with JS redirect to PDF
 * - PDFs hosted on: https://admin.montesclaros.mg.gov.br/upload/diario-oficial/files/edicoes/
 *
 * The site displays gazette links that redirect via JavaScript to PDF files.
 * Each gazette page contains a script tag with window.location redirect to the PDF.
 */
export interface PrefeituramontesclarosConfig {
  type: "prefeituramontesclaros";
  /** Base URL for the Prefeitura Montes Claros diário oficial site */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Ipatinga spider
 *
 * Site Structure:
 * - URL: https://www.ipatinga.mg.gov.br/diariooficial
 * - Uses Portal Fácil platform with AjaxPro for loading gazettes
 * - Gazettes loaded via JavaScript (diel_diel_lis.GetDiario)
 * - PDF URLs: https://www.ipatinga.mg.gov.br/abrir_arquivo.aspx?cdLocal=12&arquivo={GUID}.pdf
 *
 * Requires browser rendering due to JavaScript-heavy page
 */
export interface PrefeituraIpatingaConfig {
  type: "prefeituraipatinga";
  /** Base URL for the Prefeitura Ipatinga diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering (always true for this spider) */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Governador Valadares spider
 *
 * Site Structure:
 * - URL: https://www.valadares.mg.gov.br/diario-eletronico/caderno/governador-valadares-mg/1
 * - Uses Portal Fácil platform with AjaxPro for loading gazettes
 * - Gazettes loaded via JavaScript (diel_diel_lis.GetDiario)
 * - PDF URLs: https://www.valadares.mg.gov.br/abrir_arquivo.aspx?cdLocal=12&arquivo={GUID}.pdf
 *
 * Requires browser rendering due to JavaScript-heavy page
 */
export interface PrefeituraGovernadorValadaresConfig {
  type: "prefeituragovernadovaladares";
  /** Base URL for the Prefeitura Governador Valadares diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering (always true for this spider) */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Santa Luzia - MG spider
 *
 * Site Structure:
 * - WordPress site with Modern Events Calendar plugin
 * - REST API: /index.php?rest_route=/wp/v2/posts
 * - PDFs embedded via pdf-poster plugin with data-attributes containing file URL
 * - PDF URL pattern: https://dom.santaluzia.mg.gov.br/wp-content/uploads/YYYY/MM/{number}-DOM.pdf
 */
export interface PrefeiturasantaluziamgConfig {
  type: "prefeiturasantaluziamg";
  /** Base URL for the Santa Luzia DOM platform */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Uberaba spider
 *
 * Site Structure:
 * - Base URL: http://www.uberaba.mg.gov.br/portal/galeriaarquivos,portavoz/arquivos
 * - Folder structure: /YYYY/ (years)
 * - PDFs organized by month within each year folder
 * - Official gazette name: "Porta-Voz"
 *
 * The site uses a file gallery system with year-based folders containing PDFs.
 */
export interface PrefeiturauberabaConfig {
  type: "prefeiturauberaba";
  /** Base URL for the Prefeitura Uberaba Porta-Voz archive */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Poços de Caldas spider
 *
 * Site Structure:
 * - Portal do Cidadão: https://sistemas.pocosdecaldas.mg.gov.br/portalcidadao/
 * - Uses GWT (Google Web Toolkit) with hash-based routing
 * - Diário Oficial search page accessible via specific hash in URL
 * - Search interface with: Edição, Data (from/to), Texto, Verificador
 *
 * The city does NOT publish in AMM-MG. They have their own proprietary system.
 * Requires browser rendering due to GWT framework complexity.
 */
export interface PrefeituraPocosdecaldasConfig {
  type: "prefeiturapocosdecaldas";
  /** Base URL for the Portal do Cidadão (e.g., "https://sistemas.pocosdecaldas.mg.gov.br/portalcidadao/") */
  baseUrl: string;
  /** Whether this spider requires client-side rendering (always true for this spider) */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Barbacena spider
 *
 * Site structure:
 * - Main page: https://www1.barbacena.mg.gov.br/portal/diario-oficial
 * - Open Data API: https://www1.barbacena.mg.gov.br/portal/dados-abertos/diario-oficial/{YEAR}
 * - Download URL: https://www1.barbacena.mg.gov.br/portal/download/diario-oficial/{TOKEN}/
 *
 * The site provides a JSON API with gazette metadata.
 */
export interface PrefeiturabarbacenaConfig {
  type: "prefeiturabarbacena";
  /** Base URL for the Prefeitura Barbacena portal (e.g., "https://www1.barbacena.mg.gov.br") */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Araguari spider
 *
 * Site Structure:
 * - Base URL: https://araguari.mg.gov.br/correio
 * - Pagination: /p/{offset} (20 items per page)
 * - Each gazette is in a .panel.panel-info block
 * - Date: <h6><em>{weekday}, {DD} de {month} de {YYYY}</em></h6>
 * - PDF: <a href="...pdf">Leia Aqui</a>
 */
export interface PrefeituraAraguariConfig {
  type: "prefeituraaraguari";
  /** Base URL for the Correio Oficial page */
  baseUrl?: string;
  /** Alternative URL property */
  url?: string;
}

export interface PrefeituraCoronelFabricianoConfig {
  type: "prefeituracoronelfabriciano";
  /** Base URL for the Diário Oficial page */
  baseUrl: string;
}

export interface PrefeituraAraxaConfig {
  type: "prefeituraaraxa";
  /** Base URL for the e.DOMA list page */
  baseUrl: string;
}

export interface PrefeituraLavrasConfig {
  type: "prefeituralavras";
  /** Base URL for the Portal do Cidadão */
  baseUrl: string;
  /** Whether this spider requires client-side rendering (always true for GWT applications) */
  requiresClientRendering?: boolean;
}

export interface PrefeituraNovaLimaConfig {
  type: "prefeituranolalima";
  /** Base URL for the Prefeitura Nova Lima website */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

export interface PrefeituraItaunaConfig {
  type: "prefeituraitauna";
  /** Base URL for the Prefeitura Itaúna diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

export interface PrefeituraUbaConfig {
  type: "prefeiturauba";
  /** Base URL for the Prefeitura Ubá diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

export interface PrefeituraItuiutabaConfig {
  type: "prefeituraituiutaba";
  /** Base URL for the Prefeitura Ituiutaba diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

export interface PrefeituraParademinasConfig {
  type: "prefeituraparademinas";
  /** Base URL for the Prefeitura Pará de Minas diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

export interface PrefeituraSaoJoaoDelReiConfig {
  type: "prefeiturasaojoaodelrei";
  /** Base URL for the Prefeitura São João del-Rei diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

export interface PrefeituraPatrocinioConfig {
  type: "prefeiturapatrocinio";
  /** Base URL for the Prefeitura Patrocínio diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

export interface PrefeituraCaratingaConfig {
  type: "prefeituracaratinga";
  /** Base URL for the Prefeitura Caratinga diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

export interface PrefeituraUnaiConfig {
  type: "prefeituraunai";
  /** Base URL for the Prefeitura Unaí diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

export interface PrefeituraBrumadinhoConfig {
  type: "prefeiturabrumadinho";
  /** URL for the Prefeitura Brumadinho diário oficial list page */
  url: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

export interface PrefeituraEsmeraldasConfig {
  type: "prefeituraesmeraldas";
  /** Base URL for the Prefeitura Esmeraldas diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

export interface PrefeituraTimoteoConfig {
  type: "prefeituratimoteo";
  /** Base URL for the Prefeitura Timóteo diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

export interface PrefeituraItajubaConfig {
  type: "prefeituraitajuba";
  /** Base URL for the Prefeitura Itajubá diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

export interface PrefeituraManhuacuConfig {
  type: "prefeituramanhuacu";
  /** Base URL for the Prefeitura Manhuaçu diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Alfenas spider
 *
 * Site Structure:
 * - URL: https://www.alfenas.mg.gov.br/publicacoes/diario-oficial
 * - Uses Portal Fácil platform with AjaxPro for loading gazettes
 * - Gazettes loaded via JavaScript
 * - Similar structure to PrefeituraIpatinga
 *
 * Requires browser rendering due to JavaScript-heavy page
 */
export interface PrefeituraAlfenasConfig {
  type: "prefeituraalfenas";
  /** Base URL for the Prefeitura Alfenas diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering (always true for this spider) */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura Alfenas Atos Oficiais spider
 */
export interface PrefeituraAlfenasAtosOficiaisConfig {
  type: "prefeituraalfenasatosoficiais";
  /** Base URL for the Atos Oficiais page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Viçosa spider
 *
 * Site Structure:
 * - URL: https://www.vicosa.mg.gov.br/diario-eletronico
 * - Uses Portal Fácil platform with AjaxPro for loading gazettes
 * - Gazettes loaded via JavaScript (diel_diel_lis.GetDiario)
 * - List of editions with "Visualizar arquivo" links
 * - PDF URLs: https://www.vicosa.mg.gov.br/abrir_arquivo.aspx?cdLocal=12&arquivo={GUID}.pdf
 *
 * Data Structure per gazette:
 * - Edition number (N° XXXX / YYYY)
 * - Date (DD/Mês/YYYY)
 * - Size (X.XXX MB)
 * - Link to PDF
 *
 * Requires browser rendering due to JavaScript-heavy page
 */
export interface PrefeituraVicosaConfig {
  type: "prefeituravicosa";
  /** Base URL for the Prefeitura Viçosa diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering (always true for this spider) */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Ouro Preto spider
 *
 * Site Structure:
 * - URL: https://www.ouropreto.mg.gov.br/transparencia/diario
 * - List of publications with format "PUBLICAÇÃO Nº XXXX - DD/MM/YYYY"
 * - Each publication has direct PDF link to sgm.ouropreto.mg.gov.br
 */
export interface PrefeituraOuroPretoConfig {
  type: "prefeituraouropreto";
  /** Base URL for the Prefeitura Ouro Preto diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Janaúba spider
 *
 * Site Structure:
 * - URL: https://www.janauba.mg.gov.br/transparencia
 * - Diário oficial accessible through transparency portal
 * - Structure to be determined
 */
export interface PrefeituraJanaubaConfig {
  type: "prefeiturajanauba";
  /** Base URL for the Prefeitura Janaúba diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Janaúba publicações page
 *
 * Site Structure:
 * - URL: https://janauba.mg.gov.br/transparencia/publicacoes
 * - List of publications with date and download links
 * - Pagination support
 */
export interface PrefeituraJanaubaPublicacoesConfig {
  type: "prefeiturajanaubapublicacoes";
  /** Base URL for the Prefeitura Janaúba publicações page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Folha de Sabará spider
 *
 * Local newspaper that publishes legal notices for Sabará
 * Site URL: https://folhadesabara.com.br/publicacao-leg
 */
export interface FolhadesabaraConfig {
  type: "folhadesabara";
  /** Base URL for the Folha de Sabará publications page */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Sabará spider
 *
 * Sabará does not have a consolidated daily gazette.
 * Official acts (decretos, portarias) are published individually on the city website.
 * Site URL: https://site.sabara.mg.gov.br/prefeitura/decretos/
 */
export interface PrefeiturasabaraConfig {
  type: "prefeiturasabara";
  /** Base URL for the Prefeitura Sabará decretos page */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Mariana spider
 *
 * Site Structure:
 * - URL: https://www.mariana.mg.gov.br/diario-oficial
 * - List of publications with format "PUBLICAÇÃO Nº XXXX - DD/MM/YYYY"
 * - Each publication has a download link with hash-based URL
 * - Uses simple HTML list structure
 */
export interface PrefeituraMarianaConfig {
  type: "prefeituramariana";
  /** Base URL for the Prefeitura Mariana diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Cataguases spider
 *
 * Site Structure:
 * - URL: https://cataguases.mg.gov.br/jornal-de-cataguases/
 * - WordPress blog with posts containing PDF links
 * - Posts in format: /jornal-cataguases-{date}/
 */
export interface PrefeituraCataguasesConfig {
  type: "prefeituracataguases";
  /** Base URL for the Jornal Cataguases page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Frutal spider
 *
 * Site Structure:
 * - URL: https://frutal.publicabrasil.net/
 * - Uses PublicaBrasil platform (WordPress-based)
 * - Editions in format: /documentos/diario-oficial-eletronico-edicao-XXX/
 */
export interface PrefeituraFrutalConfig {
  type: "prefeiturafrutal";
  /** Base URL for the Frutal diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

export interface PrefeituraExtremaConfig {
  type: "prefeituraextrema";
  /** Base URL for the Prefeitura Extrema diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

export interface PrefeituraCongonhasConfig {
  type: "prefeituracongonhas";
  /** Base URL for the Prefeitura Congonhas diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for SimpleSS platform spiders
 *
 * SimpleSS is a platform used by some Brazilian municipalities.
 * API Structure:
 * - Endpoint: {baseUrl}/listarDiario/
 * - Method: POST
 * - Response: Array of gazette objects with data, numero_edicao, pasta, arquivo, etc.
 * - PDF URLs: https://pub.simpless.com.br/files/{pasta}{arquivo}
 */
export interface SimpleSSConfig {
  type: "simpless";
  /** Base URL for the SimpleSS platform (e.g., "https://www.almenara.mg.gov.br/diario") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Barão de Cocais spider
 *
 * Site Structure:
 * - URL: https://www.baraodecocais.mg.gov.br/downloads/categoria/editais/7
 * - Downloads page with category filter for "Editais"
 * - List of publications with download links
 * - Pagination support
 */
export interface PrefeituraBaraoDeCocaisConfig {
  type: "prefeiturabaraodecocais";
  /** Base URL for the downloads page with category filter (e.g., "https://www.baraodecocais.mg.gov.br/downloads/categoria/editais/7") */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Espinosa spider
 *
 * Site Structure:
 * - URL: https://espinosa.mg.gov.br/category/diario-oficial-espinosa-mg/
 * - WordPress category page with posts for each gazette edition
 * - Pagination: /category/diario-oficial-espinosa-mg/page/{N}/
 * - Each post contains a PDF link to the gazette
 */
export interface PrefeituraEspinosaConfig {
  type: "prefeituraespinosa";
  /** Base URL for the category page (e.g., "https://espinosa.mg.gov.br/category/diario-oficial-espinosa-mg/") */
  url: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Elói Mendes spider
 *
 * Site Structure:
 * - URL: https://eloimendes.mg.gov.br/category/editais/concurso-publico/
 * - WordPress category page with posts for each gazette edition
 * - Pagination: /category/editais/concurso-publico/page/{N}/
 * - Each post contains a PDF link to the gazette
 * - Note: Only concurso-publico category found, no general atos/editions page available
 */
export interface PrefeituraEloiMendesConfig {
  type: "prefeituraeloi_mendes";
  /** Base URL for the category page (e.g., "https://eloimendes.mg.gov.br/category/editais/concurso-publico/") */
  url: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura Conceição das Alagoas - Concursos
 * - WordPress page with posts for each competition/decree
 * - URL: https://www.conceicaodasalagoas.mg.gov.br/concursos/
 * - Pagination: /concursos/page/{N}/
 */
export interface PrefeituraConceicaoDasAlagoasConcursosConfig {
  type: "prefeituraconceicaodasalagoas_concursos";
  /** Base URL for the concursos page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura Conceição das Alagoas - Atos Oficiais
 * - WordPress page with posts for each official act
 * - URL: https://www.conceicaodasalagoas.mg.gov.br/atos-oficiais/
 * - Pagination: /atos-oficiais/{N}/
 */
export interface PrefeituraConceicaoDasAlagoasAtosConfig {
  type: "prefeituraconceicaodasalagoas_atos";
  /** Base URL for the atos oficiais page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Portal Fácil/Actcon.net platform spider
 *
 * Portal Fácil is a common platform used by many Brazilian municipalities.
 * Developed by Actcon.net, it uses AjaxPro for loading gazettes via JavaScript.
 *
 * Site Structure:
 * - Uses Portal Fácil platform with AjaxPro for loading gazettes
 * - Gazettes are loaded via JavaScript (typically diel_diel_lis.GetDiario)
 * - List of editions with "Visualizar arquivo" or similar links
 * - PDF URLs typically: {baseUrl}/abrir_arquivo.aspx?cdLocal=12&arquivo={GUID}.pdf
 *
 * Requires browser rendering due to JavaScript-heavy page
 */
export interface DiarioOficialLinkConfig {
  type: "diario_oficial_link";
  /** Base URL for the diário oficial page (e.g., "https://www.jacutinga.mg.gov.br/diariooficial") */
  url: string;
  /** Whether client-side rendering is required (always true for this spider) */
  requiresClientRendering?: boolean;
}

export interface PortalfacilConfig {
  type: "portalfacil";
  /** Base URL for the Portal Fácil diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering (always true for Portal Fácil) */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Alegre - ES
 * WordPress site with PDFs organized by category (decretos, leis) and year
 */
export interface PrefeituraAlegreConfig {
  type: "prefeituraalegre";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Vitória - ES
 * ASP.NET site with ExibirArquivo.aspx endpoints
 */
export interface PrefeituraVitoriaConfig {
  type: "prefeituravitoria";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Cariacica - ES
 * Next.js site that requires browser rendering
 */
export interface PrefeituraCariacicaConfig {
  type: "prefeituracariacica";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering (always true for Next.js) */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Linhares - ES
 */
export interface PrefeituraLinharesConfig {
  type: "prefeiturlinhares";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Castelo - ES
 */
export interface PrefeituraCasteloConfig {
  type: "prefeituracastelo";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Guaçuí - ES
 */
export interface PrefeituraGuacuiConfig {
  type: "prefeituraguacui";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Vila Velha - ES
 */
export interface PrefeituraVilaVelhaConfig {
  type: "prefeituravilavelha";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Cachoeiro de Itapemirim - ES
 */
export interface PrefeituraCachoeiroConfig {
  type: "prefeituracachoeiro";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Serra - ES
 *
 * Site Structure:
 * - URL: https://ioes.dio.es.gov.br/diariodaserra
 * - Uses ioes.dio.es.gov.br platform (same as AMUNES but city-specific URL)
 * - Search form with date picker (DD/MM/YYYY format)
 * - May use same API as AMUNES with city filter
 */
export interface PrefeituraSerraConfig {
  type: "prefeituraserra";
  /** Base URL for the diário oficial page (e.g., "https://ioes.dio.es.gov.br/diariodaserra") */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Marataízes - ES
 *
 * Site Structure:
 * - URL: https://www.marataizes.es.gov.br/diario_oficial
 * - HTML table structure with gazette listings
 * - Each table row contains: edition number, date, and PDF link
 * - PDF links in format: /uploads/diario_oficial/diario-oficial-{edition}-{DD}-{MM}-{YYYY}-{hash}.pdf
 */
export interface PrefeituraMarataizesConfig {
  type: "prefeituramarataizes";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Niterói - RJ
 *
 * Site Structure:
 * - URL: https://diariooficial.niteroi.rj.gov.br/
 * - PDF URL pattern: /do/{year}/{monthName}/{day}.pdf
 * - Example: /do/2026/janeiro/19.pdf
 */
export interface PrefeituraNiteroiConfig {
  type: "prefeituraniiteroi";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura do Rio de Janeiro - RJ
 *
 * Site Structure:
 * - URL: https://doweb.rio.rj.gov.br/
 * - Page contains embedded JSON data in JavaScript variables
 * - PDF URL pattern: /portal/edicoes/download/{id}
 */
export interface PrefeituraRioDeJaneiroConfig {
  type: "prefeiturariodejaneiro";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de São Gonçalo - RJ
 * Site that requires browser rendering to search for official gazettes
 */
export interface PrefeituraSaoGoncaloConfig {
  type: "prefeiturasaogoncalo";
  /** Base URL for the diário oficial page (e.g., "https://do.pmsg.rj.gov.br") */
  url: string;
  /** Whether client-side rendering is required (always true for this spider) */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Campos dos Goytacazes - RJ
 *
 * Site Structure:
 * - URL: https://www.campos.rj.gov.br/diario-oficial.php
 * - HTML page with list of gazettes
 * - Each gazette has a link: /app/assets/diario-oficial/link/{id}
 * - Links redirect directly to PDFs
 * - Pagination: ?PGpagina=2&PGporPagina=15
 */
export interface PrefeituraCamposDosGoytacazesConfig {
  type: "prefeituracamposdosgoytacazes";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Duque de Caxias - RJ
 *
 * Site Structure:
 * - URL: https://transparencia.duquedecaxias.rj.gov.br/diario_oficial_busca.php
 * - Interface with monthly tabs (Jan, Fev, Mar, etc.) and year dropdown
 * - Each month tab shows a list of gazettes with date, edition number, and PDF links
 * - Requires browser rendering to interact with tabs and load content dynamically
 */
export interface PrefeituraDuqueDeCaxiasConfig {
  type: "prefeituraduquedecaxias";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering (always true for this spider) */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de São João de Meriti - RJ
 *
 * Site Structure:
 * - URL: https://transparencia.meriti.rj.gov.br/diario_oficial_busca.php
 * - Interface with monthly tabs (Jan, Fev, Mar, etc.) and year dropdown
 * - Each month tab shows a list of gazettes with date, edition number, and PDF links
 * - Requires browser rendering to interact with tabs and load content dynamically
 */
export interface PrefeituraSaoJoaoDeMeritiConfig {
  type: "prefeiturasaojoaodemeriti";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering (always true for this spider) */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Volta Redonda - RJ
 *
 * Site Structure:
 * - URL: https://www.voltaredonda.rj.gov.br/vrdestaque/index.php
 * - The site has a section for "Diário Oficial" with a list of gazettes
 * - Each gazette entry contains date, edition number, and PDF download link
 * - May require browser rendering to access dynamic content
 */
export interface PrefeituraVoltaRedondaConfig {
  type: "prefeituravoltaredonda";
  /** Base URL for the diário oficial page */
  url: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Petrópolis - RJ
 *
 * Site Structure:
 * - URL: https://www.petropolis.rj.gov.br/pmp/index.php/servicos-cidadao/diario-oficial
 * - Uses Joomla-based site with tab-based navigation
 * - Gazettes are displayed in a tabbed interface organized by year/month
 * - Requires browser rendering to interact with tabs and load content dynamically
 */
export interface PrefeituraPetropolisConfig {
  type: "prefeitrapetropolis";
  /** Base URL for the diário oficial page */
  url: string;
  /** Whether this spider requires client-side rendering (always true for this spider) */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Macaé - RJ
 *
 * Site Structure:
 * - URL: https://do.macae.rj.gov.br/
 * - DataTables-based table with columns: Edição, Ano, Data, Ações
 * - Requires browser rendering for JavaScript-rendered DataTables
 */
export interface PrefeituraMacaeConfig {
  type: "prefeituramacae";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering (always true for this spider) */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Magé - RJ
 */
export interface PrefeituraMageConfig {
  type: "prefeituramage";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Itaboraí - RJ
 */
export interface PrefeituraItaboraiConfig {
  type: "prefeituraitaborai";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Cabo Frio - RJ
 */
export interface PrefeituraCaboFrioConfig {
  type: "prefeituracabofrio";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Maricá - RJ
 */
export interface PrefeituraMaricaConfig {
  type: "prefeituramarica";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Nova Friburgo - RJ
 */
export interface PrefeituraNovaFriburgoConfig {
  type: "prefeituranovafriburgo";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for DomWeb platform (generic)
 *
 * DomWeb is a Yii2-based platform used by many Brazilian municipalities
 * for publishing official gazettes. Examples:
 * - Maragogi (AL): https://diario.maragogi.al.gov.br/
 * - Nova Friburgo (RJ): https://diario.novafriburgo.rj.gov.br/
 * - Presidente Prudente (SP): https://diario.presidenteprudente.sp.gov.br/
 */
export interface DomWebConfig {
  type: "domweb";
  /** Base URL for the diário oficial page (e.g., https://diario.maragogi.al.gov.br) */
  baseUrl: string;
  /** Whether this spider requires client-side rendering (usually true for DomWeb) */
  requiresClientRendering?: boolean;
  /** City name for logging/display purposes */
  cityName?: string;
}

/**
 * Configuration for Prefeitura de Barra Mansa - RJ
 */
export interface PrefeituraBarraMansaConfig {
  type: "prefeiturabarramansa";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Angra dos Reis - RJ
 */
export interface PrefeituraAngraDosReisConfig {
  type: "prefeituraangradosreis";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Mesquita - RJ
 */
export interface PrefeituraMesquitaConfig {
  type: "prefeituramesquita";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Teresópolis - RJ
 */
export interface PrefeituraTeresopolisConfig {
  type: "prefeiturateresopolis";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Rio das Ostras - RJ
 */
export interface PrefeituraRjOdasOstrasConfig {
  type: "prefeiturarjodasostras";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Nilópolis - RJ
 */
export interface PrefeituraNilopolisConfig {
  type: "prefeituranilopolis";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Queimados - RJ
 */
export interface PrefeituraQueimadosConfig {
  type: "prefeituraqueimados";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Araruama - RJ
 */
export interface PrefeituraRjAraruamaConfig {
  type: "prefeiturarjararuama";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Resende - RJ
 */
export interface PrefeituraRjResendeConfig {
  type: "prefeiturarjresende";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Itaguaí - RJ
 */
export interface PrefeituraRjItaguaiConfig {
  type: "prefeiturarjitaguai";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de São Pedro da Aldeia - RJ
 */
export interface PrefeituraRjSaoPedroDaAldeiaConfig {
  type: "prefeiturarjsaopedrodaaldeia";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Itaperuna - RJ
 */
export interface PrefeituraRjItaperunaConfig {
  type: "prefeiturarjitaperuna";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Japeri - RJ
 */
export interface PrefeituraRjJaperiConfig {
  type: "prefeiturarjjaperi";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Barra do Piraí - RJ
 */
export interface PrefeituraRjBarraDoPixaiConfig {
  type: "prefeiturarjbarradopirai";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Saquarema - RJ
 */
export interface PrefeituraRjSaquaremaConfig {
  type: "prefeiturarjsaquarema";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Seropédica - RJ
 */
export interface PrefeituraRjSeropedicaConfig {
  type: "prefeiturarjseropedica";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Três Rios - RJ
 */
export interface PrefeituraRjTresRiosConfig {
  type: "prefeiturarjtresrios";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Valença - RJ
 */
export interface PrefeituraRjValencaConfig {
  type: "prefeiturarjvalenca";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Cachoeiras de Macacu - RJ
 */
export interface PrefeituraRjCachoeirasDeMacacuConfig {
  type: "prefeiturarjcachoeirasdemacacu";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Rio Bonito - RJ
 */
export interface PrefeituraRjRioBonitoConfig {
  type: "prefeiturarjriobonito";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Guapimirim - RJ
 */
export interface PrefeituraRjGuapimirimConfig {
  type: "prefeiturarjguapimirim";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Casimiro de Abreu - RJ
 */
export interface PrefeituraRjCasimiroDeAbreuConfig {
  type: "prefeiturarjcasimirodeabreu";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Paraty - RJ
 */
export interface PrefeituraRjParatyConfig {
  type: "prefeiturarjparaty";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de São Francisco de Itabapoana - RJ
 */
export interface PrefeituraRjSaoFranciscoDeItabapoanaConfig {
  type: "prefeiturarjsaofranciscodeitabapoana";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Paraíba do Sul - RJ
 */
export interface PrefeituraRjParaibaDoSulConfig {
  type: "prefeiturarjparaibadosul";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Paraíba do Sul - RJ (V2 - Google Drive based)
 */
export interface PrefeituraRjParaibaDoSulV2Config {
  type: "prefeiturarjparaibadosulv2";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Paracambi - RJ
 */
export interface PrefeituraRjParacambiConfig {
  type: "prefeiturarjparacambi";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Santo Antônio de Pádua - RJ
 */
export interface PrefeituraRjSantoAntonioDePaduaConfig {
  type: "prefeiturarjsantoantoniopadua";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Mangaratiba - RJ
 */
export interface PrefeituraRjMangaratibaConfig {
  type: "prefeiturarjmangaratiba";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Armação dos Búzios - RJ
 */
export interface PrefeituraRjArmacaoDosBuziosConfig {
  type: "prefeiturarjarmacaodosbuzios";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de São Fidélis - RJ
 */
export interface PrefeituraRjSaoFidelisConfig {
  type: "prefeiturarjsaofidelis";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de São Fidélis - RJ v2
 * Uses HTTP-only mode (no browser required)
 */
export interface PrefeituraRjSaoFidelisV2Config {
  type: "prefeiturarjsaofidelisv2";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de São João da Barra - RJ
 */
export interface PrefeituraRjSaoJoaoDaBarraConfig {
  type: "prefeiturarjsaojoaodabarra";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de São João da Barra - RJ V2
 * Uses HTTP-only mode with PHP API (no browser required)
 */
export interface PrefeituraRjSaoJoaoDaBarraV2Config {
  type: "prefeiturarjsaojoaodabarrav2";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Bom Jesus do Itabapoana - RJ
 */
export interface PrefeituraRjBomJesusDoItabapoanaConfig {
  type: "prefeiturarjbomjesusdoitabapoana";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Vassouras - RJ
 */
export interface PrefeituraRjVassourasConfig {
  type: "prefeiturarjvassouras";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Tanguá - RJ
 */
export interface PrefeituraRjTanguaConfig {
  type: "prefeiturarjtangua";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Arraial do Cabo - RJ
 */
export interface PrefeituraRjArraialDoCaboConfig {
  type: "prefeiturarjarraialdocabo";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Arraial do Cabo - RJ (v2)
 * New site structure at https://www.arraial.rj.gov.br/diariooficial
 */
export interface PrefeituraRjArraialDoCaboV2Config {
  type: "prefeiturarjarraialdocabov2";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Itatiaia - RJ
 */
export interface PrefeituraRjItatiaiaConfig {
  type: "prefeiturarjitatiaia";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Paty do Alferes - RJ
 */
export interface PrefeituraRjPatyDoAlferesConfig {
  type: "prefeiturarjpatydoalferes";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Bom Jardim - RJ
 */
export interface PrefeituraRjBomJardimConfig {
  type: "prefeiturarjbomjardim";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Iguaba Grande - RJ
 */
export interface PrefeituraRjIguabaGrandeConfig {
  type: "prefeiturarjiguabagrande";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Miracema - RJ
 */
export interface PrefeituraRjMiracemaConfig {
  type: "prefeiturarjmiracema";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Miguel Pereira - RJ
 */
export interface PrefeituraRjMiguelPereiraConfig {
  type: "prefeiturarjmiguelpereira";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Piraí - RJ
 */
export interface PrefeituraRjPiraiConfig {
  type: "prefeiturarjpirai";
  /** Base URL for the diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for DiarioOficialOnline platform spiders
 * Used for sites hosted on diario-oficial.online (e.g., Bom Jardim - RJ)
 */
export interface DiarioOficialOnlineConfig {
  type: "diario_oficial_online";
  /** Base URL for the gazette listing page (e.g., https://diario-oficial.online/publicacoes/todas/1) */
  baseUrl: string;
}

/**
 * Configuration for Phoca Download (Joomla component) spiders
 * Used for sites that use Phoca Download to organize gazette files in hierarchical categories
 */
export interface PhocaDownloadConfig {
  type: "phocadownload";
  /** Base URL for the Phoca Download category page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Ceará municipality gazette spiders
 * Used for sites that use the standard CE template (diariooficial.php)
 */
export interface PrefeituraCEConfig {
  type: "prefeiturace";
  /** Base URL for the gazette list page (e.g., https://www.caucaia.ce.gov.br/diariooficial.php) */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for ASSESI gazette spider
 * ASSESI is a common system used by municipalities in Ceará.
 * Uses a custom template with list-group-item structure.
 *
 * URL pattern: https://www.{cidade}.ce.gov.br/{slug}.php
 * PDF URL pattern: https://www.{cidade}.ce.gov.br/arquivos_download.php?id={ID}&pg={slug}
 *
 * Available slugs (all accessible from /acessoainformacao.php):
 * - diariooficial - Diário Oficial
 * - leis - Leis
 * - decretos - Decretos
 * - processoseletivo - Processo Seletivo
 * - publicacoes - Publicações
 */
export interface AssesiConfig {
  type: "assesi";
  /** Base URL for the gazette list page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
  /**
   * When true, searches all available slugs (diariooficial, leis, decretos, processoseletivo, publicacoes)
   * Default: false (only searches the slug specified in baseUrl)
   */
  searchAllSlugs?: boolean;
  /**
   * Specific slugs to search (overrides searchAllSlugs)
   * Example: ['diariooficial', 'leis', 'decretos']
   */
  slugs?: string[];
}

/**
 * Configuration for Procede Bahia gazette spider
 *
 * Procede is a document certification system used by municipalities in Bahia.
 * Uses a REST API to fetch gazette information.
 *
 * API Endpoint: https://api.procedebahia.com.br/diaries
 * Parameters:
 *   - cod_entity: Entity code (unique per municipality)
 *   - start_date: Start date in YYYY-MM-DD format
 *   - end_date: End date in YYYY-MM-DD format
 *
 * PDF URLs are constructed as:
 * - If arquivo contains full URL -> use directly
 * - Otherwise: https://procede.api.br/{pasta}/publicacoes/{arquivo}
 *
 * Example: Itabuna uses cod_entity=88
 */
export interface ProcedeConfig {
  type: "procede";
  /** Entity code for the municipality in the Procede system (e.g., 88 for Itabuna) */
  codEntity: number;
  /** Optional custom API URL (default: https://api.procedebahia.com.br/diaries) */
  apiUrl?: string;
  /** Optional custom download base URL (default: https://procede.api.br) */
  downloadBaseUrl?: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Domunicipio gazette spider
 * Used for municipalities using the domunicipio.com platform
 *
 * URL pattern: https://domunicipio.com/cidade.php?q={q}&id={cityId}
 * - q=1 for Ordinary editions
 * - q=2 for Extraordinary editions
 *
 * Publications are listed as calendar events with links to PDF viewers
 */
export interface DomunicipioConfig {
  type: "domunicipio";
  /** City ID on the domunicipio.com platform (e.g., 34 for Conceição do Coité) */
  cityId: number;
  /** Whether to include extraordinary editions (default: true) */
  includeExtraordinary?: boolean;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Portal IOP gazette spider
 * Used for municipalities in Bahia using the portaliop.org.br platform (e.g., Euclides da Cunha)
 *
 * URL Structure:
 * - Main page: https://diario.portaliop.org.br/{UF}/prefeitura/{CityName}
 * - Redirects from: https://portaliop.org.br/diariopref/?id={clientId}
 *
 * The site uses Vue.js and requires client-side rendering.
 * Data is loaded dynamically via JavaScript.
 *
 * Note: This spider may have historical data only as some municipalities
 * have migrated to different platforms.
 */
export interface PortalIopConfig {
  type: "portaliop";
  /** State code (e.g., "BA" for Bahia) */
  stateCode: string;
  /** City slug as it appears in the URL (e.g., "EuclidesdaCunha") */
  citySlug: string;
  /** Optional client ID from the original URL (e.g., 3117) */
  clientId?: number;
  /** Base URL for the portal (default: https://diario.portaliop.org.br) */
  baseUrl?: string;
  /** Whether this spider requires client-side rendering (default: true) */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for INDAP gazette spider
 * Platform used by some municipalities in Bahia (e.g., Araci)
 *
 * URL pattern: https://diario.indap.org.br/?estado_id={estadoId}&cidade_id={cidadeId}&cidade={cidade}&estado={estado}&orgao={orgao}
 */
export interface IndapConfig {
  type: "indap";
  /** State ID in the INDAP system (e.g., 5 for Bahia) */
  estadoId: number;
  /** City ID in the INDAP system (e.g., 1853 for Araci) */
  cidadeId: number;
  /** City name (e.g., "Araci") */
  cidade: string;
  /** State abbreviation (e.g., "BA") */
  estado: string;
  /** Organization type (e.g., "Prefeitura", "Câmara") */
  orgao: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for PortalGov gazette spider
 * Used for municipalities using the portalgov.srv.br platform (e.g., Brumado)
 *
 * HTML Structure:
 * - Main page with edition table
 * - PDF links in the table with direct download URLs
 *
 * URL pattern: https://portalgov.srv.br/diariooficial/{slug}
 */
export interface PortalGovConfig {
  type: "portalgov";
  /** The slug identifier for the municipality (e.g., "prefeitura-municipal-de-brumado") */
  slug: string;
  /** Base URL for the portal (default: https://portalgov.srv.br) */
  baseUrl?: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Imprensa Oficial (Open T.I.) gazette spider
 * WordPress-based platform used by many Bahia municipalities (e.g., Serrinha)
 *
 * URL pattern: {subdomain}.imprensaoficial.org
 *
 * HTML Structure:
 * - WordPress posts representing gazette editions
 * - Calendar-based navigation
 * - Links to PDF downloads
 */
export interface ImprensaOficialConfig {
  type: "imprensaoficial";
  /** The subdomain for the municipality (e.g., "pmserrinhaba" for Serrinha) */
  subdomain: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Transparência Oficial BA gazette spider
 * Used by municipalities in Bahia (e.g., Casa Nova)
 *
 * URL pattern: pm{cidade}.transparenciaoficialba.com/diariooficial/
 *
 * HTML Structure:
 * - Calendar-based navigation by year/month
 * - PDF links for each day
 */
export interface TransparenciaOficialBaConfig {
  type: "transparenciaoficialba";
  /** The subdomain for the municipality (e.g., "pmcasanova") */
  subdomain: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura Irecê gazette spider
 * Custom platform used by Irecê municipality
 *
 * URL pattern: irece.ba.gov.br/diario_oficial
 *
 * HTML Structure:
 * - Calendar-based navigation by month/year
 * - PDF links for editions
 */
export interface PrefeituraIreceConfig {
  type: "prefeiturairece";
  /** Base URL for the gazette page (default: https://irece.ba.gov.br/diario_oficial) */
  baseUrl?: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for IBDM Transparência spider
 * Used for municipalities using the IBDM transparency platform
 *
 * Features:
 * - Direct HTTP parsing of transparency portal
 * - PDF links via downloader.php with base64-encoded URLs
 * - Supports multiple municipalities in Bahia
 */
export interface IbdmTransparenciaConfig {
  type: "ibdmtransparencia";
  /** Base URL of the transparency portal */
  baseUrl: string;
  /** City slug for identifying the municipality */
  citySlug?: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Juazeiro do Norte gazette spider
 * Uses diariolista.php with direct PDF links
 * URL pattern: https://www.juazeirodonorte.ce.gov.br/diariolista.php
 * PDF URL pattern: diario/{ID}/{EDITION}_{YEAR}_0000001.pdf
 */
export interface PrefeituraJuazeiroDoNorteConfig {
  type: "prefeiturajuazeirodonorte";
  /** Base URL for the gazette list page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Sobral gazette spider
 * Sobral uses a custom DOM system with direct PDF links
 */
export interface PrefeituraSobralConfig {
  type: "prefeiturasobral";
  /** Base URL for the gazette search page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Crato gazette spider
 * Crato uses a custom paginated table system
 * URL: https://mail.crato.ce.gov.br/diariooficial/?p=
 * PDF URLs: https://mail.crato.ce.gov.br/site/conteudo/2/{TIMESTAMP}_1.pdf
 */
export interface PrefeituraCratoConfig {
  type: "prefeituracrato";
  /** Base URL for the gazette list page (e.g., https://mail.crato.ce.gov.br/diariooficial/?p=) */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Plug Tecnologia transparency portal spiders
 *
 * Platform Structure:
 * - Main URL: /transparencia/exibir/{CATEGORY_ID}/0/1/{SLUG} - shows year folders
 * - Year URL: /transparencia/exibir/{CATEGORY_ID}/{FOLDER_ID}/1/{SLUG} - shows gazette list
 * - Download: /transparencia/download/{FILE_ID} - redirects to PDF
 *
 * Example: https://miracema.plugtecnologia.com.br/transparencia/exibir/20/0/1/boletim-oficial
 */
export interface PlugTecnologiaConfig {
  type: "plugtecnologia";
  /** Base URL for the gazette page (e.g., "https://miracema.plugtecnologia.com.br/transparencia/exibir/20/0/1/boletim-oficial") */
  baseUrl: string;
}

/**
 * Configuration for WordPress sites with custom post type "publicacoes"
 *
 * This spider uses the WordPress REST API to fetch publications.
 * Each publication may have PDF attachments that are fetched via the media endpoint.
 *
 * API endpoints:
 * - Publications list: /wp-json/wp/v2/publicacoes
 * - Media for a post: /wp-json/wp/v2/media?parent={post_id}
 *
 * Example site: https://camocim.ce.gov.br/publicacoes/
 */
export interface WordPressPublicacoesConfig {
  type: "wordpress_publicacoes";
  /** Base URL for the WordPress site (e.g., "https://camocim.ce.gov.br") */
  baseUrl: string;
  /** Custom post type slug (default: "publicacoes") */
  postType?: string;
  /** Number of posts per page (default: 100) */
  perPage?: number;
}

/**
 * Configuration for Joomla EDocman component spiders
 *
 * EDocman is a document management extension for Joomla that provides
 * a structured way to organize and publish documents.
 *
 * Example site: https://parambu.ce.gov.br/transparencia-2/transparencia/diario-oficial
 */
export interface EdocmanConfig {
  type: "edocman";
  /** Base URL for the gazette listing page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Salvador, BA gazette spider
 *
 * Salvador uses a Joomla-based platform with a category listing.
 * PDFs are stored at: http://www.dom.salvador.ba.gov.br/images/stories/pdf/{year}/{month}/dom-{number}-{day}-{month}-{year}.pdf
 */
export interface PrefeiturasalvadorConfig {
  type: "prefeiturasalvador";
  /** Base URL for the gazette site (e.g., "http://dom.salvador.ba.gov.br") */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Vitória da Conquista, BA gazette spider
 *
 * Vitória da Conquista uses a custom platform with monthly listings.
 * URL pattern: https://dom.pmvc.ba.gov.br/diarios/{year}/{month}
 */
export interface PrefeituraVitoriadaConquistaConfig {
  type: "prefeituravitoiriadaconquista";
  /** Base URL for the gazette site (e.g., "https://dom.pmvc.ba.gov.br") */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Barreiras, BA gazette spider
 *
 * Barreiras uses a WordPress page with direct PDF links.
 * PDFs are stored at: //www.barreiras.ba.gov.br/diario/pdf/{year}/diario{number}.pdf
 */
export interface PrefeituraBarreirasConfig {
  type: "prefeiturabarreiras";
  /** Base URL for the gazette page (e.g., "https://barreiras.ba.gov.br/diario-oficial/") */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Teixeira de Freitas, BA gazette spider
 *
 * Teixeira de Freitas uses a WordPress blog where each post is an edition.
 * Each edition contains multiple "Cadernos" (sections) with PDF links.
 * URL: https://diario.teixeiradefreitas.ba.gov.br
 * Pagination: /page/N/
 */
export interface PrefeiturateixeiraDeFreitasConfig {
  type: "prefeiturateixeiradefreitas";
  /** Base URL for the gazette site (e.g., "https://diario.teixeiradefreitas.ba.gov.br") */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Porto Seguro, BA gazette spider
 *
 * Porto Seguro uses the IBDM Modernização / Acesso Informação platform.
 * URL: http://www.acessoinformacao.com.br/ba/portoseguro/diario-externo.php
 */
export interface PrefeituraPortoSeguroConfig {
  type: "prefeituraportoseguro";
  /** Base URL for the gazette page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Ilhéus, BA gazette spider
 *
 * Ilhéus uses a custom ASP.NET platform.
 * URL: http://www.ilheus.ba.gov.br/diario-eletronico
 */
export interface PrefeituraIlheusConfig {
  type: "prefeiturailheus";
  /** Base URL for the gazette page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Feira de Santana, BA gazette spider
 *
 * Feira de Santana uses a custom ASP platform.
 * URL: https://diariooficial.feiradesantana.ba.gov.br/
 */
export interface PrefeituraFeiraDesantanaConfig {
  type: "prefeiturafeiradesantana";
  /** Base URL for the gazette page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Camaçari, BA gazette spider
 *
 * Camaçari uses a WordPress site with custom REST API endpoint.
 * API: /wp-json/camacari/v1/arquivos?paged=1&categoria=diario-oficial
 * PDF URL pattern: /wp-content/uploads/{year}/{month}/diario-{number}-certificado.pdf
 *
 * Note: The API is protected by WAF and requires browser rendering.
 */
export interface PrefeituracamacariConfig {
  type: "prefeituracamacari";
  /** Base URL for the gazette site (e.g., "https://www.camacari.ba.gov.br") */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Paulo Afonso, BA gazette spider
 *
 * Paulo Afonso uses the DIOF system via diario.io.org.br
 * URL: https://diario.io.org.br/ba/pauloafonso
 * API: https://diof.io.org.br/api/
 * Client ID: 587
 */
export interface PrefeituraPauloAfonsoConfig {
  type: "prefeiturapauloafonso";
  /** Client ID for the DIOF API (587 for Paulo Afonso) */
  clientId: number;
  /** Power of the gazette (executive, legislative, or executive_legislative) */
  power: "executive" | "legislative" | "executive_legislative";
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for AIRDOC platform gazette spider
 *
 * AIRDOC is a platform used by some municipalities in Bahia for official gazettes.
 * The platform provides a paginated list of PDFs with export options (JSON, ODT).
 *
 * URL pattern: {baseUrl}/diario or {baseUrl}/diario?page=N
 * JSON export: {baseUrl}/diario/exportar_json
 *
 * Currently used by: Presidente Tancredo Neves (BA)
 */
export interface AirdocConfig {
  type: "airdoc";
  /** Base URL for the gazette site (e.g., "http://presidentetancredoneves.ba.gov.br") */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for PortalTP/PortalGov based gazette spider for Anagé, BA
 *
 * Anagé uses a custom portal system with:
 * - Search by date range, category, and keywords
 * - PDF files stored at /arquivos/diariooficial/{hash}/DiarioOficial_Edicao_{number}.pdf
 * - Editions with volume and number (e.g., "Volume 19, Nº 3907/2026")
 *
 * URL: https://anage.ba.gov.br/diariooficial
 */
export interface PrefeituraAnageConfig {
  type: "prefeituraanage";
  /** Base URL for the gazette site */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Recife DOME spider
 * URL: https://dome.recife.pe.gov.br/dome/
 */
export interface PrefeituraRecifeConfig {
  type: "prefeiturarecife";
  /** Base URL for the DOME portal */
  baseUrl: string;
}

/**
 * Configuration for Jaboatão dos Guararapes spider
 * URL: https://diariooficial.jaboatao.pe.gov.br/
 */
export interface PrefeituraJaboataoConfig {
  type: "prefeiturajaboatao";
  /** Base URL for the diário oficial portal */
  baseUrl: string;
}

/**
 * Configuration for Caruaru spider
 * URL: https://diariooficial.caruaru.pe.gov.br/
 */
export interface PrefeituraCaruaruConfig {
  type: "prefeituracaruaru";
  /** Base URL for the diário oficial portal */
  baseUrl: string;
}

/**
 * Configuration for Santa Cruz do Capibaribe spider
 * URL: https://www.santacruzdocapibaribe.pe.gov.br/artigos/diariooficial
 */
export interface PrefeiturasantacruzdocapibaribeConfig {
  type: "prefeiturasantacruzdocapibaribe";
  /** Base URL for the diário oficial portal */
  baseUrl: string;
}

/**
 * Configuration for Camaragibe spider
 * URL: https://diariooficial.camaragibe.pe.gov.br/
 */
export interface PrefeituracamaragibeConfig {
  type: "prefeituracamaragibe";
  /** Base URL for the diário oficial portal */
  baseUrl: string;
}

/**
 * Configuration for Teresina spider
 * URL: https://dom.pmt.pi.gov.br/lista_diario.php
 */
export interface PrefeiturareTeresinhaConfig {
  type: "prefeiturateresina";
  /** Base URL for the diário oficial portal */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Parnaíba spider
 * URL: https://dom.parnaiba.pi.gov.br/
 */
export interface PrefeituraParnaraibaConfig {
  type: "prefeiturapnarnaiba";
  /** Base URL for the diário oficial portal */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Diário Oficial das Prefeituras platform (Piauí)
 * URL: https://diariooficialdasprefeituras.org/piaui/
 */
export interface DiarioOficialDasPrefeiturasConfig {
  type: "diariooficialdasprefeituras";
  /** Base URL for the platform */
  baseUrl: string;
  /** City name to filter results (Unidade Gestora) */
  cityName: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
  /**
   * Entity type filter (Entidade)
   * Options: "Câmara", "Empresa privada", "Prefeitura"
   */
  entidade?: "Câmara" | "Empresa privada" | "Prefeitura";
  /**
   * Classification of the act filter (Classificação do Ato)
   * Examples: "Edital de concurso público", "Edital de Seletivo Público", "Outros atos de concurso"
   * When multiple values are needed, provide an array
   */
  classificacaoAto?: string | string[];
}

/**
 * Configuration for Diário Oficial dos Municípios (APPM) platform (Piauí)
 * URL: https://www.diarioficialdosmunicipios.org
 * Managed by APPM (Associação Piauiense de Municípios)
 */
export interface DiarioOficialDosMunicipiosAPPMConfig {
  type: "diarioficialdosmunicipiosappm";
  /** Base URL for the platform */
  baseUrl: string;
  /** City name to filter results */
  cityName: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Araripina spider (Softagon/Nuxt.js platform)
 * URL: https://www.araripina.pe.gov.br/diario-oficial
 * Note: Despite using Vue.js, this platform server-renders date information in HTML
 */
export interface PrefeituaAraripina {
  type: "prefeituraaraipina";
  /** Base URL for the diário oficial portal */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Bezerros spider
 * WordPress-based site with yearly pages and paginated lists of PDFs
 */
export interface PrefeituraBezerrosConfig {
  type: "prefeiturabezerros";
  /** Base URL for the diário oficial portal (e.g., "https://bezerros.pe.gov.br/diario-oficial") */
  baseUrl: string;
}

/**
 * Configuration for Softagon platform spider
 * Nuxt.js-based Diário Oficial portal used by various municipalities
 * URL Pattern: {baseUrl}/{editionNumber}?exercicio={year}
 *
 * Known municipalities using this platform:
 * - Santa Maria da Boa Vista - PE
 */
export interface SoftagonConfig {
  type: "softagon";
  /** Base URL for the diário oficial portal (e.g., "https://santamariadaboavista.pe.gov.br/diario-oficial") */
  baseUrl: string;
}

/**
 * Configuration for Directus Portal spider
 *
 * These portals use Directus CMS with a REST API to serve gazette data.
 * Example: Bodocó - PE (https://bodoco.pe.gov.br/diario-oficial)
 */
export interface DirectusPortalConfig {
  type: "directus_portal";
  /** API base URL (e.g., "https://app.bodoco.pe.gov.br/") */
  apiBase: string;
  /** API token for authorization */
  apiToken: string;
  /** City ID in the system */
  cityId: string;
  /** Collection name for gazettes (default: "edicao") */
  collection?: string;
  /** Public portal base URL for gazette pages */
  portalBaseUrl: string;
}

/**
 * Configuration for SOGO Tecnologia WordPress spider
 * Used by municipalities with WordPress sites built by SOGO Tecnologia
 *
 * Example URL pattern: https://trindade.pe.gov.br/diario-oficial/diario-oficial-2026/
 * PDFs are in: wp-content/uploads/YEAR/MONTH/EDICAO-No-XXX-DE-DD-DE-MES-DE-YYYY.pdf
 */
export interface SogoTecnologiaConfig {
  type: "sogotecnologia";
  /** Base URL of the gazette page (e.g., "https://trindade.pe.gov.br/diario-oficial/") */
  baseUrl: string;
  /** Starting year to crawl from (e.g., 2019) */
  startYear?: number;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
  /**
   * Custom URL pattern for the year page. Use {year} as placeholder.
   * Default: "{baseUrl}diario-oficial-{year}/"
   * Example for Campina Grande: "{baseUrl}semanario-oficial-{year}/"
   */
  yearUrlPattern?: string;
  /**
   * If true, gazettes are listed as article links pointing to detail pages
   * that contain PDF links, rather than direct PDF links.
   * Default: false
   */
  usesDetailPages?: boolean;
}

/**
 * Configuration for Prefeitura Imperatriz and similar platform spiders
 * Used by multiple municipalities in Maranhão with this specific CMS
 *
 * Example sites:
 * - Imperatriz: diariooficial.imperatriz.ma.gov.br/edicoes
 * - Timon: transparencia.timon.ma.gov.br/edicoes
 *
 * HTML Structure:
 * - Edition cards: div.deprt-icon-box
 * - PDF links: a.rm (href to /upload/diario_oficial/XXX.pdf)
 * - Edition info: "Vol X | Nº Y/YYYY"
 * - Date: "DD/MM/YYYY"
 * - Pagination: ?page=N
 */
export interface PrefeituraImperatrizConfig {
  type: "prefeituraimperatriz";
  /** Base URL of the editions page (e.g., "http://diariooficial.imperatriz.ma.gov.br/edicoes") */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Timon spider
 *
 * Site uses ScriptCase with iframes for editions.
 * Main page: https://www.timon.ma.gov.br/diario-oficial/
 * Executivo iframe: https://timon.ma.gov.br/diario-oficial/diario_executivo/publicacao_executivo/
 * Legislativo iframe: https://timon.ma.gov.br/diario-oficial/diario_legislativo/publicacao_legislativo/
 *
 * PDF URL pattern:
 * - https://timon.ma.gov.br/diario-oficial/administrador/_lib/file/doc/Diário Executivo DD.MM.YYYY.pdf
 * - https://timon.ma.gov.br/diario-oficial/administrador/_lib/file/doc/Diário Executivo Extra DD.MM.YYYY.pdf
 * - https://timon.ma.gov.br/diario-oficial/administrador/_lib/file/doc/Diário Legislativo DD.MM.YYYY.pdf
 */
export interface PrefeituraTimonConfig {
  type: "prefeituratimon";
  /** Base URL of the gazette page (e.g., "https://www.timon.ma.gov.br/diario-oficial/") */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Bacabal spider
 * City in Maranhão state
 *
 * Site: www.bacabal.ma.gov.br/diario
 *
 * PDF URL pattern: https://www.bacabal.ma.gov.br/DOM/BAC{YYYYMMDD}-a.pdf
 * Extra editions: https://www.bacabal.ma.gov.br/DOM/BAC{YYYYMMDD}-{n}-a.pdf
 *
 * Pagination: /diario/1, /diario/2, etc.
 */
export interface PrefeiturabacabalConfig {
  type: "prefeiturabacabal";
  /** Base URL of the gazette page (e.g., "https://www.bacabal.ma.gov.br/diario") */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura Transparente spider
 *
 * Platform: prefeituratransparente.com.br (Laravel + Vue.js SPA)
 *
 * Used by: Coroatá-MA (dom.coroata.ma.gov.br)
 *
 * This is a SPA platform that requires client-side JavaScript rendering.
 * The page contains a table of gazettes with "Baixar" buttons.
 * Each row contains: edition number, date, PDF download link.
 */
export interface PrefeituratransparenteConfig {
  type: "prefeituratransparente";
  /** Base URL of the gazette page (e.g., "https://dom.coroata.ma.gov.br/") */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering (always true for this platform) */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Órbita Tecnologia DOM platform (Next.js)
 *
 * Platform: dom.*.pa.gov.br (Órbita Tecnologia)
 * Used by: Barcarena-PA (dom.barcarena.pa.gov.br)
 *
 * Next.js SPA with "Últimas Edições" section that loads content dynamically.
 */
export interface DomOrbitapConfig {
  type: "dom_orbitap";
  /** Base URL of the gazette page (e.g., "https://dom.barcarena.pa.gov.br/") */
  baseUrl: string;
}

/**
 * Configuration for VFM (Veno File Manager) transparency portal spider
 *
 * Platform: websiteseguro.com (commonly used by municipalities in MA)
 *
 * Used by: Monção-MA (moncao3.websiteseguro.com/transparencia)
 *
 * Structure:
 * - Base: {baseUrl}/?dir=uploads/{diretorioDiario}
 * - Years: {baseUrl}/?dir=uploads/{diretorioDiario}/{ano}
 * - Months: {baseUrl}/?dir=uploads/{diretorioDiario}/{ano}/{mesNome} (e.g., 01-JAN, 02-FEV)
 * - Files: DIÁRIO-OFICIAL_N{edição}_{dia}_{mês}_{ano}.pdf
 */
export interface VFMTransparenciaConfig {
  type: "vfmtransparencia";
  /** Base URL of the transparency portal (e.g., "https://moncao3.websiteseguro.com/transparencia") */
  baseUrl: string;
  /** Directory name for official gazettes (default: "DIÁRIO-OFICIAL") */
  diretorioDiario?: string;
}

/**
 * Configuration for Megasoft Transparência spider
 *
 * Platform: {subdomain}.megasofttransparencia.com.br
 *
 * Used by: Uruaçu-GO (uruacu.megasofttransparencia.com.br)
 *
 * Diário Oficial em "Legislação e Publicações" (/legislacao-e-publicacoes).
 */
export interface MegasoftTransparenciaConfig {
  type: "megasofttransparencia";
  /** Base URL of the transparency portal (e.g., "https://uruacu.megasofttransparencia.com.br") */
  baseUrl: string;
  /** Path to diário oficial page (default: "legislacao-e-publicacoes") */
  diarioPath?: string;
}

/**
 * Configuration for Prefeitura de São Luís spider
 * Capital of Maranhão state
 *
 * Site: diariooficial.saoluis.ma.gov.br
 *
 * HTML Structure:
 * - Edition cards: div.box-publicacao with data-key="ID"
 * - Edition title: h4 (e.g., "Edição nº 022/XLVI")
 * - Date: Text after h4 (e.g., "Terça-feira, 27 de janeiro de 2026")
 * - PDF link: /diario-oficial/versao-pdf/ID
 */
export interface PrefeturaSaoLuisConfig {
  type: "prefeiturasaoluis";
  /** Base URL of the gazette page (e.g., "https://diariooficial.saoluis.ma.gov.br/diario-oficial") */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Natal spider
 * Capital of Rio Grande do Norte state
 *
 * Site: https://www2.natal.rn.gov.br/dom/
 *
 * PDF URL pattern: https://www2.natal.rn.gov.br/_anexos/publicacao/dom/dom_{YYYYMMDD}_{hash}.pdf
 */
export interface PrefeituraNatalConfig {
  type: "prefeituranatal";
  /** Base URL of the gazette page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Mossoró spider
 * Rio Grande do Norte state
 *
 * Site: https://dom.mossoro.rn.gov.br/
 */
export interface PrefeituraMossoroConfig {
  type: "prefeituramossoro";
  /** Base URL of the gazette page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de São Gonçalo do Amarante spider
 * Rio Grande do Norte state
 *
 * Site: https://www.saogoncalo.rn.gov.br/diariooficial
 */
export interface PrefeituraSaoGoncaloRNConfig {
  type: "prefeiturasaogoncalorn";
  /** Base URL of the gazette page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Macaíba spider
 * Rio Grande do Norte state
 *
 * Site: https://macaiba.rn.gov.br/servicos/diario-oficial/
 *
 * WordPress-based site with paginated list of PDFs
 */
export interface PrefeituraMacaibaConfig {
  type: "prefeituramacaiba";
  /** Base URL of the gazette page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Parnamirim spider
 * Rio Grande do Norte state
 *
 * Site: https://diariooficial.parnamirim.rn.gov.br/
 * API: https://sgidom.parnamirim.rn.gov.br/rest/
 *
 * Angular SPA with REST API backend for gazette listing and PDF generation
 */
export interface PrefeituraParnamirimConfig {
  type: "prefeituraparnamirim";
  /** Base URL of the gazette frontend */
  baseUrl: string;
  /** API URL for fetching gazette data */
  apiUrl?: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Assú spider
 * Rio Grande do Norte state
 *
 * Site: https://assu.rn.gov.br/diario_oficial/
 *
 * Custom PHP/HTML site with table listing gazettes by edition number and date
 * Supports filtering by month/year. PDF download links in "Baixar" buttons.
 */
export interface PrefeituraAssuConfig {
  type: "prefeituraassu";
  /** Base URL of the gazette page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Macau spider
 * Rio Grande do Norte state
 *
 * Site: https://macau.rn.gov.br/diario/
 *
 * Apache directory listing site with folders organized by year and month.
 * PDF pattern: diário{number}-{DD}-{MM}-{YYYY}.pdf
 */
export interface PrefeituramacaurnConfig {
  type: "prefeituramacaurn";
  /** Base URL of the gazette directory */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Vilhena - RO
 * Diário oficial em vilhena.xyz/diario-oficial (não AROM).
 * PDFs em: {baseUrl}/diarios_publicado/Abrir_Seguro/{year}/{MM}-{monthname}/DOV N {number} - {DD.MM.YYYY}.pdf
 */
export interface PrefeituraVilhenaConfig {
  type: "prefeituravilhena";
  /** Base URL (e.g. https://vilhena.xyz/diario-oficial) */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Santa Inês spider
 * Maranhão state
 *
 * Site: https://santaines.ma.gov.br/diariooficial
 *
 * Gestor Web platform with date filters and categorized publications.
 * PDF pattern: /arquivos/diariooficial/{hash}/DiarioOficial_Edicao_{number}.pdf
 */
export interface PrefeiturasantainesConfig {
  type: "prefeiturasantaines";
  /** Base URL of the gazette page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Pinheiro spider
 * Maranhão state
 *
 * Site: https://diariooficial.pinheiro.ma.gov.br
 *
 * WordPress (WebAtiva) with edition listing and signed PDFs.
 * PDF pattern: /wp-content/uploads/YYYY/MM/diario-oficial-YYYY-MM-DD-assinado.pdf
 */
export interface PrefeiturapinheiroConfig {
  type: "prefeiturapinheiro";
  /** Base URL of the gazette page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Barra do Corda spider
 * Maranhão state
 *
 * Site: https://dom.barradocorda.ma.gov.br/
 *
 * React SPA requiring JavaScript rendering.
 * PDF pattern: /uploads/editions/13/{timestamp}_signature.pdf
 */
export interface PrefeiturabarradocordaConfig {
  type: "prefeiturabarradocorda";
  /** Base URL of the gazette page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Chapadinha spider
 * Maranhão state
 *
 * Site: https://chapadinha.ma.gov.br/transparencia/diario-oficial
 *
 * Custom platform with HTML table listing editions. Direct PDF links.
 */
export interface PrefeiturachapadinhaConfig {
  type: "prefeiturachapadinha";
  /** Base URL of the gazette page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Grajaú spider
 * Maranhão state
 *
 * Site: https://grajau.ma.gov.br/diario-oficial
 *
 * Workcenter SPA requiring JavaScript rendering.
 */
export interface PrefeituragrajauConfig {
  type: "prefeituragrajau";
  /** Base URL of the gazette page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Barreirinhas spider
 * Maranhão state
 *
 * Site: https://www.transparencia.barreirinhas.ma.gov.br/engine.php?class=diario_home
 *
 * WebService Sistemas (Adianti Framework) with SHA-1 authentication codes.
 * PDF hosted at transparencia.webservicesistemas.com.br
 */
export interface PrefeiturabarreirinhasConfig {
  type: "prefeiturabarreirinhas";
  /** Base URL of the gazette page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Santa Luzia spider
 * Maranhão state (not to be confused with Santa Luzia - MG)
 *
 * Site: https://santaluzia.ma.gov.br/edicoes
 *
 * Custom CMS with card-based edition listing.
 * PDF pattern: /upload/diario_oficial/{hash}.pdf
 */
export interface PrefeiturasantaluziamaConfig {
  type: "prefeiturasantaluziama";
  /** Base URL of the gazette page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Caxias spider
 * Maranhão state
 *
 * Site: https://caxias.ma.gov.br/dom/
 *
 * WordPress-based DOM archive with:
 * - Paginated edition listing at /dom/ and /dom/page/{n}/
 * - Date filters support
 * - Detail pages at /dom/{numero}-{ano}/ with PDF download links
 * - PDF hosted at /wp-content/uploads/dom-files/{ano}/dom_{id}_{x}.pdf
 */
export interface PrefeituracaxiasConfig {
  type: "prefeituracaxias";
  /** Base URL of the gazette page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Paço do Lumiar spider
 * Maranhão state
 *
 * Site: https://pacodolumiar.ma.gov.br/diariooficial/edicoes-anteriores
 *
 * Custom platform with:
 * - Table listing editions with columns: Edição Nº, Total de Páginas, Resumo, Data
 * - Each edition links to a detail page: /diariooficial/edicao/{numero}
 * - PDF download URL: /diariooficial/getFile/{numero}/{hash}?download=true
 * - Requires JavaScript to render content
 */
export interface PrefeiturapacodolumiarConfig {
  type: "prefeiturapacodolumiar";
  /** Base URL of the gazette page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/** Config for Prefeitura Porto Alegre - RS (DOPA) */
export interface PrefeituraportoalegreConfig {
  type: "prefeituraportoalegre";
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/** Config for Câmara Municipal de Cachoeirinha - RS (sistemalegislativo.com.br) */
export interface CamaraCachoerinhaConfig {
  type: "camaracachoeirinha";
  baseUrl: string;
  listingPath?: string;
}

/** Config for Prefeitura Caxias do Sul - RS (DOE) */
export interface PrefeituracaxiasdosulConfig {
  type: "prefeituracaxiasdosul";
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/** Config for Prefeitura Canoas - RS (DOM) */
export interface PrefeituracanoasConfig {
  type: "prefeituracanoas";
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/** Config for Prefeitura Pelotas - RS */
export interface PrefeiturapelotasConfig {
  type: "prefeiturapelotas";
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/** Config for Prefeitura Santa Maria - RS */
export interface PrefeiturasantamariaConfig {
  type: "prefeiturasantamaria";
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/** Config for Prefeitura Novo Hamburgo - RS (DOM) */
export interface PrefeituranovohamburgoConfig {
  type: "prefeituranovohamburgo";
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/** Config for Prefeitura São Leopoldo - RS */
export interface PrefeiturasaoleopoldoConfig {
  type: "prefeiturasaoleopoldo";
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/** Config for Prefeitura Passo Fundo - RS (GRP system with JSF/RichFaces) */
export interface PrefeiturapassofundoConfig {
  type: "prefeiturapassofundo";
  baseUrl: string;
  domUrl?: string;
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de João Pessoa spider
 * Paraíba state (Capital)
 *
 * Site: https://www.joaopessoa.pb.gov.br/doe-jp/
 *
 * WordPress-based DOE-JP (Diário Oficial Eletrônico) with:
 * - Paginated listing at /doe-jp/ and /doe-jp/page/{n}/
 * - Each edition links to a detail page: /doe-jp/edicao-{numero}-{ano}/
 * - Direct PDF links in listing: /wp-content/uploads/{ano}/{mes}/FILENAME.pdf
 * - 1234+ editions available
 */
export interface PrefeituraJoaoPessoaConfig {
  type: "prefeiturajoaopessoa";
  /** Base URL of the gazette page (e.g., "https://www.joaopessoa.pb.gov.br/doe-jp/") */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Bayeux spider
 * Paraíba state
 *
 * Site: https://bayeux.pb.gov.br/diario-oficial/
 *
 * WordPress-based gazette listing with:
 * - wp-pagenavi pagination
 * - Direct PDF links in /wp-content/uploads/
 * - Date format: "DD de MÊS de YYYY"
 */
export interface PrefeiturabayeuxConfig {
  type: "prefeiturabayeux";
  /** Base URL of the gazette page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Cajazeiras spider
 * Paraíba state
 *
 * Site: https://www.cajazeiras.pb.gov.br/diariooficial.php
 *
 * Ms Soluções platform with:
 * - Paginated edition listing (?pagina=N)
 * - 730+ editions in the archive
 * - PDF via /arquivos_download.php?id={ID}&pg=diariooficial
 */
export interface PrefeituracajazeirasConfig {
  type: "prefeituracajazeiras";
  /** Base URL of the gazette page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Guarabira spider
 * Paraíba state
 *
 * Site: https://guarabira.online/diariooficial
 *
 * GestorGBA platform with:
 * - Paginated edition listing (16/40/80 per page)
 * - 210+ pages of editions
 * - Direct PDF links in storage/diariooficial/
 * - Date filter support
 */
export interface PrefeituraguarabirapbConfig {
  type: "prefeituraguarabirapb";
  /** Base URL of the gazette page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Ms Soluções Platform Configuration
 *
 * Generic platform used by multiple municipalities (mostly in Paraíba and other NE states).
 * URL pattern: /diariooficial.php with pagination via ?pagina=N
 * PDF pattern: /arquivos_download.php?id={ID}&pg=diariooficial
 *
 * Examples:
 * - https://www.cajazeiras.pb.gov.br/diariooficial.php
 * - https://www.solanea.pb.gov.br/diariooficial.php
 * - https://www.alagoagrande.pb.gov.br/diariooficial.php
 */
export interface MsSolucoesConfig {
  type: "mssolucoes";
  /** Base URL of the gazette page (e.g., "https://www.solanea.pb.gov.br/diariooficial.php") */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Sousa spider
 * Paraíba state
 *
 * Site: https://www.sousa.pb.gov.br/jornais-oficiais.php
 *
 * Custom WordPress-based website with gazette listing.
 * Listing page shows editions with "Ler Mais" links to g.php?id=XXX
 * Detail pages have PDF embedded in iframe.
 * Pagination via ?pagina=N (1-based)
 */
export interface PrefeiturasousaConfig {
  type: "prefeiturasousa";
  /** Base URL of the gazette page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Queimadas - PB spider
 * Paraíba state
 *
 * Site: https://www.queimadas.pb.gov.br/publicacoes/mensario-oficial-do-municipio
 *
 * Laravel-based portal with gazette listing (Mensário Oficial do Município).
 * Listing page shows editions with date and title.
 * Detail pages have PDF links in /storage/content/publicacoes/ path.
 * Pagination via ?page=N (1-based)
 * Filters: ?ano={YYYY}&mes={MM}&texto={search}
 */
export interface PrefeituraQueimadasPBConfig {
  type: "prefeituraqueimadaspb";
  /** Base URL of the gazette page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de São Bento - PB spider
 * Paraíba state
 *
 * Site: https://transparencia.saobento.pb.gov.br/diario-oficial
 *
 * Laravel/Inertia.js portal with embedded JSON data.
 * PDFs served directly via /diario-oficial/{YYYY-MM-DD}
 * Filterable by year and month.
 */
export interface PrefeiturasaobentopbConfig {
  type: "prefeiturasaobentopb";
  /** Base URL of the gazette page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Lagoa Seca spider
 * Paraíba state - Boletim Oficial
 *
 * Site uses WordPress Download Manager (WPDM) plugin
 * - List page: https://lagoaseca.pb.gov.br/boletim-oficial/
 * - Pagination: ?cp=N
 * - Download links via data-downloadurl attribute
 */
export interface PrefeituraLagoaSecaConfig {
  type: "prefeituralagoaseca";
  /** Base URL of the gazette page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Presidente Dutra spider
 * Maranhão state
 *
 * Site: https://presidentedutra.ma.gov.br/transparencia/diario-oficial
 *
 * Custom website with table listing all gazette editions.
 * PDFs follow the pattern: /anexos/diarios/Diário_{DD-MM-YYYY}_PMPD_{HASH}.pdf
 * ISSN: 2965-4483
 */
export interface PrefeituraPresidenteDutraConfig {
  type: "prefeiturapresidentedutra";
  /** Base URL of the gazette page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Amarante do Maranhão spider
 * Maranhão state
 *
 * Site: https://www.amarante.ma.gov.br/edicoes
 *
 * Custom website with paginated list of gazette editions.
 * PDFs follow the pattern: /upload/diario_oficial/{HASH}.pdf
 * or /upload/diario_oficial/diario_ofical_YYYY-MM-DDHHMMSS.pdf
 * ISSN: 2764-6653
 */
export interface PrefeituraAmaranteConfig {
  type: "prefeituraamarante";
  /** Base URL of the gazette editions page */
  baseUrl: string;
  /** Maximum number of pages to scrape (default: all pages) */
  maxPages?: number;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Coelho Neto spider
 * Maranhão state
 *
 * Site: https://dom.coelhoneto.ma.gov.br/
 *
 * Custom website with paginated list of gazette editions.
 * PDFs follow the pattern: /DOM/DOM{YYYYMMDD}.pdf
 * Law: Lei N° 709/2018
 */
export interface PrefeituraCoelhoNetoConfig {
  type: "prefeituracoelhoneto";
  /** Base URL of the gazette page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * FAMEM (Federação dos Municípios do Estado do Maranhão) Configuration
 *
 * Consolidated official gazette for municipalities in Maranhão state.
 * Platform: Siganet (diariooficial.famem.org.br)
 *
 * Features:
 * - Consolidated PDF per day (all municipalities in one file)
 * - Publication search by keyword (municipality name)
 * - Digital certificate ICP-Brasil
 *
 * The spider searches for publications mentioning the municipality name
 * and extracts the consolidated gazette PDFs.
 */
export interface FamemConfig {
  type: "famem";
  /** Base URL of FAMEM gazette portal */
  baseUrl: string;
  /** Municipality name for filtering publications */
  cityName: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * DiariodoMunicipio.info Platform Configuration
 *
 * WordPress-based platform using WP File Download plugin for gazette listings.
 * Used by Alto Alegre do Pindaré - MA (diariodomunicipio.info)
 *
 * URL pattern: /download/{categoryId}/{categorySlug}/{fileId}/{filename}.pdf
 *
 * Features:
 * - WordPress pagination with /page/N
 * - PDFs organized in categories (Diários - Geral, Diários - CPL)
 * - Date extracted from filename (diario-de-{day}-de-{month})
 *
 * Example:
 * - https://diariodomunicipio.info/download/2/diarios-geral/1651/caderno-do-executivo-diario-de-12-de-fevereiro-d_caderno-do-executivo.pdf
 */
export interface DiariodomunicipioinfoConfig {
  type: "diariodomunicipioinfo";
  /** Base URL of the gazette listing page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Easyweb Portal Platform Configuration
 *
 * Generic platform used by municipalities with Easyweb CMS (e.g., Catolé do Rocha - PB).
 * URL pattern: /jornal-oficial/p16_sectionid/{sectionId}
 * PDF pattern: /images/arquivos/documentos/{timestamp}.pdf
 *
 * Features:
 * - Section-based year organization (DOM 2021, DOM 2022, etc.)
 * - Direct PDF links on the homepage
 * - Pagination via p16_start parameter
 *
 * Example:
 * - https://catoledorocha.pb.gov.br/jornal-oficial/p16_sectionid/39
 */
export interface EasywebPortalConfig {
  type: "easywebportal";
  /** Base URL of the gazette listing page */
  baseUrl: string;
  /** Section ID for the journal (default: 39) */
  sectionId?: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Pedras de Fogo - PB spider
 * Paraíba state
 *
 * Site: https://pedrasdefogo.pb.gov.br/transparencia-inicio/semanario
 *
 * Custom portal with Semanário Oficial listing (Semanário Oficial).
 * Listing page shows editions with date and title in a table.
 * PDFs are directly linked via download buttons.
 * Pagination via ?page=N (1-based)
 * 459 editions across 39 pages as of January 2026
 */
export interface PrefeiturapedrasdefogoConfig {
  type: "prefeiturapedrasdefogo";
  /** Base URL of the gazette page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Diario IO (IMAP) platform spiders
 *
 * Platform: diario.io.org.br
 * Used by municipalities in Alagoas (AL) and other states
 * Examples:
 *   - Palmeira dos Índios: https://diario.io.org.br/11052
 *   - Penedo: https://diario.io.org.br/11064
 *
 * This is an Angular SPA that requires browser rendering.
 */
export interface DiarioIOConfig {
  type: "diarioio";
  /** Client ID for the municipality (e.g., "11052") */
  clientId: string;
  /** City name for display purposes */
  cityName: string;
  /** Whether the site requires client-side JavaScript rendering (always true for this platform) */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Diário Municipal AL WordPress spiders
 *
 * Platform: diariomunicipal-al.com.br
 * Used by municipalities in Alagoas (AL)
 * Example: https://www.diariomunicipal-al.com.br/uniao/
 *
 * WordPress-based gazette portal with paginated blog posts.
 */
export interface DiarioMunicipalALWordpressConfig {
  type: "diariomunicipalalwordpress";
  /** Base URL for the gazette portal (e.g., "https://www.diariomunicipal-al.com.br/uniao/") */
  baseUrl: string;
  /** City name for display purposes */
  cityName: string;
}

/**
 * Configuration for Kalana platform spiders
 *
 * Platform: app.kalana.com.br
 * Used by municipalities in Alagoas (AL) and other states
 * Example: https://app.kalana.com.br/?c=12264222000109&r=diariooficial&u=0000
 *
 * React SPA that requires browser rendering.
 */
export interface KalanaConfig {
  type: "kalana";
  /** CNPJ of the municipality (used as client identifier) */
  cnpj: string;
  /** City name for display purposes */
  cityName: string;
  /** Whether the site requires client-side JavaScript rendering (always true for this platform) */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura Coruripe spider
 *
 * Site structure:
 * - Base URL: https://diario.coruripe.al.gov.br/
 * - PDF Download: https://diario.coruripe.al.gov.br/diarios/{id}/download
 * - Titles: "Diário Oficial nº {edition}/{year}"
 * - Dates: "Publicado no dia DD/MM/YYYY"
 */
export interface PrefeituraCoruripeeConfig {
  type: "prefeituracoruripe";
  /** Base URL for the Prefeitura Coruripe diário oficial */
  baseUrl: string;
  /** City name for display */
  cityName?: string;
}

/**
 * Configuration for IOSE (Imprensa Oficial de Sergipe) spider
 *
 * Site structure:
 * - Base URL: https://iose.se.gov.br/{entitySlug}/
 * - Download: https://iose.se.gov.br/{entitySlug}/portal/edicoes/download/{id}
 * - Search by date or name
 * - Editions dropdown for selection
 *
 * Requires browser rendering due to JavaScript-dependent content loading
 */
export interface IOSEConfig {
  type: "iose";
  /** Entity slug as used in the URL (e.g., "prefeitura-sao-cristovao") */
  entitySlug: string;
  /** City name for display purposes */
  cityName: string;
  /** Whether the site requires client-side JavaScript rendering (always true for this platform) */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Prefeitura de Aracaju spider
 *
 * Site structure:
 * - Base URL: http://sga.aracaju.se.gov.br:5011/legislacao/faces/diario_form_pesq.jsp
 * - Legacy JSP system with form-based search
 * - Search by month/year or edition number
 * - Session-based navigation
 *
 * Requires browser rendering due to legacy JSP session requirements
 */
export interface PrefeituraAracajuConfig {
  type: "prefeituaraaracaju";
  /** Base URL for the Prefeitura Aracaju diário oficial */
  baseUrl: string;
  /** City name for display purposes */
  cityName?: string;
  /** Whether the site requires client-side JavaScript rendering (always true for this platform) */
  requiresClientRendering?: boolean;
}

/**
 * Configuration for Ágape Sistemas platform spiders
 *
 * This platform is used by municipalities for publishing official gazettes.
 * URL pattern: https://agportal.agapesistemas.com.br/DiarioOficial/?alias={alias}
 *
 * Features:
 * - JSF-based application with AJAX form submission
 * - Search by date range
 * - PDF download via form POST
 * - Multiple entities per municipality (Prefeitura, Fundo de Saúde, etc.)
 */
export interface AgapeConfig {
  type: "agape";
  /** Alias used in the URL (e.g., "pmportofolha") */
  alias: string;
  /** City name for display purposes */
  cityName?: string;
  /** Entity ID to filter (optional, defaults to all entities) */
  entityId?: string;
}

/**
 * Configuration for DOM WordPress platform spiders
 *
 * Platform: WordPress with custom "portaldatransparencia2020" theme
 *
 * Used by: Urbano Santos-MA (dom.urbanosantos.ma.gov.br)
 *
 * API endpoint: /wp-json/wp/v2/diarios?post_type=diariooficial
 *
 * The API returns a JSON object with a "data" array containing gazette items.
 * Each item has:
 * - numero_diario: Edition number (e.g., "Volume VII - Nº 577/2024")
 * - data_publicacao: Date in DD/MM/YYYY format
 * - origem_diario: Source (e.g., "Poder Executivo")
 * - baixar: HTML with download link containing PDF URL in onclick handler
 */
export interface DOMWordPressConfig {
  type: "domwordpress";
  /** Base URL of the gazette portal (e.g., "https://dom.urbanosantos.ma.gov.br") */
  baseUrl: string;
}

/**
 * Configuration for Prefeitura de Macapá spider
 *
 * Site structure:
 * - Base URL: https://macapa.ap.gov.br/diarios-oficiais/
 * - PDF pattern: https://macapa.ap.gov.br/portal/wp-content/uploads/{year}/{month}/Diario-Oficial-{number}-{date}.pdf
 * - Table with editions, dates, and download links
 * - Filter by month/year
 */
export interface PrefeituramacapaConfig {
  type: "prefeituramacapa";
  /** Base URL for the gazette page */
  baseUrl: string;
  /** City name for display purposes */
  cityName?: string;
}

/**
 * Configuration for Prefeitura de Santana-AP spider
 *
 * Site structure:
 * - Base URL: https://santana.ap.gov.br/diario-oficial/
 * - API endpoint: /wp-admin/admin-ajax.php?action=datatables_endpoint
 * - Returns JSON with gazette data including PDF URLs
 * - Uses DataTables for rendering
 */
export interface PrefeiturasantanaapConfig {
  type: "prefeiturasantanaap";
  /** Base URL for the gazette page */
  baseUrl: string;
  /** City name for display purposes */
  cityName?: string;
}

/**
 * Configuration for Prefeitura de Laranjal do Jari spider
 *
 * Site structure:
 * - Base URL: https://laranjaldojari.ap.gov.br/diario-oficial/
 * - Calendar-based listing with direct PDF links
 * - Filter by year/month via query params (?ano=YYYY&mes=MM)
 * - PDF pattern: /diario-oficial/wp-content/uploads/{year}/{month}/No{number}-{date}-DIARIO-OFICIAL.pdf
 */
export interface PrefeituralaranjaldojariConfig {
  type: "prefeituralaranjaldojari";
  /** Base URL for the gazette page */
  baseUrl: string;
  /** City name for display purposes */
  cityName?: string;
}

export interface PrefeituratoledoConfig {
  type: "prefeituratoledo";
  baseUrl: string;
}

export interface PrefeituracambeConfig {
  type: "prefeituracambe";
  baseUrl: string;
}

export interface PrefeiturafranciscobeltraoConfig {
  type: "prefeiturafranciscobeltrao";
  baseUrl: string;
}

export interface IngaDigitalConfig {
  type: "ingadigital";
  /** Client ID on the Inga Digital platform (id_cliente param) */
  idCliente: string;
  /** Session token for ingadigital.com.br (sessao param) */
  sessao?: string;
}
