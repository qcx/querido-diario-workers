import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraBeloHorizonteConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

interface DocumentoBH {
  id: number;
  nome_original: string;
  nome_minio: string;
  hash_arquivo: string;
  extensao: string;
  mimetype: string;
  size: string;
  prefix: string;
}

interface EdicaoBH {
  id: number;
  numero_edicao: number;
  tipo_edicao: string;
  ano_romanos_edicao: string;
  dt_publicacao: string;
  hr_publicacao: string;
  documento_capa: DocumentoBH;
  documento_jornal: DocumentoBH;
}

interface APIResponseBH {
  success: boolean;
  data: EdicaoBH[];
  message: string;
}

/**
 * Spider for Belo Horizonte (MG) official gazette
 * 
 * The DOM-Web portal uses a Vue.js frontend with an API backend.
 * The API at api-dom.pbh.gov.br is protected by GoCache WAF but allows
 * access to certain endpoints without authentication.
 * 
 * Site Structure:
 * - Web Frontend: https://dom-web.pbh.gov.br/
 * - API Backend: https://api-dom.pbh.gov.br/api/v1/
 * 
 * Key API Endpoints:
 * - /edicoes/buscarultimapublicacao - Get latest publication (no auth required)
 * - /documentos/{nome_minio}/download?prefix={prefix} - Download PDF
 * 
 * Note: The endpoint /edicoes?dataInicio=...&dataFim=... requires authentication
 * token and is not available for public use.
 */
export class PrefeituraBeloHorizonteSpider extends BaseSpider {
  private baseUrl: string;
  private apiBaseUrl: string;
  protected browser?: Fetcher;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const bhConfig = config.config as PrefeituraBeloHorizonteConfig;
    this.baseUrl = bhConfig.baseUrl || 'https://dom-web.pbh.gov.br';
    this.apiBaseUrl = bhConfig.apiBaseUrl || 'https://api-dom.pbh.gov.br';
    this.browser = browser;
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    logger.info(`Crawling ${this.baseUrl} for ${this.config.name} with date range ${this.startDate.toISOString()} to ${this.endDate.toISOString()}`);

    try {
      // Use the public endpoint to get the latest publication
      // This endpoint doesn't require authentication token, only a valid User-Agent
      const latestUrl = `${this.apiBaseUrl}/api/v1/edicoes/buscarultimapublicacao`;
      
      logger.debug(`Fetching latest edition from: ${latestUrl}`);
      
      // Always use global fetch for API requests - this works in both Node.js and Cloudflare Workers
      // The browser binding is for Browser Rendering (page rendering), not for simple HTTP requests
      const latestResponse = await fetch(latestUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': `${this.baseUrl}/`,
        },
      });

      if (!latestResponse.ok) {
        logger.warn(`Failed to fetch latest edition: ${latestResponse.status}`);
        return gazettes;
      }

      let responseData: APIResponseBH;
      try {
        responseData = await latestResponse.json() as APIResponseBH;
      } catch (parseError) {
        logger.error(`Failed to parse API response: ${parseError}`);
        return gazettes;
      }

      if (!responseData.success || !Array.isArray(responseData.data)) {
        logger.warn(`Unexpected API response format: ${JSON.stringify(responseData)}`);
        return gazettes;
      }

      // Process each edition from the response
      for (const edition of responseData.data) {
        const gazette = this.processEdition(edition);
        if (gazette) {
          // Check if the gazette date is within our date range
          const gazetteDate = new Date(gazette.date);
          if (gazetteDate >= this.startDate && gazetteDate <= this.endDate) {
            gazettes.push(gazette);
            logger.debug(`Found gazette: Edition ${edition.numero_edicao} from ${gazette.date}`);
          } else {
            logger.debug(`Edition ${edition.numero_edicao} from ${gazette.date} is outside date range`);
          }
        }
      }

    } catch (error) {
      logger.error(`Error crawling Belo Horizonte: ${error}`);
    }

    logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`);
    return gazettes;
  }

  /**
   * Process a single edition and return gazette info
   */
  private processEdition(edition: EdicaoBH): Gazette | null {
    try {
      // Validate required fields
      if (!edition.documento_jornal || !edition.documento_jornal.nome_minio) {
        logger.debug(`Edition ${edition.id} has no PDF document`);
        return null;
      }

      const documento = edition.documento_jornal;
      const prefix = documento.prefix || this.extractPrefixFromDate(edition.dt_publicacao);
      
      // Build the download URL
      const downloadUrl = `${this.apiBaseUrl}/api/v1/documentos/${documento.nome_minio}/download?prefix=${prefix}`;

      // Determine if it's an extra edition based on tipo_edicao
      // P = Principal (normal), E = Extraordinária (extra)
      const isExtraEdition = edition.tipo_edicao === 'E';

      const gazette: Gazette = {
        date: edition.dt_publicacao,
        fileUrl: downloadUrl,
        territoryId: this.config.territoryId,
        scrapedAt: new Date().toISOString(),
        editionNumber: edition.numero_edicao.toString(),
        isExtraEdition: isExtraEdition,
        power: 'executive_legislative', // BH includes both powers (Prefeitura + Câmara)
      };

      return gazette;

    } catch (error) {
      logger.debug(`Error processing edition ${edition.id}: ${error}`);
      return null;
    }
  }

  /**
   * Extract prefix (YYYYMMDD) from date string (YYYY-MM-DD)
   */
  private extractPrefixFromDate(dateStr: string): string {
    return dateStr.replace(/-/g, '');
  }
}
