import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraPiraporadobomjesusConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * PrefeituraPiraporadobomjesusSpider implementation
 * 
 * Crawls Pirapora do Bom Jesus's official gazette website.
 * 
 * The spider:
 * 1. Fetches the main page (baseUrl)
 * 2. Parses the widget_recent_entries list to find gazette links
 * 3. For each gazette, fetches the detail page
 * 4. Extracts the PDF URL from the iframe embed-pdf-viewer element
 * 5. The PDF URL is embedded in a Google Docs viewer iframe URL
 * 6. Filters gazettes to match the requested date range
 */
export class PrefeituraPiraporadobomjesusSpider extends BaseSpider {
  protected piraporadobomjesusConfig: PrefeituraPiraporadobomjesusConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.piraporadobomjesusConfig = spiderConfig.config as PrefeituraPiraporadobomjesusConfig;
    
    if (!this.piraporadobomjesusConfig.baseUrl) {
      throw new Error(`PrefeituraPiraporadobomjesusSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraPiraporadobomjesusSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.piraporadobomjesusConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];
    const processedUrls = new Set<string>(); // Track processed PDF URLs to avoid duplicates

    try {
      // Fetch the main page
      logger.debug(`Fetching main page: ${this.piraporadobomjesusConfig.baseUrl}`);
      const html = await this.fetch(this.piraporadobomjesusConfig.baseUrl);
      const $ = this.loadHTML(html);

      // Find the widget_recent_entries widget that contains the gazette list
      const widget = $('.widget_recent_entries');
      
      if (widget.length === 0) {
        logger.warn('No widget_recent_entries found on main page');
        return gazettes;
      }

      // Find all gazette links in the list
      const gazetteLinks = widget.find('ul li a');
      
      logger.debug(`Found ${gazetteLinks.length} gazette links on main page`);

      // Process each gazette link
      for (let i = 0; i < gazetteLinks.length; i++) {
        try {
          const link = gazetteLinks.eq(i);
          let gazetteUrl = link.attr('href');
          
          if (!gazetteUrl) {
            continue;
          }

          // Make URL absolute if relative
          if (!gazetteUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.piraporadobomjesusConfig.baseUrl);
            const baseDomain = `${baseUrlObj.protocol}//${baseUrlObj.host}`;
            const normalizedPath = gazetteUrl.startsWith('/') ? gazetteUrl : `/${gazetteUrl}`;
            gazetteUrl = `${baseDomain}${normalizedPath}`;
          }

          // Extract edition number from link text (e.g., "Edição 141/2025")
          const linkText = link.text().trim();
          const editionMatch = linkText.match(/Edição\s+(\d+)\/(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;
          const editionYear = editionMatch ? editionMatch[2] : undefined;

          // Extract date from the post-date span (e.g., "novembro 12, 2025")
          const listItem = link.parent();
          const dateSpan = listItem.find('.post-date');
          const dateText = dateSpan.text().trim();
          
          let gazetteDate: Date | null = null;
          if (dateText) {
            gazetteDate = this.parsePortugueseDate(dateText);
          }

          // If no date found, skip this gazette
          if (!gazetteDate) {
            logger.debug(`Could not parse date for gazette: ${linkText} - ${dateText}`);
            continue;
          }

          // Check if date is in our crawl range
          if (!this.isInDateRange(gazetteDate)) {
            logger.debug(`Gazette date ${toISODate(gazetteDate)} is outside crawl range`);
            continue;
          }

          // Fetch the gazette detail page to get the PDF URL
          logger.debug(`Fetching gazette detail page: ${gazetteUrl}`);
          const detailHtml = await this.fetch(gazetteUrl);
          const detail$ = this.loadHTML(detailHtml);

          // Find the iframe with class "embed-pdf-viewer"
          const iframe = detail$('iframe.embed-pdf-viewer');
          
          if (iframe.length === 0) {
            logger.warn(`No embed-pdf-viewer iframe found for gazette: ${gazetteUrl}`);
            continue;
          }

          const iframeSrc = iframe.attr('src');
          if (!iframeSrc) {
            logger.warn(`Iframe has no src attribute for gazette: ${gazetteUrl}`);
            continue;
          }

          // Extract PDF URL from Google Docs viewer URL
          // Format: https://docs.google.com/viewer?url=https%3A%2F%2Fimprensa.piraporadobomjesus.net.br%2Fwp-content%2Fuploads%2F2025%2F11%2FDiario-141-assinado.pdf&embedded=true
          const pdfUrl = this.extractPdfUrlFromIframe(iframeSrc);
          
          if (!pdfUrl) {
            logger.warn(`Could not extract PDF URL from iframe src: ${iframeSrc}`);
            continue;
          }

          // Skip if we've already processed this PDF URL
          if (processedUrls.has(pdfUrl)) {
            logger.debug(`Skipping duplicate PDF URL: ${pdfUrl}`);
            continue;
          }

          // Mark URL as processed
          processedUrls.add(pdfUrl);

          // Create the gazette object
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber,
            power: 'executive_legislative',
            sourceText: linkText || `Edição ${editionNumber || 'N/A'}/${editionYear || 'N/A'}`,
          });

          if (gazette) {
            gazettes.push(gazette);
            logger.debug(`Created gazette: ${toISODate(gazetteDate)} - Edição ${editionNumber}/${editionYear} - ${pdfUrl}`);
          }

        } catch (error) {
          logger.error(`Error processing gazette link:`, error as Error);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Parse Portuguese date format (e.g., "novembro 12, 2025")
   */
  private parsePortugueseDate(dateStr: string): Date | null {
    const monthMap: Record<string, number> = {
      'janeiro': 0, 'fevereiro': 1, 'março': 2, 'marco': 2,
      'abril': 3, 'maio': 4, 'junho': 5,
      'julho': 6, 'agosto': 7, 'setembro': 8,
      'outubro': 9, 'novembro': 10, 'dezembro': 11
    };

    // Match pattern: "novembro 12, 2025" or "novembro 12 2025"
    const match = dateStr.match(/(\w+)\s+(\d+)[,\s]+(\d{4})/i);
    if (!match) {
      return null;
    }

    const [, monthName, day, year] = match;
    const month = monthMap[monthName.toLowerCase()];
    
    if (month === undefined) {
      logger.warn(`Unknown month name: ${monthName}`);
      return null;
    }

    return new Date(
      parseInt(year, 10),
      month,
      parseInt(day, 10)
    );
  }

  /**
   * Extract PDF URL from Google Docs viewer iframe src
   * Format: https://docs.google.com/viewer?url=https%3A%2F%2F...&embedded=true
   */
  private extractPdfUrlFromIframe(iframeSrc: string): string | null {
    try {
      const url = new URL(iframeSrc);
      const urlParam = url.searchParams.get('url');
      
      if (urlParam) {
        // URL is already decoded by URLSearchParams
        return urlParam;
      }
      
      // Fallback: try to extract manually if searchParams doesn't work
      const match = iframeSrc.match(/url=([^&]+)/);
      if (match) {
        return decodeURIComponent(match[1]);
      }
      
      return null;
    } catch (error) {
      logger.error(`Error extracting PDF URL from iframe: ${iframeSrc}`, error as Error);
      return null;
    }
  }
}

