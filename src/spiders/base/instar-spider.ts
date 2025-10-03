import { BaseGazetteSpider } from './base-gazette-spider';
import { SpiderConfig, Gazette, DateRange, InstarConfig } from '../../types';
import { logger } from '../../utils/logger';
import { fetchHTML } from '../../utils/http-client';
import { parse } from 'node-html-parser';
import { parseBrazilianDate } from '../../utils/date-utils';

export class InstarSpider extends BaseGazetteSpider {
  protected config: InstarConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as InstarConfig;
    logger.info(`Initializing InstarSpider for ${spiderConfig.name} with URL: ${this.config.url}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.config.url} for ${this.config.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Instar spiders often involve a specific API or form submission to get gazettes.
      // This is a simplified example. A full implementation would require inspecting
      // the original Python spider's logic for fetching and parsing.
      const response = await fetchHTML(this.config.url);
      const root = parse(response);

      // Look for links to gazettes, typically PDF links or specific elements
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

