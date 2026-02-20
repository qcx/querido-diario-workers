import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituracamposdojordaoConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Spider for Prefeitura de Campos do Jordão official gazette
 * 
 * Site structure:
 * - URL: https://camposdojordao.sp.gov.br/diario-oficial
 * - Table columns: Edição/Mês, Data (DD/MM/YYYY), Título (with PDF link)
 * - PDFs at: https://camposdojordao.sp.gov.br/Arquivos_Publicacoes/Diario-Oficial/{hash}.pdf
 * - Pagination: "Primeira", "1", "2", "3", ..., "Ultima"
 * 
 * Requires browser rendering for JavaScript-heavy pages
 */
export class PrefeituracamposdojordaoSpider extends BaseSpider {
  protected camposConfig: PrefeituracamposdojordaoConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.camposConfig = spiderConfig.config as PrefeituracamposdojordaoConfig;
    this.browser = browser || null;
    
    if (!this.camposConfig.baseUrl) {
      throw new Error(`PrefeituracamposdojordaoSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituracamposdojordaoSpider for ${spiderConfig.name} with URL: ${this.camposConfig.baseUrl}`, {
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
    logger.info(`Crawling ${this.camposConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      logger.error('Browser is required for PrefeituracamposdojordaoSpider');
      return [];
    }
    
    return this.crawlWithBrowser();
  }

  /**
   * Browser-based crawling for Campos do Jordão gazette site
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
      logger.debug(`Navigating to: ${this.camposConfig.baseUrl}`);
      await page.goto(this.camposConfig.baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Wait for page to stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extract gazettes from all pages
      let hasMorePages = true;
      let currentPage = 1;
      let foundOlderThanRange = false;
      
      while (hasMorePages && !foundOlderThanRange) {
        logger.debug(`Extracting gazettes from page ${currentPage}`);
        
        // Wait for the table to load
        try {
          await page.waitForSelector('table', { timeout: 10000 });
        } catch (error) {
          logger.warn('Table not found on page');
          break;
        }
        
        // Extract gazettes from current page
        const pageGazettes = await this.extractGazettesFromPage(page);
        
        logger.debug(`Found ${pageGazettes.length} gazettes on page ${currentPage}`);
        
        // Process each gazette and check date range
        for (const gazetteInfo of pageGazettes) {
          if (gazetteInfo.date) {
            const gazetteDate = new Date(gazetteInfo.date);
            const startDate = new Date(this.dateRange.start);
            
            // Check if gazette is older than our date range
            if (gazetteDate < startDate) {
              logger.debug(`Found gazette older than date range (${gazetteInfo.date}), stopping pagination`);
              foundOlderThanRange = true;
              break;
            }
            
            // Check if gazette is within date range
            if (this.isInDateRange(gazetteDate) && gazetteInfo.pdfUrl) {
              const gazette = await this.createGazette(gazetteDate, gazetteInfo.pdfUrl, {
                editionNumber: gazetteInfo.editionNumber,
                isExtraEdition: false,
                power: 'executive_legislative',
                sourceText: gazetteInfo.title || `Gazette ${toISODate(gazetteDate)}`,
              });
              
              if (gazette) {
                gazettes.push(gazette);
              }
            }
          }
        }
        
        if (foundOlderThanRange) {
          break;
        }
        
        // Check for next page
        const nextPageButton = await page.$('a[href*="pagina"]:not(.disabled), .pagination li:not(.active):not(.disabled) a, nav a[href*="page"]');
        
        if (nextPageButton && pageGazettes.length > 0) {
          // Try to find the "next" page by looking for numeric pagination links
          const nextPageLink = await page.evaluate(() => {
            const paginationLinks = document.querySelectorAll('.pagination a, nav ul li a');
            let currentActive = 0;
            
            for (const link of Array.from(paginationLinks)) {
              const text = link.textContent?.trim();
              const isActive = link.closest('li')?.classList.contains('active') || link.classList.contains('active');
              
              if (isActive && text && /^\d+$/.test(text)) {
                currentActive = parseInt(text, 10);
              }
            }
            
            // Find link for next page number
            for (const link of Array.from(paginationLinks)) {
              const text = link.textContent?.trim();
              if (text && /^\d+$/.test(text) && parseInt(text, 10) === currentActive + 1) {
                return (link as HTMLAnchorElement).href;
              }
            }
            
            // Try "Próxima" or ">" button
            for (const link of Array.from(paginationLinks)) {
              const text = link.textContent?.trim().toLowerCase();
              if (text && (text.includes('próxima') || text.includes('proxima') || text === '>')) {
                return (link as HTMLAnchorElement).href;
              }
            }
            
            return null;
          });
          
          if (nextPageLink) {
            logger.debug(`Navigating to next page: ${nextPageLink}`);
            await page.goto(nextPageLink, { waitUntil: 'networkidle0', timeout: 30000 });
            this.requestCount++;
            await new Promise(resolve => setTimeout(resolve, 2000));
            currentPage++;
            
            // Safety limit
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
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from Campos do Jordão`);
      
    } catch (error) {
      logger.error(`Error crawling Campos do Jordão:`, error as Error);
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
   * Extract gazette information from the current page
   */
  private async extractGazettesFromPage(page: any): Promise<Array<{
    date: string | null;
    pdfUrl: string | null;
    editionNumber: string | undefined;
    title: string | undefined;
  }>> {
    const results: Array<{
      date: string | null;
      pdfUrl: string | null;
      editionNumber: string | undefined;
      title: string | undefined;
    }> = [];

    try {
      // Extract data from table rows
      const rowsData = await page.evaluate(() => {
        const rows: any[] = [];
        
        // Find the table - look for table with gazette data
        const table = document.querySelector('table');
        if (!table) return rows;
        
        // Get all rows from tbody or directly from table
        const tableRows = table.querySelectorAll('tbody tr, tr');
        
        for (const row of Array.from(tableRows)) {
          const cells = row.querySelectorAll('td, th');
          if (cells.length < 3) continue;
          
          // Skip header rows
          const firstCellText = cells[0].textContent?.trim() || '';
          if (firstCellText.toLowerCase().includes('edição') || firstCellText.toLowerCase().includes('numero')) {
            continue;
          }
          
          // Column 0: Edition/Month (e.g., "522 / Janeiro")
          const editionText = cells[0].textContent?.trim() || '';
          
          // Column 1: Date (e.g., "05/01/2026")
          const dateText = cells[1].textContent?.trim() || '';
          
          // Column 2: Title with link to PDF
          const titleCell = cells[2];
          const titleLink = titleCell.querySelector('a');
          const titleText = titleLink?.textContent?.trim() || titleCell.textContent?.trim() || '';
          const pdfUrl = titleLink?.href || null;
          
          // Extract edition number from text like "522 / Janeiro"
          const editionMatch = editionText.match(/^(\d+)/);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;
          
          rows.push({
            editionText,
            dateText,
            titleText,
            pdfUrl,
            editionNumber,
          });
        }
        
        return rows;
      });
      
      logger.debug(`Found ${rowsData.length} table rows with data`);
      
      // Process each row
      for (const rowData of rowsData) {
        // Parse date from DD/MM/YYYY format
        let isoDate: string | null = null;
        if (rowData.dateText) {
          const dateMatch = rowData.dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (dateMatch) {
            const [, day, month, year] = dateMatch;
            isoDate = `${year}-${month}-${day}`;
          }
        }
        
        results.push({
          date: isoDate,
          pdfUrl: rowData.pdfUrl,
          editionNumber: rowData.editionNumber,
          title: rowData.titleText,
        });
      }
      
    } catch (error) {
      logger.error(`Error extracting gazettes from page:`, error as Error);
    }

    return results;
  }
}



