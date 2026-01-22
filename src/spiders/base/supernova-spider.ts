import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Configuration interface for Supernova/Moderna portal spiders
 */
export interface SupernovaConfig {
  type: string;
  /** Base URL for the Supernova portal (e.g., "https://webtangua.supernova.com.br:8443/contaspublicas/pages/publicacao_demais_relatorio.xhtml?faces-redirect=true&idTipoRelatorio=1") */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Spider for Supernova/Moderna Portal da Transparência gazette system
 * 
 * Uses Cloudflare Browser Rendering (Puppeteer) to handle:
 * - JSF/PrimeFaces application requiring JavaScript
 * - Dropdown filter for "Diário Oficial" type
 * - Data grid with pagination
 * - PDF links via "Exibir Relatório" buttons
 * 
 * The site structure:
 * 1. Navigate to baseUrl
 * 2. Select "Diário Oficial" from dropdown (if not already selected)
 * 3. Click "Pesquisar" button
 * 4. Results appear in a data grid with columns: Ano, Número, Nome do Arquivo
 * 5. Each row has "Exibir Relatório" links that open PDFs
 * 6. Pagination available at top and bottom
 * 7. File names contain date in format: Diário Oficial_Nº XXXX_Publicação_DDMMYYYY.pdf
 */
export class SupernovaSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as SupernovaConfig;
    this.baseUrl = platformConfig.baseUrl;
    this.browser = browser || null;
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  /**
   * Parse date from filename format DDMMYYYY
   */
  private parseDateFromFilename(filename: string): Date | null {
    // Match pattern like "Publicação_05012026.pdf" or "Publicacao_05012026.pdf"
    const match = filename.match(/Publica[çc][ãa]o_(\d{2})(\d{2})(\d{4})/i);
    if (match) {
      const [, day, month, year] = match;
      return new Date(
        parseInt(year, 10),
        parseInt(month, 10) - 1,
        parseInt(day, 10)
      );
    }
    return null;
  }

  /**
   * Extract edition number from filename
   */
  private extractEditionNumber(filename: string): string | undefined {
    // Match pattern like "Nº 1104" or "N° 1104"
    const match = filename.match(/N[ºo°]\s*(\d+)/i);
    return match ? match[1] : undefined;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(`SupernovaSpider for ${this.config.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling Supernova portal for ${this.config.name}...`);

    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      
      // Set viewport
      await page.setViewport({ width: 1280, height: 800 });
      
      // Step 1: Navigate to the portal home page
      const portalHome = this.baseUrl.includes('/pages/') 
        ? this.baseUrl.replace(/\/pages\/.*$/, '/')
        : this.baseUrl.replace(/\/[^/]*$/, '/');
      
      logger.debug(`Navigating to portal home: ${portalHome}`);
      await page.goto(portalHome, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Wait for page to stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Step 2: Click on "Diário oficial" menu item to navigate to the gazette search page
      logger.debug('Looking for Diário oficial menu...');
      
      const menuClicked = await page.evaluate(() => {
        // Find the menu link for "Diário oficial" in the submenu
        const menuLinks = document.querySelectorAll('.ui-menu a.ui-menuitem-link, a.ui-menuitem-link');
        for (let i = 0; i < menuLinks.length; i++) {
          const link = menuLinks[i] as HTMLAnchorElement;
          const text = (link.textContent || '').toLowerCase();
          if (text.includes('diário oficial') || text.includes('diario oficial')) {
            link.click();
            return { clicked: true, text: link.textContent };
          }
        }
        
        // Try clicking on the menu button first to open submenu
        const menuButtons = document.querySelectorAll('.ui-menubutton button');
        for (let i = 0; i < menuButtons.length; i++) {
          const btn = menuButtons[i] as HTMLButtonElement;
          const text = (btn.textContent || '').toLowerCase();
          if (text.includes('diário oficial') || text.includes('diario oficial')) {
            btn.click();
            return { clicked: true, text: btn.textContent, isMenuButton: true };
          }
        }
        
        return { clicked: false, text: null };
      });
      
      if (menuClicked.clicked) {
        logger.debug(`Menu clicked: ${menuClicked.text}`);
        
        if (menuClicked.isMenuButton) {
          // If we clicked a menu button, wait for submenu and click the item
          await new Promise(resolve => setTimeout(resolve, 500));
          
          await page.evaluate(() => {
            const menuLinks = document.querySelectorAll('.ui-menu a.ui-menuitem-link');
            for (let i = 0; i < menuLinks.length; i++) {
              const link = menuLinks[i] as HTMLAnchorElement;
              const text = (link.textContent || '').toLowerCase();
              if (text.includes('diário oficial') || text.includes('diario oficial')) {
                link.click();
                return true;
              }
            }
            return false;
          });
        }
        
        // Wait for navigation to complete
        await new Promise(resolve => setTimeout(resolve, 3000));
      } else {
        // If menu click failed, try navigating directly to the search page with parameters
        const directUrl = `${portalHome}pages/publicacao_demais_relatorio.xhtml?faces-redirect=true&idTipoRelatorio=1`;
        logger.debug(`Menu not found, navigating directly to: ${directUrl}`);
        await page.goto(directUrl, { waitUntil: 'networkidle0', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      this.requestCount++;
      
      // Step 3: Click the search button to load results
      logger.debug('Looking for Pesquisar button...');
      
      const searchClicked = await page.evaluate(() => {
        // Look for buttons with search-related text
        const allButtons = document.querySelectorAll('button');
        for (let i = 0; i < allButtons.length; i++) {
          const button = allButtons[i] as HTMLButtonElement;
          const text = (button.textContent || '').replace(/\s+/g, '').toLowerCase();
          
          // Skip menu buttons that open dropdowns
          if (button.closest('.ui-menubutton')) continue;
          
          // Match "Pesquisar" or variations like "Pqiar" (font rendering issue)
          if (text.includes('pesquisar') || text.includes('pqiar')) {
            button.click();
            return { clicked: true, buttonText: button.textContent };
          }
        }
        
        // Try to find by icon or class
        const searchButtons = document.querySelectorAll('button[class*="search"], .ui-commandbutton');
        for (let i = 0; i < searchButtons.length; i++) {
          const button = searchButtons[i] as HTMLButtonElement;
          const text = (button.textContent || '').replace(/\s+/g, '').toLowerCase();
          if (!button.closest('.ui-menubutton') && (text.includes('pe') || text.includes('ar'))) {
            button.click();
            return { clicked: true, buttonText: button.textContent };
          }
        }
        
        return { clicked: false, buttonText: null };
      });
      
      logger.debug(`Search button clicked: ${searchClicked.clicked}, text: ${searchClicked.buttonText}`);
      
      // Wait for results to load
      logger.debug('Waiting for results to load...');
      
      // Wait for the loading dialog to disappear
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Wait for datatable/grid to appear
      try {
        await page.waitForSelector('[role="grid"], .ui-datatable, .ui-datatable-tablewrapper', { timeout: 15000 });
        logger.debug('Results grid found!');
      } catch {
        logger.debug('Grid not found after first wait, waiting more...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      
      // Additional wait for AJAX to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
      this.requestCount++;
      
      // Extract gazettes from all pages
      let currentPage = 1;
      let hasMorePages = true;
      const maxPages = 50; // Safety limit
      const seenUrls = new Set<string>();
      
      while (hasMorePages && currentPage <= maxPages) {
        logger.debug(`Extracting gazettes from page ${currentPage}...`);
        
        const pageGazettes = await this.extractGazettesFromPage(page, seenUrls);
        
        // Filter by date range and add to results
        for (const gazette of pageGazettes) {
          if (gazette && this.isInDateRange(new Date(gazette.date))) {
            gazettes.push(gazette);
          }
        }
        
        logger.debug(`Found ${pageGazettes.length} gazettes on page ${currentPage}, ${gazettes.length} total in date range`);
        
        // Check for next page
        const hasNext = await page.evaluate(() => {
          const nextLink = document.querySelector('a.ui-paginator-next:not(.ui-state-disabled)');
          if (nextLink) {
            (nextLink as HTMLElement).click();
            return true;
          }
          return false;
        });
        
        if (hasNext) {
          await new Promise(resolve => setTimeout(resolve, 3000));
          currentPage++;
          this.requestCount++;
        } else {
          hasMorePages = false;
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from Supernova portal`);
      
    } catch (error) {
      logger.error(`Error crawling Supernova portal:`, error as Error);
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
  private async extractGazettesFromPage(page: any, seenUrls: Set<string>): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Extract all gazette rows from the data grid
      const gazetteItems = await page.evaluate(() => {
        const results: Array<{
          year: string;
          number: string;
          filename: string;
          linkHref: string | null;
          rowIndex: number;
        }> = [];
        
        // Try multiple selectors to find the data rows
        // The Supernova portal uses PrimeFaces which renders a grid/datatable
        const selectors = [
          '[role="grid"] [role="row"]:not([role="row"]:first-child)', // grid rows excluding header
          '.ui-datatable tbody tr',
          '.ui-datatable-data tr',
          'table tbody tr[role="row"]',
          'table tbody tr',
        ];
        
        let rows: Element[] = [];
        for (const selector of selectors) {
          const found = document.querySelectorAll(selector);
          if (found && found.length > 0) {
            // Filter out header rows
            rows = Array.from(found).filter(row => {
              const hasHeaderCells = row.querySelector('th');
              const hasColumnHeader = row.querySelector('[role="columnheader"]');
              return !hasHeaderCells && !hasColumnHeader;
            });
            if (rows.length > 0) break;
          }
        }
        
        if (rows.length === 0) {
          console.log('No data rows found in datatable');
          return results;
        }
        
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
          const row = rows[rowIndex];
          // Try gridcell first, then td
          let cells = row.querySelectorAll('[role="gridcell"]');
          if (cells.length === 0) {
            cells = row.querySelectorAll('td');
          }
          
          if (cells.length >= 3) {
            // Get direct text content, avoiding header text
            const getCleanText = (cell: Element | null): string => {
              if (!cell) return '';
              // Try to get text from direct children only (skip any nested headers)
              const textNodes = Array.from(cell.childNodes)
                .filter(n => n.nodeType === Node.TEXT_NODE)
                .map(n => n.textContent?.trim())
                .filter(Boolean)
                .join('');
              if (textNodes) return textNodes;
              
              // Fallback to innerText (single line) if available
              const innerText = (cell as HTMLElement).innerText?.trim();
              if (innerText) {
                // Remove common header patterns
                return innerText
                  .replace(/^(Ano|Número|Nome do Arquivo)\s*/gi, '')
                  .trim();
              }
              
              return cell.textContent?.trim() || '';
            };
            
            const year = getCleanText(cells[0]);
            const number = getCleanText(cells[1]);
            let filename = getCleanText(cells[2]);
            
            // Clean up filename - remove header text if accidentally included
            filename = filename
              .replace(/^Nome do Arquivo\s*/gi, '')
              .replace(/^Exibir Relatório\s*/gi, '')
              .trim();
            
            // Try to find the PDF link
            // Look for links in all cells
            let linkHref: string | null = null;
            
            const allLinks = row.querySelectorAll('a');
            for (let j = 0; j < allLinks.length; j++) {
              const link = allLinks[j] as HTMLAnchorElement;
              const href = link.getAttribute('href');
              const onclick = link.getAttribute('onclick') || '';
              
              // Check for window.open pattern
              const windowOpenMatch = onclick.match(/window\.open\(['"]([^'"]+)['"]/);
              if (windowOpenMatch) {
                linkHref = windowOpenMatch[1];
                break;
              }
              
              // Check for PrimeFaces download pattern
              const pfDownloadMatch = onclick.match(/PrimeFaces\.download\(['"]([^'"]+)['"]/);
              if (pfDownloadMatch) {
                linkHref = pfDownloadMatch[1];
                break;
              }
              
              // Check for direct PDF href
              if (href && (href.includes('.pdf') || href.includes('download') || href.includes('arquivo'))) {
                linkHref = href;
                break;
              }
            }
            
            // Only include if it looks like a Diário Oficial file
            const lowerFilename = filename.toLowerCase();
            if (filename && (
              lowerFilename.includes('diário oficial') ||
              lowerFilename.includes('diario oficial') ||
              lowerFilename.includes('publicação') ||
              lowerFilename.includes('publicacao') ||
              lowerFilename.includes('.pdf')
            )) {
              results.push({ year, number, filename, linkHref, rowIndex });
            }
          }
        }
        
        return results;
      });
      
      logger.debug(`Found ${gazetteItems.length} gazette rows on page`);
      
      // Process each gazette item
      for (const item of gazetteItems) {
        try {
          // Parse date from filename
          const gazetteDate = this.parseDateFromFilename(item.filename);
          
          if (!gazetteDate || isNaN(gazetteDate.getTime())) {
            logger.debug(`Skipping item: could not parse date from ${item.filename}`);
            continue;
          }
          
          // Check if date is in range
          if (!this.isInDateRange(gazetteDate)) {
            logger.debug(`Skipping item: date ${gazetteDate.toISOString()} not in range`);
            continue;
          }
          
          // Get PDF URL - construct from filename if not found
          let pdfUrl: string | null = item.linkHref;
          
          if (!pdfUrl || !pdfUrl.includes('.pdf')) {
            // Construct URL from filename
            // The Supernova portal typically stores files at: /contaspublicas/arquivos/demais_relatorio/
            const baseUrlObj = new URL(this.baseUrl);
            // URL encode the filename properly
            const encodedFilename = encodeURIComponent(item.filename);
            pdfUrl = `${baseUrlObj.origin}/contaspublicas/arquivos/demais_relatorio/${encodedFilename}`;
          }
          
          if (!pdfUrl) {
            logger.warn(`Could not determine PDF URL for gazette: ${item.filename}`);
            continue;
          }
          
          // Make URL absolute if needed
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }
          
          // Skip if already seen
          if (seenUrls.has(pdfUrl)) {
            continue;
          }
          seenUrls.add(pdfUrl);
          
          // Extract edition number
          const editionNumber = this.extractEditionNumber(item.filename) || item.number;
          
          // Create gazette without URL resolution (the Supernova portal serves PDFs via session-based URLs)
          // We skip URL resolution to avoid timeouts and let the OCR system handle the actual PDF download
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber,
            power: 'executive_legislative',
            sourceText: item.filename,
            skipUrlResolution: true, // Skip URL resolution for Supernova - PDFs require session cookies
          });
          
          if (gazette) {
            gazettes.push(gazette);
            logger.debug(`Created gazette: ${item.filename} - ${pdfUrl}`);
          }
          
        } catch (error) {
          logger.error(`Error processing gazette item:`, { error: error instanceof Error ? error.message : String(error), item });
        }
      }
      
    } catch (error) {
      logger.error(`Error extracting gazettes from page:`, { error: error instanceof Error ? error.message : String(error) });
    }
    
    return gazettes;
  }
}
