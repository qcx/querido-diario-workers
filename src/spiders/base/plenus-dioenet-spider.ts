import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PlenusDioenetConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, parseBrazilianDate } from '../../utils/date-utils';

/**
 * Spider for Plenus DIOENET platform (plenussistemas.dioenet.com.br)
 * 
 * This spider scrapes HTML pages from the list view instead of using the API.
 * The site structure:
 * - List URL: https://plenussistemas.dioenet.com.br/list/{city-slug}
 * - View URL: https://plenussistemas.dioenet.com.br/uploads/view/{id}?utm_edicao={edition}
 * - PDF embedded in iframe with viewer.php?file= parameter
 * 
 * HTML Structure:
 * - List items: .lista-diarios li
 * - Date: "Diário Oficial de DD/MM/YYYY"
 * - Edition: "Edição nº NNNN"
 * - View link: a[href*="/uploads/view/"]
 */
export class PlenusDioenetSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PlenusDioenetConfig;
    this.baseUrl = platformConfig.baseUrl;
    
    if (!this.baseUrl) {
      throw new Error(`PlenusDioenetSpider requires a baseUrl in config for ${config.name}`);
    }
    
    logger.info(`Initializing PlenusDioenetSpider for ${config.name} with URL: ${this.baseUrl}`);
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const processedUrls = new Set<string>(); // Track processed view URLs to avoid duplicates
    logger.info(`Crawling Plenus DIOENET for ${this.config.name}...`);

    try {
      let currentPage = 1;
      let hasMorePages = true;
      let consecutiveOutOfRange = 0; // Track consecutive pages with no items in range
      const maxPages = 500; // Safety limit
      const maxConsecutiveOutOfRange = 3; // Stop after 3 consecutive pages with no items in range

      while (hasMorePages && currentPage <= maxPages) {
        const pageUrl = currentPage === 1 
          ? this.baseUrl 
          : `${this.baseUrl}?page=${currentPage}`;
        
        logger.debug(`Fetching page ${currentPage}: ${pageUrl}`);
        
        const html = await this.fetch(pageUrl);
        const $ = this.loadHTML(html);
        
        // Find all list items
        const listItems = $('.lista-diarios li');
        
        if (listItems.length === 0) {
          logger.debug(`No items found on page ${currentPage}, stopping pagination`);
          hasMorePages = false;
          break;
        }
        
        logger.debug(`Found ${listItems.length} items on page ${currentPage}`);
        
        let foundInRange = false;
        let foundOutOfRangeBefore = false;
        
        for (let i = 0; i < listItems.length; i++) {
          const item = listItems.eq(i);
          const itemText = item.text();
          
          // Extract date from text like "Diário Oficial de 12/01/2026"
          const dateMatch = itemText.match(/Diário Oficial de (\d{2}\/\d{2}\/\d{4})/i);
          if (!dateMatch) {
            logger.debug(`Could not extract date from item: ${itemText.substring(0, 100)}`);
            continue;
          }
          
          const dateStr = dateMatch[1];
          const gazetteDate = parseBrazilianDate(dateStr);
          
          if (isNaN(gazetteDate.getTime())) {
            logger.warn(`Could not parse date: ${dateStr}`);
            continue;
          }
          
          // Check if date is in range
          if (!this.isInDateRange(gazetteDate)) {
            // If date is before start date and we've already found items, we can stop
            if (gazetteDate < this.startDate && foundInRange) {
              logger.debug(`Found date ${dateStr} before start date ${toISODate(this.startDate)}, stopping pagination`);
              hasMorePages = false;
              break;
            }
            // Track if we found dates out of range (after end date)
            if (gazetteDate > this.endDate) {
              foundOutOfRangeBefore = true;
            }
            continue;
          }
          
          foundInRange = true;
          consecutiveOutOfRange = 0; // Reset counter when we find items in range
          
          // Extract edition number from text like "Edição nº 1942"
          const editionMatch = itemText.match(/Edição\s*n[°º]?\s*(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;
          
          // Check if extra edition
          const isExtraEdition = /Extra/i.test(itemText);
          
          // Find the view link
          const viewLink = item.find('a[href*="/uploads/view/"]').first();
          if (viewLink.length === 0) {
            logger.warn(`Could not find view link for date ${dateStr}`);
            continue;
          }
          
          const viewUrl = viewLink.attr('href');
          if (!viewUrl) {
            logger.warn(`View link has no href for date ${dateStr}`);
            continue;
          }
          
          // Resolve relative URLs
          const fullViewUrl = viewUrl.startsWith('http') 
            ? viewUrl 
            : new URL(viewUrl, this.baseUrl).toString();
          
          // Skip if already processed
          if (processedUrls.has(fullViewUrl)) {
            logger.debug(`Skipping already processed URL: ${fullViewUrl}`);
            continue;
          }
          
          processedUrls.add(fullViewUrl);
          
          // Fetch the view page to get the PDF URL
          try {
            const viewHtml = await this.fetch(fullViewUrl);
            
            // Extract PDF URL from viewer.php?file= parameter
            // Pattern: viewer.php?c=...&file=https://... or viewer.php?file=...
            const fileMatch = viewHtml.match(/viewer\.php\?[^"']*file=([^"&']+)/);
            if (!fileMatch) {
              logger.warn(`Could not find PDF URL in view page: ${fullViewUrl}`);
              continue;
            }
            
            let fileUrl = decodeURIComponent(fileMatch[1]);
            
            // The file parameter may already contain a full URL or a relative path
            if (!fileUrl.startsWith('http')) {
              // If relative, make it absolute
              fileUrl = new URL(fileUrl, 'https://plenussistemas.dioenet.com.br').toString();
            }
            
            const gazette = await this.createGazette(gazetteDate, fileUrl, {
              editionNumber,
              isExtraEdition,
              power: 'executive',
            });
            
            if (gazette) {
              gazettes.push(gazette);
              logger.debug(`Found gazette: ${dateStr} - Edição ${editionNumber || 'N/A'} - ${fileUrl}`);
            }
            
            // Add delay between requests
            await new Promise(resolve => setTimeout(resolve, 200));
            
          } catch (error) {
            logger.warn(`Failed to fetch gazette view page: ${fullViewUrl} - ${error}`);
          }
        }
        
        // If no items in range were found on this page, increment counter
        if (!foundInRange) {
          consecutiveOutOfRange++;
          if (consecutiveOutOfRange >= maxConsecutiveOutOfRange) {
            logger.debug(`Found ${consecutiveOutOfRange} consecutive pages with no items in range, stopping pagination`);
            hasMorePages = false;
            break;
          }
        }
        
        // Check if there's a next page - look for "Próximo" link that is not disabled
        const paginationLinks = $('.pagination a');
        let foundNextPage = false;
        
        paginationLinks.each((_, el) => {
          const link = $(el);
          const text = link.text().trim();
          if (text.includes('Próximo') || text.includes('Próximo →')) {
            // Check if it's disabled or if it's the current page
            if (!link.hasClass('disabled') && !link.parent().hasClass('disabled')) {
              foundNextPage = true;
              return false; // break
            }
          }
        });
        
        hasMorePages = foundNextPage;
        
        if (hasMorePages) {
          currentPage++;
          // Add delay between pages
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          logger.debug(`No next page found, stopping pagination at page ${currentPage}`);
        }
      }

      if (currentPage > maxPages) {
        logger.warn(`Reached maximum page limit (${maxPages}), stopping pagination`);
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from Plenus DIOENET (processed ${currentPage} pages)`);
    } catch (error) {
      logger.error(`Error crawling Plenus DIOENET: ${error}`);
      throw error;
    }

    return gazettes;
  }
}
