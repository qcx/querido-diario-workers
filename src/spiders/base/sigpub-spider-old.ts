import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, SigpubConfig } from '../../types';
import { logger } from '../../utils/logger';
// @ts-ignore
import { parse } from 'node-html-parser';
import { parseBrazilianDate } from '../../utils/date-utils';

export class SigpubSpider extends BaseSpider {
  protected sigpubConfig: SigpubConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.sigpubConfig = spiderConfig.config as SigpubConfig;
    logger.info(`Initializing SigpubSpider for ${spiderConfig.name} with URL: ${this.sigpubConfig.url}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.sigpubConfig.url} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      const response = await this.fetch(this.sigpubConfig.url);
      const root = parse(response);

      // This is a simplified example. Sigpub spiders often involve form submissions and pagination.
      // For now, we'll assume a direct parse of the main page for links.
      const links = root.querySelectorAll('a');

      for (const link of links) {
        const href = link.getAttribute('href');
        const text = link.text.trim();

        // Example: Look for links that might contain gazettes (e.g., PDF links or specific text)
        if (href && (href.includes('.pdf') || text.includes('Diário Oficial')) && !href.includes('javascript')) {
          let fileUrl = href;
          if (fileUrl.startsWith('/')) {
            fileUrl = new URL(fileUrl, this.sigpubConfig.url).toString();
          }

          // Attempt to extract date from text or URL. This is highly dependent on the site structure.
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

