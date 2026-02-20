import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp } from '../../utils/date-utils';

/**
 * Configuration interface for São João da Barra V2 spider
 */
interface PrefeituraRjSaoJoaoDaBarraV2Config {
  type: string;
  baseUrl: string;
}

/**
 * API response item structure from class_diario.php
 */
interface DiarioApiItem {
  codigo: string;
  numero: string;
  ano: string;
  descricao: string;
  arquivo: string;
  data_form: string;
  data: string; // DD/MM/YYYY format
}

/**
 * Spider for São João da Barra - RJ gazette extraction
 * 
 * Website: https://www.sjb.rj.gov.br/site/diarios_oficiais
 * 
 * The site uses:
 * - A PHP API at /controllers/diario_oficial/class_diario.php
 * - POST request with func=5 returns all gazettes as JSON array
 * - PDFs at /arquivos/diario_oficial/{filename}
 * 
 * API Response format:
 * [
 *   {
 *     "codigo": "24392",
 *     "numero": "014",
 *     "ano": "26",
 *     "descricao": "",
 *     "arquivo": "014_26_do-21012026-ed014.pdf",
 *     "data_form": "21 de Janeiro de 2026",
 *     "data": "21/01/2026"
 *   },
 *   ...
 * ]
 */
export class PrefeituraRjSaoJoaoDaBarraV2Spider extends BaseSpider {
  private sjbConfig: PrefeituraRjSaoJoaoDaBarraV2Config;
  private readonly userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  private readonly baseApiUrl = 'https://www.sjb.rj.gov.br';
  private readonly apiEndpoint = 'https://www.sjb.rj.gov.br/controllers/diario_oficial/class_diario.php';
  private readonly pdfBaseUrl = 'https://www.sjb.rj.gov.br/arquivos/diario_oficial';

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.sjbConfig = spiderConfig.config as PrefeituraRjSaoJoaoDaBarraV2Config;
    
    if (!this.sjbConfig.baseUrl) {
      throw new Error(`PrefeituraRjSaoJoaoDaBarraV2Spider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraRjSaoJoaoDaBarraV2Spider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.sjbConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    const processedUrls = new Set<string>();
    
    try {
      // Fetch all gazettes from the API using func=5
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': this.userAgent,
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
          'Origin': this.baseApiUrl,
          'Referer': this.sjbConfig.baseUrl,
        },
        body: 'func=5',
      });
      this.requestCount++;
      
      if (!response.ok) {
        logger.error(`Failed to fetch gazettes from API: ${response.status}`);
        return gazettes;
      }
      
      const data: DiarioApiItem[] = await response.json();
      
      if (!Array.isArray(data)) {
        logger.error(`API response is not an array`);
        return gazettes;
      }
      
      logger.info(`API returned ${data.length} gazette items`);
      
      // Process each gazette item
      for (const item of data) {
        try {
          const gazette = this.processGazetteItem(item, processedUrls);
          if (gazette) {
            gazettes.push(gazette);
          }
        } catch (error) {
          logger.error(`Error processing gazette item:`, error as Error);
        }
      }
      
    } catch (error) {
      logger.error(`Error during crawl:`, error as Error);
    }
    
    logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    return gazettes;
  }

  /**
   * Process a single gazette item from the API response
   */
  private processGazetteItem(item: DiarioApiItem, processedUrls: Set<string>): Gazette | null {
    const { numero, arquivo, data: dateStr } = item;
    
    if (!arquivo || !dateStr) {
      logger.warn(`Missing arquivo or data in gazette item: ${JSON.stringify(item)}`);
      return null;
    }
    
    // Build the PDF URL
    const pdfUrl = `${this.pdfBaseUrl}/${encodeURIComponent(arquivo)}`;
    
    if (processedUrls.has(pdfUrl)) {
      return null;
    }
    
    // Parse date (DD/MM/YYYY format)
    const [day, month, year] = dateStr.split('/');
    const gazetteDate = new Date(`${year}-${month}-${day}`);
    
    if (isNaN(gazetteDate.getTime())) {
      logger.warn(`Invalid date: ${dateStr}`);
      return null;
    }
    
    // Check if within date range
    if (!this.isInDateRange(gazetteDate)) {
      return null;
    }
    
    // Detect extra/special editions from the edition number
    const isExtra = this.isExtraEdition(numero);
    
    // Clean edition number (remove suffixes like "-Extraordinária")
    const cleanEditionNumber = numero.replace(/-.*$/, '').trim();
    
    const gazette = this.createGazetteDirectly(gazetteDate, pdfUrl, {
      power: 'executive_legislative',
      editionNumber: cleanEditionNumber,
      isExtraEdition: isExtra,
    });
    
    processedUrls.add(pdfUrl);
    logger.info(`Found gazette for ${toISODate(gazetteDate)} (edição ${numero}): ${pdfUrl}`);
    
    return gazette;
  }

  /**
   * Check if edition number indicates an extra/special edition
   */
  private isExtraEdition(numero: string): boolean {
    const lowerNumero = numero.toLowerCase();
    return (
      lowerNumero.includes('extra') ||
      lowerNumero.includes('suplementar') ||
      lowerNumero.includes('extraordin') ||
      lowerNumero.includes('republicado')
    );
  }

  /**
   * Creates a Gazette object directly without URL resolution
   * Used when the target site blocks HEAD requests used for URL resolution
   */
  private createGazetteDirectly(
    date: Date,
    fileUrl: string,
    options: {
      editionNumber?: string;
      isExtraEdition?: boolean;
      power?: 'executive' | 'legislative' | 'executive_legislative';
    } = {}
  ): Gazette {
    return {
      date: toISODate(date),
      fileUrl: fileUrl,
      territoryId: this.spiderConfig.territoryId,
      scrapedAt: getCurrentTimestamp(),
      editionNumber: options.editionNumber,
      isExtraEdition: options.isExtraEdition ?? false,
      power: options.power ?? 'executive_legislative',
    };
  }
}
