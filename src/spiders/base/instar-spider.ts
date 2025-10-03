import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, InstarConfig } from '../../types';
import { logger } from '../../utils/logger';
// @ts-ignore
import { parse } from 'node-html-parser';
import { parseBrazilianDate } from '../../utils/date-utils';

export class InstarSpider extends BaseSpider {
  protected instarConfig: InstarConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.instarConfig = spiderConfig.config as InstarConfig;
    logger.info(`Initializing InstarSpider for ${spiderConfig.name} with URL: ${this.instarConfig.url}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.instarConfig.url} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Instar spiders often involve a specific API or form submission to get gazettes.
      // This is a simplified example. A full implementation would require inspecting
      // the original Python spider's logic for fetching and parsing.
      const response = await this.fetch(this.instarConfig.url);
      const root = parse(response);

      // Look for links to gazettes, typically PDF links or specific elements
      const links = root.querySelectorAll('a');

      for (const link of links) {
        const href = link.getAttribute('href');
        const text = link.text.trim();

        if (href && (href.includes('.pdf') || text.includes('Diário Oficial')) && !href.includes('javascript')) {
          let fileUrl = href;
          if (fileUrl.startsWith('/')) {
            fileUrl = new URL(fileUrl, this.instarConfig.url).toString();
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

