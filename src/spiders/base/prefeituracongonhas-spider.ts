import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraCongonhasConfig } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for Prefeitura de Congonhas diário oficial
 * 
 * Site Structure:
 * - URL: https://www.congonhas.mg.gov.br/index.php/diario-eletronico/
 * - WordPress-based site with diário eletrônico section
 * - Each gazette has a link to the PDF
 * - Requires browser rendering due to JavaScript-heavy page
 */
export class PrefeituraCongonhasSpider extends BaseSpider {
  protected congonhasConfig: PrefeituraCongonhasConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.congonhasConfig = spiderConfig.config as PrefeituraCongonhasConfig;
    this.browser = browser || null;
    
    if (!this.congonhasConfig.baseUrl) {
      throw new Error(`PrefeituraCongonhasSpider requires a baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraCongonhasSpider for ${spiderConfig.name} with URL: ${this.congonhasConfig.baseUrl}`, {
      hasBrowser: !!this.browser,
    });
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.congonhasConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error('PrefeituraCongonhasSpider requires browser rendering');
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
      
      logger.debug(`Navigating to: ${this.congonhasConfig.baseUrl}`);
      
      try {
        await page.goto(this.congonhasConfig.baseUrl, { waitUntil: 'load', timeout: 30000 });
      } catch (error) {
        logger.warn('Page load timeout, trying with domcontentloaded');
        try {
          await page.goto(this.congonhasConfig.baseUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        } catch (retryError) {
          logger.error('Failed to load page even with domcontentloaded');
          throw retryError;
        }
      }
      
      this.requestCount++;
      
      // Wait for page to stabilize and JavaScript to execute
      await new Promise(resolve => setTimeout(resolve, 4000));
      
      try {
        // Wait for any content that might indicate gazettes are loaded
        await page.waitForSelector('a, div, section', { timeout: 10000 });
      } catch (error) {
        logger.warn('Page content selector not found, but continuing anyway');
      }
      
      // Additional wait to ensure dynamic content is loaded
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Crawl all pages with pagination
      let currentPage = 1;
      let hasMorePages = true;
      const visitedUrls = new Set<string>();
      
      while (hasMorePages) {
        const currentUrl = page.url();
        if (visitedUrls.has(currentUrl)) {
          logger.warn(`Already visited ${currentUrl}, stopping pagination`);
          break;
        }
        visitedUrls.add(currentUrl);
        
        logger.debug(`Extracting gazettes from page ${currentPage}: ${currentUrl}`);
        
        const pageGazettes = await this.extractGazettesFromPage(page);
        
        for (const gazette of pageGazettes) {
          if (gazette) {
            const gazetteDate = new Date(gazette.date);
            if (this.isInDateRange(gazetteDate)) {
              gazettes.push(gazette);
            }
          }
        }
        
        logger.debug(`Found ${pageGazettes.length} gazettes on page ${currentPage}, ${gazettes.length} total in date range`);
        
        // Check for next page
        const nextPageInfo = await page.evaluate(() => {
          // Look for pagination links
          const paginationLinks = Array.from(document.querySelectorAll('a'));
          let nextPageUrl = null;
          let currentPageNum = null;
          
          for (const link of paginationLinks) {
            const text = (link.textContent || '').trim();
            const href = link.getAttribute('href') || '';
            
            // Skip JavaScript links
            if (href.startsWith('javascript:') || href === '#' || !href || href === 'void(0)') {
              continue;
            }
            
            // Check if this is the current page
            if (link.getAttribute('aria-current') === 'page' || 
                link.classList.contains('current') ||
                (text.match(/^\d+$/) && link.closest('nav, .pagination, .pager'))) {
              const pageMatch = text.match(/^(\d+)$/);
              if (pageMatch) {
                currentPageNum = parseInt(pageMatch[1], 10);
              }
            }
            
            // Look for "next" or page number links
            if (text.toLowerCase().includes('next') || 
                text.toLowerCase().includes('próximo') ||
                text.toLowerCase().includes('>') ||
                (text.match(/^\d+$/) && parseInt(text, 10) > (currentPageNum || 0))) {
              if (href && !href.includes('#') && !href.startsWith('javascript:')) {
                nextPageUrl = href;
                break;
              }
            }
          }
          
          return { nextPageUrl, currentPageNum };
        });
        
        if (nextPageInfo.nextPageUrl && 
            !nextPageInfo.nextPageUrl.startsWith('javascript:') &&
            nextPageInfo.nextPageUrl !== '#' &&
            !visitedUrls.has(nextPageInfo.nextPageUrl)) {
          try {
            // Construct full URL if relative
            let nextUrl = nextPageInfo.nextPageUrl;
            if (!nextUrl.startsWith('http')) {
              const baseUrlObj = new URL(this.congonhasConfig.baseUrl);
              nextUrl = `${baseUrlObj.origin}${nextUrl.startsWith('/') ? '' : '/'}${nextUrl}`;
            }
            
            logger.debug(`Navigating to next page: ${nextUrl}`);
            await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            this.requestCount++;
            
            // Wait for page to load
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            currentPage++;
            
            // Limit pagination to prevent infinite loops
            if (currentPage > 50) {
              logger.warn('Reached pagination limit (50 pages), stopping');
              hasMorePages = false;
            }
          } catch (error) {
            logger.warn(`Error navigating to next page: ${error instanceof Error ? error.message : String(error)}`);
            hasMorePages = false;
          }
        } else {
          hasMorePages = false;
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from ${currentPage} page(s)`);
      
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
          totalContainers: 0,
          containersWithDate: 0,
          containersWithLink: 0,
          successCount: 0,
        };
        
        // Find all containers that might contain gazette entries
        // The structure is: container > div with "Data: DD/MM/YYYY" > link "Visualizar arquivo"
        const allContainers = document.querySelectorAll('div, section, article, li');
        debugInfo.totalContainers = allContainers.length;
        
        const processedContainers = new Set<Element>();
        
        // Strategy 1: Look for containers with "Data: DD/MM/YYYY" pattern
        for (const container of Array.from(allContainers)) {
          if (processedContainers.has(container)) continue;
          
          const containerText = (container.textContent || '').replace(/\s+/g, ' ').trim();
          
          // Check if container has "Data: DD/MM/YYYY" pattern
          const datePattern = /Data:\s*(\d{2})\/(\d{2})\/(\d{4})/i;
          const dateMatch = containerText.match(datePattern);
          
          if (dateMatch) {
            debugInfo.containersWithDate++;
            const dateText = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;
            
            // Find "Visualizar arquivo" link in this container
            const allLinks = container.querySelectorAll('a');
            let pdfUrl = '';
            
            for (const link of Array.from(allLinks)) {
              const linkText = (link.textContent || '').toLowerCase().trim();
              const href = link.getAttribute('href') || '';
              
              // Look for "visualizar" or links that might be PDFs
              if (linkText.includes('visualizar') || linkText.includes('arquivo') || 
                  href.includes('.pdf') || href.includes('download') || href.includes('visualizar')) {
                pdfUrl = href;
                debugInfo.containersWithLink++;
                break;
              }
            }
            
            // If no link found, try to find any link in the container
            if (!pdfUrl && allLinks.length > 0) {
              const firstLink = allLinks[0];
              pdfUrl = firstLink.getAttribute('href') || '';
            }
            
            if (pdfUrl) {
              // Try to extract edition number from container text
              const editionMatch = containerText.match(/[Ee]di[çc][ãa]o\s+[Nn][°º]?\s*(\d+)/i);
              const editionNumber = editionMatch ? editionMatch[1] : null;
              
              data.push({
                editionNumber,
                dateText,
                pdfUrl,
              });
              
              processedContainers.add(container);
            }
          }
        }
        
        // Strategy 2: Fallback - look for links with "Visualizar arquivo" and find date nearby
        if (data.length === 0) {
          const allLinks = document.querySelectorAll('a');
          
          for (const link of Array.from(allLinks)) {
            const linkText = (link.textContent || '').toLowerCase().trim();
            
            if (linkText.includes('visualizar') || linkText.includes('arquivo')) {
              const href = link.getAttribute('href') || '';
              if (!href) continue;
              
              // Find parent container
              let container = link.closest('div, section, article, li');
              if (!container) {
                container = link.parentElement;
              }
              
              if (container) {
                const containerText = (container.textContent || '').replace(/\s+/g, ' ').trim();
                
                // Try to find date in container
                const datePattern = /(\d{2})\/(\d{2})\/(\d{4})/;
                const dateMatch = containerText.match(datePattern);
                
                if (dateMatch) {
                  const dateText = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;
                  
                  // Try to extract edition number
                  const editionMatch = containerText.match(/[Ee]di[çc][ãa]o\s+[Nn][°º]?\s*(\d+)/i);
                  const editionNumber = editionMatch ? editionMatch[1] : null;
                  
                  data.push({
                    editionNumber,
                    dateText,
                    pdfUrl: href,
                  });
                }
              }
            }
          }
        }
        
        debugInfo.successCount = data.length;
        
        return { data, debugInfo };
      });
      
      const debugInfo = (gazetteData as any).debugInfo;
      const actualData = (gazetteData as any).data || gazetteData;
      
      if (debugInfo) {
        logger.debug(`Debug info - Containers: ${debugInfo.totalContainers}, With date: ${debugInfo.containersWithDate}, With link: ${debugInfo.containersWithLink}, Success: ${debugInfo.successCount || 0}`);
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
          if (!pdfUrl || pdfUrl.startsWith('javascript:') || pdfUrl === '#') {
            logger.warn(`Invalid PDF URL for date ${item.dateText}: ${pdfUrl}`);
            continue;
          }
          
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.congonhasConfig.baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }
          
          // If the URL doesn't point directly to a PDF, try to follow it to find the PDF
          if (!pdfUrl.includes('.pdf') && !pdfUrl.includes('download')) {
            try {
              logger.debug(`Following link to find PDF: ${pdfUrl}`);
              await page.goto(pdfUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
              this.requestCount++;
              
              // Wait a bit for page to load
              await new Promise(resolve => setTimeout(resolve, 2000));
              
              // Try to find PDF link on the page
              const pdfLinkInfo = await page.evaluate(() => {
                const links = document.querySelectorAll('a[href*=".pdf"], iframe[src*=".pdf"], embed[src*=".pdf"], object[data*=".pdf"]');
                for (const link of Array.from(links)) {
                  const href = link.getAttribute('href') || 
                              link.getAttribute('src') || 
                              link.getAttribute('data') || '';
                  if (href.includes('.pdf')) {
                    return href;
                  }
                }
                return null;
              });
              
              if (pdfLinkInfo) {
                if (!pdfLinkInfo.startsWith('http')) {
                  const baseUrlObj = new URL(pdfUrl);
                  pdfUrl = `${baseUrlObj.origin}${pdfLinkInfo.startsWith('/') ? '' : '/'}${pdfLinkInfo}`;
                } else {
                  pdfUrl = pdfLinkInfo;
                }
                logger.debug(`Found PDF URL: ${pdfUrl}`);
              } else {
                // If no PDF link found, the URL might be a direct PDF or the page might embed it
                // Check if current URL is a PDF
                const currentUrl = page.url();
                if (currentUrl.includes('.pdf')) {
                  pdfUrl = currentUrl;
                }
              }
              
              // Go back to listing page
              await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 });
              await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
              logger.warn(`Error following link ${pdfUrl}: ${error instanceof Error ? error.message : String(error)}`);
              // Continue with original URL - it might still work
            }
          }
          
          // Try to create gazette - if URL resolution fails, log but continue
          // Note: URLs from servidor.congonhas.mg.gov.br may require client rendering
          // to access properly, so we mark them as requiring client rendering
          try {
            const requiresClientRendering = pdfUrl.includes('servidor.congonhas.mg.gov.br') || 
                                          !pdfUrl.includes('.pdf');
            
            const gazette = await this.createGazette(gazetteDate, pdfUrl, {
              editionNumber: item.editionNumber || undefined,
              isExtraEdition: false,
              power: 'executive_legislative',
              sourceText: `Diário Oficial ${item.editionNumber ? `N° ${item.editionNumber}` : ''} - ${item.dateText}`,
              requiresClientRendering: requiresClientRendering,
            });
            
            if (gazette) {
              gazettes.push(gazette);
              logger.debug(`Successfully created gazette for ${item.dateText}`);
            } else {
              logger.warn(`Failed to create gazette for ${item.dateText} - URL resolution failed for ${pdfUrl}`);
            }
          } catch (error) {
            logger.error(`Error creating gazette for ${item.dateText}:`, error as Error);
            // Continue processing other gazettes even if one fails
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

