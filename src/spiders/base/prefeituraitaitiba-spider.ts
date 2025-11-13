import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraItatibaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Spider for Prefeitura de Itatiba official gazette
 * 
 * Uses Cloudflare Browser Rendering (Puppeteer) to handle:
 * - JavaScript-rendered gazette listings
 * - Query parameter-based date filtering (dataDe, dataAte)
 * - Pagination with pagina parameter
 * - Dynamic content loading
 * 
 * The site structure:
 * 1. Navigate to base URL with query parameters: ?dataDe=DD/MM/YYYY&dataAte=DD/MM/YYYY&numeroEdicao=&busca=
 * 2. Results appear in .list-item articles
 * 3. Each item has:
 *    - Title: .list-item__title (e.g., "Edição nº 3456 - Ano XXIII")
 *    - Date: .list-item__date (e.g., "13/11/2025")
 *    - PDF link: .list-item__button href
 * 4. Pagination in .pagination nav with next button
 */
export class PrefeituraItatibaSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraItatibaConfig;
    this.baseUrl = platformConfig.url;
    this.browser = browser || null;
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  /**
   * Format date for URL query parameter (DD/MM/YYYY)
   */
  private formatDateForUrl(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }

  /**
   * Build URL with query parameters
   */
  private buildUrl(page: number = 1): string {
    const startDate = this.formatDateForUrl(new Date(this.startDate));
    const endDate = this.formatDateForUrl(new Date(this.endDate));
    
    const params = new URLSearchParams({
      dataDe: startDate,
      dataAte: endDate,
      numeroEdicao: '',
      busca: '',
    });
    
    // Add pagina parameter only if page > 1
    if (page > 1) {
      params.set('pagina', page.toString());
    }
    
    return `${this.baseUrl}/?${params.toString()}`;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(`PrefeituraItatibaSpider for ${this.config.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura Itatiba for ${this.config.name}...`);

    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      
      // Extract gazettes from all pages
      let currentPage = 1;
      let hasMorePages = true;
      
      while (hasMorePages) {
        const pageUrl = this.buildUrl(currentPage);
        logger.debug(`Navigating to page ${currentPage}: ${pageUrl}`);
        
        await page.goto(pageUrl, { waitUntil: 'networkidle0', timeout: 30000 });
        this.requestCount++;
        
        // Wait for page to stabilize
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Wait for list items to be present
        try {
          await page.waitForSelector('.list-item', { timeout: 10000 });
        } catch (error) {
          logger.warn('List items not found, may be empty');
          break;
        }
        
        // Extract gazettes from current page
        const pageGazettes = await this.extractGazettesFromPage(page);
        
        // Filter by date range (extracted dates should already be in range, but double-check)
        for (const gazette of pageGazettes) {
          if (gazette && this.isInDateRange(new Date(gazette.date))) {
            gazettes.push(gazette);
          }
        }
        
        logger.debug(`Found ${pageGazettes.length} gazettes on page ${currentPage}, ${gazettes.length} total in date range`);
        
        // Check pagination info to determine if there are more pages
        const paginationInfo = await page.evaluate(() => {
          const paginationLabel = document.querySelector('.pagination__label');
          if (paginationLabel) {
            const text = paginationLabel.textContent || '';
            // Match pattern like "página 1 de 46" or "1 / 46"
            const match = text.match(/página\s+(\d+)\s+de\s+(\d+)|(\d+)\s*\/\s*(\d+)/i);
            if (match) {
              const current = parseInt(match[1] || match[3]);
              const total = parseInt(match[2] || match[4]);
              return { current, total, hasMore: current < total };
            }
          }
          return null;
        });
        
        if (paginationInfo && paginationInfo.hasMore) {
          currentPage++;
          logger.debug(`Moving to next page: ${currentPage} (total pages: ${paginationInfo.total})`);
        } else {
          // Also check if next button exists and is enabled
          const nextPageButton = await page.$('.pagination__next button[onclick*="goto"]');
          if (nextPageButton) {
            const isDisabled = await page.evaluate((btn: any) => {
              return btn.disabled || btn.getAttribute('aria-disabled') === 'true' || btn.style.display === 'none';
            }, nextPageButton);
            
            if (!isDisabled) {
              const nextPageValue = await page.evaluate((btn: any) => {
                return btn.value || btn.getAttribute('value');
              }, nextPageButton);
              
              if (nextPageValue && parseInt(nextPageValue) > currentPage) {
                currentPage = parseInt(nextPageValue);
                logger.debug(`Moving to next page via button: ${currentPage}`);
              } else {
                hasMorePages = false;
              }
            } else {
              hasMorePages = false;
            }
          } else {
            hasMorePages = false;
          }
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from Prefeitura Itatiba`);
      
    } catch (error) {
      logger.error(`Error crawling Prefeitura Itatiba:`, error as Error);
      throw error;
    } finally {
      // Clean up
      if (page) {
        try {
          await page.close();
        } catch (e) {
          logger.warn('Error closing page', { error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (e) {
          logger.warn('Error closing browser', { error: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    return gazettes;
  }

  /**
   * Extract gazettes from the current page
   */
  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Extract all list items
      const listItems = await page.$$eval(
        '.list-item',
        (items: any[]) => {
          return items.map((item: any) => {
            // Extract title
            const titleElement = item.querySelector('.list-item__title');
            const titleText = titleElement ? titleElement.textContent?.trim() : '';
            
            // Extract edition number from title (e.g., "Edição nº 3456")
            const editionMatch = titleText.match(/[Ee]di[çc][ãa]o\s+[nN]?[°º]?\s*(\d+)/i);
            const editionNumber = editionMatch ? editionMatch[1] : undefined;
            
            // Extract date
            const dateElement = item.querySelector('.list-item__date');
            const dateText = dateElement ? dateElement.textContent?.trim() : '';
            
            // Extract PDF URL
            const pdfLink = item.querySelector('.list-item__button[href]');
            const pdfHref = pdfLink ? pdfLink.getAttribute('href') : null;
            
            return {
              titleText,
              editionNumber,
              dateText,
              pdfHref,
            };
          }).filter((item: any) => item.dateText && item.pdfHref);
        }
      );
      
      logger.debug(`Found ${listItems.length} list items on page`);
      
      // Process each item
      for (const item of listItems) {
        try {
          // Parse date from DD/MM/YYYY format
          const dateMatch = item.dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) {
            logger.warn(`Could not parse date from: ${item.dateText}`);
            continue;
          }
          
          const [, day, month, year] = dateMatch;
          const gazetteDate = new Date(
            parseInt(year, 10),
            parseInt(month, 10) - 1,
            parseInt(day, 10)
          );
          
          // Check if date is in range
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }
          
          // Construct full PDF URL if relative
          let pdfUrl = item.pdfHref;
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }
          
          // Check if it's an extra edition
          const isExtraEdition = item.titleText?.toLowerCase().includes('extra') || false;
          
          // Create gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber: item.editionNumber,
            isExtraEdition,
            power: 'executive_legislative',
            sourceText: item.titleText || `Edição ${item.editionNumber || 'N/A'} - ${item.dateText}`,
          });
          
          if (gazette) {
            gazettes.push(gazette);
          }
          
        } catch (error) {
          logger.error(`Error processing list item:`, error as Error);
        }
      }
      
    } catch (error) {
      logger.error(`Error extracting gazettes from page:`, error as Error);
    }
    
    return gazettes;
  }
}

