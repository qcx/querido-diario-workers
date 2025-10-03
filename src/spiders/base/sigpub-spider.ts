import { BaseGazetteSpider } from './base-gazette-spider';
import { SpiderConfig, Gazette, DateRange, SigpubConfig } from '../../src/types/index';
import { logger } from '../../src/utils/logger';
import { fetchHTML } from '../../utils/http-client';
import { parse } from 'node-html-parser';
import { parseBrazilianDate } from '../../src/utils/date-utils';

export class SigpubSpider extends BaseGazetteSpider {
  protected config: SigpubConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as SigpubConfig;
    logger.info(`Initializing SigpubSpider for ${spiderConfig.name} with URL: ${this.config.url}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.config.url} for ${this.config.name}...`);
    const gazettes: Gazette[] = [];

    try {
      const response = await fetchHTML(this.config.url);
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
            fileUrl = new URL(fileUrl, this.config.url).toString();
          }

          // Attempt to extract date from text or URL. This is highly dependent on the site structure.
          let gazetteDate: string | undefined;
          const dateMatch = text.match(/\d{2}\/\d{2}\/\d{4}/);
          if (dateMatch) {
            gazetteDate = parseBrazilianDate(dateMatch[0]).toISOString().split('T')[0];
          }

          // Placeholder for territoryId and editionNumber, as they are hard to extract generically
          gazettes.push({
            date: gazetteDate || this.dateRange.start, // Fallback to start date if no date found
            fileUrl: fileUrl,
            territoryId: this.spiderConfig.territoryId,
            scrapedAt: new Date().toISOString(),
            editionNumber: 'N/A', // Needs specific parsing for each Sigpub instance
            isExtraEdition: false,
            power: 'executive', // Default, can be overridden
          });
        }
      }
    } catch (error) {
      logger.error(`Error crawling ${this.config.name}:`, error);
    }

    return gazettes;
  }
}

