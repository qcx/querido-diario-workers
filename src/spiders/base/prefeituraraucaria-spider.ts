import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

interface PrefeituraraucariaConfig {
  type: "prefeituraraucaria";
  baseUrl: string;
}

export class PrefeituraraucariaSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraraucariaConfig;
    this.baseUrl = platformConfig.baseUrl;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Araucária GRP gazette for ${this.config.name}...`);

    try {
      let page = 0;
      let hasMore = true;
      const seenUrls = new Set<string>();

      while (hasMore) {
        // Build URL with date filter
        const startParts = this.dateRange.start.split('-');
        const endParts = this.dateRange.end.split('-');
        const dtIni = `${startParts[2]}/${startParts[1]}/${startParts[0]}`;
        const dtFim = `${endParts[2]}/${endParts[1]}/${endParts[0]}`;

        const url = `${this.baseUrl}?pagina=${page}&datapub[ini]=${encodeURIComponent(dtIni)}&datapub[fim]=${encodeURIComponent(dtFim)}`;

        logger.info(`Fetching Araucária page ${page}: ${url}`);

        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html',
          },
        });

        if (!response.ok) {
          logger.warn(`Failed to fetch page ${page}: ${response.status}`);
          break;
        }

        const html = await response.text();
        let foundInPage = 0;

        // Extract rows with dates and associate with PDF links
        // Each row: <tr class="textoTabela"> with columns including date and modal with PDF
        const rowRegex = /<tr[^>]*class="textoTabela"[^>]*>([\s\S]*?)<\/tr>/g;
        let rowMatch;

        while ((rowMatch = rowRegex.exec(html)) !== null) {
          const rowHtml = rowMatch[1];

          // Extract publication date (8th column, DD/MM/YYYY format)
          const dates = rowHtml.match(/(\d{2})\/(\d{2})\/(\d{4})/g) || [];
          const lastDate = dates[dates.length - 1]; // Publication date is usually the last

          if (!lastDate) continue;

          const [day, month, year] = lastDate.split('/');
          const isoDate = `${year}-${month}-${day}`;

          if (isoDate < this.dateRange.start || isoDate > this.dateRange.end) continue;

          // Extract PDF URL from modal in this row
          const pdfMatch = rowHtml.match(/href="([^"]*uploads\/publicacao\/[^"]*\.pdf)"/);
          if (!pdfMatch) continue;

          let pdfUrl = pdfMatch[1];
          if (pdfUrl.startsWith('../../')) {
            pdfUrl = pdfUrl.replace('../../', '');
            const baseUrlObj = new URL(this.baseUrl);
            pdfUrl = `${baseUrlObj.origin}/grp/diario/${pdfUrl}`;
          } else if (!pdfUrl.startsWith('http')) {
            pdfUrl = new URL(pdfUrl, this.baseUrl).toString();
          }

          if (seenUrls.has(pdfUrl)) continue;
          seenUrls.add(pdfUrl);
          foundInPage++;

          // Extract edition info
          const editionMatch = rowHtml.match(/>(\d+\/\d{4})</);
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

        // Check if there's a next page
        const nextPageExists = html.includes(`pagina=${page + 1}`);
        hasMore = nextPageExists && foundInPage > 0;

        if (hasMore) {
          page++;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      logger.info(`Found ${gazettes.length} gazettes for Araucária`);
    } catch (error) {
      logger.error(`Error crawling Araucária: ${error}`);
    }

    return gazettes;
  }
}
