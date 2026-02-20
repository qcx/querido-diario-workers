import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, KingDiarioConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for KingDiario platform official gazette
 * 
 * Uses Cloudflare Browser Rendering (Puppeteer) to handle:
 * - Form-based date range filtering
 * - JavaScript-rendered search results
 * - PDF download links extraction
 * 
 * The site structure:
 * 1. Main page with date range filter form (#data and #dataFinal)
 * 2. Submit form shows grid of available editions in .events-container-busca
 * 3. Each .event-card contains edition info and PDF download link
 */
export class KingDiarioSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as KingDiarioConfig;
    // Support both 'baseUrl' and 'url' for backward compatibility
    this.baseUrl = platformConfig.baseUrl || platformConfig.url;
    if (!this.baseUrl) {
      logger.error(`KingDiarioSpider config for ${config.name}:`, JSON.stringify(config.config, null, 2));
      throw new Error(`KingDiarioSpider requires baseUrl or url in config for ${config.name}`);
    }
    logger.debug(`KingDiarioSpider initialized with baseUrl: ${this.baseUrl} for ${config.name}`);
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
      logger.error(`KingDiarioSpider for ${this.config.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling KingDiario for ${this.config.name}...`);

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
      
      // Format dates for the form (DD/MM/YYYY)
      const startDateFormatted = this.formatDateForForm(this.startDate);
      const endDateFormatted = this.formatDateForForm(this.endDate);
      
      logger.info(`Filtering for date range: ${startDateFormatted} to ${endDateFormatted}`);
      
      // Fill the date inputs
      await this.fillDateInputs(page, startDateFormatted, endDateFormatted);
      
      // Click the search button
      await this.clickSearchButton(page);
      
      // Wait for results to load
      await this.waitForResults(page);
      
      // Extract gazettes from results
      const extractedGazettes = await this.extractGazettes(page);
      
      // Filter gazettes by date range
      for (const gazetteData of extractedGazettes) {
        const gazetteDate = this.parseDate(gazetteData.publicationDate);
        if (gazetteDate && this.isInDateRange(gazetteDate)) {
          const pdfUrl = this.resolvePdfUrl(gazetteData.downloadPath);
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            power: 'executive_legislative',
            requiresClientRendering: false,
            editionNumber: gazetteData.editionNumber,
            isExtraEdition: gazetteData.isExtraEdition,
          });
          
          if (gazette) {
            gazettes.push(gazette);
            logger.info(`Successfully created gazette for ${gazetteData.publicationDate} - Edição ${gazetteData.editionNumber}`);
          }
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from KingDiario`);
      
    } catch (error) {
      logger.error(`Error crawling KingDiario:`, error as Error);
      throw error;
    } finally {
      // Clean up
      if (page) {
        try {
          await page.close();
        } catch (e) {
          logger.warn('Error closing page', { error: (e as Error).message });
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (e) {
          logger.warn('Error closing browser', { error: (e as Error).message });
        }
      }
    }

    return gazettes;
  }

  /**
   * Fill the date input fields
   */
  private async fillDateInputs(page: any, startDate: string, endDate: string): Promise<void> {
    try {
      // Wait for date inputs to be present
      await page.waitForSelector('#data', { timeout: 10000 });
      await page.waitForSelector('#dataFinal', { timeout: 10000 });
      
      // Fill the initial date input
      await page.evaluate((date: string) => {
        const input = document.getElementById('data') as HTMLInputElement;
        if (input) {
          input.value = date;
          // Trigger input event to ensure any JavaScript handlers are called
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, startDate);
      
      // Fill the final date input
      await page.evaluate((date: string) => {
        const input = document.getElementById('dataFinal') as HTMLInputElement;
        if (input) {
          input.value = date;
          // Trigger input event to ensure any JavaScript handlers are called
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, endDate);
      
      // Wait a bit for any JavaScript to process
      await new Promise(resolve => setTimeout(resolve, 500));
      
      logger.debug(`Filled date inputs: ${startDate} to ${endDate}`);
    } catch (error) {
      logger.error('Error filling date inputs:', error as Error);
      throw error;
    }
  }

  /**
   * Click the search button
   */
  private async clickSearchButton(page: any): Promise<void> {
    try {
      // Wait for button to be present
      await page.waitForSelector('#btn_busca_diario', { visible: true, timeout: 10000 });
      
      // Try submitting the form instead of clicking the button
      // This is more reliable for form submissions
      const formSubmitted = await page.evaluate(() => {
        const form = document.getElementById('frmBusca') as HTMLFormElement;
        if (form) {
          form.submit();
          return true;
        }
        return false;
      });
      
      if (!formSubmitted) {
        // Fallback to clicking the button
        await page.evaluate(() => {
          const button = document.getElementById('btn_busca_diario') as HTMLElement;
          if (button) {
            button.click();
          }
        });
      }
      
      logger.debug('Submitted search form');
      
      // Wait for navigation/response
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Wait for page to stabilize after form submission
      try {
        await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 });
      } catch (navError) {
        // Navigation might not happen if it's AJAX, that's okay
        logger.debug('No navigation detected, assuming AJAX update');
      }
    } catch (error) {
      logger.error('Error submitting search form:', error as Error);
      throw error;
    }
  }

  /**
   * Wait for search results to load
   */
  private async waitForResults(page: any): Promise<void> {
    try {
      // Wait for results container to appear
      await page.waitForSelector('.events-container-busca', { timeout: 15000 });
      
      // Wait a bit more for content to populate
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      logger.debug('Results container loaded');
    } catch (error) {
      logger.warn('Results container did not appear, may be no results');
      // Continue anyway - we'll check for content below
    }
  }

  /**
   * Extract gazette data from search results
   */
  private async extractGazettes(page: any): Promise<Array<{
    editionNumber: string;
    publicationDate: string;
    downloadPath: string;
    isExtraEdition: boolean;
  }>> {
    try {
      // First, check if the container exists and count cards
      const containerExists = await page.$('.events-container-busca');
      if (!containerExists) {
        logger.warn('Results container .events-container-busca not found');
        return [];
      }

      const cardCount = await page.$$eval('.events-container-busca .event-card', (cards: any[]) => cards.length);
      logger.debug(`Found ${cardCount} event-card elements in results container`);

      if (cardCount === 0) {
        // Try to get the HTML content for debugging
        const containerHtml = await page.$eval('.events-container-busca', (el: any) => el.innerHTML.substring(0, 500));
        logger.debug(`Container HTML snippet: ${containerHtml}`);
        return [];
      }

      const gazettes = await page.$$eval(
        '.events-container-busca .event-card',
        (cards: any[]) => {
          const results: any[] = [];
          
          cards.forEach((card: any, index: number) => {
            // Extract edition number from h4 (e.g., "Edição Nº 730")
            const editionH4 = card.querySelector('.event-data h4');
            const editionText = editionH4 ? editionH4.textContent.trim() : '';
            const editionMatch = editionText.match(/Edição\s+Nº\s*(\d+)/i);
            const editionNumber = editionMatch ? editionMatch[1] : '';
            
            // Extract publication date
            // Look through all paragraphs in .event-data to find the one with "Publicado em:"
            let publicationDate = '';
            const dateParagraphs = card.querySelectorAll('.event-data p');
            for (const p of dateParagraphs) {
              const dateText = p.textContent || p.innerText || '';
              // Match "Publicado em:" followed by date (handles whitespace variations)
              const dateMatch = dateText.match(/Publicado\s+em\s*:\s*(\d{2}\/\d{2}\/\d{4})/i);
              if (dateMatch) {
                publicationDate = dateMatch[1];
                break;
              }
            }
            
            // Extract download path from the anchor element containing button with "Download em PDF" text
            // Structure: .event-card > .row > div > a > button (with "Download em PDF" text)
            let downloadPath = '';
            const rowDivs = card.querySelectorAll('.row > div');
            for (const div of rowDivs) {
              const link = div.querySelector('a');
              if (link) {
                const button = link.querySelector('button');
                if (button) {
                  // Check button text content (including nested elements)
                  const buttonText = button.textContent || button.innerText || '';
                  if (buttonText.includes('Download em PDF')) {
                    downloadPath = link.getAttribute('href') || '';
                    break;
                  }
                }
              }
            }
            
            // Check if it's an extra edition
            const editionType = card.querySelector('.tipo-edicao');
            const isExtraEdition = editionType ? 
              editionType.textContent.toLowerCase().includes('extra') : false;
            
            const item = {
              editionNumber,
              publicationDate,
              downloadPath,
              isExtraEdition
            };
            
            // Log each item before filtering for debugging
            console.log(`Card ${index + 1}:`, {
              editionNumber: item.editionNumber || 'MISSING',
              publicationDate: item.publicationDate || 'MISSING',
              downloadPath: item.downloadPath || 'MISSING',
              isExtraEdition: item.isExtraEdition
            });
            
            results.push(item);
          });
          
          return results;
        }
      );
      
      // Filter out incomplete items
      const filteredGazettes = gazettes.filter((item: any) => {
        const isValid = item.editionNumber && item.publicationDate && item.downloadPath;
        if (!isValid) {
          logger.debug(`Filtered out incomplete item: editionNumber=${item.editionNumber}, publicationDate=${item.publicationDate}, downloadPath=${item.downloadPath}`);
        }
        return isValid;
      });
      
      logger.debug(`Extracted ${gazettes.length} raw items, ${filteredGazettes.length} valid gazette items from results`);
      return filteredGazettes;
    } catch (error) {
      logger.error('Error extracting gazettes:', { error: (error as Error).message });
      // Try to get page HTML for debugging
      try {
        const pageHtml = await page.content();
        logger.debug(`Page HTML snippet (first 2000 chars): ${pageHtml.substring(0, 2000)}`);
      } catch (e) {
        // Ignore
      }
      return [];
    }
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
   * Parse date from DD/MM/YYYY format
   */
  private parseDate(dateString: string): Date | null {
    try {
      const [day, month, year] = dateString.split('/').map(Number);
      return new Date(year, month - 1, day);
    } catch (error) {
      logger.error(`Error parsing date ${dateString}:`, error as Error);
      return null;
    }
  }

  /**
   * Resolve PDF URL from download path
   */
  private resolvePdfUrl(downloadPath: string): string {
    // If the path is already a full URL, return it
    if (downloadPath.startsWith('http://') || downloadPath.startsWith('https://')) {
      return downloadPath;
    }
    
    // Otherwise, construct the full URL from baseUrl
    const baseUrlObj = new URL(this.baseUrl);
    const path = downloadPath.startsWith('/') ? downloadPath : `/${downloadPath}`;
    return `${baseUrlObj.origin}${path}`;
  }
}

