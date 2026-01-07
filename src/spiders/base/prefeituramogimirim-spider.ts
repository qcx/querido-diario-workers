import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraMogiMirimConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * PrefeituraMogiMirimSpider implementation
 * 
 * Crawls Mogi Mirim's Jornal Oficial website which uses paginated pages
 * to display gazettes in reverse chronological order.
 * 
 * Site structure (Dynamika Web CMS):
 * - Base URL: https://www.mogimirim.sp.gov.br/jornal
 * - Pagination: ?page=N
 * - PDFs: Direct links to /uploads/jornal/{id}/{hash}.pdf
 * - Titles: "Jornal Oficial de Mogi Mirim - {edition}" or "Jornal Oficial Extra de Mogi Mirim - {edition}"
 * - IMPORTANT: The page does NOT contain publication dates, so we use the PDF's Last-Modified header
 * 
 * HTML Structure:
 * - Container: div.box-lista-jornal
 * - Link: a[href$=".pdf"]
 * - Title: h4 > strong
 * 
 * The spider:
 * 1. Starts with base URL (page 1)
 * 2. Handles pagination via ?page=N
 * 3. Extracts PDF URLs and titles from the page
 * 4. Makes HEAD requests to get Last-Modified date for each PDF
 * 5. Filters gazettes to match the requested date range
 * 6. Stops crawling when dates fall outside the requested range
 */
export class PrefeituraMogiMirimSpider extends BaseSpider {
  protected mogiMirimConfig: PrefeituraMogiMirimConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.mogiMirimConfig = spiderConfig.config as PrefeituraMogiMirimConfig;
    
    if (!this.mogiMirimConfig.baseUrl) {
      throw new Error(`PrefeituraMogiMirimSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraMogiMirimSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.mogiMirimConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];
    const processedUrls = new Set<string>();

    try {
      let pageNumber = 1;
      let hasMorePages = true;
      let shouldStop = false;
      let consecutiveOldGazettes = 0;
      const maxConsecutiveOldGazettes = 5; // Stop after finding 5 consecutive old gazettes

      while (hasMorePages && !shouldStop) {
        try {
          // Build page URL
          const pageUrl = pageNumber === 1 
            ? this.mogiMirimConfig.baseUrl 
            : `${this.mogiMirimConfig.baseUrl}?page=${pageNumber}`;
          logger.debug(`Fetching page ${pageNumber}: ${pageUrl}`);

          const html = await this.fetch(pageUrl);
          const $ = this.loadHTML(html);

          // Find all gazette containers
          const gazetteBoxes = $('div.box-lista-jornal');
          logger.debug(`Found ${gazetteBoxes.length} gazette boxes on page ${pageNumber}`);

          if (gazetteBoxes.length === 0) {
            logger.debug(`No gazette boxes found on page ${pageNumber}`);
            hasMorePages = false;
            break;
          }

          // Process each gazette box
          for (let i = 0; i < gazetteBoxes.length; i++) {
            if (shouldStop) break;
            
            try {
              const $box = $(gazetteBoxes[i]);
              
              // Extract PDF URL from anchor
              const pdfUrl = $box.find('a[href$=".pdf"]').attr('href');
              
              if (!pdfUrl) {
                logger.debug('Skipping box without PDF URL');
                continue;
              }

              // Make URL absolute
              let absolutePdfUrl: string;
              if (pdfUrl.startsWith('http')) {
                absolutePdfUrl = pdfUrl;
              } else {
                const baseUrlObj = new URL(this.mogiMirimConfig.baseUrl);
                absolutePdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
              }

              // Skip if already processed
              if (processedUrls.has(absolutePdfUrl)) {
                logger.debug(`Skipping duplicate PDF URL: ${absolutePdfUrl}`);
                continue;
              }

              // Extract title (e.g., "Jornal Oficial Extra de Mogi Mirim - 1054")
              const titleText = $box.find('h4 strong').text().trim();
              
              // Extract edition number from title
              const editionMatch = titleText.match(/(\d+)\s*$/);
              const editionNumber = editionMatch ? editionMatch[1] : undefined;
              
              // Check if it's an extra edition
              const isExtraEdition = /Extra/i.test(titleText);

              // Get the Last-Modified date from PDF HEAD request
              const gazetteDate = await this.getLastModifiedDate(absolutePdfUrl);
              
              if (!gazetteDate) {
                logger.warn(`Could not get Last-Modified date for: ${absolutePdfUrl}`);
                continue;
              }

              // Check if date is in our crawl range
              if (!this.isInDateRange(gazetteDate)) {
                const dateISO = toISODate(gazetteDate);
                logger.debug(`Gazette date ${dateISO} is outside crawl range`);
                
                // Since results are in reverse chronological order (newest first),
                // if we encounter dates before our start date, count consecutive old gazettes
                if (dateISO < this.dateRange.start) {
                  consecutiveOldGazettes++;
                  if (consecutiveOldGazettes >= maxConsecutiveOldGazettes) {
                    logger.info(`Found ${maxConsecutiveOldGazettes} consecutive old gazettes, stopping crawl`);
                    shouldStop = true;
                  }
                }
                continue;
              }

              // Reset counter when we find a gazette in range
              consecutiveOldGazettes = 0;

              // Mark URL as processed
              processedUrls.add(absolutePdfUrl);

              // Create the gazette
              const gazette = await this.createGazette(gazetteDate, absolutePdfUrl, {
                editionNumber,
                isExtraEdition,
                power: 'executive_legislative',
                sourceText: titleText || `Jornal Oficial de Mogi Mirim`,
              });

              if (gazette) {
                gazettes.push(gazette);
                logger.debug(`Added gazette: ${titleText} - ${toISODate(gazetteDate)}`);
              }

            } catch (error) {
              logger.error(`Error processing gazette box:`, error as Error);
            }
          }

          // Check if there's a next page (look for pagination links)
          const paginationLinks = $('ul li a[href*="page="]');
          const nextPageExists = paginationLinks.filter((_, el) => {
            const href = $(el).attr('href');
            return href?.includes(`page=${pageNumber + 1}`);
          }).length > 0;

          hasMorePages = nextPageExists && !shouldStop;
          pageNumber++;

          // Add delay between pages to avoid rate limiting
          if (hasMorePages && !shouldStop) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }

        } catch (error) {
          logger.error(`Error fetching page ${pageNumber}:`, error as Error);
          hasMorePages = false;
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Get the Last-Modified date from a PDF URL via HEAD request
   */
  private async getLastModifiedDate(pdfUrl: string): Promise<Date | null> {
    try {
      const response = await fetch(pdfUrl, { method: 'HEAD' });
      this.requestCount++;
      
      const lastModified = response.headers.get('Last-Modified');
      
      if (!lastModified) {
        logger.debug(`No Last-Modified header for: ${pdfUrl}`);
        return null;
      }

      // Parse the Last-Modified header (format: "Mon, 29 Dec 2025 15:38:29 GMT")
      const date = new Date(lastModified);
      
      if (isNaN(date.getTime())) {
        logger.warn(`Could not parse Last-Modified date: ${lastModified}`);
        return null;
      }

      return date;
      
    } catch (error) {
      logger.error(`Error getting Last-Modified for ${pdfUrl}:`, error as Error);
      return null;
    }
  }
}



