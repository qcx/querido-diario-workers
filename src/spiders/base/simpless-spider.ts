import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, SimpleSSConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for SimpleSS platform (used by municipalities like Almenara)
 * 
 * The SimpleSS platform uses a JSON API to serve gazette data.
 * 
 * API Structure:
 * - Endpoint: {baseUrl}/listarDiario/
 * - Method: POST
 * - Response: Array of gazette objects
 * 
 * Each gazette object contains:
 * - data: Date in YYYY-MM-DD format
 * - numero_edicao: Edition number (e.g., "00345/2026")
 * - tpEdicao: Type ("Ordinário" or "Extraordinário")
 * - pasta: Folder path (e.g., "000013/diario-oficial/")
 * - arquivo: PDF filename (e.g., "DIARIO_OFICIAL_345_2026.pdf")
 * 
 * PDF URLs: https://pub.simpless.com.br/files/{pasta}{arquivo}
 */
export class SimpleSSSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const simplessConfig = config.config as SimpleSSConfig;
    this.baseUrl = simplessConfig.baseUrl;
    
    if (!this.baseUrl) {
      throw new Error(`SimpleSSSpider requires a baseUrl in config for ${config.name}`);
    }
    
    logger.info(`Initializing SimpleSSSpider for ${config.name} with URL: ${this.baseUrl}`);
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    logger.info(`Crawling ${this.baseUrl} for ${this.config.name}...`);

    try {
      // The API endpoint
      const apiUrl = `${this.baseUrl}/listarDiario/`;
      
      logger.debug(`Fetching gazettes from: ${apiUrl}`);

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
      
      if (!response.ok) {
        logger.warn(`Failed to fetch ${apiUrl}: ${response.status}`);
        return gazettes;
      }

      const data = await response.json() as Array<{
        id: number;
        data: string; // YYYY-MM-DD
        numero_edicao: string; // e.g., "00345/2026"
        tpEdicao: string; // "Ordinário" or "Extraordinário"
        pasta: string; // e.g., "000013/diario-oficial/"
        arquivo: string; // e.g., "DIARIO_OFICIAL_345_2026.pdf"
        status: string;
      }>;
      
      if (!Array.isArray(data)) {
        logger.warn(`Expected array but got: ${typeof data}`);
        return gazettes;
      }

      logger.debug(`Received ${data.length} gazettes from API`);

      for (const item of data) {
        try {
          // Parse date (YYYY-MM-DD)
          const gazetteDate = new Date(item.data);
          
          if (isNaN(gazetteDate.getTime())) {
            logger.warn(`Invalid date: ${item.data}`);
            continue;
          }

          // Filter by date range
          if (gazetteDate > this.endDate) continue;
          if (gazetteDate < this.startDate) continue;

          // Construct PDF URL
          const pdfUrl = `https://pub.simpless.com.br/files/${item.pasta}${item.arquivo}`;
          
          // Extract edition number from numero_edicao (e.g., "00345/2026" -> "345")
          const editionMatch = item.numero_edicao.match(/(\d+)/);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;
          
          // Check if it's an extra edition
          const isExtraEdition = item.tpEdicao?.toLowerCase().includes('extra') || false;

          const gazette: Gazette = {
            date: item.data,
            fileUrl: pdfUrl,
            territoryId: this.config.territoryId,
            scrapedAt: new Date().toISOString(),
            editionNumber,
            isExtraEdition,
            power: 'executive_legislative',
          };

          gazettes.push(gazette);
        } catch (error) {
          logger.error(`Error processing gazette item:`, error as Error);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`);
    } catch (error) {
      logger.error(`Error crawling ${this.config.name}:`, error as Error);
    }

    return gazettes;
  }
}
