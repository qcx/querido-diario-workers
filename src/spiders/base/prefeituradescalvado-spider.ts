import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraDescalvadoConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { getMonthlySequence } from '../../utils/date-utils';
import { logger } from '../../utils/logger';

/**
 * Spider for Prefeitura de Descalvado official gazette
 * 
 * The site uses a custom AleProgramas platform with a JSON API powered by DataTables.
 * 
 * API Structure:
 * - Endpoint: {baseUrl}/index.php/functions/ajax_lista_diario/{MM-YYYY}
 * - Method: POST
 * - Response: { data: [[edição, data, descrição, html_com_link_pdf], ...] }
 * 
 * Each array item:
 * - [0]: Edition number (e.g., "1155")
 * - [1]: Date (DD/MM/YYYY format)
 * - [2]: Description (e.g., "Diário Eletrônico Oficial ano X - Edição N° 1155")
 * - [3]: HTML with PDF link (contains <a href="...pdf">)
 */
export class PrefeituraDescalvadoSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const descalvadoConfig = config.config as PrefeituraDescalvadoConfig;
    this.baseUrl = descalvadoConfig.baseUrl;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const months = getMonthlySequence(this.startDate, this.endDate);

    logger.info(`Crawling ${this.baseUrl} for ${this.config.name}...`);

    for (const month of months) {
      // Format: MM-YYYY
      const monthStr = String(month.getMonth() + 1).padStart(2, '0');
      const yearStr = String(month.getFullYear());
      const dateParam = `${monthStr}-${yearStr}`;
      
      const url = `${this.baseUrl}/index.php/functions/ajax_lista_diario/${dateParam}`;
      
      logger.debug(`Fetching gazettes for ${dateParam}`);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        });
        
        if (!response.ok) {
          logger.warn(`Failed to fetch ${url}: ${response.status}`);
          continue;
        }

        const json = await response.json() as { data: string[][] };
        
        if (!json.data || !Array.isArray(json.data)) {
          logger.debug(`No data found for ${dateParam}`);
          continue;
        }

        for (const item of json.data) {
          if (!Array.isArray(item) || item.length < 4) {
            continue;
          }

          const [editionNumber, dateStr, description, htmlWithLink] = item;
          
          // Parse date (DD/MM/YYYY)
          const dateMatch = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) {
            logger.warn(`Could not parse date: ${dateStr}`);
            continue;
          }
          
          const [, day, monthPart, year] = dateMatch;
          const documentDate = new Date(`${year}-${monthPart}-${day}`);

          // Filter by date range
          if (documentDate > this.endDate) continue;
          if (documentDate < this.startDate) continue;

          // Extract PDF URL from HTML
          const pdfUrlMatch = htmlWithLink.match(/href=['"](https?:\/\/[^'"]+\.pdf)['"]/i);
          if (!pdfUrlMatch) {
            logger.warn(`Could not extract PDF URL from: ${htmlWithLink}`);
            continue;
          }
          
          const pdfUrl = pdfUrlMatch[1];
          
          // Check if it's an extra edition
          const isExtraEdition = /extra/i.test(description);

          const gazette: Gazette = {
            date: `${year}-${monthPart}-${day}`,
            fileUrl: pdfUrl,
            territoryId: this.config.territoryId,
            scrapedAt: new Date().toISOString(),
            editionNumber: editionNumber || undefined,
            isExtraEdition,
            power: 'executive_legislative',
          };

          gazettes.push(gazette);
        }
      } catch (error) {
        logger.error(`Error fetching gazettes for ${dateParam}: ${error}`);
      }
    }

    logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`);
    return gazettes;
  }
}



