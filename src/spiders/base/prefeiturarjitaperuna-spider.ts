import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraRjItaperunaConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Month name mappings for Portuguese date parsing
 */
const MONTH_NAMES: Record<string, number> = {
  'janeiro': 1, 'jan': 1,
  'fevereiro': 2, 'fev': 2,
  'março': 3, 'mar': 3, 'marco': 3,
  'abril': 4, 'abr': 4,
  'maio': 5, 'mai': 5,
  'junho': 6, 'jun': 6,
  'julho': 7, 'jul': 7,
  'agosto': 8, 'ago': 8,
  'setembro': 9, 'set': 9,
  'outubro': 10, 'out': 10,
  'novembro': 11, 'nov': 11,
  'dezembro': 12, 'dez': 12,
};

/**
 * Spider for Prefeitura de Itaperuna - RJ official gazette
 * 
 * The site has a simple HTML table with gazette editions:
 * - Column 1: Edition number (e.g., "Edição 195")
 * - Column 2: Date in Portuguese format (e.g., "19 de janeiro de 2026")
 * - Column 3: File size
 * - Column 4: PDF download link (anchor with class "icon-file-pdf")
 * 
 * URL: https://itaperuna.rj.gov.br/pmi/jornal-oficial-2022
 */
export class PrefeituraRjItaperunaSpider extends BaseSpider {
  protected config: PrefeituraRjItaperunaConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeituraRjItaperunaConfig;
    this.browser = browser || null;
    
    if (!this.config.baseUrl) {
      throw new Error(`PrefeituraRjItaperunaSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraRjItaperunaSpider for ${spiderConfig.name}`);
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.config.baseUrl} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error(`PrefeituraRjItaperunaSpider requires browser binding for ${this.spiderConfig.name}`);
    }
    
    return this.crawlWithBrowser();
  }

  /**
   * Browser-based crawling to extract gazette information
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
      logger.debug(`Navigating to ${this.config.baseUrl}`);
      await page.goto(this.config.baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Wait for page to stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extract gazettes from the page
      const extractedData = await this.extractGazettesFromPage(page);
      logger.info(`Extracted ${extractedData.length} gazette entries from page`);
      
      // Process extracted data
      for (const data of extractedData) {
        try {
          const gazetteDate = this.parseDate(data.date);
          
          if (!gazetteDate || isNaN(gazetteDate.getTime())) {
            logger.warn(`Invalid date: ${data.date}`);
            continue;
          }
          
          // Filter by date range
          if (!this.isInDateRange(gazetteDate)) {
            logger.debug(`Date ${toISODate(gazetteDate)} outside range, skipping`);
            continue;
          }
          
          // Create gazette
          const gazette = await this.createGazette(gazetteDate, data.pdfUrl, {
            power: 'executive_legislative',
            editionNumber: data.editionNumber,
            isExtraEdition: data.isExtra,
          });
          
          if (gazette) {
            gazettes.push(gazette);
            logger.info(`Found gazette for ${toISODate(gazetteDate)} (edição ${data.editionNumber || 'N/A'}): ${data.pdfUrl}`);
          }
        } catch (error) {
          logger.error(`Error processing extracted data:`, error as Error);
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
   * Extract gazette data from the page using browser evaluation
   * 
   * The page structure is:
   * <table>
   *   <tr>
   *     <td>Edição 195</td>
   *     <td>19 de janeiro de 2026</td>
   *     <td>2,0MB</td>
   *     <td><a href="...je-195.pdf" class="icon-file-pdf"></a></td>
   *   </tr>
   * </table>
   */
  private async extractGazettesFromPage(page: any): Promise<Array<{
    date: string;
    editionNumber?: string;
    pdfUrl: string;
    isExtra: boolean;
  }>> {
    return page.evaluate(() => {
      const results: Array<{
        date: string;
        editionNumber?: string;
        pdfUrl: string;
        isExtra: boolean;
      }> = [];
      
      // Find all PDF links with icon-file-pdf class or links containing .pdf
      const pdfLinks = document.querySelectorAll('a[href*=".pdf"], a.icon-file-pdf');
      const processedUrls = new Set<string>();
      
      for (const link of pdfLinks) {
        const href = link.getAttribute('href');
        if (!href || processedUrls.has(href)) continue;
        
        // Make URL absolute
        let pdfUrl = href;
        if (!href.startsWith('http')) {
          if (href.startsWith('/')) {
            pdfUrl = window.location.origin + href;
          } else {
            pdfUrl = new URL(href, window.location.href).href;
          }
        }
        
        processedUrls.add(href);
        
        // Find the parent row (tr) to extract edition and date
        let row = link.closest('tr');
        if (!row) {
          // Try to find parent container
          row = link.parentElement?.parentElement?.parentElement as HTMLTableRowElement | null;
        }
        
        if (!row) {
          // If no row found, try to extract from URL
          const urlMatch = href.match(/je-(\d+)\.pdf/i);
          if (urlMatch) {
            results.push({
              date: '',
              editionNumber: urlMatch[1],
              pdfUrl,
              isExtra: false,
            });
          }
          continue;
        }
        
        // Get all cells in the row
        const cells = row.querySelectorAll('td');
        let date = '';
        let editionNumber = '';
        
        for (const cell of cells) {
          const cellText = cell.textContent?.trim() || '';
          
          // Check for edition number (e.g., "Edição 195")
          const editionMatch = cellText.match(/[Ee]di[çc][ãa]o\s*(\d+)/);
          if (editionMatch) {
            editionNumber = editionMatch[1];
          }
          
          // Check for date in Portuguese format (e.g., "19 de janeiro de 2026")
          const dateMatch = cellText.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
          if (dateMatch) {
            date = cellText;
          }
          
          // Also check for DD/MM/YYYY format
          const dateMatch2 = cellText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (dateMatch2 && !date) {
            date = cellText;
          }
        }
        
        // Check for extra edition markers
        const rowText = row.textContent || '';
        const isExtra = /\b(extra|suplemento|extraordin[aá]ri[oa])\b/i.test(rowText);
        
        if (date || editionNumber) {
          results.push({
            date,
            editionNumber: editionNumber || undefined,
            pdfUrl,
            isExtra,
          });
        }
      }
      
      return results;
    });
  }

  /**
   * Parse Portuguese date string to Date object
   * Handles formats like:
   * - "19 de janeiro de 2026"
   * - "DD/MM/YYYY"
   * - "YYYY-MM-DD"
   */
  private parseDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    
    // Try "DD de Mês de YYYY" format
    const ptMatch = dateStr.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
    if (ptMatch) {
      const day = parseInt(ptMatch[1], 10);
      const monthName = ptMatch[2].toLowerCase();
      const year = parseInt(ptMatch[3], 10);
      
      const month = MONTH_NAMES[monthName];
      if (month) {
        return new Date(year, month - 1, day);
      }
    }
    
    // Try DD/MM/YYYY format
    const brMatch = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (brMatch) {
      const day = parseInt(brMatch[1], 10);
      const month = parseInt(brMatch[2], 10);
      const year = parseInt(brMatch[3], 10);
      return new Date(year, month - 1, day);
    }
    
    // Try YYYY-MM-DD format
    const isoMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return new Date(dateStr);
    }
    
    return null;
  }
}
