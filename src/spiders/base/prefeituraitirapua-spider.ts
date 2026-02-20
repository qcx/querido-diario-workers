import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraItirapuaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Spider for Prefeitura de Itirapuã official gazette
 * 
 * Uses Cloudflare Browser Rendering (Puppeteer) to handle:
 * - ASP.NET/GeneXus framework with JavaScript events
 * - Form-based date filtering (one day at a time)
 * - Two-step PDF extraction:
 *   1. Click download button on search results
 *   2. Navigate to intermediate page
 *   3. Extract PDF URL from embed element
 * 
 * The site structure:
 * 1. Main page with date filter form
 * 2. Submit form shows grid of available editions for that day
 * 3. Click download icon navigates to intermediate viewer page
 * 4. Intermediate page has PDF embedded via <embed> element
 */
export class PrefeituraItirapuaSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraItirapuaConfig;
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
      logger.error(`PrefeituraItirapuaSpider for ${this.config.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura Itirapuã for ${this.config.name}...`);

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
          
          const dayGazettes = await this.crawlDay(page, browserInstance, currentDate);
          gazettes.push(...dayGazettes);
          
          if (dayGazettes.length > 0) {
            logger.info(`Found ${dayGazettes.length} gazette(s) for ${toISODate(currentDate)}`);
          } else {
            logger.debug(`No gazettes found for ${toISODate(currentDate)}`);
          }
          
          // Add delay between days to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 1500));
        } catch (error) {
          logger.error(`Error crawling date ${toISODate(currentDate)}:`, error as Error);
        }
        
        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from Prefeitura Itirapuã`);
      
    } catch (error) {
      logger.error(`Error crawling Prefeitura Itirapuã:`, error as Error);
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
  private async crawlDay(page: any, browserInstance: any, date: Date): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      console.log('crawling day', this.baseUrl, date);
      // Navigate to the main page
      logger.info(`Navigating to: ${this.baseUrl}`);
      await page.goto(this.baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Wait for page to stabilize and GeneXus JavaScript to load
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Format date for the form (DD/MM/YYYY)
      const formattedDate = this.formatDateForForm(date);
      logger.info(`Filtering for date: ${formattedDate}`);
      
      // Wait for the date input field to be present
      try {
        await page.waitForSelector('#vDATA', { timeout: 10000 });
      } catch (error) {
        console.log('errorDateInputSelector', error);
        logger.error('Date input field #vDATA not found');
        const html = await page.content();
        logger.debug(`Page HTML snippet: ${html.substring(0, 1000)}`);
        return gazettes;
      }
      
      // Fill the date input using JavaScript evaluation
      console.log('setting date field to', formattedDate);
      logger.debug(`Setting date field to: ${formattedDate}`);
      await page.evaluate((dateValue: string) => {
        const dateInput = document.getElementById('vDATA') as HTMLInputElement;
        console.log('dateInput', dateInput);
        if (dateInput) {
          dateInput.value = dateValue;
        }
      }, formattedDate);
      
      // Wait a bit for any JavaScript to process
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Click the search button
      logger.debug('Clicking search button...');
      try {
        // Wait for button to be present and visible
        await page.waitForSelector('#BTNPESQUISAR', { visible: true, timeout: 10000 });
        console.log('search button found');

        // Click using JavaScript to ensure it works
        logger.debug('Clicking search button using JavaScript...');
        await page.evaluate(() => {
          const button = document.querySelector('#BTNPESQUISAR') as HTMLElement;
          console.log('button', button);
          if (button) {
            button.click();
          }
        });
      } catch (error) {
        console.log('errorClickingSearchButton', error);
        logger.error('Search button #BTNPESQUISAR not found or could not be clicked');
        // Log page content for debugging
        try {
          const html = await page.content();
          console.log('html', html);
          logger.debug(`Page HTML snippet: ${html.substring(0, 2000)}`);
        } catch (e) {
          // Ignore
        }
        return gazettes;
      }
      
      // Wait for results to load - wait for the grid container to appear or update
      logger.debug('Waiting for results container to load...');
      try {
        // Wait for the results grid to be present (with timeout)
        await page.waitForSelector('#W0038GridlistaContainerDiv', { timeout: 10000 });
        console.log('results container found');
        logger.debug('Results container found');
        // Give it a bit more time for content to populate
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (waitError) {
        logger.debug('Results container did not appear, assuming no results');
        // Continue anyway - we'll check for content below
      }
      
      this.requestCount++;
      
      // Check if results container exists
      const hasResults = await page.$('#W0038GridlistaContainerDiv');
      console.log('hasResults', hasResults);
      if (!hasResults) {
        logger.debug(`No results container found for ${formattedDate}`);
        return gazettes;
      }
      
      // Extract gazette items from the grid
      logger.debug('Extracting gazette items...');
      const gazetteItems = await this.extractGazetteItems(page);
  console.log('gazetteItems', gazetteItems);      
      if (gazetteItems.length === 0) {
        logger.debug(`No gazette items found for ${formattedDate}`);
        return gazettes;
      }

      logger.info(`Found ${gazetteItems.length} gazette item(s) for ${formattedDate}`);
      
      // Process each gazette item
      for (let i = 0; i < gazetteItems.length; i++) {
        try {
          const item = gazetteItems[i];
          logger.debug(`Processing gazette ${i + 1}/${gazetteItems.length}: ${item.title}`);
          
          // Navigate to main page again before clicking download
          await page.goto(this.baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // Re-fill the form and search
          await page.evaluate((dateValue: string) => {
            const dateInput = document.getElementById('vDATA') as HTMLInputElement;
            if (dateInput) {
              dateInput.value = dateValue;
            }
          }, formattedDate);
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Click search button using JavaScript (most reliable for GeneXus)
          logger.debug('Clicking search button...');
          await page.evaluate(() => {
            const button = document.querySelector('#BTNPESQUISAR') as HTMLElement;
            if (button) button.click();
          });
          
          // Wait for results to appear
          try {
            await page.waitForSelector('#W0038GridlistaContainerDiv', { timeout: 8000 });
            await new Promise(resolve => setTimeout(resolve, 1500));
          } catch (waitErr) {
            logger.warn('Results container did not appear after re-search');
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
          
          // Click the download button for this specific item
          const downloadSelector = `#${item.downloadId}`;
          try {
            await page.waitForSelector(downloadSelector, { timeout: 5000 });
            logger.debug(`Clicking download button: ${downloadSelector}`);
            
            // Set up listener for new page/tab before clicking
            const newPagePromise = new Promise<any>((resolve) => {
              const timeout = setTimeout(() => {
                resolve(null);
              }, 10000);
              
              const handler = async (target: any) => {
                try {
                  // Only handle page targets, ignore other types (workers, etc.)
                  const pageType = target.type();
                  if (pageType === 'page') {
                    clearTimeout(timeout);
                    browserInstance.off('targetcreated', handler);
                    const newPage = await target.page();
                    resolve(newPage);
                  }
                } catch (e) {
                  // Ignore errors, continue waiting
                }
              };
              
              browserInstance.on('targetcreated', handler);
            });
            
            // Click the download button (this will open a new tab)
            await page.click(downloadSelector);
            
            // Wait for the new page to open (with timeout)
            logger.debug('Waiting for new page to open...');
            const newPage = await newPagePromise;
            
            if (!newPage) {
              logger.warn(`No new page opened after clicking ${downloadSelector}`);
              continue;
            }
            
            logger.debug(`New page opened: ${newPage.url()}`);
            this.requestCount++;
            
            // Wait for the new page to load
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Extract PDF URL from embed element in the new page
            const pdfUrl = await this.extractPdfFromEmbed(newPage);
            
            // Close the new page
            try {
              await newPage.close();
            } catch (e) {
              logger.warn('Error closing new page', e as Error);
            }
            
            if (pdfUrl) {
              logger.debug(`Extracted PDF URL: ${pdfUrl}`);
              
              // Create gazette object
              const gazette = await this.createGazette(date, pdfUrl, {
                power: 'executive_legislative',
                requiresClientRendering: false,
                editionNumber: item.editionNumber,
                isExtraEdition: item.isExtra,
              });
              
              if (gazette) {
                gazettes.push(gazette);
                logger.info(`Successfully created gazette for ${formattedDate} - ${item.title}`);
              }
            } else {
              logger.warn(`Could not extract PDF URL for ${item.title}`);
            }
            
            // Add delay between items
            await new Promise(resolve => setTimeout(resolve, 1000));
            
          } catch (error) {
            console.log('errorProcessingDownload', error);
            logger.error(`Error processing download for ${item.title}:`, error as Error);
          }
        } catch (error) {
          console.log('errorProcessingGazetteItem', error);
          logger.error(`Error processing gazette item ${i + 1}:`, error as Error);
        }
      }
      
    } catch (error) {
      console.log('errorInCrawlDay', error);
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
   * Extract gazette items from the results grid
   */
  private async extractGazetteItems(page: any): Promise<Array<{
    downloadId: string;
    title: string;
    editionNumber?: string;
    isExtra: boolean;
  }>> {
    try {
      const items = await page.$$eval(
        '#W0038GridlistaContainerDiv [id^="W0038GridlistaContainerRow_"]',
        (rows: any[]) => {
          return rows.map((row: any) => {
            console.log('row', row);
            // Find download button
            const downloadImg = row.querySelector('img[id^="W0038DOWNLOAD_"]');
            const downloadId = downloadImg ? downloadImg.id : null;
            
            // Extract title from the numero span
            const numeroSpan = row.querySelector('[id^="span_W0038vNUMERO_"]');
            const title = numeroSpan ? numeroSpan.textContent.trim() : '';
            
            // Extract edition number from title (e.g., "Diário Eletrônico nº. 185" -> "185")
            let editionNumber: string | undefined;
            let isExtra = false;
            
            const numberMatch = title.match(/nº\.?\s*(\d+)/i);
            if (numberMatch) {
              editionNumber = numberMatch[1];
            }
            
            // Check for extra edition indicators
            isExtra = /extra|supl|ee|esp/i.test(title);
            
            return {
              downloadId,
              title,
              editionNumber,
              isExtra
            };
          }).filter((item: any) => item.downloadId); // Only return items with download buttons
        }
      );
      
      logger.debug(`Extracted ${items.length} gazette items from grid`);
      return items;
    } catch (error) {
      logger.error('Error extracting gazette items:', error as Error);
      return [];
    }
  }

  /**
   * Extract PDF URL from iframe or embed element on intermediate page
   */
  private async extractPdfFromEmbed(page: any): Promise<string | null> {
    try {
      // First try to find iframe (most common case for this site)
      try {
        // Wait for iframe to be present (try multiple selectors)
        await page.waitForSelector('iframe', { timeout: 10000 });
        
        // Extract src attribute from iframe
        const pdfUrl = await page.evaluate(() => {
          // Try multiple selectors for the iframe, prioritizing EMBPAGE
          const iframe = document.querySelector('iframe[name="EMBPAGE"]') as HTMLIFrameElement ||
                        document.querySelector('iframe#EMBPAGE') as HTMLIFrameElement ||
                        document.querySelector('iframe[src*=".pdf"]') as HTMLIFrameElement ||
                        document.querySelector('iframe') as HTMLIFrameElement;
          
          return iframe && iframe.src ? iframe.src : null;
        });

        console.log('pdfUrl from iframe', pdfUrl);
        
        if (pdfUrl && pdfUrl.includes('.pdf')) {
          logger.debug(`Found PDF URL in iframe: ${pdfUrl}`);
          return pdfUrl;
        } else if (pdfUrl) {
          logger.debug(`Found iframe but src doesn't contain .pdf: ${pdfUrl}`);
        }
      } catch (iframeError) {
        logger.debug('Iframe not found, trying embed element...');
      }
      
      // Fallback: try embed element (for other sites or different page structures)
      try {
        await page.waitForSelector('embed[type="application/x-google-chrome-pdf"]', { timeout: 5000 });
        
        const pdfUrl = await page.$eval(
          'embed[type="application/x-google-chrome-pdf"]',
          (embed: any) => embed.getAttribute('original-url') || embed.getAttribute('src')
        );

        console.log('pdfUrl from embed', pdfUrl);
        
        if (pdfUrl) {
          logger.debug(`Found PDF URL in embed: ${pdfUrl}`);
          return pdfUrl;
        }
      } catch (embedError) {
        logger.debug('Embed element not found');
      }
      
      logger.warn('Could not find PDF URL in iframe or embed element');
      return null;
    } catch (error) {
      logger.error('Error extracting PDF from page:', error as Error);
      
      // Log page content for debugging
      try {
        const html = await page.content();
        console.log('html', html);
        logger.debug(`Page HTML snippet: ${html.substring(0, 1000)}`);
      } catch (e) {
        // Ignore
      }
      
      return null;
    }
  }
}

