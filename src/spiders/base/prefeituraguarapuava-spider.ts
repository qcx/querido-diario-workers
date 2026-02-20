import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, DateRange } from '../../types';
import { logger } from '../../utils/logger';

interface PrefeituraguarapuavaConfig {
  type: "prefeituraguarapuava";
  baseUrl: string;
}

export class PrefeituraguarapuavaSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as unknown as PrefeituraguarapuavaConfig;
    this.baseUrl = platformConfig.baseUrl;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Guarapuava gazette for ${this.config.name}...`);

    try {
      // Determine which years we need to check
      const startYear = parseInt(this.dateRange.start.split('-')[0]);
      const endYear = parseInt(this.dateRange.end.split('-')[0]);

      for (let year = endYear; year >= startYear; year--) {
        const yearUrl = `${this.baseUrl}${year}-2/`;
        logger.info(`Fetching Guarapuava year page: ${yearUrl}`);

        const response = await fetch(yearUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html',
          },
        });

        if (!response.ok) {
          logger.warn(`Failed to fetch year ${year}: ${response.status}`);
          continue;
        }

        const html = await response.text();

        // Extract all PDF links with dates
        // Pattern: <a href="...Boletim-Oficial...pdf">Boletim Oficial 3345 - 11/02/2026</a>
        const linkRegex = /<a[^>]*href="([^"]*\.pdf)"[^>]*>([^<]*Boletim[^<]*)<\/a>/gi;
        let match;

        while ((match = linkRegex.exec(html)) !== null) {
          let pdfUrl = match[1];
          const linkText = match[2];

          if (!pdfUrl.startsWith('http')) {
            pdfUrl = new URL(pdfUrl, yearUrl).toString();
          }

          // Extract date from link text (DD/MM/YYYY)
          const dateMatch = linkText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) continue;

          const [, day, month, yr] = dateMatch;
          const isoDate = `${yr}-${month}-${day}`;

          if (isoDate < this.dateRange.start || isoDate > this.dateRange.end) {
            continue;
          }

          // Extract edition number
          const editionMatch = linkText.match(/Boletim\s+Oficial\s+(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;

          gazettes.push({
            date: isoDate,
            editionNumber,
            fileUrl: pdfUrl,
            territoryId: this.config.territoryId,
            isExtraEdition: false,
            power: 'executive',
            scrapedAt: new Date().toISOString(),
          });
        }

        await new Promise(resolve => setTimeout(resolve, 300));
      }

      logger.info(`Found ${gazettes.length} gazettes for Guarapuava`);
    } catch (error) {
      logger.error(`Error crawling Guarapuava: ${error}`);
    }

    return gazettes;
  }
}
