import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, AdiariosConfig } from '../../types';
import { logger } from '../../utils/logger';
// @ts-ignore
import { parse } from 'node-html-parser';
import { parseBrazilianDate } from '../../utils/date-utils';

export class ADiariosV1Spider extends BaseSpider {
  protected adiariosConfig: AdiariosConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.adiariosConfig = spiderConfig.config as AdiariosConfig;
    logger.info(`Initializing ADiariosV1Spider for ${spiderConfig.name} with URL: ${this.adiariosConfig.baseUrl}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.adiariosConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      const response = await this.fetch(this.adiariosConfig.baseUrl);
      const root = parse(response);

      const links = root.querySelectorAll('a');

      for (const link of links) {
        const href = link.getAttribute('href');
        const text = link.text.trim();

        if (href && (href.includes('.pdf') || text.includes('Diário Oficial')) && !href.includes('javascript')) {
          let fileUrl = href;
          if (fileUrl.startsWith('/')) {
            fileUrl = new URL(fileUrl, this.adiariosConfig.baseUrl).toString();
          }

          let gazetteDate: Date | undefined;
          const dateMatch = text.match(/\d{2}\/\d{2}\/\d{4}/);
          if (dateMatch) {
            gazetteDate = parseBrazilianDate(dateMatch[0]);
          }

          if (gazetteDate && this.isInDateRange(gazetteDate)) {
            gazettes.push(this.createGazette(gazetteDate, fileUrl, {
              editionNumber: 'N/A',
              isExtraEdition: false,
              power: 'executive',
            }));
          }
        }
      }
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }
}

