import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, ImprensaOficialMunicipalConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Spider for Imprensa Oficial Municipal platform
 * Used by municipalities like Miguelópolis and Caiabu
 * 
 * Uses Cloudflare Browser Rendering (Puppeteer) to handle:
 * - JavaScript-rendered gazette listings
 * - Form-based date filtering
 * - Dynamic content loading with AJAX
 * - Pagination through gazette editions
 * 
 * The site structure:
 * 1. Main page loads with JavaScript that fetches gazette data via AJAX
 * 2. Date filter form (#from, #to, #filtrodata) to filter by date range
 * 3. Results appear in #jornal div as a list of gazette editions
 * 4. Each edition has an "Original Eletrônico" button linking to the PDF
 * 5. Pagination in #Pagination div for multiple pages of results
 */
export class ImprensaOficialMunicipalSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as ImprensaOficialMunicipalConfig;
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
      logger.error(`ImprensaOficialMunicipalSpider for ${this.config.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling Imprensa Oficial Municipal for ${this.config.name}...`);

    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      
      // Iterate through each day in the date range
      const currentDate = new Date(this.startDate);
      const endDate = new Date(this.endDate);
      
      while (currentDate <= endDate) {
        try {
          logger.info(`Processing date: ${toISODate(currentDate)}`);
          
          const dayGazettes = await this.crawlDay(page, currentDate);
          gazettes.push(...dayGazettes);
          
          if (dayGazettes.length > 0) {
            logger.info(`Found ${dayGazettes.length} gazette(s) for ${toISODate(currentDate)}`);
          } else {
            logger.debug(`No gazettes found for ${toISODate(currentDate)}`);
          }
        } catch (error) {
          logger.error(`Error crawling date ${toISODate(currentDate)}:`, error as Error);
        }
        
        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from Imprensa Oficial Municipal`);
      
    } catch (error) {
      logger.error(`Error crawling Imprensa Oficial Municipal:`, error as Error);
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
   * Crawl gazettes for a specific day
   */
  private async crawlDay(page: any, date: Date): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Navigate to the main page
      logger.info(`Navigating to: ${this.baseUrl}`);
      await page.goto(this.baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Wait for the page to stabilize and initial JavaScript to load gazettes
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Format date for the form (DD/MM/YYYY)
      const formattedDate = this.formatDateForForm(date);
      logger.info(`Filtering for date: ${formattedDate}`);
      
      // Wait for the date input fields to be present
      try {
        await page.waitForSelector('#from', { timeout: 10000 });
        await page.waitForSelector('#to', { timeout: 10000 });
        await page.waitForSelector('#filtrodata', { timeout: 10000 });
      } catch (error) {
        logger.error('Date filter elements not found, logging page content...');
        const html = await page.content();
        logger.debug(`Page HTML snippet: ${html.substring(0, 1000)}`);
        return gazettes;
      }
      
      // Fill the date input fields using JavaScript evaluation
      logger.debug(`Setting date fields to: ${formattedDate}`);
      await page.evaluate((dateValue: string) => {
        const fromInput = document.getElementById('from') as HTMLInputElement;
        const toInput = document.getElementById('to') as HTMLInputElement;
        if (fromInput) {
          fromInput.value = dateValue;
        }
        if (toInput) {
          toInput.value = dateValue;
        }
      }, formattedDate);
      
      // Wait a bit for any JavaScript to process
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Click the filter button
      logger.debug('Clicking filter button...');
      const filterButton = await page.$('#filtrodata');
      
      if (filterButton) {
        await filterButton.click();
      } else {
        logger.error('Filter button not found');
        return gazettes;
      }
      
      // Wait for results to load (AJAX call completes and updates #jornal)
      logger.debug('Waiting for results...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      this.requestCount++;
      
      // Extract PDF links from the results
      logger.debug('Extracting gazette links...');
      const gazetteLinks = await this.extractGazetteLinks(page);
      
      if (gazetteLinks.length > 0) {
        logger.info(`Found ${gazetteLinks.length} gazette link(s) for ${formattedDate}`);
      } else {
        logger.debug(`No gazette links found for ${formattedDate}`);
      }
      
      // Create gazette objects
      for (const pdfUrl of gazetteLinks) {
        try {
          // Resolve relative URLs
          const fullUrl = pdfUrl.startsWith('http') 
            ? pdfUrl 
            : new URL(pdfUrl, 'https://dosp.com.br/').href;
          
          logger.debug(`Creating gazette for URL: ${fullUrl}`);
          
          // Create gazette with the PDF viewer URL
          // The system will later resolve this to download the actual PDF
          const gazette = await this.createGazette(date, fullUrl, {
            power: 'executive_legislative',
            requiresClientRendering: false,
          });
          
          if (gazette) {
            gazettes.push(gazette);
            logger.info(`Successfully created gazette for ${formattedDate}`);
          }
        } catch (error) {
          logger.error(`Error creating gazette for URL ${pdfUrl}:`, error as Error);
        }
      }
      
    } catch (error) {
      logger.error(`Error in crawlDay for ${toISODate(date)}:`, error as Error);
    }
    
    return gazettes;
  }

  /**
   * Format date for form submission (DD/MM/YYYY)
   */
  private formatDateForForm(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }

  /**
   * Extract gazette PDF links from the results page
   */
  private async extractGazetteLinks(page: any): Promise<string[]> {
    try {
      // Check if there are results in the #jornal div
      const journalContent = await page.$('#jornal');
      if (!journalContent) {
        logger.warn('No #jornal element found on page');
        return [];
      }
      
      // Extract all links with href containing "exibe_do.php?i="
      const allLinks = await page.$$eval('a[href]', (anchors: any[]) => {
        return anchors
          .filter((a: any) => {
            const href = a.href || '';
            return href.includes('exibe_do.php?i=');
          })
          .map((a: any) => a.href);
      });
      
      logger.debug(`Found ${allLinks.length} total gazette links on page`);
      
      // Remove duplicates
      const uniqueLinks = [...new Set(allLinks)];
      
      if (uniqueLinks.length > 0) {
        logger.info(`Extracted ${uniqueLinks.length} unique gazette links`);
        logger.debug('Gazette links:', uniqueLinks.slice(0, 5)); // Log first 5
      } else {
        logger.warn('No gazette links found in results');
      }
      
      return uniqueLinks;
    } catch (error) {
      logger.error('Error extracting gazette links:', error as Error);
      return [];
    }
  }
}
