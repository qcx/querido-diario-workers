import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraExtremaConfig } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for Prefeitura de Extrema diário oficial
 * 
 * Site Structure:
 * - URL: https://extrema.mg.gov.br/diariooficial
 * - Uses a calendar/list view with links to gazettes
 * - Each gazette has a link to the PDF
 * - Requires browser rendering due to JavaScript-heavy page
 */
export class PrefeituraExtremaSpider extends BaseSpider {
  protected extremaConfig: PrefeituraExtremaConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.extremaConfig = spiderConfig.config as PrefeituraExtremaConfig;
    this.browser = browser || null;
    
    if (!this.extremaConfig.baseUrl) {
      throw new Error(`PrefeituraExtremaSpider requires a baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraExtremaSpider for ${spiderConfig.name} with URL: ${this.extremaConfig.baseUrl}`, {
      hasBrowser: !!this.browser,
    });
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.extremaConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error('PrefeituraExtremaSpider requires browser rendering');
    }
    
    return this.crawlWithBrowser();
  }

  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      logger.debug(`Navigating to: ${this.extremaConfig.baseUrl}`);
      
      try {
        await page.goto(this.extremaConfig.baseUrl, { waitUntil: 'load', timeout: 30000 });
      } catch (error) {
        logger.warn('Page load timeout, trying with domcontentloaded');
        try {
          await page.goto(this.extremaConfig.baseUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        } catch (retryError) {
          logger.error('Failed to load page even with domcontentloaded');
          throw retryError;
        }
      }
      
      this.requestCount++;
      
      // Wait for page to stabilize and JavaScript to execute
      await new Promise(resolve => setTimeout(resolve, 4000));
      
      try {
        // Wait for gazette articles or list structure
        await page.waitForSelector('article, .list-item, h3.list-item__title, a.list-item__button', { timeout: 10000 });
      } catch (error) {
        logger.warn('Gazette list selector not found, but continuing anyway - page may still have content');
      }
      
      // Additional wait to ensure dynamic content is loaded
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extract gazettes from all pages
      let hasMorePages = true;
      let currentPage = 1;
      const maxPages = 50; // Safety limit
      
      while (hasMorePages && currentPage <= maxPages) {
        logger.debug(`Extracting gazettes from page ${currentPage}`);
        
        // Wait for gazette list to load
        try {
          await page.waitForSelector('article, .list-item, h3.list-item__title', { timeout: 10000 });
        } catch (error) {
          logger.warn('Gazette list not found, may be empty or page structure changed');
          break;
        }
        
        // Extract gazettes from current page
      const pageGazettes = await this.extractGazettesFromPage(page);
      
        // Filter by date range and check if we should continue
        let foundOlderThanRange = false;
      for (const gazette of pageGazettes) {
        if (gazette) {
          const gazetteDate = new Date(gazette.date);
          if (this.isInDateRange(gazetteDate)) {
            gazettes.push(gazette);
            } else if (gazetteDate < new Date(this.dateRange.start)) {
              foundOlderThanRange = true;
            }
          }
        }
        
        logger.debug(`Found ${pageGazettes.length} gazettes on page ${currentPage}, ${gazettes.length} total in date range`);
        
        // Stop if we found gazettes older than our date range
        if (foundOlderThanRange) {
          logger.debug('Found gazettes older than date range, stopping pagination');
          break;
        }
        
        // Check for pagination - look for next page button or page selector
        // The page has a combobox with page numbers and navigation buttons
        const nextPageButton = await page.$('button[aria-label*="próximo" i], button[aria-label*="next" i], a[aria-label*="próximo" i], nav[aria-label*="Paginação"] button:not([aria-label*="anteriores" i]), .pagination .next a');
        
        if (nextPageButton) {
          logger.debug(`Clicking next page button`);
          try {
            await nextPageButton.click();
            await new Promise(resolve => setTimeout(resolve, 3000));
            currentPage++;
            this.requestCount++;
          } catch (error) {
            logger.warn('Error clicking next page button, trying alternative method');
            hasMorePages = false;
          }
        } else {
          // Try to find pagination info and navigate to next page
          try {
            const paginationInfo = await page.evaluate(() => {
              const nav = document.querySelector('nav[aria-label*="Paginação" i], nav[aria-label*="paginação" i]');
              if (!nav) return null;
              
              const text = nav.textContent || '';
              const match = text.match(/página\s+(\d+)\s+de\s+(\d+)/i);
              if (match) {
                return { current: parseInt(match[1]), total: parseInt(match[2]) };
              }
              return null;
            });
            
            if (paginationInfo && paginationInfo.current < paginationInfo.total) {
              const nextPageNum = paginationInfo.current + 1;
              
              // Try to select next page using combobox/select
              const selectElement = await page.$('nav[aria-label*="Paginação"] combobox, nav[aria-label*="Paginação"] select, select[aria-label*="Selecionar página"]');
              
              if (selectElement) {
                try {
                  // Try using select API if it's a SELECT element
                  const tagName = await page.evaluate((el: any) => el.tagName, selectElement);
                  if (tagName === 'SELECT') {
                    await page.select('nav[aria-label*="Paginação"] select, select[aria-label*="Selecionar página"]', String(nextPageNum));
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    currentPage++;
                    this.requestCount++;
                  } else {
                    // For combobox, try to find and click the option
                    const nextPageOption = await page.$(`nav[aria-label*="Paginação"] option[value="${nextPageNum}"]`);
                    if (nextPageOption) {
                      await nextPageOption.click();
                      await new Promise(resolve => setTimeout(resolve, 3000));
                      currentPage++;
                      this.requestCount++;
                    } else {
                      hasMorePages = false;
                    }
                  }
                } catch (error) {
                  logger.debug('Could not navigate to next page via selector');
                  hasMorePages = false;
                }
              } else {
                // No selector found, try to find and click combobox/option
                const combobox = await page.$('nav[aria-label*="Paginação"] combobox, nav[aria-label*="Paginação"] [role="combobox"]');
                if (combobox) {
                  try {
                    // Click to open the combobox
                    await combobox.click();
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    // Now find and click the next page option
                    const nextPageOption = await page.$(`option[value="${nextPageNum}"]`);
                    if (nextPageOption) {
                      await nextPageOption.click();
                      await new Promise(resolve => setTimeout(resolve, 3000));
                      currentPage++;
                      this.requestCount++;
                    } else {
                      // Try to find by text content using evaluate
                      const optionFound = await page.evaluate((pageNum: number) => {
                        const options = Array.from(document.querySelectorAll('option'));
                        const option = options.find((opt: any) => {
                          return opt.value === String(pageNum) || opt.textContent?.trim() === String(pageNum);
                        });
                        if (option) {
                          (option as HTMLElement).click();
                          return true;
                        }
                        return false;
                      }, nextPageNum);
                      
                      if (optionFound) {
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        currentPage++;
                        this.requestCount++;
                      } else {
                        hasMorePages = false;
                      }
                    }
                  } catch (error) {
                    logger.debug('Error navigating to next page via combobox');
                    hasMorePages = false;
                  }
                } else {
                  hasMorePages = false;
                }
              }
            } else {
              hasMorePages = false;
            }
          } catch (error) {
            logger.debug('Could not find pagination controls, assuming no more pages');
            hasMorePages = false;
          }
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from browser across ${currentPage} page(s)`);
      
    } catch (error) {
      logger.error(`Error crawling with browser:`, error as Error);
      throw error;
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (e) {
          logger.warn('Error closing page', { error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (e) {
          logger.warn('Error closing browser', { error: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    return gazettes;
  }

  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      const gazetteData = await page.evaluate(() => {
        const data: any[] = [];
        const debugInfo: any = {
          articlesFound: 0,
          processedItems: [] as any[],
        };
        
        // Strategy 1: Look for article elements with the specific structure
        // Structure: <article> -> <h3 class="list-item__title">Edição nº X</h3> -> <a class="list-item__button" href="...pdf">
        const articles = document.querySelectorAll('article');
        debugInfo.articlesFound = articles.length;
        
        for (const article of Array.from(articles)) {
          // Find the edition title (h3 with class list-item__title)
          const titleElement = article.querySelector('h3.list-item__title, h3[class*="list-item"], .list-item__title');
          const titleText = titleElement ? (titleElement.textContent || '').trim() : '';
          
          // Extract edition number from title
          let editionNumber: string | null = null;
          const editionMatch = titleText.match(/[Ee]di[çc][ãa]o\s+[Nn][°º]?\s*(\d+)/);
          if (editionMatch) {
            editionNumber = editionMatch[1];
          }
          
          // Find the PDF link (a with class list-item__button or any link to PDF)
          const pdfLink = article.querySelector('a.list-item__button, a[class*="list-item"], a[href*=".pdf"]');
          if (!pdfLink) {
            debugInfo.processedItems.push({ status: 'no_pdf_link', titleText });
            continue;
          }
          
          const pdfUrl = pdfLink.getAttribute('href') || '';
          if (!pdfUrl || !pdfUrl.includes('.pdf')) {
            debugInfo.processedItems.push({ status: 'invalid_pdf_url', pdfUrl: pdfUrl.substring(0, 100) });
            continue;
          }
          
          // Extract date from PDF filename
          // Format example: u_240_08012026171115.pdf where 08012026 = 08/01/2026
          let dateText: string | null = null;
          const filenameMatch = pdfUrl.match(/_(\d{8})\d+/); // Match 8 digits after underscore
          if (filenameMatch) {
            const dateStr = filenameMatch[1]; // e.g., "08012026"
            if (dateStr.length === 8) {
              const day = dateStr.substring(0, 2);
              const month = dateStr.substring(2, 4);
              const year = dateStr.substring(4, 8);
              dateText = `${day}/${month}/${year}`;
            }
          }
          
          // If date not found in filename, try to find it in the article text
          if (!dateText) {
            const articleText = article.textContent || '';
            const dateMatch = articleText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (dateMatch) {
              dateText = dateMatch[0];
            }
          }
          
          // If still no date, try to extract from link title attribute
          if (!dateText) {
            const linkTitle = pdfLink.getAttribute('title') || '';
            const dateMatch = linkTitle.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (dateMatch) {
              dateText = dateMatch[0];
            }
          }
          
          if (!dateText) {
            debugInfo.processedItems.push({ status: 'no_date', pdfUrl: pdfUrl.substring(0, 100), titleText });
            continue;
          }
          
          data.push({
            editionNumber,
            dateText,
            pdfUrl,
            titleText,
          });
          
          debugInfo.processedItems.push({ 
            status: 'success', 
            dateText, 
            editionNumber, 
            pdfUrl: pdfUrl.substring(0, 100) 
          });
        }
        
        // Strategy 2: Fallback - Look for any links to PDFs in list-item containers
        if (data.length === 0) {
          const listItems = document.querySelectorAll('.list-item, [class*="list-item"]');
          for (const item of Array.from(listItems)) {
            const titleEl = item.querySelector('h3, h2, h1, .title');
            const title = titleEl ? (titleEl.textContent || '').trim() : '';
            
            const pdfLink = item.querySelector('a[href*=".pdf"]');
            if (!pdfLink) continue;
            
            const pdfUrl = pdfLink.getAttribute('href') || '';
            if (!pdfUrl.includes('.pdf')) continue;
            
            // Extract edition number
            let editionNumber: string | null = null;
            const editionMatch = title.match(/[Ee]di[çc][ãa]o\s+[Nn][°º]?\s*(\d+)/) || 
                                 title.match(/\d+/);
            if (editionMatch) {
              editionNumber = editionMatch[1] || editionMatch[0];
            }
            
            // Extract date from filename
            let dateText: string | null = null;
            const filenameMatch = pdfUrl.match(/_(\d{8})\d+/);
            if (filenameMatch) {
              const dateStr = filenameMatch[1];
              if (dateStr.length === 8) {
                const day = dateStr.substring(0, 2);
                const month = dateStr.substring(2, 4);
                const year = dateStr.substring(4, 8);
                dateText = `${day}/${month}/${year}`;
              }
            }
            
            // Try article text
            if (!dateText) {
              const itemText = item.textContent || '';
              const dateMatch = itemText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
              if (dateMatch) {
                dateText = dateMatch[0];
              }
            }
            
            if (dateText) {
            data.push({
              editionNumber,
              dateText,
              pdfUrl,
                titleText: title,
            });
            }
          }
        }
        
        debugInfo.successCount = data.length;
        
        return { data, debugInfo };
      });
      
      const debugInfo = (gazetteData as any).debugInfo;
      const actualData = (gazetteData as any).data || gazetteData;
      
      if (debugInfo) {
        logger.debug(`Debug info - Articles found: ${debugInfo.articlesFound}, Success: ${debugInfo.successCount || 0}`);
        if (debugInfo.processedItems && debugInfo.processedItems.length > 0) {
          const statusCounts = debugInfo.processedItems.reduce((acc: any, item: any) => {
            acc[item.status] = (acc[item.status] || 0) + 1;
            return acc;
          }, {});
          logger.debug(`Processing status:`, statusCounts);
        }
      }
      
      logger.debug(`Found ${actualData.length} gazette items on page`);
      
      for (const item of actualData) {
        try {
          const dateMatch = item.dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) {
            logger.warn(`Could not parse date: ${item.dateText}`);
            continue;
          }
          
          const [, day, month, year] = dateMatch;
          const gazetteDate = new Date(`${year}-${month}-${day}`);
          
          if (isNaN(gazetteDate.getTime())) {
            logger.warn(`Invalid date: ${item.dateText}`);
            continue;
          }
          
          let pdfUrl = item.pdfUrl;
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.extremaConfig.baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }
          
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber: item.editionNumber || undefined,
            isExtraEdition: false,
            power: 'executive_legislative',
            sourceText: `Diário Oficial ${item.editionNumber ? `N° ${item.editionNumber}` : ''} - ${item.dateText}`,
          });
          
          if (gazette) {
            gazettes.push(gazette);
          }
          
        } catch (error) {
          logger.error(`Error processing gazette item:`, error as Error);
        }
      }
      
    } catch (error) {
      logger.error(`Error extracting gazettes from page:`, error as Error);
    }
    
    return gazettes;
  }
}

