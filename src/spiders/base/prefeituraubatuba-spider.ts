import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraUbatubaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp } from '../../utils/date-utils';

/**
 * Spider for Prefeitura de Ubatuba official gazette (Zion3 platform)
 * 
 * Uses Cloudflare Browser Rendering (Puppeteer) to handle:
 * - DataTables-based table with 6 columns: NUMERO, DATA, EMENTA, TIPO, RELACIONADOS, ARQUIVO
 * - Date format: "DD/MM/YYYY" (e.g., "06/01/2026")
 * - PDF links in the ARQUIVO column ("Ver" button)
 * 
 * Site structure:
 * 1. Navigate to: https://www.ubatuba.sp.gov.br/diario-oficial/
 * 2. Table with columns: Numero, Data, Ementa, Tipo, Relacionados, Arquivo (PDF "Ver" link)
 * 3. Pagination via DataTables "Próximo" button
 * 4. Each row is a single document (decree, ordinance, edict, etc.)
 */
export class PrefeituraUbatubaSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraUbatubaConfig;
    this.baseUrl = platformConfig.baseUrl || platformConfig.url || 'https://www.ubatuba.sp.gov.br/diario-oficial/';
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
      logger.error(`PrefeituraUbatubaSpider for ${this.config.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura Ubatuba for ${this.config.name}...`);

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
      
      // Wait for page to stabilize and table to load
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
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from Prefeitura Ubatuba`);
      
    } catch (error) {
      logger.error(`Error crawling Prefeitura Ubatuba:`, error as Error);
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
   * Table structure: NUMERO | DATA | EMENTA | TIPO | RELACIONADOS | ARQUIVO
   */
  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Extract all rows from the table
      const rows = await page.evaluate(() => {
        const results: Array<{
          editionNumber: string;
          dateText: string;
          ementa: string;
          tipo: string;
          pdfUrl: string | null;
        }> = [];
        
        // Get all table rows (skip header if present)
        const tableRows = document.querySelectorAll('table tbody tr');
        
        for (const row of Array.from(tableRows)) {
          const cells = row.querySelectorAll('td');
          // Table has 6 columns: NUMERO (0), DATA (1), EMENTA (2), TIPO (3), RELACIONADOS (4), ARQUIVO (5)
          if (cells.length >= 6) {
            const editionNumber = cells[0]?.textContent?.trim() || '';
            const dateText = cells[1]?.textContent?.trim() || '';
            const ementa = cells[2]?.textContent?.trim() || '';
            const tipo = cells[3]?.textContent?.trim() || '';
            
            // Find PDF link in the ARQUIVO cell (index 5)
            const pdfLink = cells[5]?.querySelector('a');
            const pdfUrl = pdfLink ? pdfLink.getAttribute('href') : null;
            
            if (editionNumber && dateText) {
              results.push({
                editionNumber,
                dateText,
                ementa,
                tipo,
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
          // Parse date from DD/MM/YYYY format
          const gazetteDate = this.parseBrazilianDate(row.dateText);
          
          if (!gazetteDate) {
            logger.warn(`Could not parse date from: ${row.dateText}`);
            continue;
          }
          
          // Get PDF URL
          let pdfUrl = row.pdfUrl;
          if (!pdfUrl) {
            logger.debug(`No PDF URL found for edition ${row.editionNumber}`);
            continue;
          }
          
          // Make URL absolute if relative
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }
          
          // Create gazette directly without URL resolution
          const gazette = this.createGazetteDirectly(gazetteDate, pdfUrl, {
            editionNumber: row.editionNumber,
            isExtraEdition: row.tipo?.toLowerCase().includes('extra') || row.ementa?.toLowerCase().includes('extra') || false,
            power: 'executive_legislative',
            sourceText: `${row.tipo} ${row.editionNumber} - ${row.ementa}`,
          });
          
          gazettes.push(gazette);
          logger.debug(`Created gazette for edition ${row.editionNumber}`);
          
        } catch (error) {
          logger.error(`Error processing row`, error);
        }
      }
      
    } catch (error) {
      logger.error(`Error extracting gazettes from page`, error);
    }
    
    return gazettes;
  }

  /**
   * Parse Brazilian date format: "DD/MM/YYYY"
   */
  private parseBrazilianDate(dateText: string): Date | null {
    try {
      // Pattern: DD/MM/YYYY
      const match = dateText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      
      if (!match) {
        return null;
      }
      
      const day = parseInt(match[1], 10);
      const month = parseInt(match[2], 10);
      const year = parseInt(match[3], 10);
      
      // Create date (months are 0-indexed in JavaScript)
      return new Date(year, month - 1, day);
      
    } catch (error) {
      logger.error(`Error parsing Brazilian date: ${dateText}`, error as Error);
      return null;
    }
  }

  /**
   * Create gazette without URL resolution
   * The Ubatuba PDFs are directly accessible without redirects
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

