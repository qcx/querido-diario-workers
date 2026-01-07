import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraSerranegraConfig } from '../../types';
import { logger } from '../../utils/logger';
// @ts-ignore
import { parse } from 'node-html-parser';

/**
 * PrefeituraSerranegraSpider implementation
 * 
 * Site Structure:
 * - URL: https://serranegra.sp.gov.br/servicos/diario-oficial
 * - Listing page with article elements containing gazette titles
 * - Titles in format: "Diário Oficial - DD de MMMM de YYYY"
 * - Each article links to a detail page containing the PDF link
 * - PDFs hosted on ecrie.com.br
 * - Pagination with ?pagina= query parameter
 * 
 * This spider uses static HTTP requests (no browser required) since the HTML
 * is fully server-rendered.
 */
export class PrefeituraSerranegraSpider extends BaseSpider {
  protected serranegraConfig: PrefeituraSerranegraConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.serranegraConfig = spiderConfig.config as PrefeituraSerranegraConfig;
    
    if (!this.serranegraConfig.baseUrl) {
      throw new Error(`PrefeituraSerranegraSpider requires a baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraSerranegraSpider for ${spiderConfig.name} with URL: ${this.serranegraConfig.baseUrl}`);
  }

  /**
   * Set browser instance (not used, kept for API compatibility)
   */
  setBrowser(browser: Fetcher): void {
    // Not used - this spider doesn't need browser rendering
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.serranegraConfig.baseUrl} for ${this.spiderConfig.name}...`);
    return this.crawlStatic();
  }

  /**
   * Parse date from title in format "DD de MMMM de YYYY" or "Diário Oficial - DD de MMMM de YYYY"
   */
  private parseDateFromTitle(title: string): Date | null {
    const monthNames: { [key: string]: number } = {
      'janeiro': 1, 'fevereiro': 2, 'março': 3, 'marco': 3, 'abril': 4,
      'maio': 5, 'junho': 6, 'julho': 7, 'agosto': 8,
      'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12
    };
    
    // Match "DD de MMMM de YYYY"
    const match = title.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
    if (match) {
      const [, day, monthName, year] = match;
      const month = monthNames[monthName.toLowerCase()];
      if (month) {
        return new Date(parseInt(year), month - 1, parseInt(day));
      }
    }
    
    return null;
  }

  /**
   * Static HTTP-based crawling (no browser required)
   */
  private async crawlStatic(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let currentPage = 1;
    const maxPages = 50; // Safety limit
    let foundOlderThanRange = false;

    while (currentPage <= maxPages && !foundOlderThanRange) {
      try {
        // Fetch listing page
        const listingUrl = currentPage === 1 
          ? this.serranegraConfig.baseUrl 
          : `${this.serranegraConfig.baseUrl}?pagina=${currentPage}`;
        
        logger.debug(`Fetching listing page ${currentPage}: ${listingUrl}`);
        const listingResponse = await fetch(listingUrl);
        this.requestCount++;
        
        if (!listingResponse.ok) {
          logger.warn(`Failed to fetch listing page ${currentPage}: ${listingResponse.status}`);
          break;
        }
        
        const listingHtml = await listingResponse.text();
        const listingDoc = parse(listingHtml);
        
        // Find all article elements
        const articles = listingDoc.querySelectorAll('article.list-item');
        
        if (articles.length === 0) {
          logger.debug(`No articles found on page ${currentPage}`);
          break;
        }
        
        logger.debug(`Found ${articles.length} articles on page ${currentPage}`);
        
        for (const article of articles) {
          try {
            // Get title and detail URL from the article
            const titleLink = article.querySelector('.list-item__title a') || article.querySelector('.list-item__link');
            if (!titleLink) {
              continue;
            }
            
            const title = titleLink.text?.trim() || '';
            let detailUrl = titleLink.getAttribute('href') || '';
            
            if (!title || !detailUrl) {
              continue;
            }
            
            // Parse date from title
            const gazetteDate = this.parseDateFromTitle(title);
            if (!gazetteDate) {
              logger.warn(`Could not parse date from title: ${title}`);
              continue;
            }
            
            // Check if older than date range
            if (gazetteDate < new Date(this.dateRange.start)) {
              foundOlderThanRange = true;
              continue;
            }
            
            // Skip if not in date range
            if (!this.isInDateRange(gazetteDate)) {
              continue;
            }
            
            // Build absolute detail URL
            if (!detailUrl.startsWith('http')) {
              const baseUrlObj = new URL(this.serranegraConfig.baseUrl);
              detailUrl = `${baseUrlObj.origin}${detailUrl}`;
            }
            
            // Fetch detail page to get PDF URL
            logger.debug(`Fetching detail page: ${detailUrl}`);
            const detailResponse = await fetch(detailUrl);
            this.requestCount++;
            
            if (!detailResponse.ok) {
              logger.warn(`Failed to fetch detail page: ${detailUrl}`);
              continue;
            }
            
            const detailHtml = await detailResponse.text();
            const detailDoc = parse(detailHtml);
            
            // Find PDF link - look for ecrie.com.br PDF links or any PDF link
            let pdfUrl: string | null = null;
            
            // Primary: Look for ecrie.com.br PDF links
            const ecrieLink = detailDoc.querySelector('a[href*="ecrie.com.br"][href*=".pdf"]');
            if (ecrieLink) {
              pdfUrl = ecrieLink.getAttribute('href');
            }
            
            // Fallback: Look for any PDF link
            if (!pdfUrl) {
              const anyPdfLink = detailDoc.querySelector('a[href*=".pdf"]');
              if (anyPdfLink) {
                pdfUrl = anyPdfLink.getAttribute('href');
              }
            }
            
            if (!pdfUrl) {
              logger.warn(`No PDF URL found on detail page: ${detailUrl}`);
              continue;
            }
            
            // Create gazette
            const gazette = await this.createGazette(gazetteDate, pdfUrl, {
              isExtraEdition: title.toLowerCase().includes('extra'),
              power: 'executive_legislative',
              sourceText: title,
            });
            
            if (gazette) {
              gazettes.push(gazette);
              logger.debug(`Added gazette: ${title} -> ${pdfUrl}`);
            }
            
          } catch (error) {
            logger.error(`Error processing article:`, error as Error);
          }
        }
        
        logger.debug(`Processed page ${currentPage}, found ${gazettes.length} gazettes total`);
        
        // Check for next page - look for pagination options
        const paginationSelect = listingDoc.querySelector('.pagination__select, select[onchange]');
        if (paginationSelect) {
          const options = paginationSelect.querySelectorAll('option');
          let hasNextPage = false;
          
          for (const option of options) {
            const pageNum = parseInt(option.text?.trim() || '0');
            if (pageNum === currentPage + 1) {
              hasNextPage = true;
              break;
            }
          }
          
          if (hasNextPage) {
            currentPage++;
          } else {
            break;
          }
        } else {
          // No pagination found, check if there's a "next" link
          const nextLink = listingDoc.querySelector('.pagination a[rel="next"], .pagination .next a');
          if (nextLink) {
            currentPage++;
          } else {
            break;
          }
        }
        
      } catch (error) {
        logger.error(`Error crawling page ${currentPage}:`, error as Error);
        break;
      }
    }
    
    logger.info(`Successfully crawled ${gazettes.length} gazettes`);
    return gazettes;
  }
}
