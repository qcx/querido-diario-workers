import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, DiarioOficialOnlineConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for diario-oficial.online platform
 * 
 * This platform is used by some municipalities in Rio de Janeiro (e.g., Bom Jardim).
 * The site has a paginated list of gazette publications with direct PDF links.
 * 
 * URL pattern: https://diario-oficial.online/publicacoes/todas/{page}
 * PDF pattern: /media/publicacoes/{cityId}/{uuid}.pdf
 */
export class DiarioOficialOnlineSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as DiarioOficialOnlineConfig;
    this.baseUrl = platformConfig.baseUrl;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling DiarioOficialOnline for ${this.config.name}...`);

    try {
      let page = 1;
      let hasMorePages = true;
      let foundOlderThanRange = false;

      while (hasMorePages && !foundOlderThanRange) {
        const pageUrl = `${this.baseUrl.replace(/\/\d+$/, '')}/${page}`;
        logger.debug(`Fetching page ${page}: ${pageUrl}`);

        const response = await fetch(pageUrl);
        if (!response.ok) {
          if (response.status === 404) {
            logger.debug(`Page ${page} not found, stopping pagination`);
            break;
          }
          throw new Error(`HTTP request failed: ${response.status}`);
        }

        const html = await response.text();
        const pageGazettes = this.extractGazettesFromHtml(html);

        if (pageGazettes.length === 0) {
          logger.debug(`No gazettes found on page ${page}, stopping pagination`);
          hasMorePages = false;
          break;
        }

        for (const gazette of pageGazettes) {
          const gazetteDate = new Date(gazette.date);
          
          // Check if we've gone past our date range (older than start)
          if (gazetteDate < new Date(this.dateRange.start)) {
            foundOlderThanRange = true;
            logger.debug(`Found gazette older than date range, stopping: ${gazette.date}`);
            continue;
          }

          // Check if gazette is within date range
          if (gazetteDate <= new Date(this.dateRange.end)) {
            gazettes.push(gazette);
            logger.debug(`Found gazette: Edição ${gazette.editionNumber} - ${gazette.date} - ${gazette.fileUrl}`);
          }
        }

        // Check for next page
        hasMorePages = this.hasNextPage(html, page);
        page++;

        // Add delay between requests to be polite
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from DiarioOficialOnline`);
    } catch (error) {
      logger.error(`Error crawling DiarioOficialOnline: ${error}`);
      throw error;
    }

    return gazettes;
  }

  /**
   * Extract gazette information from HTML page
   */
  private extractGazettesFromHtml(html: string): Gazette[] {
    const gazettes: Gazette[] = [];

    // Match pattern for gazette entries
    // Each gazette has: Edição: XXX, Publicado em DD/MM/YYYY, and a PDF link
    const editionRegex = /Edição:\s*(\d+)/g;
    const dateRegex = /Publicado em\s*(\d{2})\/(\d{2})\/(\d{4})/g;
    const pdfRegex = /href="(\/media\/publicacoes\/[^"]+\.pdf)"/g;

    // Extract all editions, dates, and PDF links
    const editions: string[] = [];
    const dates: { day: string; month: string; year: string }[] = [];
    const pdfUrls: string[] = [];

    let match;

    while ((match = editionRegex.exec(html)) !== null) {
      editions.push(match[1]);
    }

    while ((match = dateRegex.exec(html)) !== null) {
      dates.push({
        day: match[1],
        month: match[2],
        year: match[3],
      });
    }

    while ((match = pdfRegex.exec(html)) !== null) {
      pdfUrls.push(match[1]);
    }

    // Combine the extracted data
    const minLength = Math.min(editions.length, dates.length, pdfUrls.length);

    for (let i = 0; i < minLength; i++) {
      const date = dates[i];
      const isoDate = `${date.year}-${date.month}-${date.day}`;
      const fullPdfUrl = `https://diario-oficial.online${pdfUrls[i]}`;

      gazettes.push({
        date: isoDate,
        editionNumber: editions[i],
        fileUrl: fullPdfUrl,
        territoryId: this.config.territoryId,
        isExtraEdition: false,
        power: 'executive',
        scrapedAt: new Date().toISOString(),
      });
    }

    return gazettes;
  }

  /**
   * Check if there's a next page available
   */
  private hasNextPage(html: string, currentPage: number): boolean {
    // Check for pagination links - look for "Próxima" or next page number
    const nextPagePattern = new RegExp(`href="\\?page=${currentPage + 1}"`, 'i');
    const proximaPattern = /aria-label="Próxima"/i;
    
    return nextPagePattern.test(html) || proximaPattern.test(html);
  }
}
