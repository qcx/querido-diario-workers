import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, DateRange } from '../../types';
import { logger } from '../../utils/logger';

interface PrefeiturasjpConfig {
  type: "prefeiturasjp";
  baseUrl: string;
  entityId?: string;
}

export class PrefeiturasjpSpider extends BaseSpider {
  private baseUrl: string;
  private entityId: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as unknown as PrefeiturasjpConfig;
    this.baseUrl = platformConfig.baseUrl;
    this.entityId = platformConfig.entityId || '12526'; // Município de São José dos Pinhais
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling São José dos Pinhais gazette for ${this.config.name}...`);

    try {
      // Format dates for the query (DD/MM/YYYY)
      const startParts = this.dateRange.start.split('-');
      const endParts = this.dateRange.end.split('-');
      const dtDe = `${startParts[2]}/${startParts[1]}/${startParts[0]}`;
      const dtAte = `${endParts[2]}/${endParts[1]}/${endParts[0]}`;

      const url = `${this.baseUrl}?entidade=${this.entityId}&dt_publicacao_de=${encodeURIComponent(dtDe)}&dt_publicacao_ate=${encodeURIComponent(dtAte)}`;

      logger.info(`Fetching SJP: ${url}`);

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html',
        },
      });

      if (!response.ok) {
        logger.warn(`Failed to fetch SJP page: ${response.status}`);
        return gazettes;
      }

      const html = await response.text();

      // Extract gazette items from item-publicacao blocks
      const itemRegex = /<div[^>]*class="[^"]*item-publicacao[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
      let match;

      while ((match = itemRegex.exec(html)) !== null) {
        const itemHtml = match[1];

        // Extract PDF URL
        const pdfMatch = itemHtml.match(/href="([^"]*sisazul[^"]*\.pdf)"/i) ||
                         itemHtml.match(/href="([^"]*\.pdf)"/i);
        if (!pdfMatch) continue;

        let pdfUrl = pdfMatch[1];
        if (!pdfUrl.startsWith('http')) {
          pdfUrl = new URL(pdfUrl, this.baseUrl).toString();
        }

        // Extract date (DD/MM/YYYY)
        const dateMatch = itemHtml.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (!dateMatch) continue;

        const [, day, month, year] = dateMatch;
        const isoDate = `${year}-${month}-${day}`;

        if (isoDate < this.dateRange.start || isoDate > this.dateRange.end) {
          continue;
        }

        // Extract edition number
        const editionMatch = itemHtml.match(/Edição[:\s]*(\d+)/i) ||
                             itemHtml.match(/(\d+)\s*\/\s*\d{4}/);
        const editionNumber = editionMatch ? editionMatch[1] : undefined;

        const isExtra = itemHtml.toLowerCase().includes('extraordin');

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

      // Fallback: try to find all PDF links with dates
      if (gazettes.length === 0) {
        const pdfLinkRegex = /href="([^"]*sisazul\.sjp\.pr\.gov\.br[^"]*\.pdf)"/g;
        let pdfMatch;
        while ((pdfMatch = pdfLinkRegex.exec(html)) !== null) {
          const pdfUrl = pdfMatch[1];

          // Try to extract date from filename (YYYYMMDD pattern)
          const fileDateMatch = pdfUrl.match(/(\d{4})(\d{2})(\d{2})/);
          if (fileDateMatch) {
            const isoDate = `${fileDateMatch[1]}-${fileDateMatch[2]}-${fileDateMatch[3]}`;
            if (isoDate >= this.dateRange.start && isoDate <= this.dateRange.end) {
              gazettes.push({
                date: isoDate,
                fileUrl: pdfUrl,
                territoryId: this.config.territoryId,
                isExtraEdition: false,
                power: 'executive',
                scrapedAt: new Date().toISOString(),
              });
            }
          }
        }
      }

      logger.info(`Found ${gazettes.length} gazettes for São José dos Pinhais`);
    } catch (error) {
      logger.error(`Error crawling SJP: ${error}`);
    }

    return gazettes;
  }
}
