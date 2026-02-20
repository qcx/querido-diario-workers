import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, GovbrDioenetConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for GOVBR DIOENET platform (govbrdioenet.com.br)
 * 
 * Site structure:
 * - Listing URL: https://www.govbrdioenet.com.br/list/{city-slug}
 * - View URL: https://www.govbrdioenet.com.br/uploads/view/{id}?utm_edicao={edition}
 * - PDF embedded in iframe with viewer.php?file= parameter
 * 
 * This is different from the plenussistemas.dioenet.com.br platform
 */
export class GovbrDioenetSpider extends BaseSpider {
  private baseUrl: string;
  private citySlug: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as GovbrDioenetConfig;
    this.baseUrl = platformConfig.baseUrl;
    
    // Extract city slug from URL if not provided
    const slugMatch = this.baseUrl.match(/\/list\/([^\/\?]+)/);
    this.citySlug = platformConfig.citySlug || (slugMatch ? slugMatch[1] : '');
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling GOVBR DIOENET for ${this.config.name}...`);

    try {
      const startDate = new Date(this.dateRange.start);
      const endDate = new Date(this.dateRange.end);
      
      let currentPage = 1;
      const maxPages = 20; // Safety limit
      let hasMore = true;
      
      while (hasMore && currentPage <= maxPages) {
        const pageUrl = currentPage === 1 
          ? this.baseUrl 
          : `${this.baseUrl}?page=${currentPage}`;
        
        logger.debug(`Fetching page ${currentPage}: ${pageUrl}`);
        
        const response = await fetch(pageUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch listing page: ${response.status}`);
        }

        const html = await response.text();
        
        // Parse gazette items from the listing page
        // Pattern: <a href="https://www.govbrdioenet.com.br/uploads/view/{id}?utm_edicao={edition}" ... >
        //          Diário Oficial de DD/MM/YYYY ... Edição nº XXXX
        const itemRegex = /<li[^>]*>[\s\S]*?<a href="(https:\/\/www\.govbrdioenet\.com\.br\/uploads\/view\/\d+\?utm_edicao=\d+)"[^>]*>[\s\S]*?<\/li>/gi;
        const titleRegex = /Diário Oficial de (\d{2}\/\d{2}\/\d{4})[^<]*<span[^>]*>Edição nº (\d+)/i;
        
        let foundItems = 0;
        let allBeforeRange = true;
        let allAfterRange = true;
        
        // Find all list items with gazette links
        const listHtml = html.match(/<ul class="lista-diarios"[^>]*>[\s\S]*?<\/ul>/i);
        if (!listHtml) {
          logger.debug('No gazette list found on page');
          break;
        }

        // Extract individual items
        const itemMatches = listHtml[0].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi);
        
        for (const itemMatch of itemMatches) {
          const itemHtml = itemMatch[1];
          foundItems++;
          
          // Extract the view link
          const linkMatch = itemHtml.match(/href="(https:\/\/www\.govbrdioenet\.com\.br\/uploads\/view\/(\d+)\?utm_edicao=(\d+))"/i);
          if (!linkMatch) continue;
          
          const viewUrl = linkMatch[1];
          const viewId = linkMatch[2];
          const editionNumber = linkMatch[3];
          
          // Extract date from the title
          const dateMatch = itemHtml.match(/Diário Oficial de (\d{2})\/(\d{2})\/(\d{4})/i);
          if (!dateMatch) {
            logger.debug(`Could not find date in item: ${viewId}`);
            continue;
          }
          
          const day = dateMatch[1];
          const month = dateMatch[2];
          const year = dateMatch[3];
          const dateStr = `${year}-${month}-${day}`;
          const itemDate = new Date(dateStr);
          
          // Track if we're in range
          if (itemDate >= startDate) {
            allBeforeRange = false;
          }
          if (itemDate <= endDate) {
            allAfterRange = false;
          }
          
          // Filter by date range
          if (itemDate < startDate || itemDate > endDate) {
            continue;
          }
          
          // Fetch the view page to extract the PDF URL
          try {
            logger.debug(`Fetching view page: ${viewUrl}`);
            const viewResponse = await fetch(viewUrl);
            if (!viewResponse.ok) {
              logger.warn(`Failed to fetch view page: ${viewUrl}`);
              continue;
            }

            const viewHtml = await viewResponse.text();
            
            // Extract PDF URL from iframe
            // Pattern: <iframe ... src="...viewer.php?...file=https://www.govbrdioenet.com.br/public/uploads/diarios/YYYY/MM/{hash}.pdf"
            const iframeMatch = viewHtml.match(/file=([^"&]+\.pdf)/i);
            if (!iframeMatch) {
              logger.warn(`Could not find PDF URL in view page: ${viewUrl}`);
              continue;
            }
            
            const fileUrl = decodeURIComponent(iframeMatch[1]);
            
            gazettes.push({
              date: dateStr,
              editionNumber,
              fileUrl,
              territoryId: this.config.territoryId,
              isExtraEdition: false,
              power: 'executive',
              scrapedAt: new Date().toISOString(),
            });
            
            logger.debug(`Found gazette: Edition ${editionNumber} - ${dateStr} - ${fileUrl}`);
            
          } catch (error) {
            logger.warn(`Failed to fetch gazette view page: ${viewUrl} - ${error}`);
          }
          
          // Add delay between requests
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        logger.debug(`Page ${currentPage}: found ${foundItems} items, ${gazettes.length} gazettes in range so far`);
        
        // Stop if we've gone past our date range (all items on page are before startDate)
        if (foundItems > 0 && allBeforeRange) {
          logger.debug('All items on page are before date range, stopping');
          break;
        }
        
        // Check for next page
        const hasNextPage = html.includes('Próximo →') || html.includes('Next →');
        if (!hasNextPage || foundItems === 0) {
          hasMore = false;
        } else {
          currentPage++;
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from GOVBR DIOENET`);
    } catch (error) {
      logger.error(`Error crawling GOVBR DIOENET: ${error}`);
      throw error;
    }

    return gazettes;
  }
}

