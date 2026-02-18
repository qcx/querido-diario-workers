import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, DateRange } from '../../types';
import { logger } from '../../utils/logger';

interface PrefeituralondrinaConfig {
  type: "prefeituralondrina";
  baseUrl: string;
}

export class PrefeituralondrinaSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as unknown as PrefeituralondrinaConfig;
    this.baseUrl = platformConfig.baseUrl;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Londrina gazette for ${this.config.name}...`);

    try {
      const response = await fetch(this.baseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html',
        },
      });

      if (!response.ok) {
        logger.warn(`Failed to fetch Londrina page: ${response.status}`);
        return gazettes;
      }

      const html = await response.text();

      // Extract gazette items from list-group-items
      // Each item has a PDF link and a date
      const itemRegex = /<li[^>]*class="list-group-item"[^>]*>([\s\S]*?)<\/li>/g;
      let match;

      while ((match = itemRegex.exec(html)) !== null) {
        const itemHtml = match[1];

        // Extract PDF URL
        const pdfMatch = itemHtml.match(/href="([^"]*jornalOficial[^"]*\.pdf)"/i) ||
                         itemHtml.match(/href="([^"]*\.pdf)"/i);
        if (!pdfMatch) continue;

        let pdfUrl = pdfMatch[1];
        if (!pdfUrl.startsWith('http')) {
          pdfUrl = new URL(pdfUrl, this.baseUrl).toString();
        }

        // Extract date
        const dateMatch = itemHtml.match(/Publicado em (\d{2})\/(\d{2})\/(\d{4})/);
        if (!dateMatch) continue;

        const [, day, month, year] = dateMatch;
        const isoDate = `${year}-${month}-${day}`;

        // Check date range
        if (isoDate < this.dateRange.start || isoDate > this.dateRange.end) {
          continue;
        }

        // Extract edition number from filename (Jornal-XXXX-Assinado.pdf)
        const editionMatch = pdfUrl.match(/Jornal-(\d+)/i);
        const editionNumber = editionMatch ? editionMatch[1] : undefined;
        const isExtra = pdfUrl.toLowerCase().includes('extra');

        gazettes.push({
          date: isoDate,
          editionNumber,
          fileUrl: pdfUrl,
          territoryId: this.config.territoryId,
          isExtraEdition: isExtra,
          power: 'executive',
          scrapedAt: new Date().toISOString(),
        });
      }

      logger.info(`Found ${gazettes.length} gazettes for Londrina`);
    } catch (error) {
      logger.error(`Error crawling Londrina: ${error}`);
    }

    return gazettes;
  }
}
