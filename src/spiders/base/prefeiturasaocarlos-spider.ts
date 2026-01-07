import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeiturasaocarlosConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Response item from the São Carlos gazette API
 */
interface SaoCarlosGazetteItem {
  /** Edition number (e.g., "02934") */
  title: string;
  /** Date in YYYY-MM-DD format */
  start: string;
  /** Relative path to PDF (e.g., "arquivo/2026/DO02934_2026_assinado.pdf") */
  description: string;
}

/**
 * Prefeitura de São Carlos spider
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
 * [
 *   {
 *     "title": "02934",
 *     "start": "2026-01-06",
 *     "description": "arquivo/2026/DO02934_2026_assinado.pdf"
 *   }
 * ]
 * 
 * PDF URL: {baseUrl}/{description}
 * e.g., https://cidadao.saocarlos.sp.gov.br/servicos/jornal/arquivo/2026/DO02934_2026_assinado.pdf
 */
export class PrefeiturasaocarlosSpider extends BaseSpider {
  private baseUrl: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    const config = spiderConfig.config as PrefeiturasaocarlosConfig;
    this.baseUrl = config.baseUrl || 'https://cidadao.saocarlos.sp.gov.br/servicos/jornal';
    
    logger.info(`Initializing PrefeiturasaocarlosSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      // Build API URL with date range
      const startDate = toISODate(this.startDate);
      const endDate = toISODate(this.endDate);
      
      const apiUrl = `${this.baseUrl}/include/publicacoes.php?calendario=true&permissao=0&start=${startDate}&end=${endDate}`;
      
      logger.info(`Fetching gazettes from API: ${apiUrl}`);
      
      const response = await this.fetch(apiUrl);
      
      // Parse JSON response
      let items: SaoCarlosGazetteItem[];
      try {
        items = JSON.parse(response);
      } catch (e) {
        logger.error(`Failed to parse API response as JSON`);
        return gazettes;
      }
      
      if (!Array.isArray(items)) {
        logger.warn(`API response is not an array`);
        return gazettes;
      }
      
      logger.info(`Found ${items.length} gazette items from API`);
      
      // Process each gazette
      for (const item of items) {
        try {
          // Parse date from "start" field (already in YYYY-MM-DD format)
          const gazetteDate = new Date(item.start);
          
          if (isNaN(gazetteDate.getTime())) {
            logger.warn(`Invalid date format: ${item.start}`);
            continue;
          }
          
          // Skip if not in date range (API might return extra items)
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }
          
          // Build full PDF URL
          // Description comes as "arquivo/2026/DO02934_2026_assinado.pdf" (with escaped slashes in JSON)
          const pdfPath = item.description.replace(/\\\//g, '/');
          const pdfUrl = `${this.baseUrl}/${pdfPath}`;
          
          // Extract edition number from title
          const editionNumber = item.title;
          
          // Create gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber,
            isExtraEdition: false,
            power: 'executive_legislative',
            sourceText: `Edição ${editionNumber} - ${item.start}`,
          });
          
          if (gazette) {
            gazettes.push(gazette);
            logger.debug(`Added gazette: Edition ${editionNumber}, Date: ${item.start}`);
          }
          
        } catch (error) {
          logger.error(`Error processing gazette item:`, error as Error);
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }
}

