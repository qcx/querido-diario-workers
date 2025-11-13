import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraCosmopolisConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * PrefeituraCosmopolisSpider implementation
 * 
 * Crawls Cosmópolis's Semanário Eletrônico website which uses paginated pages
 * to display gazettes in reverse chronological order.
 * 
 * The spider:
 * 1. Starts with base URL (page 1)
 * 2. Handles pagination: {baseUrl}/page/N/
 * 3. Fetches HTML page with list of gazettes
 * 4. Parses HTML to find articles in article.post-wrap
 * 5. Extracts PDF URLs from h2.post-title a.post-title-link href attributes
 * 6. Extracts dates from time.date.update datetime attributes (ISO format)
 * 7. Extracts edition numbers from title text (pattern: "EDIÇÃO NNNN" or "EDIÇÃO NNNN – EXTRAORDINÁRIA")
 * 8. Filters gazettes to match the requested date range
 * 9. Stops crawling when dates fall outside the requested range
 */
export class PrefeituraCosmopolisSpider extends BaseSpider {
  protected cosmopolisConfig: PrefeituraCosmopolisConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.cosmopolisConfig = spiderConfig.config as PrefeituraCosmopolisConfig;
    
    if (!this.cosmopolisConfig.baseUrl) {
      throw new Error(`PrefeituraCosmopolisSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraCosmopolisSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.cosmopolisConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];
    const processedUrls = new Set<string>(); // Track processed PDF URLs to avoid duplicates

    try {
      let pageNumber = 1;
      let hasMorePages = true;
      let shouldStop = false;

      while (hasMorePages && !shouldStop) {
        try {
          // Build page URL (first page has no /page/N/ suffix)
          const pageUrl = pageNumber === 1 
            ? this.cosmopolisConfig.baseUrl 
            : `${this.cosmopolisConfig.baseUrl}page/${pageNumber}/`;
          logger.debug(`Fetching page ${pageNumber}: ${pageUrl}`);

          const html = await this.fetch(pageUrl);
          const $ = this.loadHTML(html);

          // Find all gazette articles
          const articles = $('article.post-wrap.post-list-lc.delicita.radius-6.clearfix');
          logger.debug(`Found ${articles.length} gazette articles on page ${pageNumber}`);

          if (articles.length === 0) {
            logger.debug(`No gazette articles found on page ${pageNumber}`);
            hasMorePages = false;
            break;
          }

          // Process each article
          const gazettePromises: Promise<Gazette | null>[] = [];
          
          articles.each((_, element) => {
            try {
              const $article = $(element);
              
              // Extract PDF URL from title link
              const pdfUrl = $article.find('h2.post-title a.post-title-link').attr('href');
              
              if (!pdfUrl) {
                logger.debug('Skipping article without PDF URL');
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
                const baseUrlObj = new URL(this.cosmopolisConfig.baseUrl);
                const baseDomain = `${baseUrlObj.protocol}//${baseUrlObj.host}`;
                const normalizedPath = pdfUrl.startsWith('/') ? pdfUrl : `/${pdfUrl}`;
                absolutePdfUrl = `${baseDomain}${normalizedPath}`;
              }

              // Extract title text (e.g., "EDIÇÃO 2039 – EXTRAORDINÁRIA" or "EDIÇÃO 2036")
              const titleText = $article.find('h2.post-title a.post-title-link').text().trim();
              
              // Extract edition number (pattern: "EDIÇÃO NNNN" or "EDIÇÃO NNNN – EXTRAORDINÁRIA")
              const editionMatch = titleText.match(/EDIÇÃO\s+(\d+)/i);
              const editionNumber = editionMatch ? editionMatch[1] : undefined;
              
              // Check if it's an extra edition
              const isExtraEdition = /EXTRAORDINÁRIA|EXTRAORDINARIA/i.test(titleText);

              // Extract publication date from datetime attribute
              const dateTimeAttr = $article.find('time.date.update').attr('datetime');
              
              if (!dateTimeAttr) {
                logger.warn(`Could not extract date from article: ${titleText}`);
                return;
              }

              // Parse ISO date from datetime attribute (format: "2025-11-12T16:34:22-03:00")
              // Extract just the date part (YYYY-MM-DD)
              const dateMatch = dateTimeAttr.match(/^(\d{4}-\d{2}-\d{2})/);
              if (!dateMatch) {
                logger.warn(`Could not parse date from datetime attribute: ${dateTimeAttr}`);
                return;
              }

              const dateStr = dateMatch[1];
              const [year, month, day] = dateStr.split('-').map(Number);
              const gazetteDate = new Date(year, month - 1, day); // JavaScript months are 0-indexed

              // Check if date is in our crawl range
              if (!this.isInDateRange(gazetteDate)) {
                const dateISO = toISODate(gazetteDate);
                logger.debug(`Gazette date ${dateISO} is outside crawl range`);
                
                // Since results are in reverse chronological order (newest first),
                // if we encounter a date before our start date, we can stop crawling
                if (dateISO < this.dateRange.start) {
                  logger.info(`Reached dates before start date (${this.dateRange.start}), stopping crawl`);
                  shouldStop = true;
                }
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
                  sourceText: titleText,
                })
              );

            } catch (error) {
              logger.error(`Error processing gazette article:`, error as Error);
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
          const paginationDiv = $('div.pagination-wrap div.pagination-num');
          if (paginationDiv.length > 0) {
            // Check if there's a link to the next page
            const nextPageLink = paginationDiv.find(`a.page-numbers[href*='/page/${pageNumber + 1}/']`);
            hasMorePages = nextPageLink.length > 0 && !shouldStop;
          } else {
            hasMorePages = false;
          }

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
}

