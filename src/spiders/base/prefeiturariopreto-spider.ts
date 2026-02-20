import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraRioPretoConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Spider for Prefeitura de São José do Rio Preto official gazette
 * 
 * Uses Cloudflare Browser Rendering (Puppeteer) to handle:
 * - JavaScript-rendered iframe content
 * - Form-based date filtering (POST requests)
 * - Dynamic PDF link extraction
 * 
 * The site structure:
 * 1. Main page loads with an iframe
 * 2. Inside iframe, there's a form to filter by date
 * 3. Submitting the form shows a list of PDF links for that date
 */
export class PrefeituraRioPretoSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraRioPretoConfig;
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
      console.log('no browser binding')
      logger.error(`PrefeituraRioPretoSpider for ${this.config.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura Rio Preto for ${this.config.name}...`);

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
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from Prefeitura Rio Preto`);
      
    } catch (error) {
      logger.error(`Error crawling Prefeitura Rio Preto:`, error as Error);
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
      // Navigate directly to the search page (iframe URL)
      const searchUrl = `${this.baseUrl}Diario!pesquisar.action`;
      logger.info(`Navigating to search page: ${searchUrl}`);
      await page.goto(searchUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Wait for page to stabilize
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Format date for the form (DD/MM/YYYY)
      const formattedDate = this.formatDateForForm(date);
      logger.info(`Processing date: ${formattedDate}`);
      
      // Wait for the date input field to be present
      try {
        await page.waitForSelector('#dataPublicacao', { timeout: 10000 });
      } catch (error) {
        console.log('errorDataPublicacaoSelector', error);
        logger.error('Date input field not found, logging page content...');
        const html = await page.content();
        logger.debug(`Page HTML snippet: ${html.substring(0, 1000)}`);
        return gazettes;
      }
      
      // Fill the date input using JavaScript evaluation
      logger.debug(`Setting date field to: ${formattedDate}`);
      await page.evaluate((dateValue: string) => {
        const dateInput = document.getElementById('dataPublicacao') as HTMLInputElement;
        if (dateInput) {
          dateInput.value = dateValue;
        }
      }, formattedDate);
      
      // Wait a bit for any JavaScript to process
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Submit the form using JavaScript
      logger.debug('Submitting form...');
      
      // Try to find and click the submit button
      const submitButtonSelector = 'input[id="formPesquisaPublicacoes_Diario!listar_action"]';
      const submitButton = await page.$(submitButtonSelector);
      
      if (submitButton) {
        logger.debug('Found submit button, clicking...');
        await submitButton.click();
      } else {
        console.log('errorSubmitButtonSelector', submitButtonSelector);
        // Try alternative: submit the form directly via JS
        logger.debug('Submit button not found, trying to submit form via JavaScript...');
        await page.evaluate(() => {
          const form = document.querySelector('form');
          if (form) {
            form.submit();
          }
        });
      }
      
      // Wait for results to load
      logger.debug('Waiting for results...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      this.requestCount++;
      
      // Extract PDF links from the results
      logger.debug('Extracting PDF links...');
      const pdfLinks = await this.extractPdfLinks(page);
      
      if (pdfLinks.length > 0) {
        logger.info(`Found ${pdfLinks.length} PDF link(s) for ${formattedDate}`);
      } else {
        logger.warn(`No PDF links found for ${formattedDate}`);
      }
      
      // Create gazette objects
      for (const pdfUrl of pdfLinks) {
        try {
          // Resolve relative URLs
          const fullUrl = pdfUrl.startsWith('http') 
            ? pdfUrl 
            : new URL(pdfUrl, this.baseUrl).href;
          
          logger.debug(`Creating gazette for PDF: ${fullUrl}`);

          console.log('createGazette fullUrl', fullUrl);
          
          // Mark as requiring client rendering since these are download links
          // that need the browser session context
          const gazette = await this.createGazette(date, fullUrl, {
            power: 'executive_legislative',
            requiresClientRendering: false,
          });
          
          if (gazette) {
            gazettes.push(gazette);
            logger.info(`Successfully created gazette for ${formattedDate}`);
          }
        } catch (error) {
          logger.error(`Error creating gazette for PDF ${pdfUrl}:`, error as Error);
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
   * Extract PDF links from the results page
   */
  private async extractPdfLinks(page: any): Promise<string[]> {
    try {
      // First, let's see what we have on the page
      const pageContent = await page.content();
      logger.debug(`Page content length: ${pageContent.length} characters`);
      
      // Extract all links with their text content
      const allLinks = await page.$$eval('a[href]', (anchors: any[]) => {
        return anchors.map((a: any) => ({
          href: a.href,
          text: a.textContent?.trim() || '',
          onclick: a.getAttribute('onclick') || ''
        }));
      });
      
      logger.debug(`Found ${allLinks.length} total links on page`);

      // Filter for links with the diario.codPublicacao query parameter
      const pdfLinks = allLinks
        .filter((link: any) => {
          const href = link.href.toLowerCase();
          return href.includes('?diario.codpublicacao=');
        })
        .map((link: any) => link.href);
      
      if (pdfLinks.length > 0) {
        logger.info(`Extracted ${pdfLinks.length} PDF links`);
        logger.debug('PDF links:', pdfLinks.slice(0, 5)); // Log first 5
      } else {
        logger.warn('No PDF links found in results');
        // Log some sample links for debugging
        const sampleLinks = allLinks.slice(0, 10).map((l: any) => ({
          href: l.href.substring(0, 100),
          text: l.text.substring(0, 50)
        }));
        logger.debug('Sample links found:', sampleLinks);
      }
      
      return pdfLinks;
    } catch (error) {
      logger.error('Error extracting PDF links:', error as Error);
      return [];
    }
  }
}

