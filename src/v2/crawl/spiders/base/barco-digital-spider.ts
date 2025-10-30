import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, BarcoDigitalConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { getMonthlySequence } from '../../utils/date-utils';
import { logger } from '../../utils/logger';

/**
 * Spider for BarcoDigital platform
 * 
 * BarcoDigital is a gazette management platform used by several municipalities in Tocantins.
 * It provides a simple JSON API with monthly calendar endpoints.
 * 
 * API Structure:
 * - Endpoint: {baseUrl}/api/publico/diario/calendario?mes={month}&ano={year}
 * - Response: Object with dates as keys, each containing array of documents
 * - Each document has: data, edicao, tipo_edicao_id, url
 * 
 * Edition Types:
 * - 1: Normal edition
 * - 2: Extra edition
 * - 3: Supplement
 */
export class BarcoDigitalSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const barcoConfig = config.config as BarcoDigitalConfig;
    this.baseUrl = barcoConfig.baseUrl;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const months = getMonthlySequence(this.startDate, this.endDate);

    logger.info(`Crawling ${this.baseUrl} for ${this.config.name}...`);

    for (const month of months) {
      const url = `${this.baseUrl}/api/publico/diario/calendario?mes=${month.getMonth() + 1}&ano=${month.getFullYear()}`;
      
      logger.debug(`Fetching calendar for ${month.getFullYear()}-${month.getMonth() + 1}`);

      try {
        const response = await fetch(url);
        
        if (!response.ok) {
          logger.warn(`Failed to fetch ${url}: ${response.status}`);
          continue;
        }

        const data = await response.json() as Record<string, any>;

        // Response is an object with dates as keys
        for (const dateKey of Object.keys(data)) {
          const documents = data[dateKey];
          if (!Array.isArray(documents)) continue;

          for (const document of documents) {
            const documentDate = new Date(document.data);

            // Filter by date range
            if (documentDate > this.endDate) continue;
            if (documentDate < this.startDate) continue;

            const gazette: Gazette = {
              date: document.data,
              fileUrl: `${this.baseUrl}/arquivo/${document.url}`,
              territoryId: this.config.territoryId,
              scrapedAt: new Date().toISOString(),
              editionNumber: document.edicao?.toString() || undefined,
              isExtraEdition: document.tipo_edicao_id !== 1, // 1 = normal, 2 = extra, 3 = supplement
              power: 'executive',
            };

            gazettes.push(gazette);
          }
        }
      } catch (error) {
        logger.error(`Error fetching calendar for ${month.getFullYear()}-${month.getMonth() + 1}: ${error}`);
      }
    }

    logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`);
    return gazettes;
  }
}
