import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraBatataisConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * PrefeituraBatataisSpider implementation
 * 
 * Crawls Batatais's official gazette website which uses date-based URLs
 * to display gazettes for a specific date.
 * 
 * The spider:
 * 1. Builds URL with date parameter: {baseUrl}?d=YYYY-MM-DD
 * 2. Fetches HTML page with list of gazettes
 * 3. Parses HTML to find cards in .content .card.border-0
 * 4. Extracts PDF URLs from .card-buttons a.btn.btn-purple.icone-download href attributes
 * 5. Extracts dates from "Publicação: DD/MM/YYYY" text
 * 6. Extracts edition numbers from "Diário Oficial N.° NNN/YYYY" text
 * 7. Filters gazettes to match the requested date range
 */
export class PrefeituraBatataisSpider extends BaseSpider {
  protected batataisConfig: PrefeituraBatataisConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.batataisConfig = spiderConfig.config as PrefeituraBatataisConfig;
    
    if (!this.batataisConfig.baseUrl) {
      throw new Error(`PrefeituraBatataisSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraBatataisSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.batataisConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];
    const processedUrls = new Set<string>(); // Track processed PDF URLs to avoid duplicates

    try {
      // Generate dates to check (daily intervals)
      const dates = this.generateDateRange();
      logger.info(`Generated ${dates.length} dates to check`);

      // Fetch pages for each date
      for (const date of dates) {
        try {
          const dateStr = this.formatDateForUrl(date);
          const searchUrl = `${this.batataisConfig.baseUrl}?d=${dateStr}`;
          
          logger.debug(`Fetching URL: ${searchUrl}`);

          const html = await this.fetch(searchUrl);
          const $ = this.loadHTML(html);

          // Find the content container
          const contentContainer = $('.content');
          
          if (contentContainer.length === 0) {
            logger.debug(`No content container found for date ${dateStr}`);
            continue;
          }

          // Find all gazette cards
          const gazetteCards = contentContainer.find('.card.border-0');
          logger.debug(`Found ${gazetteCards.length} gazette cards for date ${dateStr}`);

          // Process each card and collect promises
          const gazettePromises: Promise<Gazette | null>[] = [];
          
          gazetteCards.each((_, element) => {
            try {
              const $card = $(element);
              
              // Extract PDF URL from download button
              const pdfUrl = $card.find('.card-buttons a.btn.btn-purple.icone-download').attr('href');
              
              if (!pdfUrl) {
                logger.debug('Skipping card without PDF URL');
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
                const baseUrlObj = new URL(this.batataisConfig.baseUrl);
                const baseDomain = `${baseUrlObj.protocol}//${baseUrlObj.host}`;
                const normalizedPath = pdfUrl.startsWith('/') ? pdfUrl : `/${pdfUrl}`;
                absolutePdfUrl = `${baseDomain}${normalizedPath}`;
              }

              // Extract card text spans
              const cardTextSpans = $card.find('.card-text span');
              
              // Extract edition number from first span (e.g., "Diário Oficial N.° 938/2025" or "936-A EDIÇÃO EXTRA")
              const editionText = cardTextSpans.eq(0).text().trim();
              const editionMatch = editionText.match(/N\.°\s*(\d+)(?:[-\/](\d+))?/i);
              const editionNumber = editionMatch ? editionMatch[1] : undefined;
              
              // Check if it's an extra edition
              const isExtraEdition = /extra|edição extra/i.test(editionText);

              // Extract publication date from second span (e.g., "Publicação: 10/11/2025")
              const dateText = cardTextSpans.eq(1).text().trim();
              const dateMatch = dateText.match(/Publicação:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
              
              if (!dateMatch) {
                logger.warn(`Could not extract date from card: ${editionText}`);
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
                  sourceText: editionText,
                })
              );

            } catch (error) {
              logger.error(`Error processing gazette card:`, error as Error);
            }
          });

          // Await all gazette creation promises for this date
          const results = await Promise.all(gazettePromises);
          for (const gazette of results) {
            if (gazette) {
              gazettes.push(gazette);
            }
          }

          // Add delay between requests to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));

        } catch (error) {
          logger.error(`Error fetching date ${toISODate(date)}:`, error as Error);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Generate array of dates to check (daily intervals)
   */
  private generateDateRange(): Date[] {
    const dates: Date[] = [];
    const currentDate = new Date(this.startDate);
    const endDate = new Date(this.endDate);

    while (currentDate <= endDate) {
      dates.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return dates;
  }

  /**
   * Format date for URL: YYYY-MM-DD
   * Example: new Date(2025, 10, 12) -> "2025-11-12"
   */
  private formatDateForUrl(date: Date): string {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

