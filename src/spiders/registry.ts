import { SpiderConfig, SpiderType, DateRange } from "../types";
import {
  AgapeSpider,
  BaseSpider,
  DoemSpider,
  InstarSpider,
  DospSpider,
  DiofSpider,
  ADiariosV1Spider,
  SigpubSpider,
  SigpubSeSpider,
  SigpubMtSpider,
  SigpubPaSpider,
  AgmSpider,
  GoianesiaSpider,
  PlanaltinaGoSpider,
  CristalinaGoSpider,
  SantoAntonioDescobertoGoSpider,
  CamaraManausSpider,
  DomManausSpider,
  BarcoDigitalSpider,
  SiganetSpider,
  DiarioOficialMunicipalSpider,
  RondoniaSpider,
  AcreSpider,
  EspiritoSantoSpider,
  DODFSpider,
  DomeletronicSpider,
  DomunicipalSpider,
  ImprensaOficialJundiaiSpider,
  PrefeituraRioPretoSpider,
  PrefeituraItirapuaSpider,
  PrefeituraNovaOdessaSpider,
  PrefeituraMogiDasCruzesSpider,
  PrefeituraSaoJoaoDaBoaVistaSpider,
  PrefeituraBoaVistaSpider,
  PrefeituraBatataisSpider,
  PrefeituraCajamarSpider,
  PrefeituraCosmopolisSpider,
  PrefeituraCotiaSpider,
  PrefeituraGuarulhosSpider,
  PrefeituraItatibaSpider,
  PrefeituraMairiporaSpider,
  PrefeituraNarandibaSpider,
  PrefeituraPirajuSpider,
  SupernovaSpider,
  PrefeituraItaquaquecetubaSpider,
  EatosSpider,
  PrefeituraPiracicabaSpider,
  PrefeituraBauruSpider,
  PrefeiturabentogoncalvesSpider,
  DiarioMunicipioSJCSpider,
  GazetaMunicipalSpider,
  DiarioOficialGuarantadonorteSpider,
  DiarioOficialCaldasnovasSpider,
  DiarioOficialMSSpider,
  PrefeituraCampoGrandeSpider,
  PrefeituraDouradosSpider,
  PrefeituraPontaPoraSpider,
  PrefeituraNovaAndradinaSpider,
  PrefeituraAquidauanaSpider,
  PrefeiturasantoandreSpider,
  PrefeituramauaSpider,
  PrefeituradiademaSpider,
  PrefeituracarapicuibaSpider,
  PrefeituraSorocabaSpider,
  EcrieSpider,
  EcrieDiarioOficialSpider,
  PrefeituraSerranegraSpider,
  PrefeituraIbiunaSpider,
  PrefeituraFrancoDaRochaSpider,
  PrefeituraAlvaresMachadoSpider,
  PrefeituraSerranaSpider,
  PrefeituracamposdojordaoSpider,
  PrefeituraCapaoBonitoSpider,
  PrefeituraJauSpider,
  PrefeituraMogiMirimSpider,
  PrefeituraTatuiSpider,
  PrefeituraLemeSpider,
  PrefeituracaieirasSpider,
  PrefeiturasocorroSpider,
  PrefeituraCapivariSpider,
  PrefeituratieteeSpider,
  PrefeiturapirasSunungaSpider,
  PrefeituraPeruibeSpider,
  PrefeituraBertiogaSpider,
  PrefeituraItanhaemSpider,
  PrefeituraCaraguatatubaSpider,
  PrefeituracubataoSpider,
  PrefeiturasaocaetanodosulSpider,
  GovbrDioenetSpider,
  PrefeiturasuzanoSpider,
  PrefeituraDescalvadoSpider,
  PrefeituraBarueriSpider,
  PrefeituraSumareSpider,
  PrefeiturasaocarlosSpider,
  PrefeituraIndaiatubaSpider,
  PrefeituraFerrazDeVasconcelosSpider,
  PortalComunicacaoSpider,
  PrefeituraIlhaSolteiraSpider,
  PrefeiturasaosebastiaoeSpider,
  MentorSpider,
  PrefeituraBeloHorizonteSpider,
  PrefeiturabetimSpider,
  PrefeituraJuizDeForaSpider,
  PrefeituramontesclarosSpider,
  PrefeiturauberlandiaSpider,
  PrefeituraIpatingaSpider,
  PrefeituraGovernadorValadaresSpider,
  PrefeiturasantaluziamgSpider,
  PrefeiturauberabaSpider,
  PrefeiturapocosdecaldasSpider,
  PrefeiturabarbacenaSpider,
  PrefeituraAraguariSpider,
  PrefeituraCoronelFabricianoSpider,
  PrefeituraAraxaSpider,
  PrefeituraLavrasSpider,
  PrefeituraNovaLimaSpider,
  PrefeituraItaunaSpider,
  PrefeituraUbaSpider,
  PrefeituraItuiutabaSpider,
  PrefeituraParademinasSpider,
  PrefeituraSaoJoaoDelReiSpider,
  PrefeituraPatrocinioSpider,
  PrefeituraCaratingaSpider,
  PrefeituraBomDespachoSpider,
  PrefeituraUnaiSpider,
  PrefeituraTimoteoSpider,
  PrefeituraItajubaSpider,
  PrefeituraManhuacuSpider,
  PrefeituraAlfenasSpider,
  PrefeituraAlfenasAtosOficiaisSpider,
  PrefeituraVicosaSpider,
  PrefeituraOuroPretoSpider,
  PrefeituraJanaubaSpider,
  PrefeituraJanaubaPublicacoesSpider,
  PrefeituraMarianaSpider,
  PrefeituraCataguasesSpider,
  PrefeituraFrutalSpider,
  PrefeituraExtremaSpider,
  PrefeituraCongonhasSpider,
  PrefeituraBaraoDeCocaisSpider,
  PrefeituraConceicaoDasAlagoasConcursosSpider,
  PrefeituraConceicaoDasAlagoasAtosSpider,
  SimpleSSSpider,
  PortalfacilSpider,
  FolhadesabaraSpider,
  PrefeiturasabaraSpider,
  PrefeituraAlegreSpider,
  PrefeituraVitoriaSpider,
  PrefeituraCariacicaSpider,
  PrefeituraLinharesSpider,
  PrefeituraCasteloSpider,
  PrefeituraGuacuiSpider,
  PrefeituraVilaVelhaSpider,
  PrefeituraCachoeiroSpider,
  PrefeituraSerraSpider,
  PrefeituraMarataizesSpider,
  PrefeituraNiteroiSpider,
  PrefeituraRioDeJaneiroSpider,
  PrefeituraSaoGoncaloSpider,
  PrefeituraDuqueDeCaxiasSpider,
  PrefeituraCamposDosGoytacazesSpider,
  PrefeituraVoltaRedondaSpider,
  PrefeituraMacaeSpider,
  PrefeituraMageSpider,
  PrefeituraItaboraiSpider,
  PrefeituraCaboFrioSpider,
  PrefeituraMaricaSpider,
  PrefeituraNovaFriburgoSpider,
  DomWebSpider,
  PrefeituraBarraMansaSpider,
  PrefeituraAngraDosReisSpider,
  PrefeituraMesquitaSpider,
  PrefeituraTeresopolisSpider,
  PrefeituraRjOdasOstrasSpider,
  PrefeituraNilopolisSpider,
  PrefeituraQueimadosSpider,
  PrefeituraRjAraruamaSpider,
  PrefeituraRjResendeSpider,
  PrefeituraRjItaguaiSpider,
  PrefeituraRjSaoPedroDaAldeiaSpider,
  PrefeituraRjItaperunaSpider,
  PrefeituraRjJaperiSpider,
  PrefeituraRjBarraDoPixaiSpider,
  PrefeituraRjBarraDoPiraiSpider,
  PrefeituraRjSaquaremaSpider,
  PrefeituraRjSeropedicaSpider,
  PrefeituraRjTresRiosSpider,
  PrefeituraRjValencaSpider,
  PrefeituraRjCachoeirasDeMacacuSpider,
  PrefeituraRjRioBonitoSpider,
  PrefeituraRjGuapimirimSpider,
  PrefeituraRjCasimiroDeAbreuSpider,
  PrefeituraRjParatySpider,
  PrefeituraRjSaoFranciscoDeItabapoanaSpider,
  PrefeituraRjParaibaDoSulSpider,
  PrefeituraRjParaibaDoSulV2Spider,
  PrefeituraRjParacambiSpider,
  PrefeituraRjParacambiV2Spider,
  PrefeituraRjSantoAntonioDePaduaSpider,
  PrefeituraRjMangaratibaSpider,
  PrefeituraRjArmacaoDosBuziosSpider,
  PrefeituraRjSaoFidelisSpider,
  PrefeituraRjSaoJoaoDaBarraSpider,
  PrefeituraRjBomJesusDoItabapoanaSpider,
  PrefeituraRjVassourasSpider,
  PrefeituraRjTanguaSpider,
  PrefeituraRjArraialDoCaboSpider,
  PrefeituraRjPatyDoAlferesSpider,
  PrefeituraRjBomJardimSpider,
  PrefeituraRjIguabaGrandeSpider,
  PrefeituraRjMiracemaSpider,
  PrefeituraRjMiguelPereiraSpider,
  PrefeituraRjPiraiSpider,
} from "./base";
import { PrefeituracuritibaSpider } from "./base/prefeituracuritiba-spider";
import { PrefeituralondrinaSpider } from "./base/prefeituralondrina-spider";
import { PrefeiturapontagrossaSpider } from "./base/prefeiturapontagrossa-spider";
import { PrefeituramaringaSpider } from "./base/prefeituramaringa-spider";
import { PrefeituracascavelSpider } from "./base/prefeituracascavel-spider";
import { PrefeiturasjpSpider } from "./base/prefeiturasjp-spider";
import { PrefeiturafozSpider } from "./base/prefeiturafoz-spider";
import { PrefeituraguarapuavaSpider } from "./base/prefeituraguarapuava-spider";
import { PrefeituraraucariaSpider } from "./base/prefeituraraucaria-spider";
import { DiarioOficialBRSpider } from "./base/diario-oficial-br-spider";
import { ModernizacaoSpider } from "./base/modernizacao-spider";
import { InstarPortalSpider } from "./base/instar-portal-spider";
import { DiarioParauapebasPaSpider } from "./base/diario-parauapebas-pa-spider";
import { DocCastanhalSpider } from "./base/doc-castanhal-spider";
import { ADiariosV2Spider } from "./base/adiarios-v2-spider";
import { AplusSpider } from "./base/aplus-spider";
import { DioenetSpider } from "./base/dioenet-spider";
import { PlenusDioenetSpider } from "./base/plenus-dioenet-spider";
import { AdministracaoPublicaSpider } from "./base/administracao-publica-spider";
import { PtioSpider } from "./base/ptio-spider";
import { IndapSpider } from "./base/indap-spider";
import { ImpublicacoesSpider } from "./base/impublicacoes-spider";
import { InstitutoPublicacoesSpider } from "./base/institutopublicacoes-spider";
import { AirdocSpider } from "./base/airdoc-spider";
import { PrefeituraAnageSpider } from "./base/prefeituraanage-spider";
import { PrefeituraRecifeSpider } from "./base/prefeiturarecife-spider";
import { PrefeituraJaboataoSpider } from "./base/prefeiturajaboatao-spider";
import { PrefeituraCaruaruSpider } from "./base/prefeituracaruaru-spider";
import { PrefeiturasantacruzdocapibaribeSpider } from "./base/prefeiturasantacruzdocapibaribe-spider";
import { PrefeituracamaragibeSpider } from "./base/prefeituracamaragibe-spider";
import { PrefeiturareTeresinhaSpider } from "./base/prefeiturateresina-spider";
import { PrefeituraParnaraibaSpider } from "./base/prefeiturapnarnaiba-spider";
import { DiarioOficialDasPrefeiturasSpider } from "./base/diariooficialdasprefeituras-spider";
import { DiarioOficialDosMunicipiosAPPMSpider } from "./base/diarioficialdosmunicipiosappm-spider";
import { PrefeituraAraripinaSpider } from "./base/prefeituraaraipina-spider";
import { PrefeituraBezerrosSpider } from "./base/prefeiturabezerros-spider";
import { SoftagonSpider } from "./base/softagon-spider";
import { DirectusPortalSpider } from "./base/directus-portal-spider";
import { SogoTecnologiaSpider } from "./base/sogotecnologia-spider";
import { PrefeituraImperatrizSpider } from "./base/prefeituraimperatriz-spider";
import { PrefeturaSaoLuisSpider } from "./base/prefeiturasaoluis-spider";
import { PrefeituraNatalSpider } from "./base/prefeituranatal-spider";
import { PrefeituraMossoroSpider } from "./base/prefeituramossoro-spider";
import { PrefeituraSaoGoncaloRNSpider } from "./base/prefeiturasaogoncalorn-spider";
import { PrefeituraMacaibaSpider } from "./base/prefeituramacaiba-spider";
import { PrefeituraAssuSpider } from "./base/prefeituraassu-spider";
import { PrefeituraParnamirimSpider } from "./base/prefeituraparnamirim-spider";
import { PrefeituramacaurnSpider } from "./base/prefeituramacaurn-spider";
import { PrefeituraVilhenaSpider } from "./base/prefeituravilhena-spider";
import { PrefeiturasantainesSpider } from "./base/prefeiturasantaines-spider";
import { PrefeiturapinheiroSpider } from "./base/prefeiturapinheiro-spider";
import { PrefeiturabarradocordaSpider } from "./base/prefeiturabarradocorda-spider";
import { PrefeiturachapadinhaSpider } from "./base/prefeiturachapadinha-spider";
import { PrefeituragrajauSpider } from "./base/prefeituragrajau-spider";
import { PrefeiturabarreirinhasSpider } from "./base/prefeiturabarreirinhas-spider";
import { PrefeiturasantaluziamaSpider } from "./base/prefeiturasantaluziama-spider";
import { PrefeituracaxiasSpider } from "./base/prefeituracaxias-spider";
import { PrefeiturapacodolumiarSpider } from "./base/prefeiturapacodolumiar-spider";
import { PrefeituraportoalegreSpider } from "./base/prefeituraportoalegre-spider";
import { PrefeituracaxiasdosulSpider } from "./base/prefeituracaxiasdosul-spider";
import { PrefeituracanoasSpider } from "./base/prefeituracanoas-spider";
import { PrefeiturapelotasSpider } from "./base/prefeiturapelotas-spider";
import { PrefeiturasantamariaSpider } from "./base/prefeiturasantamaria-spider";
import { PrefeituranovohamburgoSpider } from "./base/prefeituranovohamburgo-spider";
import { PrefeiturasaoleopoldoSpider } from "./base/prefeiturasaoleopoldo-spider";
import { PrefeiturapassofundoSpider } from "./base/prefeiturapassofundo-spider";
import { PrefeituraTimonSpider } from "./base/prefeituratimon-spider";
import { PrefeiturabacabalSpider } from "./base/prefeiturabacabal-spider";
import { PrefeituraJoaoPessoaSpider } from "./base/prefeiturajoaopessoa-spider";
import { PrefeiturabayeuxSpider } from "./base/prefeiturabayeux-spider";
import { PrefeituracajazeirasSpider } from "./base/prefeituracajazeiras-spider";
import { PrefeituraguarabirapbSpider } from "./base/prefeituraguarabirapb-spider";
import { MsSolucoesSpider } from "./base/mssolucoes-spider";
import { PrefeiturasousaSpider } from "./base/prefeiturasousa-spider";
import { PrefeituraQueimadasPBSpider } from "./base/prefeituraqueimadaspb-spider";
import { PrefeiturapedrasdefogoSpider } from "./base/prefeiturapedrasdefogo-spider";
import { PrefeiturasaobentopbSpider } from "./base/prefeiturasaobentopb-spider";
import { PrefeituraLagoaSecaSpider } from "./base/prefeituralagoaseca-spider";
import { PrefeituraPresidenteDutraSpider } from "./base/prefeiturapresidentedutra-spider";
import { PrefeituraAmaranteSpider } from "./base/prefeituraamarante-spider";
import { PrefeituraCoelhoNetoSpider } from "./base/prefeituracoelhoneto-spider";
import { EasywebPortalSpider } from "./base/easywebportal-spider";
import { PrefeituramacapaSpider } from "./base/prefeituramacapa-spider";
import { PrefeiturasantanaapSpider } from "./base/prefeiturasantanaap-spider";
import { PrefeituralaranjaldojariSpider } from "./base/prefeituralaranjaldojari-spider";
import { DiagramacaoSpider } from "./base/diagramacao-spider";
import { PrefeiturapalmastSpider } from "./base/prefeiturapalmas-spider";
import { PrefeituragurupiSpider } from "./base/prefeituragurupi-spider";
import { NucleogovSpider } from "./base/nucleogov-spider";
import { PrefeituraaraguainaSpider } from "./base/prefeituraaraguaina-spider";
import { PrefeituraportonacionalSpider } from "./base/prefeituraportonacional-spider";
import { PrefeiturarondonopolisSpider } from "./base/prefeiturarondonopolis-spider";
import { PrefeituragoianiaSpider } from "./base/prefeituragoiania-spider";
import { PrefeituraJataiSpider } from "./base/prefeiturajatai-spider";
import { PrefeituraprimaveradolesteSpider } from "./base/prefeituraprimaveradoleste-spider";
import { PrefeituraNovoGamaSpider } from "./base/prefeitura-novogama-spider";
import { SantaHelenaGoSpider } from "./base/santa-helena-go-spider";
import { PrefeituraJaraguaSpider } from "./base/prefeiturajaragua-spider";
import { MorrinhosGoSpider } from "./base/morrinhos-go-spider";
import { MunicipioOnlineSpider } from "./base/municipio-online-spider";
import { TresTecnosSpider } from "./base/trestecnos-spider";
import { AtendeV2Spider } from "./base/atende-v2-spider";
import { DomScSpider } from "./base/dom-sc-spider";
import { DomScEdicaoSpider } from "./base/dom-sc-edicao-spider";
import { PrefeituraAltamiraSpider } from "./base/prefeituraaltamira-spider";
import { PrefeituraPaPublicacoesSpider } from "./base/prefeitura-pa-publicacoes-spider";
import { PrefeituraUlianopolisSpider } from "./base/prefeituraulianopolis-spider";
import { PrefeituraSantanaAraguaiaSpider } from "./base/prefeituasantanaaraguaia-spider";
import { PrefeituraSaodomingosdocapimSpider } from "./base/prefeitura-saodomingosdocapim-spider";
import { PortalCr2Spider } from "./base/portalcr2-spider";
import { PortalCr2CoSpider } from "./base/portalcr2co-spider";
import { PrefeituraBelemSpider } from "./base/prefeiturabeelem-spider";
import { PrefeituraAnanindeuaSpider } from "./base/prefeituraananindeua-spider";
import { PrefeituracametaSpider } from "./base/prefeituracameta-spider";
import { PrefeituraJoinvilleScSpider } from "./base/prefeitura-joinville-sc-spider";
import { PrefeituraScSpider } from "./base/prefeitura-sc-spider";
import { DiarioBaSpider } from "./base/diario-ba-spider";
import { AmmMtSpider } from "./base/amm-mt-spider";
import { FamemSpider } from "./base/famem-spider";
import { DiariodomunicipioinfoSpider } from "./base/diariodomunicipioinfo-spider";
import { AmunesSpider } from "./base/amunes-spider";
import { AemerjSpider } from "./base/aemerj-spider";
import { ApreceSpider } from "./base/aprece-spider";
import { PrefeituraRjMangaratibaV2Spider } from "./base/prefeiturarjmangaratiba-v2-spider";
import { PrefeituraRjSaoFidelisV2Spider } from "./base/prefeiturarjsaofidelisv2-spider";
import { PrefeituraRjSaoJoaoDaBarraV2Spider } from "./base/prefeiturarjsaojoaodabarra-v2-spider";
import { PrefeituraRjBomJesusSpider } from "./base/prefeiturarjbomjesus-spider";
import { PrefeituraRjArraialDoCaboV2Spider } from "./base/prefeiturarjarraialdocabov2-spider";
import { PrefeituraRjItatiaiaSpider } from "./base/prefeiturarjitatiaia-spider";
import { DiarioOficialOnlineSpider } from "./base/diario-oficial-online-spider";
import { PrefeituraCESpider } from "./base/prefeiturace-spider";
import { AssesiSpider } from "./base/assesi-spider";
import { ProcedeSpider } from "./base/procede-spider";
import { DomunicipioSpider } from "./base/domunicipio-spider";
import { PortalIopSpider } from "./base/portaliop-spider";
import { PrefeituraJuazeiroDoNorteSpider } from "./base/prefeiturajuazeirodonorte-spider";
import { PrefeituraSobralSpider } from "./base/prefeiturasobral-spider";
import { PrefeituraCratoSpider } from "./base/prefeitura-crato-spider";
import { PrefeituraItapipocaSpider } from "./base/prefeituraitapipoca-spider";
import { PlugTecnologiaSpider } from "./base/plugtecnologia-spider";
import { WordPressPublicacoesSpider } from "./base/wordpress-publicacoes-spider";
import { PortalGovSpider } from "./base/portalgov-spider";
import { ImprensaOficialSpider } from "./base/imprensaoficial-spider";
import { TransparenciaOficialBaSpider } from "./base/transparenciaoficialba-spider";
import { PrefeituraIreceSpider } from "./base/prefeiturairece-spider";
import { IbdmTransparenciaSpider } from "./base/ibdmtransparencia-spider";
import doemCitiesConfig from "./configs/doem-cities.json";
import diarioBaCitiesConfig from "./configs/diario-ba-cities.json";
import ammMtCitiesConfig from "./configs/amm-mt-cities.json";
import instarCitiesConfig from "./configs/instar-cities.json";
import dospCitiesConfig from "./configs/dosp-cities.json";
import diofCitiesConfig from "./configs/diof-cities.json";
import adiariosV1CitiesConfig from "./configs/adiarios-v1-cities.json";
import barcoDigitalCitiesConfig from "./configs/barco_digital_cities.json";
import siganetCitiesConfig from "./configs/siganet_cities.json";
import diarioOficialBRCitiesConfig from "./configs/diario-oficial-br-cities.json";
import modernizacaoCitiesConfig from "./configs/modernizacao-cities.json";
import adiariosV2CitiesConfig from "./configs/adiarios-v2-cities.json";
import aplusCitiesConfig from "./configs/aplus-cities.json";
import dioenetCitiesConfig from "./configs/dioenet-cities.json";
import administracaoPublicaCitiesConfig from "./configs/administracao-publica-cities.json";
import ptioCitiesConfig from "./configs/ptio-cities.json";
import municipioOnlineCitiesConfig from "./configs/municipio-online-cities.json";
import atendeV2CitiesConfig from "./configs/atende-v2-cities.json";
import domScCitiesConfig from "./configs/dom-sc-cities.json";
import sigpubCitiesConfig from "./configs/sigpub-cities.json";
import doeSpCitiesConfig from "./configs/doe-sp-cities.json";
import rondoniaCitiesConfig from "./configs/rondonia-cities.json";
import acreCitiesConfig from "./configs/acre-cities.json";
import espiritoSantoCitiesConfig from "./configs/espirito-santo-cities.json";
import domunicipalCitiesConfig from "./configs/domunicipal-cities.json";

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

    // Load DOMunicipal cities
    for (const config of domunicipalCitiesConfig as SpiderConfig[]) {
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
      (config) => config.spiderType === spiderType,
    );
  }

  /**
   * Creates a spider instance from configuration
   */
  createSpider(
    config: SpiderConfig,
    dateRange: DateRange,
    browser?: Fetcher,
  ): BaseSpider {
    switch (config.spiderType) {
      case "agape":
        return new AgapeSpider(config, dateRange);

      case "doem":
        return new DoemSpider(config, dateRange);

      case "adiarios_v1":
        return new ADiariosV1Spider(config, dateRange);

      case "adiarios_v2":
        const spider = new ADiariosV2Spider(config, dateRange);
        if (browser) {
          spider.setBrowser(browser);
        }
        return spider;

      case "instar":
        const instarSpider = new InstarSpider(config, dateRange, browser);
        return instarSpider;

      case "instar_portal":
        const instarPortalSpider = new InstarPortalSpider(
          config,
          dateRange,
          browser,
        );
        return instarPortalSpider;

      case "diario_parauapebas_pa":
        return new DiarioParauapebasPaSpider(config, dateRange, browser);

      case "doc_castanhal":
        return new DocCastanhalSpider(config, dateRange);

      case "mentor":
        const mentorSpider = new MentorSpider(config, dateRange, browser);
        return mentorSpider;

      case "dosp":
        return new DospSpider(config, dateRange);

      case "diof":
        return new DiofSpider(config, dateRange);

      case "sigpub":
        return new SigpubSpider(config, dateRange);

      case "camaramanaus": {
        const camaramanausSpider = new CamaraManausSpider(config, dateRange);
        if (browser) {
          camaramanausSpider.setBrowser(browser);
        }
        return camaramanausSpider;
      }

      case "dommanaus": {
        const dommanausSpider = new DomManausSpider(config, dateRange);
        if (browser) {
          dommanausSpider.setBrowser(browser);
        }
        return dommanausSpider;
      }

      case "sigpub_se":
        return new SigpubSeSpider(config, dateRange);

      case "sigpub_mt":
        return new SigpubMtSpider(config, dateRange);

      case "sigpub_pa":
        return new SigpubPaSpider(config, dateRange);

      case "agm":
        return new AgmSpider(config, dateRange);

      case "goianesia":
        return new GoianesiaSpider(config, dateRange);

      case "planaltina_go":
        return new PlanaltinaGoSpider(config, dateRange);

      case "cristalina_go":
        return new CristalinaGoSpider(config, dateRange);

      case "santo_antonio_descoberto_go":
        return new SantoAntonioDescobertoGoSpider(config, dateRange);

      case "barco_digital":
        return new BarcoDigitalSpider(config, dateRange);

      case "siganet":
        return new SiganetSpider(config, dateRange);

      case "diariooficialmunicipal":
        return new DiarioOficialMunicipalSpider(config, dateRange);

      case "famem":
        const famemSpider = new FamemSpider(config, dateRange);
        if (browser) {
          famemSpider.setBrowser(browser);
        }
        return famemSpider;

      case "diariodomunicipioinfo":
        return new DiariodomunicipioinfoSpider(config, dateRange);

      case "diario_oficial_br":
        return new DiarioOficialBRSpider(config, dateRange);

      case "modernizacao":
        return new ModernizacaoSpider(config, dateRange);

      case "aplus":
        return new AplusSpider(config, dateRange);

      case "dioenet":
        return new DioenetSpider(config, dateRange);

      case "plenus_dioenet":
        return new PlenusDioenetSpider(config, dateRange);

      case "administracao_publica":
        return new AdministracaoPublicaSpider(config, dateRange);

      case "ptio":
        return new PtioSpider(config, dateRange);

      case "indap":
        const indapSpider = new IndapSpider(config, dateRange);
        if (browser) {
          indapSpider.setBrowser(browser);
        }
        return indapSpider;

      case "municipio_online":
        return new MunicipioOnlineSpider(config, dateRange);

      case "3tecnos":
        const tresTecnosSpider = new TresTecnosSpider(config, dateRange);
        if (browser) {
          tresTecnosSpider.setBrowser(browser);
        }
        return tresTecnosSpider;

      case "atende_v2":
        return new AtendeV2Spider(config, dateRange);

      case "dom_sc":
        return new DomScSpider(config, dateRange);

      case "dom_sc_edicao":
        return new DomScEdicaoSpider(config, dateRange);

      case "prefeituraananindeua":
        return new PrefeituraAnanindeuaSpider(config, dateRange);
      case "prefeituracameta":
        return new PrefeituracametaSpider(config, dateRange);
      case "prefeiturabeelem":
        const belemSpider = new PrefeituraBelemSpider(
          config,
          dateRange,
          browser,
        );
        if (browser) {
          belemSpider.setBrowser(browser);
        }
        return belemSpider;
      case "prefeituraaltamira":
        return new PrefeituraAltamiraSpider(config, dateRange);
      case "prefeituraulianopolis":
        return new PrefeituraUlianopolisSpider(config, dateRange);
      case "prefeituasantanaaraguaia":
        return new PrefeituraSantanaAraguaiaSpider(config, dateRange);
      case "prefeiturasaodomingosdocapim":
        return new PrefeituraSaodomingosdocapimSpider(config, dateRange);
      case "portalcr2":
        const portalCr2Spider = new PortalCr2Spider(config, dateRange, browser);
        if (browser) portalCr2Spider.setBrowser(browser);
        return portalCr2Spider;
      case "portalcr2co":
        const portalCr2CoSpider = new PortalCr2CoSpider(
          config,
          dateRange,
          browser,
        );
        if (browser) portalCr2CoSpider.setBrowser(browser);
        return portalCr2CoSpider;
      case "prefeituraaugustocorrea":
      case "prefeiturapacaja":
      case "prefeituraportodemoz":
      case "prefeituraigarapeacu":
      case "prefeituravigia":
      case "prefeituraalmeirim":
      case "prefeituracurralinho":
      case "prefeituraoeirasdopara":
      case "prefeituraourilandianorte":
      case "prefeituraipixunadopara":
      case "prefeituralimoeirodoajuru":
      case "prefeituramedicilandia":
      case "prefeituraconcordiadopara":
      case "prefeituragoianesiadopara":
      case "prefeituramaracana":
      case "prefeiturasaosebastiaodaboavista":
        return new PrefeituraPaPublicacoesSpider(config, dateRange);
      case "prefeituramelgaco":
        return new PrefeituraSaodomingosdocapimSpider(config, dateRange);
      case "prefeiturajoinville_sc":
        return new PrefeituraJoinvilleScSpider(config, dateRange);

      case "prefeituraflorianopolis_sc":
      case "prefeiturablumenau_sc":
      case "prefeiturasaojose_sc":
      case "prefeituraitajai_sc":
      case "prefeiturachapeco_sc":
      case "prefeiturapalhoca_sc":
      case "prefeituracriciuma_sc":
      case "prefeiturajaraguadosul_sc":
      case "prefeituralages_sc":
        return new PrefeituraScSpider(config, dateRange);

      case "diario-ba":
        return new DiarioBaSpider(config, dateRange);

      case "amm-mt":
        return new AmmMtSpider(config, dateRange);

      case "rondonia":
        return new RondoniaSpider(config, dateRange);

      case "acre":
        const acreSpider = new AcreSpider(config, dateRange);
        if (browser) {
          acreSpider.setBrowser(browser);
        }
        return acreSpider;

      case "dodf":
        return new DODFSpider(config, dateRange);

      case "domeletronico":
        return new DomeletronicSpider(config, dateRange);

      case "espirito_santo":
        return new EspiritoSantoSpider(config, dateRange);

      case "amunes":
        return new AmunesSpider(config, dateRange);

      case "aemerj":
        return new AemerjSpider(config, dateRange);

      case "aprece":
        return new ApreceSpider(config, dateRange);

      case "domunicipal":
        return new DomunicipalSpider(config, dateRange);

      case "imprensaoficialjundiai":
        return new ImprensaOficialJundiaiSpider(config, dateRange);

      case "prefeiturariopreto":
        const rioPretospider = new PrefeituraRioPretoSpider(config, dateRange);
        if (browser) {
          rioPretospider.setBrowser(browser);
        }
        return rioPretospider;

      case "prefeituraitirapua":
        const itirapuaSpider = new PrefeituraItirapuaSpider(config, dateRange);
        if (browser) {
          itirapuaSpider.setBrowser(browser);
        }
        return itirapuaSpider;

      case "prefeituranovaodessa":
        return new PrefeituraNovaOdessaSpider(config, dateRange);

      case "prefeituramogidascruzes":
        const mogiSpider = new PrefeituraMogiDasCruzesSpider(
          config,
          dateRange,
          browser,
        );
        return mogiSpider;

      case "prefeiturasaojoaodaboavista":
        const saoJoaoSpider = new PrefeituraSaoJoaoDaBoaVistaSpider(
          config,
          dateRange,
        );
        if (browser) {
          saoJoaoSpider.setBrowser(browser);
        }
        return saoJoaoSpider;

      case "prefeituraboavista":
        return new PrefeituraBoaVistaSpider(config, dateRange);

      case "prefeiturabatais":
        return new PrefeituraBatataisSpider(config, dateRange);

      case "prefeituracajamar":
        return new PrefeituraCajamarSpider(config, dateRange);

      case "prefeituracosmopolis":
        return new PrefeituraCosmopolisSpider(config, dateRange);

      case "prefeituracotia":
        const cotiaSpider = new PrefeituraCotiaSpider(config, dateRange);
        if (browser) {
          cotiaSpider.setBrowser(browser);
        }
        return cotiaSpider;

      case "prefeituraguarulhos":
        const guarulhosSpider = new PrefeituraGuarulhosSpider(
          config,
          dateRange,
        );
        if (browser) {
          guarulhosSpider.setBrowser(browser);
        }
        return guarulhosSpider;

      case "prefeituraitaitiba":
        const itatibaSpider = new PrefeituraItatibaSpider(
          config,
          dateRange,
          browser,
        );
        return itatibaSpider;

      case "prefeituramaripora":
        const mairiporaSpider = new PrefeituraMairiporaSpider(
          config,
          dateRange,
        );
        if (browser) {
          mairiporaSpider.setBrowser(browser);
        }
        return mairiporaSpider;

      case "prefeituranarandiba":
        return new PrefeituraNarandibaSpider(config, dateRange);

      case "prefeiturapiraju":
        const pirajuSpider = new PrefeituraPirajuSpider(
          config,
          dateRange,
          browser,
        );
        return pirajuSpider;

      case "supernova":
        const supernovaSpider = new SupernovaSpider(config, dateRange, browser);
        return supernovaSpider;

      case "prefeituraitaquaquecetuba":
        return new PrefeituraItaquaquecetubaSpider(config, dateRange);

      case "eatos":
        const eatosSpider = new EatosSpider(config, dateRange);
        if (browser) {
          eatosSpider.setBrowser(browser);
        }
        return eatosSpider;

      case "prefeiturapiracicaba":
        const piracicabaSpider = new PrefeituraPiracicabaSpider(
          config,
          dateRange,
        );
        if (browser) {
          piracicabaSpider.setBrowser(browser);
        }
        return piracicabaSpider;

      case "prefeiturabauru":
        const bauruSpider = new PrefeituraBauruSpider(config, dateRange);
        if (browser) {
          bauruSpider.setBrowser(browser);
        }
        return bauruSpider;

      case "prefeiturabentogoncalves":
        return new PrefeiturabentogoncalvesSpider(config, dateRange);

      case "diariomunicipiosjc":
        return new DiarioMunicipioSJCSpider(config, dateRange);

      case "gazetamunicipal":
        return new GazetaMunicipalSpider(config, dateRange);

      case "diariooficialguarantadonorte":
        return new DiarioOficialGuarantadonorteSpider(config, dateRange);

      case "diariooficialcaldasnovas":
        return new DiarioOficialCaldasnovasSpider(config, dateRange);

      case "diariooficialms":
        const diariooficialmsSpider = new DiarioOficialMSSpider(
          config,
          dateRange,
          browser,
        );
        if (browser) {
          diariooficialmsSpider.setBrowser(browser);
        }
        return diariooficialmsSpider;

      case "prefeituracampogrande":
        const campoGrandeSpider = new PrefeituraCampoGrandeSpider(
          config,
          dateRange,
        );
        if (browser) {
          campoGrandeSpider.setBrowser(browser);
        }
        return campoGrandeSpider;

      case "prefeituradourados":
        const douradosSpider = new PrefeituraDouradosSpider(
          config,
          dateRange,
          browser,
        );
        if (browser) {
          douradosSpider.setBrowser(browser);
        }
        return douradosSpider;

      case "prefeiturapontapora":
        return new PrefeituraPontaPoraSpider(config, dateRange);

      case "prefeituranovaandradina":
        const novaAndradinaSpider = new PrefeituraNovaAndradinaSpider(
          config,
          dateRange,
        );
        if (browser) {
          novaAndradinaSpider.setBrowser(browser);
        }
        return novaAndradinaSpider;

      case "prefeituraaquidauana":
        const aquidauanaSpider = new PrefeituraAquidauanaSpider(
          config,
          dateRange,
        );
        if (browser) {
          aquidauanaSpider.setBrowser(browser);
        }
        return aquidauanaSpider;

      case "prefeiturasantoandre":
        const santoAndreSpider = new PrefeiturasantoandreSpider(
          config,
          dateRange,
        );
        if (browser) {
          santoAndreSpider.setBrowser(browser);
        }
        return santoAndreSpider;

      case "prefeituramaua":
        return new PrefeituramauaSpider(config, dateRange);

      case "prefeituradiadema":
        return new PrefeituradiademaSpider(config, dateRange);

      case "prefeituracarapicuiba":
        return new PrefeituracarapicuibaSpider(config, dateRange);

      case "prefeiturasorocaba":
        const sorocabaSpider = new PrefeituraSorocabaSpider(config, dateRange);
        if (browser) {
          sorocabaSpider.setBrowser(browser);
        }
        return sorocabaSpider;

      case "ecrie":
        const ecrieSpider = new EcrieSpider(config, dateRange, browser);
        return ecrieSpider;

      case "ecriediariooficial":
        return new EcrieDiarioOficialSpider(config, dateRange);

      case "prefeituraserranegra":
        const serranegraSpider = new PrefeituraSerranegraSpider(
          config,
          dateRange,
          browser,
        );
        return serranegraSpider;

      case "prefeituraibiuna":
        return new PrefeituraIbiunaSpider(config, dateRange);

      case "prefeiturafrancodarocha":
        return new PrefeituraFrancoDaRochaSpider(config, dateRange);

      case "prefeituralvaresmachado":
        return new PrefeituraAlvaresMachadoSpider(config, dateRange);

      case "prefeituraserrana":
        const serranaSpider = new PrefeituraSerranaSpider(config, dateRange);
        if (browser) {
          serranaSpider.setBrowser(browser);
        }
        return serranaSpider;

      case "prefeituracamposdojordao":
        const camposDoJordaoSpider = new PrefeituracamposdojordaoSpider(
          config,
          dateRange,
        );
        if (browser) {
          camposDoJordaoSpider.setBrowser(browser);
        }
        return camposDoJordaoSpider;

      case "prefeituracapaobonito":
        return new PrefeituraCapaoBonitoSpider(config, dateRange);

      case "prefeituraju":
        return new PrefeituraJauSpider(config, dateRange);

      case "prefeituramogimirim":
        return new PrefeituraMogiMirimSpider(config, dateRange);

      case "prefeituratatatui":
        return new PrefeituraTatuiSpider(config, dateRange);

      case "prefeituraleme":
        const lemeSpider = new PrefeituraLemeSpider(config, dateRange);
        if (browser) {
          lemeSpider.setBrowser(browser);
        }
        return lemeSpider;

      case "prefeituracaieiras":
        return new PrefeituracaieirasSpider(config, dateRange);

      case "prefeiturasocorro":
        return new PrefeiturasocorroSpider(config, dateRange);

      case "prefeituracapivari":
        const capivariSpider = new PrefeituraCapivariSpider(config, dateRange);
        if (browser) {
          capivariSpider.setBrowser(browser);
        }
        return capivariSpider;

      case "prefeituratiete":
        const tieteSpider = new PrefeituratieteeSpider(config, dateRange);
        if (browser) {
          tieteSpider.setBrowser(browser);
        }
        return tieteSpider;

      case "prefeiturapirassununga":
        return new PrefeiturapirasSunungaSpider(config, dateRange);

      case "prefeituraperuibe":
        return new PrefeituraPeruibeSpider(config, dateRange);

      case "prefeiturabertioga":
        return new PrefeituraBertiogaSpider(config, dateRange);

      case "prefeituraitanhaem":
        return new PrefeituraItanhaemSpider(config, dateRange);

      case "prefeituracaraguatatuba":
        return new PrefeituraCaraguatatubaSpider(config, dateRange);

      case "prefeituracubatao":
        return new PrefeituracubataoSpider(config, dateRange);

      case "prefeiturasaocaetanodosul":
        const saoCaetanoSpider = new PrefeiturasaocaetanodosulSpider(
          config,
          dateRange,
        );
        if (browser) {
          saoCaetanoSpider.setBrowser(browser);
        }
        return saoCaetanoSpider;

      case "govbrdioenet":
        return new GovbrDioenetSpider(config, dateRange);

      case "prefeiturasuzano":
        const suzanoSpider = new PrefeiturasuzanoSpider(
          config,
          dateRange,
          browser,
        );
        return suzanoSpider;

      case "prefeituradescalvado":
        return new PrefeituraDescalvadoSpider(config, dateRange);

      case "prefeiturabarueri":
        return new PrefeituraBarueriSpider(config, dateRange);

      case "prefeiturasumare":
        return new PrefeituraSumareSpider(config, dateRange);

      case "prefeiturasaocarlos":
        return new PrefeiturasaocarlosSpider(config, dateRange);

      case "prefeituraindaiatuba":
        return new PrefeituraIndaiatubaSpider(config, dateRange);

      case "prefeituraferrazdevasconcelos":
        const ferrazSpider = new PrefeituraFerrazDeVasconcelosSpider(
          config,
          dateRange,
          browser,
        );
        return ferrazSpider;

      case "portalcomunicacao":
        const portalSpider = new PortalComunicacaoSpider(
          config,
          dateRange,
          browser,
        );
        return portalSpider;

      case "prefeiturailhasolteira":
        return new PrefeituraIlhaSolteiraSpider(config, dateRange);

      case "prefeiturasaosebastiao":
        return new PrefeiturasaosebastiaoeSpider(config, dateRange);

      case "prefeiturabelohorizonte":
        const bhSpider = new PrefeituraBeloHorizonteSpider(
          config,
          dateRange,
          browser,
        );
        return bhSpider;

      case "prefeiturabetim":
        const betimSpider = new PrefeiturabetimSpider(
          config,
          dateRange,
          browser,
        );
        return betimSpider;

      case "prefeiturajuizdefora":
        return new PrefeituraJuizDeForaSpider(config, dateRange);

      case "prefeiturauberlandia":
        return new PrefeiturauberlandiaSpider(config, dateRange);

      case "prefeituramontesclaros":
        return new PrefeituramontesclarosSpider(config, dateRange);

      case "prefeituraipatinga":
        const ipatingaSpider = new PrefeituraIpatingaSpider(
          config,
          dateRange,
          browser,
        );
        return ipatingaSpider;

      case "prefeituragovernadovaladares":
        const govValadaresSpider = new PrefeituraGovernadorValadaresSpider(
          config,
          dateRange,
          browser,
        );
        return govValadaresSpider;

      case "prefeiturasantaluziamg":
        return new PrefeiturasantaluziamgSpider(config, dateRange);

      case "prefeiturauberaba":
        const uberabaSpider = new PrefeiturauberabaSpider(
          config,
          dateRange,
          browser,
        );
        return uberabaSpider;

      case "prefeiturapocosdecaldas":
        const pocosdecaldasSpider = new PrefeiturapocosdecaldasSpider(
          config,
          dateRange,
          browser,
        );
        return pocosdecaldasSpider;

      case "prefeiturabarbacena":
        return new PrefeiturabarbacenaSpider(config, dateRange);

      case "prefeituraaraguari":
        return new PrefeituraAraguariSpider(config, dateRange);

      case "prefeituracoronelfabriciano":
        return new PrefeituraCoronelFabricianoSpider(config, dateRange);

      case "prefeituraaraxa":
        return new PrefeituraAraxaSpider(config, dateRange);

      case "prefeituralavras":
        return new PrefeituraLavrasSpider(config, dateRange, browser);

      case "prefeituranolalima":
        return new PrefeituraNovaLimaSpider(config, dateRange, browser);

      case "prefeituraitauna":
        return new PrefeituraItaunaSpider(config, dateRange, browser);

      case "prefeiturauba":
        return new PrefeituraUbaSpider(config, dateRange, browser);

      case "prefeituraituiutaba":
        return new PrefeituraItuiutabaSpider(config, dateRange, browser);

      case "prefeituraparademinas":
        return new PrefeituraParademinasSpider(config, dateRange, browser);

      case "prefeiturasaojoaodelrei":
        return new PrefeituraSaoJoaoDelReiSpider(config, dateRange, browser);

      case "prefeiturapatrocinio":
        return new PrefeituraPatrocinioSpider(config, dateRange, browser);

      case "prefeituracaratinga":
        return new PrefeituraCaratingaSpider(config, dateRange, browser);

      case "prefeiturabomdespacho":
        return new PrefeituraBomDespachoSpider(config, dateRange, browser);

      case "prefeituraunai":
        return new PrefeituraUnaiSpider(config, dateRange, browser);

      case "prefeituratimoteo":
        return new PrefeituraTimoteoSpider(config, dateRange, browser);

      case "prefeituraitajuba":
        return new PrefeituraItajubaSpider(config, dateRange, browser);

      case "prefeituramanhuacu":
        return new PrefeituraManhuacuSpider(config, dateRange, browser);

      case "prefeituraalfenas":
        const alfenasSpider = new PrefeituraAlfenasSpider(
          config,
          dateRange,
          browser,
        );
        return alfenasSpider;

      case "prefeituraalfenasatosoficiais":
        return new PrefeituraAlfenasAtosOficiaisSpider(
          config,
          dateRange,
          browser,
        );

      case "prefeituravicosa":
        const vicosaSpider = new PrefeituraVicosaSpider(
          config,
          dateRange,
          browser,
        );
        return vicosaSpider;

      case "prefeituraouropreto":
        return new PrefeituraOuroPretoSpider(config, dateRange);

      case "prefeiturajanauba":
        return new PrefeituraJanaubaSpider(config, dateRange, browser);

      case "prefeiturajanaubapublicacoes":
        return new PrefeituraJanaubaPublicacoesSpider(config, dateRange);

      case "prefeituramariana":
        return new PrefeituraMarianaSpider(config, dateRange);

      case "prefeituracataguases":
        return new PrefeituraCataguasesSpider(config, dateRange);

      case "prefeiturafrutal":
        return new PrefeituraFrutalSpider(config, dateRange);

      case "prefeituraextrema":
        return new PrefeituraExtremaSpider(config, dateRange, browser);

      case "prefeituracongonhas":
        return new PrefeituraCongonhasSpider(config, dateRange, browser);

      case "prefeiturabaraodecocais":
        return new PrefeituraBaraoDeCocaisSpider(config, dateRange, browser);

      case "prefeituraconceicaodasalagoas_concursos":
        return new PrefeituraConceicaoDasAlagoasConcursosSpider(
          config,
          dateRange,
          browser,
        );

      case "prefeituraconceicaodasalagoas_atos":
        return new PrefeituraConceicaoDasAlagoasAtosSpider(
          config,
          dateRange,
          browser,
        );

      case "simpless":
        return new SimpleSSSpider(config, dateRange);

      case "portalfacil":
        const portalfacilSpider = new PortalfacilSpider(
          config,
          dateRange,
          browser,
        );
        return portalfacilSpider;

      case "folhadesabara":
        return new FolhadesabaraSpider(config, dateRange);

      case "prefeiturasabara":
        return new PrefeiturasabaraSpider(config, dateRange);

      case "prefeituraalegre":
        return new PrefeituraAlegreSpider(config, dateRange);

      case "prefeituravitoria":
        return new PrefeituraVitoriaSpider(config, dateRange);

      case "prefeituracariacica":
        const cariacicaSpider = new PrefeituraCariacicaSpider(
          config,
          dateRange,
          browser,
        );
        return cariacicaSpider;

      case "prefeiturlinhares":
        return new PrefeituraLinharesSpider(config, dateRange);

      case "prefeituracastelo":
        return new PrefeituraCasteloSpider(config, dateRange);

      case "prefeituraguacui":
        return new PrefeituraGuacuiSpider(config, dateRange);

      case "prefeituravilavelha":
        const vilaVelhaSpider = new PrefeituraVilaVelhaSpider(
          config,
          dateRange,
          browser,
        );
        return vilaVelhaSpider;

      case "prefeituracachoeiro":
        return new PrefeituraCachoeiroSpider(config, dateRange);

      case "prefeituraserra":
        const serraSpider = new PrefeituraSerraSpider(
          config,
          dateRange,
          browser,
        );
        return serraSpider;

      case "prefeituramarataizes":
        return new PrefeituraMarataizesSpider(config, dateRange);

      case "prefeituraniiteroi":
        return new PrefeituraNiteroiSpider(config, dateRange);

      case "prefeiturariodejaneiro":
        return new PrefeituraRioDeJaneiroSpider(config, dateRange);

      case "prefeituraduquedecaxias":
        const caxiasSpider = new PrefeituraDuqueDeCaxiasSpider(
          config,
          dateRange,
          browser,
        );
        return caxiasSpider;

      case "prefeiturasaogoncalo":
        const saoGoncaloSpider = new PrefeituraSaoGoncaloSpider(
          config,
          dateRange,
          browser,
        );
        if (browser) {
          saoGoncaloSpider.setBrowser(browser);
        }
        return saoGoncaloSpider;

      case "prefeituracamposdosgoytacazes":
        return new PrefeituraCamposDosGoytacazesSpider(config, dateRange);

      case "prefeituravoltaredonda":
        const voltaRedondaSpider = new PrefeituraVoltaRedondaSpider(
          config,
          dateRange,
          browser,
        );
        if (browser) {
          voltaRedondaSpider.setBrowser(browser);
        }
        return voltaRedondaSpider;

      case "prefeitrapetropolis":
        const petropolisSpider = new PrefeituraPetropolisSpider(
          config,
          dateRange,
          browser,
        );
        if (browser) {
          petropolisSpider.setBrowser(browser);
        }
        return petropolisSpider;

      case "prefeituramacae":
        const macaeSpider = new PrefeituraMacaeSpider(
          config,
          dateRange,
          browser,
        );
        if (browser) {
          macaeSpider.setBrowser(browser);
        }
        return macaeSpider;

      case "prefeituramage":
        const mageSpider = new PrefeituraMageSpider(config, dateRange, browser);
        if (browser) {
          mageSpider.setBrowser(browser);
        }
        return mageSpider;

      case "prefeituraitaborai":
        const itaboraiSpider = new PrefeituraItaboraiSpider(
          config,
          dateRange,
          browser,
        );
        if (browser) {
          itaboraiSpider.setBrowser(browser);
        }
        return itaboraiSpider;

      case "prefeituracabofrio":
        const cabofrioSpider = new PrefeituraCaboFrioSpider(
          config,
          dateRange,
          browser,
        );
        if (browser) {
          cabofrioSpider.setBrowser(browser);
        }
        return cabofrioSpider;

      case "prefeituramarica":
        const maricaSpider = new PrefeituraMaricaSpider(
          config,
          dateRange,
          browser,
        );
        if (browser) {
          maricaSpider.setBrowser(browser);
        }
        return maricaSpider;

      case "prefeituranovafriburgo":
        const novafriburgoSpider = new PrefeituraNovaFriburgoSpider(
          config,
          dateRange,
          browser,
        );
        if (browser) {
          novafriburgoSpider.setBrowser(browser);
        }
        return novafriburgoSpider;

      case "domweb":
        const domwebSpider = new DomWebSpider(config, dateRange, browser);
        if (browser) {
          domwebSpider.setBrowser(browser);
        }
        return domwebSpider;

      case "prefeiturabarramansa":
        const barramansaSpider = new PrefeituraBarraMansaSpider(
          config,
          dateRange,
          browser,
        );
        if (browser) {
          barramansaSpider.setBrowser(browser);
        }
        return barramansaSpider;

      case "prefeituraangradosreis":
        const angradosreisSpider = new PrefeituraAngraDosReisSpider(
          config,
          dateRange,
          browser,
        );
        if (browser) {
          angradosreisSpider.setBrowser(browser);
        }
        return angradosreisSpider;

      case "prefeituramesquita":
        const mesquitaSpider = new PrefeituraMesquitaSpider(
          config,
          dateRange,
          browser,
        );
        if (browser) {
          mesquitaSpider.setBrowser(browser);
        }
        return mesquitaSpider;

      case "prefeiturateresopolis":
        const teresopolisSpider = new PrefeituraTeresopolisSpider(
          config,
          dateRange,
          browser,
        );
        if (browser) {
          teresopolisSpider.setBrowser(browser);
        }
        return teresopolisSpider;

      case "prefeiturarjodasostras":
        return new PrefeituraRjOdasOstrasSpider(config, dateRange, browser);

      case "prefeituranilopolis":
        return new PrefeituraNilopolisSpider(config, dateRange, browser);

      case "prefeituraqueimados":
        return new PrefeituraQueimadosSpider(config, dateRange, browser);

      case "prefeiturarjararuama":
        return new PrefeituraRjAraruamaSpider(config, dateRange, browser);

      case "prefeiturarjresende":
        return new PrefeituraRjResendeSpider(config, dateRange, browser);

      case "prefeiturarjitaguai":
        return new PrefeituraRjItaguaiSpider(config, dateRange, browser);

      case "prefeiturarjsaopedrodaaldeia":
        return new PrefeituraRjSaoPedroDaAldeiaSpider(
          config,
          dateRange,
          browser,
        );

      case "prefeiturarjitaperuna":
        return new PrefeituraRjItaperunaSpider(config, dateRange, browser);

      case "prefeiturarjjaperi":
        return new PrefeituraRjJaperiSpider(config, dateRange, browser);

      case "prefeiturarjbarradopirai":
        return new PrefeituraRjBarraDoPiraiSpider(config, dateRange, browser);

      case "prefeiturarjsaquarema":
        return new PrefeituraRjSaquaremaSpider(config, dateRange, browser);

      case "prefeiturarjseropedica":
        return new PrefeituraRjSeropedicaSpider(config, dateRange, browser);

      case "prefeiturarjtresrios":
        return new PrefeituraRjTresRiosSpider(config, dateRange, browser);

      case "prefeiturarjvalenca":
        return new PrefeituraRjValencaSpider(config, dateRange, browser);

      case "prefeiturarjcachoeirasdemacacu":
        return new PrefeituraRjCachoeirasDeMacacuSpider(
          config,
          dateRange,
          browser,
        );

      case "prefeiturarjriobonito":
        return new PrefeituraRjRioBonitoSpider(config, dateRange, browser);

      case "prefeiturarjguapimirim":
        return new PrefeituraRjGuapimirimSpider(config, dateRange, browser);

      case "prefeiturarjcasimirodeabreu":
        return new PrefeituraRjCasimiroDeAbreuSpider(
          config,
          dateRange,
          browser,
        );

      case "prefeiturarjparaty":
        return new PrefeituraRjParatySpider(config, dateRange, browser);

      case "prefeiturarjsaofranciscodeitabapoana":
        return new PrefeituraRjSaoFranciscoDeItabapoanaSpider(
          config,
          dateRange,
          browser,
        );

      case "prefeiturarjparaibadosul":
        return new PrefeituraRjParaibaDoSulSpider(config, dateRange, browser);

      case "prefeiturarjparaibadosulv2":
        return new PrefeituraRjParaibaDoSulV2Spider(config, dateRange, browser);

      case "prefeiturarjparacambi":
        return new PrefeituraRjParacambiSpider(config, dateRange, browser);

      case "prefeiturarjparacambiv2":
        return new PrefeituraRjParacambiV2Spider(config, dateRange, browser);

      case "prefeiturarjsantoantoniopadua":
        return new PrefeituraRjSantoAntonioDePaduaSpider(
          config,
          dateRange,
          browser,
        );

      case "prefeiturarjmangaratiba":
        return new PrefeituraRjMangaratibaSpider(config, dateRange, browser);

      case "prefeiturarjmangaratibav2":
        return new PrefeituraRjMangaratibaV2Spider(config, dateRange);

      case "prefeiturarjarmacaodosbuzios":
        return new PrefeituraRjArmacaoDosBuziosSpider(
          config,
          dateRange,
          browser,
        );

      case "prefeiturarjsaofidelis":
        return new PrefeituraRjSaoFidelisSpider(config, dateRange, browser);

      case "prefeiturarjsaofidelisv2":
        return new PrefeituraRjSaoFidelisV2Spider(config, dateRange);

      case "prefeiturarjsaojoaodabarra":
        return new PrefeituraRjSaoJoaoDaBarraSpider(config, dateRange, browser);

      case "prefeiturarjsaojoaodabarrav2":
        return new PrefeituraRjSaoJoaoDaBarraV2Spider(config, dateRange);

      case "prefeiturarjbomjesusdoitabapoana":
        return new PrefeituraRjBomJesusSpider(config, dateRange, browser);

      case "prefeiturarjvassouras":
        return new PrefeituraRjVassourasSpider(config, dateRange, browser);

      case "prefeiturarjtangua":
        return new PrefeituraRjTanguaSpider(config, dateRange, browser);

      case "prefeiturarjarraialdocabo":
        return new PrefeituraRjArraialDoCaboSpider(config, dateRange, browser);

      case "prefeiturarjarraialdocabov2":
        return new PrefeituraRjArraialDoCaboV2Spider(
          config,
          dateRange,
          browser,
        );

      case "prefeiturarjitatiaia":
        return new PrefeituraRjItatiaiaSpider(config, dateRange);

      case "prefeiturarjpatydoalferes":
        return new PrefeituraRjPatyDoAlferesSpider(config, dateRange, browser);

      case "prefeiturarjbomjardim":
        return new PrefeituraRjBomJardimSpider(config, dateRange, browser);

      case "prefeiturarjiguabagrande":
        return new PrefeituraRjIguabaGrandeSpider(config, dateRange, browser);

      case "prefeiturarjmiracema":
        return new PrefeituraRjMiracemaSpider(config, dateRange, browser);

      case "prefeiturarjmiguelpereira":
        return new PrefeituraRjMiguelPereiraSpider(config, dateRange, browser);

      case "prefeiturarjpirai":
        return new PrefeituraRjPiraiSpider(config, dateRange, browser);

      case "diario_oficial_online":
        return new DiarioOficialOnlineSpider(config, dateRange);

      case "prefeiturace":
        return new PrefeituraCESpider(config, dateRange);

      case "assesi":
        return new AssesiSpider(config, dateRange);

      case "procede":
        return new ProcedeSpider(config, dateRange);

      case "domunicipio":
        return new DomunicipioSpider(config, dateRange);

      case "portaliop":
        return new PortalIopSpider(config, dateRange);

      case "prefeiturajuazeirodonorte":
        return new PrefeituraJuazeiroDoNorteSpider(config, dateRange);

      case "prefeiturasobral":
        return new PrefeituraSobralSpider(config, dateRange);

      case "prefeituracrato":
        return new PrefeituraCratoSpider(config, dateRange);

      case "prefeituraitapipoca":
        return new PrefeituraItapipocaSpider(config, dateRange);

      case "plugtecnologia":
        return new PlugTecnologiaSpider(config, dateRange);

      case "wordpress_publicacoes":
        return new WordPressPublicacoesSpider(config, dateRange);

      case "portalgov":
        return new PortalGovSpider(config, dateRange);

      case "imprensaoficial":
        return new ImprensaOficialSpider(config, dateRange);

      case "transparenciaoficialba":
        return new TransparenciaOficialBaSpider(config, dateRange);

      case "prefeiturairece":
        return new PrefeituraIreceSpider(config, dateRange);

      case "ibdmtransparencia":
        return new IbdmTransparenciaSpider(config, dateRange);

      case "custom":
        throw new Error(`Custom spider ${config.id} not implemented`);

      case "impublicacoes":
        const impublicacoesSpider = new ImpublicacoesSpider(config, dateRange);
        if (browser) {
          impublicacoesSpider.setBrowser(browser);
        }
        return impublicacoesSpider;

      case "institutopublicacoes":
        const ipSpider = new InstitutoPublicacoesSpider(config, dateRange);
        if (browser) {
          ipSpider.setBrowser(browser);
        }
        return ipSpider;

      case "airdoc":
        return new AirdocSpider(config, dateRange);

      case "prefeituraanage":
        const anageSpider = new PrefeituraAnageSpider(config, dateRange);
        if (browser) {
          anageSpider.setBrowser(browser);
        }
        return anageSpider;

      case "prefeiturarecife":
        return new PrefeituraRecifeSpider(config, dateRange);

      case "prefeiturajaboatao":
        const jaboataoSpider = new PrefeituraJaboataoSpider(config, dateRange);
        if (browser) {
          jaboataoSpider.setBrowser(browser);
        }
        return jaboataoSpider;

      case "prefeituracaruaru":
        return new PrefeituraCaruaruSpider(config, dateRange);

      case "prefeiturasantacruzdocapibaribe":
        return new PrefeiturasantacruzdocapibaribeSpider(config, dateRange);

      case "prefeituracamaragibe":
        return new PrefeituracamaragibeSpider(config, dateRange);

      case "prefeiturateresina":
        return new PrefeiturareTeresinhaSpider(config, dateRange);

      case "prefeiturapnarnaiba":
        const parnaraibaSpider = new PrefeituraParnaraibaSpider(
          config,
          dateRange,
        );
        if (browser) {
          parnaraibaSpider.setBrowser(browser);
        }
        return parnaraibaSpider;

      case "diariooficialdasprefeituras":
        const diarioOficialDasPrefeiturasSpider =
          new DiarioOficialDasPrefeiturasSpider(config, dateRange);
        if (browser) {
          diarioOficialDasPrefeiturasSpider.setBrowser(browser);
        }
        return diarioOficialDasPrefeiturasSpider;

      case "diarioficialdosmunicipiosappm":
        const appmSpider = new DiarioOficialDosMunicipiosAPPMSpider(
          config,
          dateRange,
        );
        if (browser) {
          appmSpider.setBrowser(browser);
        }
        return appmSpider;

      case "prefeituraaraipina":
        return new PrefeituraAraripinaSpider(config, dateRange);

      case "softagon":
        return new SoftagonSpider(config, dateRange);

      case "directus_portal":
        return new DirectusPortalSpider(config, dateRange);

      case "prefeiturabezerros":
        return new PrefeituraBezerrosSpider(config, dateRange);

      case "sogotecnologia":
        return new SogoTecnologiaSpider(config, dateRange);

      case "prefeituraimperatriz":
        return new PrefeituraImperatrizSpider(config, dateRange);

      case "prefeiturasaoluis":
        const saoLuisSpider = new PrefeturaSaoLuisSpider(config, dateRange);
        if (browser) {
          saoLuisSpider.setBrowser(browser);
        }
        return saoLuisSpider;

      case "prefeituranatal":
        return new PrefeituraNatalSpider(config, dateRange);

      case "prefeituramossoro":
        return new PrefeituraMossoroSpider(config, dateRange);

      case "prefeiturasaogoncalorn":
        return new PrefeituraSaoGoncaloRNSpider(config, dateRange);

      case "prefeituramacaiba":
        return new PrefeituraMacaibaSpider(config, dateRange);

      case "prefeituraparnamirim":
        return new PrefeituraParnamirimSpider(config, dateRange);

      case "prefeituraassu":
        const assuSpider = new PrefeituraAssuSpider(config, dateRange);
        if (browser) {
          assuSpider.setBrowser(browser);
        }
        return assuSpider;

      case "prefeituramacaurn":
        return new PrefeituramacaurnSpider(config, dateRange);

      case "prefeituravilhena":
        return new PrefeituraVilhenaSpider(config, dateRange);

      case "prefeiturasantaines":
        return new PrefeiturasantainesSpider(config, dateRange);

      case "prefeiturapinheiro":
        const pinheiroSpider = new PrefeiturapinheiroSpider(config, dateRange);
        if (browser) {
          pinheiroSpider.setBrowser(browser);
        }
        return pinheiroSpider;

      case "prefeiturabarradocorda":
        const barradocordaSpider = new PrefeiturabarradocordaSpider(
          config,
          dateRange,
        );
        if (browser) {
          barradocordaSpider.setBrowser(browser);
        }
        return barradocordaSpider;

      case "prefeiturachapadinha":
        return new PrefeiturachapadinhaSpider(config, dateRange);

      case "prefeituragrajau":
        const grajauSpider = new PrefeituragrajauSpider(config, dateRange);
        if (browser) {
          grajauSpider.setBrowser(browser);
        }
        return grajauSpider;

      case "prefeiturabarreirinhas":
        const barreirinhasSpider = new PrefeiturabarreirinhasSpider(
          config,
          dateRange,
        );
        if (browser) {
          barreirinhasSpider.setBrowser(browser);
        }
        return barreirinhasSpider;

      case "prefeiturasantaluziama":
        return new PrefeiturasantaluziamaSpider(config, dateRange);

      case "prefeituracaxias":
        return new PrefeituracaxiasSpider(config, dateRange);

      case "prefeiturapacodolumiar":
        return new PrefeiturapacodolumiarSpider(config, dateRange);

      case "prefeituraportoalegre":
        const portoAlegreSpider = new PrefeituraportoalegreSpider(
          config,
          dateRange,
          browser,
        );
        if (browser) portoAlegreSpider.setBrowser(browser);
        return portoAlegreSpider;

      case "prefeituracaxiasdosul":
        const caxiasSulSpider = new PrefeituracaxiasdosulSpider(
          config,
          dateRange,
          browser,
        );
        if (browser) caxiasSulSpider.setBrowser(browser);
        return caxiasSulSpider;

      case "prefeituracanoas":
        const canoasSpider = new PrefeituracanoasSpider(
          config,
          dateRange,
          browser,
        );
        if (browser) canoasSpider.setBrowser(browser);
        return canoasSpider;

      case "prefeiturapelotas":
        const pelotasSpider = new PrefeiturapelotasSpider(
          config,
          dateRange,
          browser,
        );
        if (browser) pelotasSpider.setBrowser(browser);
        return pelotasSpider;

      case "prefeiturasantamaria":
        const santaMariaSpider = new PrefeiturasantamariaSpider(
          config,
          dateRange,
          browser,
        );
        if (browser) santaMariaSpider.setBrowser(browser);
        return santaMariaSpider;

      case "prefeituranovohamburgo":
        const novoHamburgoSpider = new PrefeituranovohamburgoSpider(
          config,
          dateRange,
          browser,
        );
        if (browser) novoHamburgoSpider.setBrowser(browser);
        return novoHamburgoSpider;

      case "prefeiturasaoleopoldo":
        const saoLeopoldoSpider = new PrefeiturasaoleopoldoSpider(
          config,
          dateRange,
          browser,
        );
        if (browser) saoLeopoldoSpider.setBrowser(browser);
        return saoLeopoldoSpider;

      case "prefeiturapassofundo":
        const passoFundoSpider = new PrefeiturapassofundoSpider(
          config,
          dateRange,
          browser,
        );
        if (browser) passoFundoSpider.setBrowser(browser);
        return passoFundoSpider;

      case "prefeituratimon":
        return new PrefeituraTimonSpider(config, dateRange);

      case "prefeiturabacabal":
        return new PrefeiturabacabalSpider(config, dateRange);

      case "prefeiturajoaopessoa":
        return new PrefeituraJoaoPessoaSpider(config, dateRange);

      case "prefeiturabayeux":
        return new PrefeiturabayeuxSpider(config, dateRange);

      case "prefeituracajazeiras":
        return new PrefeituracajazeirasSpider(config, dateRange);

      case "prefeituraguarabirapb":
        const guarabirapbSpider = new PrefeituraguarabirapbSpider(
          config,
          dateRange,
        );
        if (browser) {
          guarabirapbSpider.setBrowser(browser);
        }
        return guarabirapbSpider;

      case "mssolucoes":
        return new MsSolucoesSpider(config, dateRange);

      case "prefeiturasousa":
        return new PrefeiturasousaSpider(config, dateRange);

      case "prefeituraqueimadaspb":
        return new PrefeituraQueimadasPBSpider(config, dateRange);

      case "prefeiturapedrasdefogo":
        return new PrefeiturapedrasdefogoSpider(config, dateRange);

      case "prefeiturasaobentopb":
        return new PrefeiturasaobentopbSpider(config, dateRange);

      case "prefeituralagoaseca":
        return new PrefeituraLagoaSecaSpider(config, dateRange);

      case "prefeiturapresidentedutra":
        return new PrefeituraPresidenteDutraSpider(config, dateRange);

      case "prefeituraamarante":
        return new PrefeituraAmaranteSpider(config, dateRange);

      case "prefeituracoelhoneto":
        return new PrefeituraCoelhoNetoSpider(config, dateRange);

      case "easywebportal":
        return new EasywebPortalSpider(config, dateRange);

      case "prefeituramacapa":
        return new PrefeituramacapaSpider(config, dateRange);

      case "prefeiturasantanaap":
        return new PrefeiturasantanaapSpider(config, dateRange);

      case "prefeituralaranjaldojari":
        return new PrefeituralaranjaldojariSpider(config, dateRange);

      case "diagramacao":
        return new DiagramacaoSpider(config, dateRange);

      case "prefeiturapalmas":
        return new PrefeiturapalmastSpider(config, dateRange);

      case "prefeituragurupi":
        return new PrefeituragurupiSpider(config, dateRange);

      case "nucleogov":
        return new NucleogovSpider(config, dateRange);

      case "prefeituraaraguaina":
        return new PrefeituraaraguainaSpider(config, dateRange);

      case "prefeituraportonacional":
        return new PrefeituraportonacionalSpider(config, dateRange);

      case "prefeiturarondonopolis":
        return new PrefeiturarondonopolisSpider(config, dateRange);

      case "prefeituragoiania":
        return new PrefeituragoianiaSpider(config, dateRange);

      case "prefeiturajatai":
        return new PrefeituraJataiSpider(config, dateRange);

      case "prefeituraprimaveradoleste":
        return new PrefeituraprimaveradolesteSpider(config, dateRange);

      case "prefeituraNovoGama":
        return new PrefeituraNovoGamaSpider(config, dateRange);

      case "santa_helena_go":
        return new SantaHelenaGoSpider(config, dateRange);

      case "prefeiturajaragua":
        return new PrefeituraJaraguaSpider(config, dateRange);

      case "prefeituracuritiba": {
        const curitibaSpider = new PrefeituracuritibaSpider(
          config,
          dateRange,
          browser,
        );
        if (browser) curitibaSpider.setBrowser(browser);
        return curitibaSpider;
      }

      case "prefeituralondrina":
        return new PrefeituralondrinaSpider(config, dateRange);

      case "prefeiturapontagrossa":
        return new PrefeiturapontagrossaSpider(config, dateRange);

      case "prefeituramaringa":
        const maringaSpider = new PrefeituramaringaSpider(config, dateRange, browser);
        if (browser) {
          maringaSpider.setBrowser(browser);
        }
        return maringaSpider;

      case "prefeituracascavel":
        return new PrefeituracascavelSpider(config, dateRange);

      case "prefeiturasjp":
        return new PrefeiturasjpSpider(config, dateRange);

      case "prefeiturafoz":
        return new PrefeiturafozSpider(config, dateRange);

      case "prefeituraguarapuava":
        return new PrefeituraguarapuavaSpider(config, dateRange);

      case "prefeituraraucaria":
        return new PrefeituraraucariaSpider(config, dateRange);

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

// Singleton instance - now using unified registry manager
import { SpiderRegistryManager } from "./registry-manager";
export const spiderRegistry = new SpiderRegistryManager();
