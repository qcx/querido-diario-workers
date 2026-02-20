import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraDuqueDeCaxiasConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';
// @ts-ignore
import { parse } from 'node-html-parser';

/**
 * PrefeituraDuqueDeCaxiasSpider for Duque de Caxias, RJ
 * 
 * Site Structure:
 * - URL: https://transparencia.duquedecaxias.rj.gov.br/diario_oficial_busca.php
 * - Interface with monthly tabs (Jan, Fev, Mar, etc.) and year dropdown
 * - Each month tab shows a list of gazettes with:
 *   - Date in format DD/MM/YYYY
 *   - Edition number (Nº XXXX)
 *   - PDF download links
 * - Requires browser rendering to interact with tabs and load content dynamically
 */
export class PrefeituraDuqueDeCaxiasSpider extends BaseSpider {
  protected caxiasConfig: PrefeituraDuqueDeCaxiasConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.caxiasConfig = spiderConfig.config as PrefeituraDuqueDeCaxiasConfig;
    this.browser = browser || null;
    
    if (!this.caxiasConfig.baseUrl) {
      throw new Error(`PrefeituraDuqueDeCaxiasSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraDuqueDeCaxiasSpider for ${spiderConfig.name}`);
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.caxiasConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error(`PrefeituraDuqueDeCaxiasSpider requires browser binding for ${this.spiderConfig.name}`);
    }
    
    return this.crawlWithBrowser();
  }

  /**
   * Browser-based crawling to interact with monthly tabs and year selector
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Navigate to the page
      logger.debug(`Navigating to ${this.caxiasConfig.baseUrl}`);
      await page.goto(this.caxiasConfig.baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Get all years we need to process
      const years = this.getYearsInRange();
      
      for (const year of years) {
        logger.debug(`Processing year ${year}`);
        
        // Select the year in the dropdown
        await page.select('[role="combobox"]', year.toString());
        await page.waitForTimeout(1000); // Wait for content to load
        
        // Get all months (1-12) and process each
        const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        
        for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
          const month = monthIndex + 1; // 1-based
          const monthName = monthNames[monthIndex];
          
          // Check if we need this month (only process months in date range)
          if (!this.isMonthInRange(year, month)) {
            continue;
          }
          
          logger.debug(`Processing ${monthName}/${year}`);
          
          // Click on the month tab - try different selectors
          try {
            // Try to find tab by text content
            const tabs = await page.$$('[role="tab"]');
            let tabFound = false;
            
            for (const tab of tabs) {
              const text = await tab.textContent();
              if (text && text.trim() === monthName) {
                await tab.click();
                tabFound = true;
                break;
              }
            }
            
            if (!tabFound) {
              // Fallback: try using aria-label or direct text matching
              await page.click(`[role="tab"]:has-text("${monthName}")`);
            }
            
            await page.waitForTimeout(1000); // Wait for content to load
          } catch (error) {
            logger.warn(`Could not click tab for ${monthName}/${year}: ${error}`);
            continue;
          }
          
          // Extract gazettes from the current tab panel
          const monthGazettes = await this.extractGazettesFromPage(page, year, month);
          gazettes.push(...monthGazettes);
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
   * Extract gazettes from the current page state
   */
  private async extractGazettesFromPage(page: any, year: number, month: number): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Get the HTML content of the current active tab panel
      const html = await page.content();
      const root = parse(html);
      
      // Find all list items in the active tab panel
      // The structure is: role="tabpanel" > role="list" > role="listitem"
      const listItems = root.querySelectorAll('[role="listitem"]');
      
      for (const item of listItems) {
        try {
          // Extract date from text (format: "DD/MM/YYYY Ver OCR do PDF Nº XXXX")
          const itemText = item.text.trim();
          const dateMatch = itemText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          
          if (!dateMatch) {
            continue;
          }
          
          const [, day, itemMonth, itemYear] = dateMatch;
          const gazetteDate = new Date(`${itemYear}-${itemMonth}-${day}`);
          
          if (isNaN(gazetteDate.getTime())) {
            logger.warn(`Invalid date found: ${itemText}`);
            continue;
          }
          
          // Filter by date range
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }
          
          // Extract edition number from text (format: "Nº XXXX" or "Nº XXXX vol2")
          const editionMatch = itemText.match(/Nº\s*(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;
          
          // Extract PDF link - look for links with "PDF" text or href containing pdf
          // Try multiple selectors to find PDF links
          let pdfLink = item.querySelector('a[href*=".pdf"]') 
            || item.querySelector('a[href*="pdf"]')
            || Array.from(item.querySelectorAll('a')).find(a => {
              const text = a.text.trim().toUpperCase();
              return text === 'PDF' || text.includes('PDF');
            });
          
          if (!pdfLink) {
            logger.warn(`No PDF link found for ${itemText}`);
            continue;
          }
          
          let pdfUrl = pdfLink.getAttribute('href');
          
          if (!pdfUrl) {
            continue;
          }
          
          // Make URL absolute if needed
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.caxiasConfig.baseUrl);
            pdfUrl = pdfUrl.startsWith('/') 
              ? `${baseUrlObj.origin}${pdfUrl}`
              : `${baseUrlObj.origin}/${pdfUrl}`;
          }
          
          // Check if it's an extra edition (contains "vol", "suplemento", "extra")
          const isExtraEdition = /\b(vol|suplemento|extra)\d*\b/i.test(itemText);
          
          // Create gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            power: 'executive_legislative',
            editionNumber,
            isExtraEdition,
          });
          
          if (gazette) {
            gazettes.push(gazette);
            logger.debug(`Found gazette for ${toISODate(gazetteDate)}: ${pdfUrl}`);
          }
        } catch (error) {
          logger.error(`Error processing list item:`, error as Error);
        }
      }
    } catch (error) {
      logger.error(`Error extracting gazettes from page:`, error as Error);
    }
    
    return gazettes;
  }

  /**
   * Get all years in the date range
   */
  private getYearsInRange(): number[] {
    const years: number[] = [];
    const startYear = new Date(this.startDate).getFullYear();
    const endYear = new Date(this.endDate).getFullYear();
    
    for (let year = startYear; year <= endYear; year++) {
      years.push(year);
    }
    
    return years;
  }

  /**
   * Check if a month is in the date range
   */
  private isMonthInRange(year: number, month: number): boolean {
    const startDate = new Date(this.startDate);
    const endDate = new Date(this.endDate);
    
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0); // Last day of month
    
    // Check if month overlaps with date range
    return monthStart <= endDate && monthEnd >= startDate;
  }
}
