import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraAngraDosReisConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp } from '../../utils/date-utils';

/**
 * Spider for Prefeitura de Angra dos Reis official gazette
 * 
 * Site Structure:
 * - URL: https://www.angra.rj.gov.br/boletim-oficial
 * - Table with columns: Data de Publicação, Mês, Número, Título, Tipo de Edição
 * - Date format: "16/01/2026" (DD/MM/YYYY)
 * - Edition number in "Número" column
 * - PDF links: /pmar/assets/files/boletins/{hash}.pdf
 * 
 * Requires browser rendering for JavaScript-rendered content
 */
export class PrefeituraAngraDosReisSpider extends BaseSpider {
  private _baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraAngraDosReisConfig;
    this._baseUrl = platformConfig.baseUrl || 'https://www.angra.rj.gov.br/boletim-oficial';
    this.browser = browser || null;
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(`PrefeituraAngraDosReisSpider for ${this.config.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura Angra dos Reis for ${this.config.name}... (${this._baseUrl})`);

    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      
      // Navigate to the main page
      logger.info(`Navigating to: ${this._baseUrl}`);
      await page.goto(this._baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Wait for table to load
      await new Promise(resolve => setTimeout(resolve, 3000));
      
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
      const processedUrls = new Set<string>();
      
      while (hasMorePages && !foundOlderThanRange) {
        logger.info(`Processing page ${pageNum}`);
        
        // Extract gazettes from current page
        const pageGazettes = await this.extractGazettesFromPage(page);
        
        for (const gazette of pageGazettes) {
          // Skip duplicates
          if (processedUrls.has(gazette.fileUrl)) {
            continue;
          }
          processedUrls.add(gazette.fileUrl);
          
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
          // Look for pagination buttons
          const nextButton = document.querySelector('.pagination .page-item:not(.disabled) .page-link[aria-label*="next"], .pagination .page-item:not(.disabled) .page-link[aria-label*="Next"]');
          if (nextButton && nextButton instanceof HTMLElement) {
            nextButton.click();
            return true;
          }
          
          // Alternative: look for any enabled page link that's not the current page
          const currentPage = document.querySelector('.pagination .page-item.active');
          if (currentPage) {
            const nextSibling = currentPage.nextElementSibling;
            if (nextSibling && !nextSibling.classList.contains('disabled')) {
              const link = nextSibling.querySelector('.page-link');
              if (link && link instanceof HTMLElement) {
                link.click();
                return true;
              }
            }
          }
          
          return false;
        });
        
        if (hasNextPage) {
          await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for AJAX to load
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
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from Prefeitura Angra dos Reis`);
      
    } catch (error) {
      logger.error(`Error crawling Prefeitura Angra dos Reis:`, error as Error);
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

      // Find all table rows (skip header row)
      const rows = document.querySelectorAll('table tbody tr');
      
      for (const row of rows) {
        try {
          const cells = row.querySelectorAll('td');
          if (cells.length < 5) continue;

          // Column 0: Data de Publicação (date) - format: "16/01/2026"
          const dateCell = cells[0];
          const dateText = dateCell?.textContent?.trim() || '';
          
          // Column 2: Número (edition number)
          const numberCell = cells[2];
          const editionNumber = numberCell?.textContent?.trim() || '';
          
          // Column 3: Título
          const titleCell = cells[3];
          const titleText = titleCell?.textContent?.trim() || '';
          
          // Check if it's an extra edition
          const isExtra = titleText.toLowerCase().includes('extra') || 
                         titleText.toLowerCase().includes('suplementar') ||
                         titleText.toLowerCase().includes('extraordinário');

          // Find PDF link in the last column (action buttons)
          const actionCell = cells[cells.length - 1];
          let pdfLink = actionCell?.querySelector('a[href*=".pdf"]') as HTMLAnchorElement;
          
          if (!pdfLink) {
            // Try to find any link with "boletins" in href
            pdfLink = actionCell?.querySelector('a[href*="boletins"]') as HTMLAnchorElement;
          }
          
          if (!pdfLink) continue;

          let pdfUrl = pdfLink.getAttribute('href') || '';
          
          // Make sure URL is absolute
          if (pdfUrl.startsWith('/')) {
            pdfUrl = new URL(pdfUrl, window.location.origin).href;
          } else if (!pdfUrl.startsWith('http')) {
            pdfUrl = new URL(pdfUrl, window.location.href).href;
          }

          if (dateText && pdfUrl && editionNumber) {
            results.push({
              editionNumber,
              date: dateText, // Format: "16/01/2026"
              pdfUrl,
              isExtra,
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
        // Parse date from DD/MM/YYYY format
        const dateMatch = item.date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (!dateMatch) {
          logger.warn(`Invalid date format for gazette ${item.editionNumber}: ${item.date}`);
          continue;
        }
        
        const [, day, month, year] = dateMatch;
        const date = new Date(Date.UTC(
          parseInt(year, 10),
          parseInt(month, 10) - 1,
          parseInt(day, 10)
        ));
        
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
          sourceText: `Boletim Oficial de Angra dos Reis - Edição nº ${item.editionNumber}${item.isExtra ? ' - EXTRA' : ''}`,
        };

        gazettes.push(gazette);
      } catch (error) {
        logger.error(`Error processing gazette ${item.editionNumber}:`, error as Error);
      }
    }

    return gazettes;
  }
}
