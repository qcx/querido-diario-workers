import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraMacaeConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp } from '../../utils/date-utils';

/**
 * Spider for Prefeitura de Macaé official gazette
 * 
 * Site Structure:
 * - URL: https://do.macae.rj.gov.br/
 * - DataTables-based table with columns: Edição, Ano, Data, Ações
 * - Date format: "DD/MM/YYYY (DE DD/MM A DD/MM/YYYY)"
 * - Edition format: "EDIÇÃO Nº XXXX" or "EDIÇÃO EXTRAORDINÁRIA Nº XXXX"
 * - PDF links in the Ações column (Download/Visualizar buttons)
 * 
 * Requires browser rendering due to JavaScript-rendered DataTables
 */
export class PrefeituraMacaeSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraMacaeConfig;
    this.baseUrl = platformConfig.baseUrl || 'https://do.macae.rj.gov.br/';
    this.browser = browser || null;
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(`PrefeituraMacaeSpider for ${this.config.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura Macaé for ${this.config.name}...`);

    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      
      // Navigate to the main page
      logger.info(`Navigating to: ${this.baseUrl}`);
      await page.goto(this.baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Wait for DataTable to load
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Wait for table to load
      try {
        await page.waitForSelector('table tbody tr', { timeout: 15000 });
      } catch (error) {
        logger.error('Table not found on page');
        return gazettes;
      }
      
      // Process pages until we find gazettes older than our date range
      let hasMorePages = true;
      let pageNum = 1;
      let foundOlderThanRange = false;
      
      while (hasMorePages && !foundOlderThanRange) {
        logger.info(`Processing page ${pageNum}`);
        
        // Extract gazettes from current page
        const pageGazettes = await this.extractGazettesFromPage(page);
        
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
            logger.debug(`Found gazette older than date range, stopping pagination`);
          }
        }
        
        if (foundOlderThanRange) {
          break;
        }
        
        // Try to click the next page button
        const hasNextPage = await page.evaluate(() => {
          const nextButton = document.querySelector('.paginate_button.next:not(.disabled)');
          if (nextButton && nextButton instanceof HTMLElement) {
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
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from Prefeitura Macaé`);
      
    } catch (error) {
      logger.error(`Error crawling Prefeitura Macaé:`, error as Error);
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
      }> = [];

      // Find all table rows
      const rows = document.querySelectorAll('table tbody tr');
      
      for (const row of rows) {
        try {
          const cells = row.querySelectorAll('td');
          if (cells.length < 4) continue;

          // Column 0: Edition number (e.g., "EDIÇÃO Nº 1366" or "EDIÇÃO EXTRAORDINÁRIA Nº 191")
          const editionCell = cells[0];
          const editionText = editionCell?.textContent?.trim() || '';
          
          const isExtra = editionText.toLowerCase().includes('extraordinária');
          const editionMatch = editionText.match(/N[º°]\s*(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : '';

          // Column 2: Date (e.g., "10/01/2026 (DE 10/01 A 10/01/2026)")
          const dateCell = cells[2];
          const dateText = dateCell?.textContent?.trim() || '';
          const dateMatch = dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) continue;

          const [, day, month, year] = dateMatch;
          const date = `${year}-${month}-${day}`;

          // Column 3: Actions (Download/Visualizar links)
          const actionsCell = cells[3];
          const downloadLink = actionsCell?.querySelector('a[href*="download"], a[href*="Download"]') as HTMLAnchorElement;
          if (!downloadLink) continue;

          let pdfUrl = downloadLink.href;
          // Make sure URL is absolute
          if (pdfUrl.startsWith('/')) {
            pdfUrl = new URL(pdfUrl, window.location.origin).href;
          }

          results.push({
            editionNumber,
            date,
            pdfUrl,
            isExtra,
          });
        } catch (error) {
          console.error('Error extracting gazette from row:', error);
        }
      }

      return results;
    });

    // Convert to Gazette objects
    for (const item of pageGazettes) {
      try {
        const date = new Date(item.date);
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
        };

        gazettes.push(gazette);
      } catch (error) {
        logger.error(`Error processing gazette ${item.editionNumber}:`, error as Error);
      }
    }

    return gazettes;
  }
}
