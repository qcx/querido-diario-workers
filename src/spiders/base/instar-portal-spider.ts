import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, InstarConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * InstarPortalSpider - Spider for Instar portal sites with text-based pagination
 * 
 * This spider is designed for municipalities using the Instar portal format
 * with pagination links that use text labels ("Próxima", "Anterior", etc.)
 * instead of CSS classes.
 * 
 * Examples:
 * - Rancharia: https://www.rancharia.sp.gov.br/portal/diario-oficial
 * 
 * HTML Structure:
 * - Container: .dof_publicacao_diario
 * - Title/Edition: .dof_titulo_publicacao span (first)
 * - Date: Found in spans with pattern DD/MM/YYYY
 * - PDF Download: .dof_download[data-href]
 * - Pagination: Links with text "Primeira", "Anterior", "Próxima", "Última"
 */
export class InstarPortalSpider extends BaseSpider {
  protected instarConfig: InstarConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.instarConfig = spiderConfig.config as InstarConfig;
    this.browser = browser || null;
    
    if (!this.instarConfig.url) {
      throw new Error(`InstarPortalSpider requires a url in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing InstarPortalSpider for ${spiderConfig.name} with URL: ${this.instarConfig.url}`, {
      hasBrowser: !!this.browser,
    });
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.instarConfig.url} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error('InstarPortalSpider requires a browser instance');
    }
    
    return this.crawlWithBrowser();
  }

  /**
   * Browser-based crawling for Instar portal sites
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Navigate to the gazette page
      logger.debug(`Navigating to: ${this.instarConfig.url}`);
      await page.goto(this.instarConfig.url, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Wait for page to stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extract gazettes from all pages
      let hasMorePages = true;
      let currentPage = 1;
      
      while (hasMorePages) {
        logger.debug(`Extracting gazettes from page ${currentPage}`);
        
        // Wait for gazette elements
        try {
          await page.waitForSelector('.dof_publicacao_diario', { timeout: 10000 });
        } catch (error) {
          logger.warn('Gazette elements not found, may be empty');
          break;
        }
        
        // Extract gazettes from current page
        const pageGazettes = await this.extractGazettesFromPage(page);
        
        // Filter by date range
        for (const gazette of pageGazettes) {
          if (gazette && this.isInDateRange(new Date(gazette.date))) {
            gazettes.push(gazette);
          }
        }
        
        logger.debug(`Found ${pageGazettes.length} gazettes on page ${currentPage}, ${gazettes.length} in date range`);
        
        // Check if we've found gazettes older than our date range - stop pagination early
        const foundOlderGazettes = pageGazettes.some(g => {
          const gazetteDate = new Date(g.date);
          const startDate = new Date(this.dateRange.start);
          return gazetteDate < startDate;
        });
        
        if (foundOlderGazettes) {
          logger.debug('Found gazettes older than date range, stopping pagination');
          hasMorePages = false;
          continue;
        }
        
        // Check for pagination using text-based link detection
        const hasNextPage = await page.evaluate(() => {
          const allLinks = document.querySelectorAll('a');
          for (const link of Array.from(allLinks)) {
            const text = link.textContent?.trim().toLowerCase();
            if (text === 'próxima' || text === 'proxima' || text === 'next' || text === '>') {
              const rect = link.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                return true;
              }
            }
          }
          return false;
        });
        
        if (hasNextPage && pageGazettes.length > 0) {
          logger.debug('Clicking next page button');
          
          // Click next page using JavaScript (more reliable for text-based links)
          const clicked = await page.evaluate(() => {
            const allLinks = document.querySelectorAll('a');
            for (const link of Array.from(allLinks)) {
              const text = link.textContent?.trim().toLowerCase();
              if (text === 'próxima' || text === 'proxima' || text === 'next' || text === '>') {
                const rect = link.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  (link as HTMLElement).click();
                  return true;
                }
              }
            }
            return false;
          });
          
          if (clicked) {
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for page to load
            currentPage++;
            
            // Safety limit to avoid infinite loops
            if (currentPage > 50) {
              logger.warn('Reached maximum page limit (50), stopping pagination');
              hasMorePages = false;
            }
          } else {
            hasMorePages = false;
          }
        } else {
          hasMorePages = false;
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from InstarPortal`);
      
    } catch (error) {
      logger.error(`Error crawling with browser:`, error as Error);
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
   * Extract gazettes from browser page using Instar portal format (.dof_publicacao_diario)
   */
  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Extract all gazette elements
      const gazetteElements = await page.evaluate(() => {
        const elements: any[] = [];
        const containers = document.querySelectorAll('.dof_publicacao_diario');
        
        for (const container of Array.from(containers)) {
          // Extract title/edition
          const titleElement = container.querySelector('.dof_titulo_publicacao span');
          const titleText = titleElement ? titleElement.textContent?.trim() : '';
          
          // Extract download link
          const downloadElement = container.querySelector('.dof_download');
          const downloadHref = downloadElement ? downloadElement.getAttribute('data-href') : null;
          
          // Extract date from spans (look for DD/MM/YYYY pattern)
          let dateText = '';
          const allSpans = container.querySelectorAll('span');
          for (const span of Array.from(allSpans)) {
            const text = span.textContent?.trim() || '';
            if (text.match(/\d{2}\/\d{2}\/\d{4}/)) {
              dateText = text;
              break;
            }
          }
          
          if (titleText || downloadHref || dateText) {
            elements.push({
              titleText,
              downloadHref,
              dateText,
            });
          }
        }
        
        return elements;
      });
      
      logger.debug(`Found ${gazetteElements.length} Instar portal gazette elements on page`);
      
      // Process each element
      for (const element of gazetteElements) {
        try {
          // Parse date
          let gazetteDate: Date | null = null;
          if (element.dateText) {
            const dateMatch = element.dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (dateMatch) {
              const [, day, month, year] = dateMatch;
              gazetteDate = new Date(`${year}-${month}-${day}`);
            }
          }
          
          if (!gazetteDate) {
            logger.warn(`Could not parse date from: ${element.dateText}`);
            continue;
          }
          
          // Check if date is in range
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }
          
          // Get PDF URL
          if (!element.downloadHref) {
            logger.warn(`No download link found for gazette: ${element.titleText}`);
            continue;
          }
          
          // Construct full PDF URL
          let pdfUrl = element.downloadHref;
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.instarConfig.url);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }
          
          // Extract edition number
          const editionMatch = element.titleText?.match(/[Ee]di[çc][ãa]o\s+[nN]?[°º]?\s*(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;
          
          // Check if it's an extra edition
          const isExtraEdition = element.titleText?.toLowerCase().includes('extra') || false;
          
          // Create gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber,
            isExtraEdition,
            power: 'executive_legislative',
            sourceText: element.titleText || `Gazette ${toISODate(gazetteDate)}`,
          });
          
          if (gazette) {
            gazettes.push(gazette);
          }
          
        } catch (error) {
          logger.error(`Error processing Instar portal gazette element:`, error as Error);
        }
      }
      
    } catch (error) {
      logger.error(`Error extracting Instar portal gazettes from page:`, error as Error);
    }
    
    return gazettes;
  }
}

