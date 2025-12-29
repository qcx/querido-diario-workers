import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeiturasantosConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for Prefeitura de Santos - Diário Oficial
 * 
 * Site Structure:
 * - URL: https://diariooficial.santos.sp.gov.br/
 * - Contains a hidden textarea with id="datas" that has all available dates
 * - PDF download URL pattern: /edicoes/inicio/download/{YYYY-MM-DD}
 * 
 * The textarea contains a 2D array of dates: [["YYYY-MM-DD", "YYYY-MM-DD", ...]]
 * Available dates start from 2001-05-05
 */
export class PrefeiturasantosSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const santosConfig = config.config as PrefeiturasantosConfig;
    this.baseUrl = santosConfig.baseUrl || 'https://diariooficial.santos.sp.gov.br';
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    logger.info(`Crawling Santos gazettes from ${this.baseUrl}...`);

    try {
      const response = await fetch(this.baseUrl);
      
      if (!response.ok) {
        logger.error(`Failed to fetch ${this.baseUrl}: ${response.status}`);
        return gazettes;
      }

      const html = await response.text();
      
      // Extract dates from the hidden textarea
      // Pattern: <textarea ... id="datas" ...>[["YYYY-MM-DD","YYYY-MM-DD",...]]</textarea>
      const textareaMatch = html.match(/<textarea[^>]*id="datas"[^>]*>\s*(\[\[.*?\]\])\s*<\/textarea>/s);
      
      if (!textareaMatch) {
        logger.error('Could not find dates textarea in page');
        return gazettes;
      }

      const datesJson = textareaMatch[1];
      let allDates: string[][];
      
      try {
        allDates = JSON.parse(datesJson);
      } catch (e) {
        logger.error(`Failed to parse dates JSON: ${e}`);
        return gazettes;
      }

      // Flatten the 2D array (seems to be [[date, date, ...]])
      const flatDates = allDates.flat();
      
      logger.info(`Found ${flatDates.length} total gazette dates`);

      for (const dateStr of flatDates) {
        // Date is in YYYY-MM-DD format
        const documentDate = new Date(dateStr);

        // Filter by date range
        if (documentDate > this.endDate) continue;
        if (documentDate < this.startDate) continue;

        const gazette: Gazette = {
          date: dateStr,
          fileUrl: `${this.baseUrl}/edicoes/inicio/download/${dateStr}`,
          territoryId: this.config.territoryId,
          scrapedAt: new Date().toISOString(),
          power: 'executive',
        };

        gazettes.push(gazette);
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`);
      return gazettes;
    } catch (error) {
      logger.error(`Error crawling Santos gazettes: ${error}`);
      return gazettes;
    }
  }
}

