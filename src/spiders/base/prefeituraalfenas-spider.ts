import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Configuration interface for Prefeitura Alfenas spider
 */
export interface PrefeituraAlfenasConfig {
  type: 'prefeituraalfenas';
  /** Base URL for the Prefeitura Alfenas diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Spider for Prefeitura de Alfenas diário oficial
 * 
 * Site Structure:
 * - URL: https://www.alfenas.mg.gov.br/publicacoes/diario-oficial
 * - Uses Portal Fácil platform with AjaxPro for loading gazettes
 * - Gazettes are loaded via JavaScript
 * - Similar structure to PrefeituraIpatinga
 * 
 * Requires browser rendering due to JavaScript-heavy page
 */
export class PrefeituraAlfenasSpider extends BaseSpider {
  protected alfenasConfig: PrefeituraAlfenasConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.alfenasConfig = spiderConfig.config as PrefeituraAlfenasConfig;
    this.browser = browser || null;
    
    if (!this.alfenasConfig.baseUrl) {
      throw new Error(`PrefeituraAlfenasSpider requires a baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraAlfenasSpider for ${spiderConfig.name} with URL: ${this.alfenasConfig.baseUrl}`, {
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
    logger.info(`Crawling ${this.alfenasConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error('PrefeituraAlfenasSpider requires browser rendering');
    }
    
    return this.crawlWithBrowser();
  }

  /**
   * Browser-based crawling for Portal Fácil sites
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Navigate to the diário oficial page
      logger.debug(`Navigating to: ${this.alfenasConfig.baseUrl}`);
      await page.goto(this.alfenasConfig.baseUrl, { waitUntil: 'networkidle0', timeout: 45000 });
      this.requestCount++;
      
      // Wait for page to stabilize and JavaScript to load the gazettes
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Wait for gazettes to load - look for the list container
      try {
        await page.waitForSelector('#arquivos li, .list-group-item, ul.list-group, iframe', { timeout: 15000 });
      } catch (error) {
        logger.warn('Gazette list not found, page may be empty or still loading');
      }
      
      // Additional wait for JavaScript to finish loading content
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extract gazettes from the page with pagination support
      let hasMorePages = true;
      let currentPage = 1;
      const maxPages = 50;
      
      while (hasMorePages && currentPage <= maxPages) {
        logger.debug(`Extracting gazettes from page ${currentPage}`);
        
        // Extract gazette data from the current page
        const pageGazettes = await this.extractGazettesFromPage(page);
        
        if (pageGazettes.length === 0) {
          logger.info(`No gazettes found on page ${currentPage}, stopping pagination`);
          hasMorePages = false;
          continue;
        }
        
        // Filter by date range and add to collection
        let foundOlderThanRange = false;
        for (const gazette of pageGazettes) {
          if (gazette) {
            const gazetteDate = new Date(gazette.date);
            
            if (this.isInDateRange(gazetteDate)) {
              gazettes.push(gazette);
            }
            
            // Check if we've found gazettes older than our date range
            if (gazetteDate < new Date(this.dateRange.start)) {
              foundOlderThanRange = true;
            }
          }
        }
        
        logger.debug(`Found ${pageGazettes.length} gazettes on page ${currentPage}, ${gazettes.length} in date range`);
        
        // If we found gazettes older than the range, stop pagination
        if (foundOlderThanRange) {
          logger.debug('Found gazettes older than date range, stopping pagination');
          hasMorePages = false;
          continue;
        }
        
        // Check for pagination - look for "Anteriores" button or next page link
        const hasNextPageButton = await page.evaluate(() => {
          // Look for "Anteriores" button
          const buttons = document.querySelectorAll('button');
          for (const button of buttons) {
            if (button.textContent?.includes('Anteriores') && !button.disabled) {
              return true;
            }
          }
          // Look for pagination links
          const paginationLinks = document.querySelectorAll('a.page-link, .pagination a[href*="page"]');
          for (const link of paginationLinks) {
            if (link.textContent?.includes('›') || link.textContent?.includes('»')) {
              return true;
            }
          }
          return false;
        });
        
        if (hasNextPageButton) {
          // Click the button using evaluate
          const clicked = await page.evaluate(() => {
            const buttons = document.querySelectorAll('button');
            for (const button of buttons) {
              if (button.textContent?.includes('Anteriores') && !button.disabled) {
                button.click();
                return true;
              }
            }
            // Try pagination links
            const paginationLinks = document.querySelectorAll('a.page-link, .pagination a[href*="page"]');
            for (const link of paginationLinks) {
              const el = link as HTMLAnchorElement;
              if (link.textContent?.includes('›') || link.textContent?.includes('»')) {
                el.click();
                return true;
              }
            }
            return false;
          });
          
          if (clicked) {
            logger.debug('Clicked next page button');
            await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for content to load
            currentPage++;
          } else {
            hasMorePages = false;
          }
        } else {
          hasMorePages = false;
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from browser`);
      
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
   * Extract gazettes from the current browser page
   */
  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Extract gazette elements from the page
      // Try multiple strategies since structure may vary
      const gazetteData = await page.evaluate(() => {
        const data: any[] = [];
        
        // Strategy 1: Look for list items with gazette info (similar to Ipatinga/Viçosa)
        const listItems = document.querySelectorAll('.list-group-item, li.list-group-item, #arquivos li');
        
        for (const item of Array.from(listItems)) {
          // Skip items that are not gazette items (like headers or "Sem arquivos" message)
          const itemText = item.textContent || '';
          if (itemText.includes('Sem arquivos') || itemText.includes('BAIXAR ARQUIVOS') || itemText.trim() === '') {
            continue;
          }
          
          // Check for link with "abrir_arquivo" or containing "Visualizar" text or view-pdf class
          let hasVisualizarLink = item.querySelector('a[href*="abrir_arquivo"]');
          if (!hasVisualizarLink) {
            // Check for links with view-pdf class
            hasVisualizarLink = item.querySelector('a.view-pdf');
          }
          if (!hasVisualizarLink) {
            // Check all links for "Visualizar" text or PDF
            const allLinks = item.querySelectorAll('a');
            for (const link of allLinks) {
              if (link.textContent?.includes('Visualizar') || 
                  link.textContent?.includes('PDF') ||
                  link.classList.contains('view-pdf') ||
                  link.getAttribute('href')?.includes('.pdf')) {
                hasVisualizarLink = link;
                break;
              }
            }
          }
          if (!hasVisualizarLink) continue;
          
          // Extract edition number
          // Look for pattern "N° XXXX / YYYY"
          const editionElement = item.querySelector('span:not([class])');
          let editionText = editionElement?.textContent?.trim() || item.textContent || '';
          const editionMatch = editionText.match(/N[°º]\s*(\d+)\s*\/\s*(\d{4})/);
          const editionNumber = editionMatch ? editionMatch[1] : null;
          const editionYear = editionMatch ? editionMatch[2] : null;
          
          // Extract date
          let dateText = '';
          // Look for "Data: DD/MM/YYYY" in divs first
          const allDivs = item.querySelectorAll('div');
          for (const div of allDivs) {
            if (div.textContent?.includes('Data:')) {
              const match = div.textContent.match(/(\d{2})\/(\d{2})\/(\d{4})/);
              if (match) {
                dateText = `${match[1]}/${match[2]}/${match[3]}`;
                break;
              }
            }
          }
          
          // If no date found in divs, try h4 heading (Portuguese month format)
          if (!dateText) {
            const headingElement = item.querySelector('h4.list-group-item-heading, h4');
            const headingText = headingElement?.textContent?.trim() || '';
            // Pattern: DD/Mês/YYYY (e.g., "06/Janeiro/2026")
            const months: Record<string, string> = {
              'janeiro': '01', 'fevereiro': '02', 'março': '03', 'marco': '03',
              'abril': '04', 'maio': '05', 'junho': '06', 
              'julho': '07', 'agosto': '08', 'setembro': '09',
              'outubro': '10', 'novembro': '11', 'dezembro': '12'
            };
            const dateMatchPt = headingText.match(/(\d{2})\/(\w+)\/(\d{4})/i);
            if (dateMatchPt) {
              const monthNum = months[dateMatchPt[2].toLowerCase()];
              if (monthNum) {
                dateText = `${dateMatchPt[1]}/${monthNum}/${dateMatchPt[3]}`;
              }
            }
          }
          
          // If still no date, try "Data: DD/MM/YYYY" pattern in full text
          if (!dateText) {
            const dataMatch = editionText.match(/Data:\s*(\d{2})\/(\d{2})\/(\d{4})/);
            if (dataMatch) {
              dateText = `${dataMatch[1]}/${dataMatch[2]}/${dataMatch[3]}`;
            } else {
              // Try any date pattern in the text
              const dateMatchAny = editionText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
              if (dateMatchAny) {
                dateText = `${dateMatchAny[1]}/${dateMatchAny[2]}/${dateMatchAny[3]}`;
              }
            }
          }
          
          // Extract PDF URL
          const pdfLink = item.querySelector('a[href*="abrir_arquivo"]');
          let pdfUrl = pdfLink?.getAttribute('href') || '';
          
          // If not found, check for view-pdf class
          if (!pdfUrl) {
            const viewPdfLink = item.querySelector('a.view-pdf');
            pdfUrl = viewPdfLink?.getAttribute('href') || '';
          }
          
          // If still not found, look for any "Visualizar" link or PDF link
          if (!pdfUrl) {
            const allLinks = item.querySelectorAll('a');
            for (const link of allLinks) {
              const href = link.getAttribute('href') || '';
              if (link.textContent?.includes('Visualizar') || 
                  link.textContent?.includes('PDF') ||
                  link.classList.contains('view-pdf') ||
                  href.includes('.pdf')) {
                pdfUrl = href;
                break;
              }
            }
          }
          
          // Also check for links with .pdf extension directly
          if (!pdfUrl) {
            const pdfLinks = item.querySelectorAll('a[href*=".pdf"]');
            if (pdfLinks.length > 0) {
              pdfUrl = pdfLinks[0].getAttribute('href') || '';
            }
          }
          
          if (dateText && pdfUrl) {
            data.push({
              editionNumber,
              editionYear,
              dateText,
              pdfUrl,
            });
          }
        }
        
        // Strategy 2: Look for iframe with PDF content
        const iframes = document.querySelectorAll('iframe[src*=".pdf"], iframe[src*="diario"]');
        for (const iframe of Array.from(iframes)) {
          const src = iframe.getAttribute('src') || '';
          if (src) {
            // Try to extract date from iframe context or nearby elements
            const parent = iframe.parentElement;
            if (parent) {
              const parentText = parent.textContent || '';
              const dateMatch = parentText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
              if (dateMatch) {
                data.push({
                  dateText: `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`,
                  pdfUrl: src,
                });
              }
            }
          }
        }
        
        return data;
      });
      
      logger.debug(`Found ${gazetteData.length} gazette items on page`);
      
      // Process each gazette item
      for (const item of gazetteData) {
        try {
          // Parse date (DD/MM/YYYY format)
          const dateMatch = item.dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) {
            logger.warn(`Could not parse date: ${item.dateText}`);
            continue;
          }
          
          const [, day, month, year] = dateMatch;
          const gazetteDate = new Date(`${year}-${month}-${day}`);
          
          // Validate date
          if (isNaN(gazetteDate.getTime())) {
            logger.warn(`Invalid date: ${item.dateText}`);
            continue;
          }
          
          // Construct full PDF URL if relative
          let pdfUrl = item.pdfUrl;
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.alfenasConfig.baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }
          
          // Create gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber: item.editionNumber || undefined,
            isExtraEdition: false,
            power: 'executive_legislative',
            sourceText: `Diário Oficial ${item.editionNumber ? `N° ${item.editionNumber}` : ''} - ${item.dateText}`,
          });
          
          if (gazette) {
            gazettes.push(gazette);
          }
          
        } catch (error) {
          logger.error(`Error processing gazette item:`, error as Error);
        }
      }
      
    } catch (error) {
      logger.error(`Error extracting gazettes from page:`, error as Error);
    }
    
    return gazettes;
  }
}

