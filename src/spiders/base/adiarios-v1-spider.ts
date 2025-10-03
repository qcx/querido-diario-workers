import { BaseGazetteSpider } from './base-gazette-spider';
import { SpiderConfig, Gazette, DateRange, AdiariosConfig } from '../../types';
import { logger } from '../../utils/logger';
import { fetchHTML } from '../../utils/http-client';
import { parse } from 'node-html-parser';
import { parseBrazilianDate } from '../../utils/date-utils';

export class ADiariosV1Spider extends BaseGazetteSpider {  protected config: AdiariosConfig;
  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as ADiariosV1Config;
    logger.info(`Initializing ADiariosV1Spider for ${spiderConfig.name} with URL: ${this.config.url}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.config.url} for ${this.config.name}...`);
    const gazettes: Gazette[] = [];

    try {
      const response = await fetchHTML(this.config.baseUrl);
      const root = parse(response);

      const links = root.querySelectorAll('a');

      for (const link of links) {
        const href = link.getAttribute('href');
        const text = link.text.trim();

        if (href && (href.includes('.pdf') || text.includes('Diário Oficial')) && !href.includes('javascript')) {
          let fileUrl = href;
          if (fileUrl.startsWith('/')) {
            fileUrl = new URL(fileUrl, this.config.url).toString();
          }

          let gazetteDate: string | undefined;
          const dateMatch = text.match(/\d{2}\/\d{2}\/\d{4}/);
          if (dateMatch) {
            gazetteDate = parseBrazilianDate(dateMatch[0]).toISOString().split('T')[0];
          }

          gazettes.push({
            date: gazetteDate || this.dateRange.start,
            fileUrl: fileUrl,
            territoryId: this.spiderConfig.territoryId,
            scrapedAt: new Date().toISOString(),
            editionNumber: 'N/A',
            isExtraEdition: false,
            power: 'executive',
          });
        }
      }
    } catch (error) {
      logger.error(`Error crawling ${this.config.name}:`, error);
    }

    return gazettes;
  }
}

