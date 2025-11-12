import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraSaoJoaoDaBoaVistaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Portuguese month names mapped to zero-indexed month numbers
 */
const PORTUGUESE_MONTHS: { [key: string]: number } = {
  'janeiro': 0,
  'fevereiro': 1,
  'março': 2,
  'marco': 2, // Handle without accent
  'abril': 3,
  'maio': 4,
  'junho': 5,
  'julho': 6,
  'agosto': 7,
  'setembro': 8,
  'outubro': 9,
  'novembro': 10,
  'dezembro': 11,
};

/**
 * Spider for Prefeitura de São João da Boa Vista official gazette
 * 
 * Uses Cloudflare Browser Rendering (Puppeteer) to handle:
 * - Vue.js/Vuetify application with JavaScript rendering
 * - Year/month-based URL structure (/diarios/{year}/{month})
 * - Pagination via "Mais resultados" button
 * - Dynamic PDF extraction from <object> tags when clicking list items
 * 
 * The site structure:
 * 1. Navigate to /diarios/{year}/{month} for each month in date range
 * 2. List items appear in .v-list-item elements
 * 3. Clicking an item updates an <object> tag with PDF data
 * 4. "Mais resultados" button loads more items via pagination
 */
export class PrefeituraSaoJoaoDaBoaVistaSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraSaoJoaoDaBoaVistaConfig;
    // Extract base domain from config URL (e.g., "https://publicacoes.boavista.rr.gov.br")
    const urlObj = new URL(platformConfig.baseUrl);
    this.baseUrl = `${urlObj.protocol}//${urlObj.host}`;
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
      logger.error(`PrefeituraSaoJoaoDaBoaVistaSpider for ${this.config.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura São João da Boa Vista for ${this.config.name}...`);

    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      
      // Generate year/month combinations for the date range
      const monthUrls = this.generateMonthUrls();
      logger.info(`Generated ${monthUrls.length} month URLs to crawl`);

      // Iterate through each month
      for (const monthUrl of monthUrls) {
        try {
          logger.info(`Processing month URL: ${monthUrl}`);
          
          const monthGazettes = await this.crawlMonth(page, monthUrl);
          gazettes.push(...monthGazettes);
          
          if (monthGazettes.length > 0) {
            logger.info(`Found ${monthGazettes.length} gazette(s) for ${monthUrl}`);
          } else {
            logger.debug(`No gazettes found for ${monthUrl}`);
          }
          
          // Add delay between months to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 1500));
        } catch (error) {
          logger.error(`Error crawling month ${monthUrl}:`, error as Error);
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from Prefeitura São João da Boa Vista`);
      
    } catch (error) {
      logger.error(`Error crawling Prefeitura São João da Boa Vista:`, error as Error);
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
   * Generate list of month URLs for the date range
   * Format: /diarios/{year}/{month} where month is 1-12
   */
  private generateMonthUrls(): string[] {
    const urls: string[] = [];
    const current = new Date(this.startDate.getFullYear(), this.startDate.getMonth(), 1);
    const end = new Date(this.endDate.getFullYear(), this.endDate.getMonth(), 1);

    while (current <= end) {
      const year = current.getFullYear();
      const month = current.getMonth() + 1; // 1-12
      urls.push(`${this.baseUrl}/diarios/${year}/${month}`);
      
      // Move to next month
      current.setMonth(current.getMonth() + 1);
    }

    return urls;
  }

  /**
   * Crawl all gazettes for a specific month (with pagination support)
   */
  private async crawlMonth(page: any, monthUrl: string): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const processedTitles = new Set<string>(); // Track processed items to avoid duplicates
    
    try {
      // Navigate to the month page
      logger.debug(`Navigating to: ${monthUrl}`);
      // Use 'domcontentloaded' instead of 'networkidle0' for Vue.js apps that may have continuous network activity
      await page.goto(monthUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      this.requestCount++;
      
      // Wait for Vue.js app to load and render content
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Wait for list items to appear
      try {
        await page.waitForSelector('.v-list-item[role="listitem"]', { timeout: 10000 });
      } catch (error) {
        logger.warn(`List items not found after navigation to ${monthUrl}, page may be empty or still loading`);
      }
      
      // Handle pagination - click "Mais resultados" until no more results
      let hasMoreResults = true;
      let paginationAttempts = 0;
      const maxPaginationAttempts = 50; // Safety limit
      
      while (hasMoreResults && paginationAttempts < maxPaginationAttempts) {
        // Extract all list items from current page state
        const items = await this.extractListItems(page);
        
        if (items.length === 0 && paginationAttempts === 0) {
          logger.debug(`No items found on first load for ${monthUrl}`);
          break;
        }
        
        // Process each item (skip if already processed)
        for (const item of items) {
          // Use title as unique identifier to avoid duplicates
          if (processedTitles.has(item.title)) {
            logger.debug(`Skipping already processed item: ${item.title}`);
            continue;
          }
          
          try {
            const gazette = await this.processListItem(page, item, monthUrl);
            if (gazette) {
              gazettes.push(gazette);
              processedTitles.add(item.title);
            }
          } catch (error) {
            logger.error(`Error processing item ${item.title}:`, error as Error);
          }
        }
        
        // Check if "Mais resultados" button exists and is enabled
        const maisResultadosButton = await page.evaluate(() => {
          // Try to find button with text "Mais resultados"
          const buttons = Array.from(document.querySelectorAll('button.v-btn'));
          const found = buttons.find((btn: any) => {
            const text = btn.textContent || btn.innerText || '';
            return text.includes('Mais resultados');
          });
          return found ? {
            disabled: found.disabled || found.classList.contains('v-btn--disabled') || found.hasAttribute('disabled'),
          } : null;
        });
        
        if (maisResultadosButton) {
          if (!maisResultadosButton.disabled) {
            logger.debug('Clicking "Mais resultados" button...');
            // Click the button using selector
            await page.evaluate(() => {
              const buttons = Array.from(document.querySelectorAll('button.v-btn'));
              const found = buttons.find((btn: any) => {
                const text = btn.textContent || btn.innerText || '';
                return text.includes('Mais resultados');
              });
              if (found) {
                (found as HTMLElement).click();
              }
            });
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for new items to load
            paginationAttempts++;
          } else {
            logger.debug('"Mais resultados" button is disabled, no more results');
            hasMoreResults = false;
          }
        } else {
          logger.debug('"Mais resultados" button not found, assuming no more results');
          hasMoreResults = false;
        }
      }
      
      if (paginationAttempts >= maxPaginationAttempts) {
        logger.warn(`Reached max pagination attempts (${maxPaginationAttempts}) for ${monthUrl}`);
      }
      
    } catch (error) {
      logger.error(`Error in crawlMonth for ${monthUrl}:`, error as Error);
    }
    
    return gazettes;
  }

  /**
   * Extract list items from the current page
   */
  private async extractListItems(page: any): Promise<Array<{
    title: string;
    subtitle: string;
    index: number;
  }>> {
    try {
      const items = await page.$$eval(
        '.v-list-item[role="listitem"]',
        (elements: any[]) => {
          return elements.map((el: any, index: number) => {
            const titleEl = el.querySelector('.v-list-item__title');
            const subtitleEl = el.querySelector('.v-list-item__subtitle');
            
            return {
              title: titleEl ? titleEl.textContent.trim() : '',
              subtitle: subtitleEl ? subtitleEl.textContent.trim() : '',
              index: index,
            };
          });
        }
      );
      
      return items.filter(item => item.title && item.subtitle);
      
    } catch (error) {
      logger.error('Error extracting list items:', error as Error);
      return [];
    }
  }

  /**
   * Process a single list item: click it, extract PDF URL, create gazette
   */
  private async processListItem(page: any, item: { title: string; subtitle: string; index: number }, monthUrl: string): Promise<Gazette | null> {
    try {
      // Parse date from subtitle (e.g., "sexta, 28 de fevereiro de 2025")
      const gazetteDate = this.parsePortugueseDate(item.subtitle);
      
      if (!gazetteDate) {
        logger.warn(`Could not parse date from subtitle: ${item.subtitle}`);
        return null;
      }
      
      // Check if date is in our crawl range
      if (gazetteDate < this.startDate || gazetteDate > this.endDate) {
        logger.debug(`Gazette date ${toISODate(gazetteDate)} is outside crawl range`);
        return null;
      }
      
      // Extract edition number from title (e.g., "DOM nº 6302" -> "6302")
      const editionMatch = item.title.match(/nº\s*(\d+)/i);
      const editionNumber = editionMatch ? editionMatch[1] : undefined;
      
      // Check if it's an extra edition
      const isExtraEdition = /extra|extraordinário/i.test(item.title);
      
      // Click the list item using its index to load PDF in object tag
      logger.debug(`Clicking item ${item.index}: ${item.title}`);
      
      // Use evaluate to click the specific list item by index
      await page.evaluate((index: number) => {
        const items = Array.from(document.querySelectorAll('.v-list-item[role="listitem"]'));
        if (items[index]) {
          (items[index] as HTMLElement).click();
        }
      }, item.index);
      
      // Wait for object tag to update with PDF
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extract PDF URL from object tag
      const pdfUrl = await this.extractPdfFromObject(page);
      
      if (!pdfUrl) {
        logger.warn(`Could not extract PDF URL for ${item.title}`);
        return null;
      }
      
      // Resolve relative URLs to absolute
      const absoluteUrl = pdfUrl.startsWith('http') 
        ? pdfUrl 
        : new URL(pdfUrl, this.baseUrl).href;
      
      logger.debug(`Extracted PDF URL: ${absoluteUrl}`);
      
      // Create gazette object
      const gazette = await this.createGazette(gazetteDate, absoluteUrl, {
        power: 'executive_legislative',
        requiresClientRendering: false,
        editionNumber,
        isExtraEdition,
        sourceText: item.title,
      });
      
      return gazette;
      
    } catch (error) {
      logger.error(`Error processing list item ${item.title}:`, error as Error);
      return null;
    }
  }

  /**
   * Extract PDF URL from object tag
   */
  private async extractPdfFromObject(page: any): Promise<string | null> {
    try {
      // Wait for object tag to be present
      await page.waitForSelector('object[type="application/pdf"]', { timeout: 10000 });
      
      // Extract data attribute from object tag
      const pdfUrl = await page.$eval(
        'object[type="application/pdf"]',
        (obj: any) => obj.getAttribute('data')
      );
      
      if (pdfUrl) {
        logger.debug(`Found PDF URL in object tag: ${pdfUrl}`);
        return pdfUrl;
      }
      
      logger.warn('Object tag found but no data attribute');
      return null;
      
    } catch (error) {
      logger.error('Error extracting PDF from object tag:', error as Error);
      return null;
    }
  }

  /**
   * Parse Portuguese date format from subtitle
   * Example: "sexta, 28 de fevereiro de 2025" -> Date
   */
  private parsePortugueseDate(dateText: string): Date | null {
    try {
      // Match pattern: DD de MMMM de YYYY (ignore day of week prefix)
      // Handle variations: "sexta, 28 de fevereiro de 2025", "28 de fevereiro de 2025"
      const match = dateText.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
      
      if (!match) {
        return null;
      }

      const day = parseInt(match[1], 10);
      const monthName = match[2].toLowerCase();
      const year = parseInt(match[3], 10);

      const month = PORTUGUESE_MONTHS[monthName];
      
      if (month === undefined) {
        logger.warn(`Unknown Portuguese month: ${monthName} in text: ${dateText}`);
        return null;
      }

      return new Date(year, month, day);

    } catch (error) {
      logger.error(`Error parsing Portuguese date "${dateText}":`, error as Error);
      return null;
    }
  }
}

