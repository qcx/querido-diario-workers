import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraBarraMansaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp, parseBrazilianDate } from '../../utils/date-utils';

/**
 * Spider for Prefeitura de Barra Mansa official gazette
 * 
 * Site Structure:
 * - URL: https://portaltransparencia.barramansa.rj.gov.br/boletim-oficial/
 * - WordPress Download Manager (WPDM) with DataTables
 * - Year links (2025, 2024, etc.) that filter the DataTables when clicked
 * - Table columns: Título, Categoria, Data de Publicação, Download
 * - Title format: "Notícia Oficial – Edição n°1504 de 16 de janeiro de 2026"
 * - Date format: "16 de janeiro de 2026" (Portuguese format)
 * - Download links in the last column
 * 
 * IMPORTANT: The DataTables only loads data AFTER clicking on a year link.
 * The spider must click on year links to load the data before extraction.
 * 
 * Requires browser rendering due to JavaScript-rendered DataTables and Cloudflare protection
 */
export class PrefeituraBarraMansaSpider extends BaseSpider {
  private _baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraBarraMansaConfig;
    this._baseUrl = platformConfig.baseUrl || 'https://portaltransparencia.barramansa.rj.gov.br/boletim-oficial/';
    this.browser = browser || null;
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(`PrefeituraBarraMansaSpider for ${this.config.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura Barra Mansa for ${this.config.name}... (${this._baseUrl})`);

    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      
      // Navigate to the main page
      logger.info(`Navigating to: ${this._baseUrl}`);
      await page.goto(this._baseUrl, { waitUntil: 'networkidle0', timeout: 60000 });
      this.requestCount++;
      
      // Wait for page to stabilize after Cloudflare protection
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Wait for table to appear (the site may already show data without clicking years)
      try {
        await page.waitForSelector('table tbody tr', { timeout: 15000 });
        logger.debug('Table found on page');
      } catch (error) {
        logger.warn('Table not immediately visible, continuing...');
      }
      
      // Check if table already has data
      const tableHasData = await page.evaluate(() => {
        const cells = document.querySelectorAll('table tbody tr td');
        return cells.length > 0;
      });
      
      if (tableHasData) {
        logger.info('Table already has data, extracting directly...');
        
        // Extract all data from the table with pagination
        await this.extractAllPagesFromTable(page, gazettes);
        
      } else {
        logger.info('Table is empty, clicking on year links to load data...');
        
        // Get available years from the page
        const availableYears = await this.getAvailableYears(page);
        
        if (availableYears.length === 0) {
          logger.error('No year links found on page');
          return gazettes;
        }
        
        // Get the years we need to crawl
        const yearsInRange = this.getYearsInRange();
        logger.info(`Years to crawl: ${yearsInRange.join(', ')}`);
        logger.info(`Available years on site: ${availableYears.join(', ')}`);
        
        // Track which site years we've already processed
        const processedSiteYears = new Set<number>();
        
        // Process each year
        for (const year of yearsInRange) {
          logger.info(`Processing year ${year}`);
          
          // Determine which site year to click (e.g., 2026 data is in "2025" link)
          let siteYear = year;
          if (!availableYears.includes(year) && availableYears.length > 0) {
            if (year >= availableYears[0]) {
              siteYear = availableYears[0];
            }
          }
          
          // Skip if we already processed this site year
          if (processedSiteYears.has(siteYear)) {
            logger.debug(`Site year ${siteYear} already processed, skipping`);
            continue;
          }
          processedSiteYears.add(siteYear);
          
          // Click on the year link to load data
          const yearClicked = await this.clickYearLink(page, year, availableYears);
          
          if (!yearClicked) {
            logger.warn(`Could not click year link for ${year}, skipping...`);
            continue;
          }
          
          // Wait for DataTables to load
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          // Extract all data from the table with pagination
          await this.extractAllPagesFromTable(page, gazettes);
          
          // Navigate back to main page for next year
          if (yearsInRange.indexOf(year) < yearsInRange.length - 1) {
            await page.goto(this._baseUrl, { waitUntil: 'networkidle0', timeout: 60000 });
            this.requestCount++;
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from Prefeitura Barra Mansa`);
      
    } catch (error) {
      logger.error(`Error crawling Prefeitura Barra Mansa:`, error as Error);
      throw error;
    } finally {
      // Clean up
      if (page) {
        try {
          await page.close();
        } catch (e) {
          logger.warn('Error closing page', { error: String(e) });
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (e) {
          logger.warn('Error closing browser', { error: String(e) });
        }
      }
    }

    return gazettes;
  }

  /**
   * Extract all pages from the DataTables table
   */
  private async extractAllPagesFromTable(page: any, gazettes: Gazette[]): Promise<void> {
    let hasMorePages = true;
    let pageNum = 1;
    let foundOlderThanRange = false;
    
    while (hasMorePages && !foundOlderThanRange) {
      logger.debug(`Processing table page ${pageNum}`);
      
      // Wait for table data to appear
      try {
        await page.waitForFunction(
          () => {
            const rows = document.querySelectorAll('table tbody tr td');
            return rows.length > 0;
          },
          { timeout: 10000 }
        );
      } catch (error) {
        logger.warn(`Table data not found on page ${pageNum}, stopping...`);
        break;
      }
      
      // Extract gazettes from current page
      const pageGazettes = await this.extractGazettesFromPage(page);
      logger.debug(`Found ${pageGazettes.length} gazettes on page ${pageNum}`);
      
      for (const gazette of pageGazettes) {
        const gazetteDate = new Date(gazette.date);
        
        // Check if gazette is in date range
        if (this.isInDateRange(gazetteDate)) {
          gazettes.push(gazette);
          logger.debug(`Added gazette: ${gazette.editionNumber} - ${gazette.date}`);
        }
        
        // Check if we've gone past our start date
        if (gazetteDate < this.startDate) {
          foundOlderThanRange = true;
          logger.debug('Found gazette older than date range, stopping pagination');
        }
      }
      
      if (foundOlderThanRange) {
        break;
      }
      
      // Try to click the next page button (DataTables pagination)
      const hasNextPage = await page.evaluate(() => {
        const nextButton = document.querySelector('.paginate_button.next:not(.disabled)') as HTMLElement;
        if (nextButton) {
          nextButton.click();
          return true;
        }
        return false;
      });
      
      if (hasNextPage) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        pageNum++;
        
        // Safety limit
        if (pageNum > 100) {
          logger.warn('Reached maximum page limit (100), stopping pagination');
          hasMorePages = false;
        }
      } else {
        hasMorePages = false;
      }
    }
  }

  /**
   * Get all years in the date range
   */
  private getYearsInRange(): number[] {
    const years: number[] = [];
    const startYear = this.startDate.getFullYear();
    const endYear = this.endDate.getFullYear();
    
    // Process from most recent to oldest
    for (let year = endYear; year >= startYear; year--) {
      years.push(year);
    }
    
    return years;
  }

  /**
   * Get available year links from the page
   */
  private async getAvailableYears(page: any): Promise<number[]> {
    try {
      const years = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        const yearLinks: number[] = [];
        
        for (const link of links) {
          const text = link.textContent?.trim() || '';
          // Match 4-digit years (2017-2030)
          if (/^20\d{2}$/.test(text)) {
            const year = parseInt(text, 10);
            if (!yearLinks.includes(year)) {
              yearLinks.push(year);
            }
          }
        }
        
        // Sort descending (most recent first)
        return yearLinks.sort((a, b) => b - a);
      });
      
      logger.debug(`Available years on page: ${years.join(', ')}`);
      return years;
      
    } catch (error) {
      logger.error('Error getting available years:', error as Error);
      return [];
    }
  }

  /**
   * Click on the year link to load data in the DataTables
   * If the exact year doesn't exist, try the most recent available year
   */
  private async clickYearLink(page: any, year: number, availableYears: number[]): Promise<boolean> {
    try {
      // First try to click exact year
      let targetYear = year;
      
      // If year doesn't exist in available years, use the most recent one
      // (e.g., 2026 data is in "2025" category link)
      if (!availableYears.includes(year) && availableYears.length > 0) {
        // For current/future years, use the most recent available
        if (year >= availableYears[0]) {
          targetYear = availableYears[0];
          logger.debug(`Year ${year} not available, using most recent: ${targetYear}`);
        } else {
          // Year is older than available - skip
          logger.warn(`Year ${year} not available and older than available years`);
          return false;
        }
      }
      
      const clicked = await page.evaluate((targetYear: number) => {
        // Find all links on the page
        const links = Array.from(document.querySelectorAll('a'));
        
        // Look for a link with text matching the year
        for (const link of links) {
          const text = link.textContent?.trim() || '';
          if (text === targetYear.toString()) {
            link.click();
            return true;
          }
        }
        
        return false;
      }, targetYear);
      
      if (clicked) {
        logger.debug(`Clicked on year link: ${targetYear}`);
        return true;
      }
      
      logger.warn(`Year link not found: ${targetYear}`);
      return false;
      
    } catch (error) {
      logger.error(`Error clicking year link ${year}:`, error as Error);
      return false;
    }
  }

  /**
   * Extract gazettes from the current page
   */
  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    const pageGazettes = await page.evaluate(() => {
      const results: Array<{
        editionNumber: string;
        date: string;
        pdfUrl: string;
        isExtra: boolean;
        title: string;
      }> = [];

      // Find all table rows in tbody
      const rows = document.querySelectorAll('table tbody tr');
      
      if (!rows || rows.length === 0) {
        console.log('No table rows found');
        return results;
      }
      
      for (const row of rows) {
        try {
          const cells = row.querySelectorAll('td');
          if (cells.length < 4) continue;

          // Column 0: Title (e.g., "Notícia Oficial – Edição n°1504 de 16 de janeiro de 2026")
          const titleCell = cells[0];
          const titleText = titleCell?.textContent?.trim() || '';
          
          // Extract edition number from title
          // Pattern: "Edição n°1504" or "Edição nº1504"
          const editionMatch = titleText.match(/Edi[çc][ãa]o\s+n[°º]\s*(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : '';
          
          // Check if it's an extra edition
          const isExtra = titleText.toLowerCase().includes('extra') || 
                         titleText.toLowerCase().includes('suplementar');

          // Column 2: Date (e.g., "16 de janeiro de 2026")
          const dateCell = cells[2];
          const dateText = dateCell?.textContent?.trim() || '';
          
          // Extract date from title if not found in date cell
          // Title format: "Notícia Oficial – Edição n°1504 de 16 de janeiro de 2026"
          let finalDateText = dateText;
          if (!finalDateText || finalDateText.length < 10) {
            // Try to extract date from title
            const dateFromTitleMatch = titleText.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
            if (dateFromTitleMatch) {
              finalDateText = `${dateFromTitleMatch[1]} de ${dateFromTitleMatch[2]} de ${dateFromTitleMatch[3]}`;
            }
          }

          // Column 3: Download link
          const downloadCell = cells[3];
          let downloadLink = downloadCell?.querySelector('a[href*="download"], a[href*="Download"], a[href*="wpdmdl"]') as HTMLAnchorElement;
          if (!downloadLink) {
            // Try to find any link in the download cell
            downloadLink = downloadCell?.querySelector('a') as HTMLAnchorElement;
          }
          
          // Also look for download link in the title cell (sometimes WPDM puts it there)
          if (!downloadLink) {
            downloadLink = titleCell?.querySelector('a[href*="download"], a[href*="wpdmdl"]') as HTMLAnchorElement;
          }
          
          if (!downloadLink) continue;

          let pdfUrl = downloadLink.href;
          
          // Make sure URL is absolute
          if (pdfUrl.startsWith('/')) {
            pdfUrl = new URL(pdfUrl, window.location.origin).href;
          } else if (!pdfUrl.startsWith('http')) {
            pdfUrl = new URL(pdfUrl, window.location.href).href;
          }
          
          if (finalDateText && pdfUrl) {
            results.push({
              editionNumber,
              date: finalDateText,
              pdfUrl,
              isExtra,
              title: titleText,
            });
          }
        } catch (error) {
          console.error('Error extracting gazette from row:', error);
        }
      }

      return results;
    });

    // Convert to Gazette objects
    for (const item of pageGazettes) {
      try {
        // Parse Portuguese date format
        const date = parseBrazilianDate(item.date);
        if (isNaN(date.getTime())) {
          logger.warn(`Invalid date for gazette ${item.editionNumber}: ${item.date}`);
          continue;
        }

        const gazette: Gazette = {
          territoryId: this.config.territoryId,
          date: toISODate(date),
          fileUrl: item.pdfUrl,
          editionNumber: item.editionNumber,
          isExtraEdition: item.isExtra,
          power: 'executive',
          scrapedAt: getCurrentTimestamp(),
          sourceText: item.title,
        };

        gazettes.push(gazette);
      } catch (error) {
        logger.error(`Error processing gazette ${item.editionNumber}:`, error as Error);
      }
    }

    return gazettes;
  }
}
