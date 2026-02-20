import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraCajamarConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * PrefeituraCajamarSpider implementation
 * 
 * Crawls Cajamar's official gazette website which uses year/month URLs
 * to display gazettes for a specific period.
 * 
 * The spider:
 * 1. Builds URL with year/month: {baseUrl}/YYYY/MM/
 * 2. Handles pagination: {baseUrl}/YYYY/MM/page/N/
 * 3. Fetches HTML page with list of gazettes
 * 4. Parses HTML to find items in ul.diarios-lista li.clearfix
 * 5. Extracts PDF URLs from div.edicao-download a href attributes
 * 6. Extracts dates from "Publicada em DD/MM/YYYY" text
 * 7. Extracts edition numbers from "Edição nº NNN" or "Edição Extraordinária" text
 * 8. Filters gazettes to match the requested date range
 */
export class PrefeituraCajamarSpider extends BaseSpider {
  protected cajamarConfig: PrefeituraCajamarConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.cajamarConfig = spiderConfig.config as PrefeituraCajamarConfig;
    
    if (!this.cajamarConfig.baseUrl) {
      throw new Error(`PrefeituraCajamarSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraCajamarSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.cajamarConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];
    const processedUrls = new Set<string>(); // Track processed PDF URLs to avoid duplicates

    try {
      // Generate month URLs
      const monthUrls = this.generateMonthUrls();
      logger.info(`Generated ${monthUrls.length} month URLs to check`);

      // Fetch pages for each month
      for (const monthUrl of monthUrls) {
        try {
          const monthGazettes = await this.crawlMonth(monthUrl, processedUrls);
          gazettes.push(...monthGazettes);
        } catch (error) {
          logger.error(`Error crawling month ${monthUrl}:`, error as Error);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Generate list of month URLs from start date to end date
   * Format: {baseUrl}/YYYY/MM/ (e.g., https://cajamar.sp.gov.br/diariooficial/2025/09/)
   */
  private generateMonthUrls(): string[] {
    const urls: string[] = [];
    const current = new Date(this.startDate.getFullYear(), this.startDate.getMonth(), 1);
    const end = new Date(this.endDate.getFullYear(), this.endDate.getMonth(), 1);

    while (current <= end) {
      const year = current.getFullYear();
      const month = String(current.getMonth() + 1).padStart(2, '0');
      const url = `${this.cajamarConfig.baseUrl}/${year}/${month}/`;
      urls.push(url);
      
      // Move to next month
      current.setMonth(current.getMonth() + 1);
    }

    return urls;
  }

  /**
   * Crawl all gazettes for a specific month (with pagination support)
   */
  private async crawlMonth(monthUrl: string, processedUrls: Set<string>): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let pageNumber = 1;
    let hasMorePages = true;

    while (hasMorePages) {
      try {
        // Build page URL (first page has no /page/N/ suffix)
        const pageUrl = pageNumber === 1 ? monthUrl : `${monthUrl}page/${pageNumber}/`;
        logger.debug(`Fetching page: ${pageUrl}`);

        const html = await this.fetch(pageUrl);
        const $ = this.loadHTML(html);

        // Find the list container
        const listContainer = $('ul.diarios-lista');
        
        if (listContainer.length === 0) {
          logger.debug(`No gazette list container found on page ${pageNumber} of ${monthUrl}`);
          hasMorePages = false;
          break;
        }

        // Find all gazette items
        const gazetteItems = listContainer.find('li.clearfix');
        logger.debug(`Found ${gazetteItems.length} gazette items on page ${pageNumber}`);

        if (gazetteItems.length === 0) {
          hasMorePages = false;
          break;
        }

        // Process each gazette item
        const gazettePromises: Promise<Gazette | null>[] = [];
        
        gazetteItems.each((_, element) => {
          try {
            const $item = $(element);
            
            // Extract PDF URL from download button
            const pdfUrl = $item.find('div.edicao-download a').attr('href');
            
            if (!pdfUrl) {
              logger.debug('Skipping item without PDF URL');
              return;
            }

            // Skip if we've already processed this URL
            if (processedUrls.has(pdfUrl)) {
              logger.debug(`Skipping duplicate PDF URL: ${pdfUrl}`);
              return;
            }

            // Make URL absolute if relative
            let absolutePdfUrl: string;
            if (pdfUrl.startsWith('http')) {
              absolutePdfUrl = pdfUrl;
            } else {
              const baseUrlObj = new URL(this.cajamarConfig.baseUrl);
              const baseDomain = `${baseUrlObj.protocol}//${baseUrlObj.host}`;
              const normalizedPath = pdfUrl.startsWith('/') ? pdfUrl : `/${pdfUrl}`;
              absolutePdfUrl = `${baseDomain}${normalizedPath}`;
            }

            // Extract edition title (e.g., "Edição nº 1531" or "Edição Extraordinária")
            const editionTitle = $item.find('div.diario-titulo').text().trim();
            
            // Extract edition number
            const editionMatch = editionTitle.match(/Edição\s+nº\s+(\d+)/i);
            const editionNumber = editionMatch ? editionMatch[1] : undefined;
            
            // Check if it's an extra edition
            const isExtraEdition = /extraordinária|extra/i.test(editionTitle);

            // Extract publication date from meta (e.g., "Publicada em 30/09/2025")
            const dateText = $item.find('div.diario-meta').text().trim();
            const dateMatch = dateText.match(/Publicada\s+em\s+(\d{2})\/(\d{2})\/(\d{4})/i);
            
            if (!dateMatch) {
              logger.warn(`Could not extract date from item: ${editionTitle}`);
              return;
            }

            // Parse date (DD/MM/YYYY format)
            const day = parseInt(dateMatch[1], 10);
            const month = parseInt(dateMatch[2], 10) - 1; // JavaScript months are 0-indexed
            const year = parseInt(dateMatch[3], 10);
            const gazetteDate = new Date(year, month, day);

            // Check if date is in our crawl range
            if (!this.isInDateRange(gazetteDate)) {
              logger.debug(`Gazette date ${toISODate(gazetteDate)} is outside crawl range`);
              return;
            }

            // Mark URL as processed
            processedUrls.add(pdfUrl);

            // Create the gazette object promise
            gazettePromises.push(
              this.createGazette(gazetteDate, absolutePdfUrl, {
                editionNumber,
                isExtraEdition,
                power: 'executive_legislative',
                sourceText: editionTitle,
              })
            );

          } catch (error) {
            logger.error(`Error processing gazette item:`, error as Error);
          }
        });

        // Await all gazette creation promises for this page
        const results = await Promise.all(gazettePromises);
        for (const gazette of results) {
          if (gazette) {
            gazettes.push(gazette);
          }
        }

        // Check if there's a next page
        // Look for pagination div with links
        const paginationDiv = $('div.paginacao');
        if (paginationDiv.length > 0) {
          // Check if there's a link to the next page
          const nextPageLink = paginationDiv.find(`a[href*='/page/${pageNumber + 1}/']`);
          hasMorePages = nextPageLink.length > 0;
        } else {
          hasMorePages = false;
        }

        pageNumber++;

        // Add delay between pages to avoid rate limiting
        if (hasMorePages) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }

      } catch (error) {
        logger.error(`Error fetching page ${pageNumber} of ${monthUrl}:`, error as Error);
        hasMorePages = false;
      }
    }

    return gazettes;
  }
}

