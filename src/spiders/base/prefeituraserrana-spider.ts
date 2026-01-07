import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraSerranaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp } from '../../utils/date-utils';

/**
 * Portuguese month names mapping
 */
const PORTUGUESE_MONTHS: Record<string, number> = {
  'janeiro': 1,
  'fevereiro': 2,
  'março': 3,
  'marco': 3,
  'abril': 4,
  'maio': 5,
  'junho': 6,
  'julho': 7,
  'agosto': 8,
  'setembro': 9,
  'outubro': 10,
  'novembro': 11,
  'dezembro': 12,
};

/**
 * Spider for Prefeitura de Serrana official gazette
 * 
 * Uses Cloudflare Browser Rendering (Puppeteer) to handle:
 * - DataTables-based table with pagination
 * - Portuguese date format: "5 de Janeiro de 2026"
 * - PDF links in table rows
 * 
 * Site structure:
 * 1. Navigate to: https://www.serrana.sp.gov.br/diario-oficial/
 * 2. Table with columns: Numero (edition), Data publicação, Arquivo (PDF link)
 * 3. Pagination via DataTables "Próximo" button
 * 4. PDF URL pattern: https://www.serrana.sp.gov.br/media/uploads/diario_oficial/diario_oficial_{edition}.pdf
 */
export class PrefeituraSerranaSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraSerranaConfig;
    this.baseUrl = platformConfig.baseUrl;
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
      logger.error(`PrefeituraSerranaSpider for ${this.config.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura Serrana for ${this.config.name}...`);

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
      
      // Wait for page to stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Wait for table to load
      try {
        await page.waitForSelector('table tbody tr', { timeout: 10000 });
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
        
        // Try to click the next page button using JavaScript click
        const hasNextPage = await page.evaluate(() => {
          // Look for the "Próximo" button that is not disabled
          const nextButton = document.querySelector('.paginate_button.next:not(.disabled)');
          if (nextButton && nextButton instanceof HTMLElement) {
            nextButton.click();
            return true;
          }
          return false;
        });
        
        if (hasNextPage) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for table to update
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
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from Prefeitura Serrana`);
      
    } catch (error) {
      logger.error(`Error crawling Prefeitura Serrana:`, error as Error);
      throw error;
    } finally {
      // Clean up
      if (page) {
        try {
          await page.close();
        } catch (e) {
          logger.warn('Error closing page', e as Error);
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (e) {
          logger.warn('Error closing browser', e as Error);
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
      // Extract all rows from the table
      const rows = await page.evaluate(() => {
        const results: Array<{
          editionNumber: string;
          dateText: string;
          pdfUrl: string | null;
        }> = [];
        
        // Get all table rows (skip header if present)
        const tableRows = document.querySelectorAll('table tbody tr');
        
        for (const row of Array.from(tableRows)) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 3) {
            const editionNumber = cells[0]?.textContent?.trim() || '';
            const dateText = cells[1]?.textContent?.trim() || '';
            
            // Find PDF link in the last cell
            const pdfLink = cells[2]?.querySelector('a');
            const pdfUrl = pdfLink ? pdfLink.getAttribute('href') : null;
            
            if (editionNumber && dateText) {
              results.push({
                editionNumber,
                dateText,
                pdfUrl,
              });
            }
          }
        }
        
        return results;
      });
      
      logger.debug(`Found ${rows.length} rows on current page`);
      
      // Process each row
      for (const row of rows) {
        try {
          // Parse date from Portuguese format: "5 de Janeiro de 2026"
          const gazetteDate = this.parsePortugueseDate(row.dateText);
          
          if (!gazetteDate) {
            logger.warn(`Could not parse date from: ${row.dateText}`);
            continue;
          }
          
          // Get PDF URL
          let pdfUrl = row.pdfUrl;
          if (!pdfUrl) {
            logger.warn(`No PDF URL found for edition ${row.editionNumber}`);
            continue;
          }
          
          // Make URL absolute if relative
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }
          
          // Create gazette directly without URL resolution
          // (Serrana PDFs are directly accessible without redirects)
          const gazette = this.createGazetteDirectly(gazetteDate, pdfUrl, {
            editionNumber: row.editionNumber,
            isExtraEdition: false,
            power: 'executive_legislative',
            sourceText: `Diário oficial ${row.editionNumber} - ${row.dateText}`,
          });
          
          gazettes.push(gazette);
          logger.debug(`Created gazette for edition ${row.editionNumber}`);
          
        } catch (error) {
          logger.error(`Error processing row:`, error as Error);
        }
      }
      
    } catch (error) {
      logger.error(`Error extracting gazettes from page:`, error as Error);
    }
    
    return gazettes;
  }

  /**
   * Parse Portuguese date format: "5 de Janeiro de 2026"
   */
  private parsePortugueseDate(dateText: string): Date | null {
    try {
      // Pattern: "DD de Month de YYYY"
      const match = dateText.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
      
      if (!match) {
        return null;
      }
      
      const day = parseInt(match[1], 10);
      const monthName = match[2].toLowerCase();
      const year = parseInt(match[3], 10);
      
      const month = PORTUGUESE_MONTHS[monthName];
      
      if (!month) {
        logger.warn(`Unknown month name: ${monthName}`);
        return null;
      }
      
      // Create date (months are 0-indexed in JavaScript)
      return new Date(year, month - 1, day);
      
    } catch (error) {
      logger.error(`Error parsing Portuguese date: ${dateText}`, error as Error);
      return null;
    }
  }

  /**
   * Create gazette without URL resolution
   * The Serrana PDFs are directly accessible without redirects
   */
  private createGazetteDirectly(
    date: Date,
    fileUrl: string,
    options: {
      editionNumber?: string;
      isExtraEdition?: boolean;
      power?: 'executive' | 'legislative' | 'executive_legislative';
      sourceText?: string;
    } = {}
  ): Gazette {
    return {
      date: toISODate(date),
      fileUrl: fileUrl,
      territoryId: this.config.territoryId,
      scrapedAt: getCurrentTimestamp(),
      editionNumber: options.editionNumber,
      isExtraEdition: options.isExtraEdition ?? false,
      power: options.power ?? 'executive_legislative',
      sourceText: options.sourceText,
    };
  }
}

