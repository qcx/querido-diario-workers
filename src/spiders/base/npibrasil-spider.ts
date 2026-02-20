import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Configuration interface for NPI Brasil transparency portals
 */
export interface NPIBrasilConfig {
  type: string;
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/**
 * Spider for NPI Brasil transparency portals
 * 
 * This spider handles the NPI Brasil portal structure commonly used by municipalities:
 * - URL pattern: transparencia.{city}.rj.gov.br/jornal.php
 * - Table structure with date, edition number, year, and secretariat
 * - "Mais informações" link that opens a modal with PDF viewer
 * - PDF URL pattern: /arquivos/{id}/DIARIO_OFICIAL_{edition}_{year}_{sequence}.pdf
 * - Pagination at the bottom of the page
 * 
 * Currently used by:
 * - Casimiro de Abreu, RJ
 */
export class NPIBrasilSpider extends BaseSpider {
  protected npiBrasilConfig: NPIBrasilConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.npiBrasilConfig = spiderConfig.config as NPIBrasilConfig;
    this.browser = browser || null;
    
    if (!this.npiBrasilConfig.baseUrl) {
      throw new Error(`NPIBrasilSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing NPIBrasilSpider for ${spiderConfig.name}`);
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.npiBrasilConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error(`NPIBrasilSpider requires browser binding for ${this.spiderConfig.name}`);
    }
    
    return this.crawlWithBrowser();
  }

  /**
   * Browser-based crawling for NPI Brasil portals
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Set viewport
      await page.setViewport({ width: 1280, height: 800 });
      
      // Navigate to the page
      logger.debug(`Navigating to ${this.npiBrasilConfig.baseUrl}`);
      await page.goto(this.npiBrasilConfig.baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Wait for page to stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Try to accept cookie consent if present
      try {
        const acceptButton = await page.evaluate(() => {
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            if (btn.textContent?.toLowerCase().includes('continuar') || 
                btn.textContent?.toLowerCase().includes('aceitar')) {
              (btn as HTMLElement).click();
              return true;
            }
          }
          return false;
        });
        if (acceptButton) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch {
        // Ignore - no cookie banner
      }
      
      // Extract gazettes from all pages
      let hasMorePages = true;
      let currentPage = 1;
      const maxPages = 50; // Safety limit
      const processedEditions = new Set<string>();
      
      while (hasMorePages && currentPage <= maxPages) {
        logger.debug(`Extracting gazettes from page ${currentPage}`);
        
        // Wait for table to be present
        try {
          await page.waitForSelector('table', { timeout: 10000 });
        } catch {
          logger.warn('Table not found on page, may be empty');
          break;
        }
        
        // Extract gazettes from the current page
        const pageGazettes = await this.extractGazettesFromPage(page, processedEditions);
        
        // Check if we've found gazettes older than our date range - stop early
        let foundOlderThanRange = false;
        for (const gazette of pageGazettes) {
          const gazetteDate = new Date(gazette.date);
          if (gazetteDate < new Date(this.startDate)) {
            foundOlderThanRange = true;
          }
          
          if (this.isInDateRange(gazetteDate)) {
            gazettes.push(gazette);
          }
        }
        
        logger.debug(`Found ${pageGazettes.length} gazettes on page ${currentPage}, ${gazettes.length} in date range`);
        
        // Stop if we found gazettes older than our range
        if (foundOlderThanRange) {
          logger.debug('Found gazettes older than date range, stopping pagination');
          break;
        }
        
        // Try to navigate to next page
        const hasNext = await this.navigateToNextPage(page);
        if (!hasNext) {
          hasMorePages = false;
        } else {
          currentPage++;
          // Wait for new content to load
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (error) {
          logger.warn(`Error closing page: ${error}`);
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (error) {
          logger.warn(`Error closing browser: ${error}`);
        }
      }
    }
    
    return gazettes;
  }

  /**
   * Extract gazettes from the current page
   */
  private async extractGazettesFromPage(page: any, processedEditions: Set<string>): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Extract data from the table
      const extractedData = await page.evaluate((baseUrl: string) => {
        const results: Array<{
          date: string;
          editionNumber: string;
          year: string;
          pdfUrl: string | null;
          linkRef: string | null;
        }> = [];
        
        // Find the table with gazette data
        const tables = document.querySelectorAll('table');
        
        for (const table of tables) {
          const rows = table.querySelectorAll('tr');
          
          for (const row of rows) {
            const cells = row.querySelectorAll('td');
            if (cells.length < 4) continue;
            
            // Expected structure: Date | Edition | Year | Secretariat | More Info
            const dateText = cells[0]?.textContent?.trim() || '';
            const editionText = cells[1]?.textContent?.trim() || '';
            const yearText = cells[2]?.textContent?.trim() || '';
            
            // Parse date (format: DD/MM/YYYY)
            const dateMatch = dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (!dateMatch) continue;
            
            const [, day, month, year] = dateMatch;
            const date = `${year}-${month}-${day}`;
            
            // Get edition number (might include "ERRATA" or other text)
            const editionMatch = editionText.match(/(\d+)/);
            const editionNumber = editionMatch ? editionMatch[1] : editionText;
            
            // Look for "Mais informações" link
            const moreInfoLink = row.querySelector('a');
            let pdfUrl: string | null = null;
            let linkRef: string | null = null;
            
            if (moreInfoLink) {
              const href = moreInfoLink.getAttribute('href');
              const onclick = moreInfoLink.getAttribute('onclick');
              
              // Check if it's a direct PDF link
              if (href && href.toLowerCase().includes('.pdf')) {
                if (href.startsWith('http')) {
                  pdfUrl = href;
                } else if (href.startsWith('/')) {
                  pdfUrl = new URL(href, baseUrl).href;
                } else {
                  pdfUrl = new URL(href, baseUrl).href;
                }
              }
              
              // Check for jornal.php?id={ID} pattern (NPI Brasil portal pattern)
              // This allows us to construct the PDF URL directly
              if (href && href.includes('jornal.php?id=')) {
                const idMatch = href.match(/jornal\.php\?id=(\d+)/);
                if (idMatch) {
                  linkRef = idMatch[1];
                  // Construct PDF URL using the known pattern:
                  // arquivos/{ID}/DIARIO_OFICIAL_{edition}_{year}_0000001.pdf
                  const paddedEdition = editionNumber.padStart(1, '0');
                  pdfUrl = new URL(`arquivos/${linkRef}/DIARIO_OFICIAL_${paddedEdition}_${yearText || year}_0000001.pdf`, baseUrl).href;
                }
              }
              
              // Check onclick for file path or ID
              if (onclick && !pdfUrl) {
                // Pattern: openFile('path/to/file.pdf') or similar
                const pathMatch = onclick.match(/['"]([^'"]*\.pdf)['"]/i);
                if (pathMatch) {
                  const path = pathMatch[1];
                  if (path.startsWith('http')) {
                    pdfUrl = path;
                  } else if (path.startsWith('/')) {
                    pdfUrl = new URL(path, baseUrl).href;
                  } else {
                    pdfUrl = new URL(path, baseUrl).href;
                  }
                }
                
                // Also capture any ID reference in onclick
                const idMatch = onclick.match(/\d+/);
                if (idMatch) {
                  linkRef = idMatch[0];
                }
              }
            }
            
            results.push({
              date,
              editionNumber,
              year: yearText || year,
              pdfUrl,
              linkRef
            });
          }
        }
        
        return results;
      }, this.npiBrasilConfig.baseUrl);
      
      // Process extracted data
      for (const data of extractedData) {
        // Create unique key for this edition
        const editionKey = `${data.year}-${data.editionNumber}`;
        if (processedEditions.has(editionKey)) {
          continue;
        }
        
        // Try to get PDF URL
        let pdfUrl = data.pdfUrl;
        
        // If no direct PDF URL found, we need to click on the link to intercept the PDF URL
        if (!pdfUrl) {
          // Try to construct PDF URL based on known patterns
          // Pattern: /arquivos/{id}/DIARIO_OFICIAL_{edition}_{year}_0000001.pdf
          // We'll click on the "Mais informações" link and intercept network requests
          pdfUrl = await this.interceptPdfUrl(page, data.editionNumber, data.year);
        }
        
        if (!pdfUrl) {
          logger.warn(`Could not find PDF URL for edition ${data.editionNumber} (${data.date})`);
          continue;
        }
        
        processedEditions.add(editionKey);
        
        // Parse date
        const gazetteDate = new Date(data.date);
        if (isNaN(gazetteDate.getTime())) {
          logger.warn(`Invalid date: ${data.date}`);
          continue;
        }
        
        // Check for extra edition markers
        const isExtra = /errata|suplemento|extra/i.test(data.editionNumber);
        
        // Create gazette
        const gazette = await this.createGazette(gazetteDate, pdfUrl, {
          power: 'executive_legislative',
          editionNumber: data.editionNumber,
          isExtraEdition: isExtra,
        });
        
        if (gazette) {
          gazettes.push(gazette);
          logger.info(`Found gazette for ${toISODate(gazetteDate)} (edição ${data.editionNumber}): ${pdfUrl}`);
        }
      }
    } catch (error) {
      logger.error('Error extracting gazettes from page:', error as Error);
    }
    
    return gazettes;
  }

  /**
   * Intercept PDF URL by clicking on the "Mais informações" link and capturing network requests
   */
  private async interceptPdfUrl(page: any, editionNumber: string, _year: string): Promise<string | null> {
    try {
      // Set up request interception to capture PDF URLs
      let capturedPdfUrl: string | null = null;
      
      // Find and click on the "Mais informações" link for this edition
      const clicked = await page.evaluate((edition: string) => {
        const rows = document.querySelectorAll('tr');
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            const editionCell = cells[1]?.textContent?.trim() || '';
            if (editionCell.includes(edition)) {
              const link = row.querySelector('a');
              if (link) {
                (link as HTMLElement).click();
                return true;
              }
            }
          }
        }
        return false;
      }, editionNumber);
      
      if (!clicked) {
        return null;
      }
      
      // Wait for the PDF to load in the viewer
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Try to find the PDF URL in the page
      capturedPdfUrl = await page.evaluate(() => {
        // Check for iframe with PDF
        const iframes = document.querySelectorAll('iframe');
        for (const iframe of iframes) {
          const src = iframe.getAttribute('src');
          if (src && src.toLowerCase().includes('.pdf')) {
            return src;
          }
        }
        
        // Check for embed or object elements
        const embeds = document.querySelectorAll('embed, object');
        for (const embed of embeds) {
          const src = embed.getAttribute('src') || embed.getAttribute('data');
          if (src && src.toLowerCase().includes('.pdf')) {
            return src;
          }
        }
        
        // Check for PDF.js viewer canvas
        const canvas = document.querySelector('.pdfViewer canvas, #the-canvas, canvas[class*="pdf"]');
        if (canvas) {
          // PDF.js doesn't expose the URL directly in the canvas
          // Try to find it in window or data attributes
          const pdfViewerApp = (window as any).PDFViewerApplication;
          if (pdfViewerApp && pdfViewerApp.url) {
            return pdfViewerApp.url;
          }
        }
        
        // Look for links to PDF in the modal
        const links = document.querySelectorAll('a');
        for (const link of links) {
          const href = link.getAttribute('href');
          if (href && href.toLowerCase().includes('.pdf')) {
            return href;
          }
        }
        
        return null;
      });
      
      // Close the modal if open
      await page.evaluate(() => {
        const closeButtons = document.querySelectorAll('[class*="close"], button[aria-label*="close"], .modal-close, [data-dismiss="modal"]');
        for (const btn of closeButtons) {
          (btn as HTMLElement).click();
        }
      });
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Make URL absolute if needed
      if (capturedPdfUrl && !capturedPdfUrl.startsWith('http')) {
        const baseUrl = new URL(this.npiBrasilConfig.baseUrl);
        if (capturedPdfUrl.startsWith('/')) {
          capturedPdfUrl = `${baseUrl.protocol}//${baseUrl.host}${capturedPdfUrl}`;
        } else {
          capturedPdfUrl = new URL(capturedPdfUrl, this.npiBrasilConfig.baseUrl).href;
        }
      }
      
      return capturedPdfUrl;
    } catch (error) {
      logger.debug(`Error intercepting PDF URL: ${error}`);
      return null;
    }
  }

  /**
   * Navigate to the next page of results
   */
  private async navigateToNextPage(page: any): Promise<boolean> {
    try {
      const hasNext = await page.evaluate(() => {
        // Look for pagination links
        const paginationLinks = document.querySelectorAll('.pagination a, [class*="pagination"] a, nav a');
        
        // Find the current page
        let currentPageNum = 1;
        for (const link of paginationLinks) {
          const parent = link.parentElement;
          if (parent?.classList.contains('active') || parent?.getAttribute('aria-current') === 'page') {
            const num = parseInt(link.textContent?.trim() || '1');
            if (!isNaN(num)) {
              currentPageNum = num;
              break;
            }
          }
        }
        
        // Look for the next page link
        for (const link of paginationLinks) {
          const text = link.textContent?.trim();
          const num = parseInt(text || '0');
          
          // Check if this is the next page number
          if (num === currentPageNum + 1) {
            (link as HTMLElement).click();
            return true;
          }
          
          // Check for "Next" or ">" button
          if (text === 'Next' || text === '>' || text === '»' || 
              link.getAttribute('aria-label')?.toLowerCase().includes('next')) {
            (link as HTMLElement).click();
            return true;
          }
        }
        
        return false;
      });
      
      return hasNext;
    } catch (error) {
      logger.debug(`Error navigating to next page: ${error}`);
      return false;
    }
  }
}
