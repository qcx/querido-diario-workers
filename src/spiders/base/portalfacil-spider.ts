import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Configuration interface for Portal Fácil/Actcon.net platform spider
 */
export interface PortalfacilConfig {
  type: 'portalfacil';
  /** Base URL for the Portal Fácil diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering (always true for Portal Fácil) */
  requiresClientRendering?: boolean;
}

/**
 * Spider for Portal Fácil/Actcon.net platform
 * 
 * Portal Fácil is a common platform used by many Brazilian municipalities.
 * Developed by Actcon.net, it uses AjaxPro for loading gazettes via JavaScript.
 * 
 * Site Structure:
 * - Uses Portal Fácil platform with AjaxPro for loading gazettes
 * - Gazettes are loaded via JavaScript (typically diel_diel_lis.GetDiario)
 * - List of editions with "Visualizar arquivo" or similar links
 * - PDF URLs typically: {baseUrl}/abrir_arquivo.aspx?cdLocal=12&arquivo={GUID}.pdf
 * 
 * Data Structure per gazette:
 * - Edition number (N° XXXX / YYYY)
 * - Date (DD/Mês/YYYY or DD/MM/YYYY)
 * - Size (X.XXX MB)
 * - Link to PDF
 * 
 * Requires browser rendering due to JavaScript-heavy page
 */
export class PortalfacilSpider extends BaseSpider {
  protected portalfacilConfig: PortalfacilConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.portalfacilConfig = spiderConfig.config as PortalfacilConfig;
    this.browser = browser || null;
    
    if (!this.portalfacilConfig.baseUrl) {
      throw new Error(`PortalfacilSpider requires a baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PortalfacilSpider for ${spiderConfig.name} with URL: ${this.portalfacilConfig.baseUrl}`, {
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
    logger.info(`Crawling ${this.portalfacilConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error('PortalfacilSpider requires browser rendering');
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
      logger.debug(`Navigating to: ${this.portalfacilConfig.baseUrl}`);
      await page.goto(this.portalfacilConfig.baseUrl, { waitUntil: 'networkidle0', timeout: 45000 });
      this.requestCount++;
      
      // Wait for page to stabilize and JavaScript to load the gazettes
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Wait for gazettes to load - look for the list container
      try {
        await page.waitForSelector('#arquivos li, .list-group-item, ul.list-group, .registros, table tbody tr', { timeout: 15000 });
      } catch (error) {
        logger.warn('Gazette list not found, page may be empty or still loading');
      }
      
      // Additional wait for JavaScript to finish loading content
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extract gazettes from the page
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
        
        // Check for pagination - look for "Anteriores" button, next page link, or pagination controls
        const hasNextPageButton = await page.evaluate(() => {
          // Look for "Anteriores" button
          const buttons = document.querySelectorAll('button, input[type="button"]');
          for (const button of buttons) {
            const text = button.textContent || button.getAttribute('value') || '';
            if ((text.includes('Anteriores') || text.includes('Próxima') || text.includes('Próximo')) && !(button as HTMLButtonElement).disabled) {
              return true;
            }
          }
          // Look for pagination links
          const paginationLinks = document.querySelectorAll('a.page-link, .pagination a, a[href*="page"], a[onclick*="page"]');
          for (const link of paginationLinks) {
            const text = link.textContent || '';
            if (text.includes('›') || text.includes('»') || text.includes('Próxima') || text.includes('Próximo')) {
              return true;
            }
          }
          return false;
        });
        
        if (hasNextPageButton) {
          // Click the button using evaluate
          const clicked = await page.evaluate(() => {
            // Try buttons first
            const buttons = document.querySelectorAll('button, input[type="button"]');
            for (const button of buttons) {
              const text = button.textContent || button.getAttribute('value') || '';
              if ((text.includes('Anteriores') || text.includes('Próxima') || text.includes('Próximo')) && !(button as HTMLButtonElement).disabled) {
                (button as HTMLElement).click();
                return true;
              }
            }
            // Try pagination links
            const paginationLinks = document.querySelectorAll('a.page-link, .pagination a, a[href*="page"], a[onclick*="page"]');
            for (const link of paginationLinks) {
              const text = link.textContent || '';
              if (text.includes('›') || text.includes('»') || text.includes('Próxima') || text.includes('Próximo')) {
                (link as HTMLAnchorElement).click();
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
      // Portal Fácil can have different structures:
      // 1. ul.list-group with li.list-group-item elements
      // 2. Table with tbody tr elements
      // 3. div.registros with child elements
      const gazetteData = await page.evaluate(() => {
        const data: any[] = [];
        
        // Try multiple selectors for different Portal Fácil layouts
        const selectors = [
          '.list-group-item',
          'li.list-group-item',
          '#arquivos li',
          'table tbody tr',
          '.registros > *',
          '[class*="edicao"]',
          '[class*="diario"]',
        ];
        
        let items: NodeListOf<Element> | null = null;
        for (const selector of selectors) {
          items = document.querySelectorAll(selector);
          if (items.length > 0) {
            break;
          }
        }
        
        if (!items || items.length === 0) {
          return data;
        }
        
        for (const item of Array.from(items)) {
          // Skip items that are not gazette items (like headers)
          // Check for link with "abrir_arquivo", "visualizar", "download", or PDF link
          let hasGazetteLink = item.querySelector('a[href*="abrir_arquivo"], a[href*="visualizar"], a[href*="download"], a[href$=".pdf"]');
          
          // Also check for links with text containing "Visualizar", "Baixar", "Download"
          if (!hasGazetteLink) {
            const allLinks = item.querySelectorAll('a');
            for (const link of allLinks) {
              const linkText = link.textContent?.toLowerCase() || '';
              if (linkText.includes('visualizar') || linkText.includes('baixar') || linkText.includes('download') || link.href.includes('.pdf')) {
                hasGazetteLink = link;
                break;
              }
            }
          }
          
          if (!hasGazetteLink) continue;
          
          // Extract edition number
          // Look for pattern "N° XXXX / YYYY" or "Edição XXXX" or "Nº XXXX"
          let editionText = item.textContent || '';
          let editionNumber = null;
          let editionYear = null;
          
          // Try pattern "N° XXXX / YYYY" or "Nº XXXX / YYYY"
          const editionMatch1 = editionText.match(/N[°º]\s*(\d+)\s*\/\s*(\d{4})/);
          if (editionMatch1) {
            editionNumber = editionMatch1[1];
            editionYear = editionMatch1[2];
          } else {
            // Try pattern "Edição XXXX" or "Ed. XXXX"
            const editionMatch2 = editionText.match(/Edi[çc][ãa]o?\s*[Nn]?[°º]?\s*(\d+)/i);
            if (editionMatch2) {
              editionNumber = editionMatch2[1];
            }
            // Try to extract year from date
            const yearMatch = editionText.match(/\/(\d{4})/);
            if (yearMatch) {
              editionYear = yearMatch[1];
            }
          }
          
          // Extract date
          // Look for pattern "Data: DD/MM/YYYY" or from heading
          let dateText = '';
          
          // Find div/span containing "Data:" text
          const allElements = item.querySelectorAll('div, span, td, th');
          for (const el of allElements) {
            const text = el.textContent || '';
            if (text.includes('Data:') || text.includes('Publicado em:')) {
              const match = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
              if (match) {
                dateText = `${match[1]}/${match[2]}/${match[3]}`;
                break;
              }
            }
          }
          
          // If no date found, try to find date in the item text (Portuguese month format)
          if (!dateText) {
            const headingElement = item.querySelector('h4, h5, h6, .title, .data, td:first-child');
            const headingText = headingElement?.textContent?.trim() || item.textContent || '';
            
            // Pattern: DD/Mês/YYYY (e.g., "06/Janeiro/2026")
            const months: Record<string, string> = {
              'janeiro': '01', 'fevereiro': '02', 'março': '03', 'marco': '03',
              'abril': '04', 'maio': '05', 'junho': '06', 
              'julho': '07', 'agosto': '08', 'setembro': '09',
              'outubro': '10', 'novembro': '11', 'dezembro': '12'
            };
            
            // Try Portuguese month format first
            const dateMatchPt = headingText.match(/(\d{2})\/(\w+)\/(\d{4})/i);
            if (dateMatchPt) {
              const monthNum = months[dateMatchPt[2].toLowerCase()];
              if (monthNum) {
                dateText = `${dateMatchPt[1]}/${monthNum}/${dateMatchPt[3]}`;
              }
            } else {
              // Try DD/MM/YYYY format
              const dateMatch = headingText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
              if (dateMatch) {
                dateText = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;
              }
            }
          }
          
          // Extract PDF URL
          let pdfUrl = '';
          const pdfLink = item.querySelector('a[href*="abrir_arquivo"], a[href*="visualizar"], a[href$=".pdf"]');
          if (pdfLink) {
            pdfUrl = pdfLink.getAttribute('href') || '';
          }
          
          // If not found, look for any link with "Visualizar", "Baixar", "Download"
          if (!pdfUrl) {
            const allLinks = item.querySelectorAll('a');
            for (const link of allLinks) {
              const linkText = link.textContent?.toLowerCase() || '';
              if (linkText.includes('visualizar') || linkText.includes('baixar') || linkText.includes('download') || link.href.includes('.pdf')) {
                pdfUrl = link.getAttribute('href') || '';
                break;
              }
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
            const baseUrlObj = new URL(this.portalfacilConfig.baseUrl);
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
