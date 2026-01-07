import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeiturasuzanoConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for Prefeitura de Suzano - Imprensa Oficial
 * 
 * Uses Cloudflare Browser Rendering (Puppeteer) to handle:
 * - Cloudflare protection requiring browser
 * - WordPress-based site with card-based gazette listings
 * 
 * Site Structure:
 * - Main listing: https://suzano.sp.gov.br/imprensa-oficial/
 * - Each gazette is displayed as a card with:
 *   - Image link to PDF viewer page
 *   - Date in format DD/MM/YYYY
 *   - Title like "Edição 002 – 06.01.2026" or "Edição EXTRA 001 – 05.01.2026"
 * - Pagination via page numbers at bottom
 */
export class PrefeiturasuzanoSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const suzanoConfig = config.config as unknown as PrefeiturasuzanoConfig;
    this.baseUrl = suzanoConfig.baseUrl || 'https://suzano.sp.gov.br/imprensa-oficial/';
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
      logger.error('Browser instance is required for PrefeiturasuzanoSpider (Cloudflare protection)');
      return [];
    }

    logger.info(`Crawling Suzano gazettes from ${this.baseUrl}...`);
    
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      
      // Navigate to the imprensa oficial page
      logger.debug(`Navigating to: ${this.baseUrl}`);
      await page.goto(this.baseUrl, { waitUntil: 'networkidle0', timeout: 60000 });
      this.requestCount++;
      
      // Wait for page to stabilize
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Debug: Check if page loaded correctly
      const pageTitle = await page.title();
      const pageUrl = page.url();
      const pageContent = await page.content();
      const bodyLength = pageContent?.length || 0;
      logger.debug(`Page loaded - Title: "${pageTitle}", URL: ${pageUrl}, HTML length: ${bodyLength}`);
      
      // Check for Cloudflare challenge page
      if (pageTitle.includes('Just a moment') || pageTitle.includes('Checking') || bodyLength < 5000) {
        logger.warn('Possible Cloudflare challenge detected - page may not have loaded correctly');
        // Log first 500 chars of HTML for debugging
        logger.debug(`HTML preview: ${pageContent?.substring(0, 500)}`);
      }

      // Extract gazettes from all pages
      let hasMorePages = true;
      let currentPage = 1;
      const maxPages = 50;
      
      while (hasMorePages && currentPage <= maxPages) {
        logger.debug(`Extracting gazettes from page ${currentPage}`);
        
        // Extract gazettes from current page
        const pageGazettes = await this.extractGazettesFromPage(page);
        logger.debug(`Found ${pageGazettes.length} gazettes on page ${currentPage}`);
        
        // Filter by date range and add to results
        let foundOlderThanRange = false;
        for (const gazette of pageGazettes) {
          const gazetteDate = new Date(gazette.date);
          
          if (gazetteDate < this.startDate) {
            foundOlderThanRange = true;
            continue;
          }
          
          if (this.isInDateRange(gazetteDate)) {
            gazettes.push(gazette);
          }
        }
        
        logger.debug(`Total gazettes in range so far: ${gazettes.length}`);
        
        // Stop if we found gazettes older than date range
        if (foundOlderThanRange) {
          logger.debug('Found gazettes older than date range, stopping pagination');
          break;
        }
        
        // Check for next page - look for pagination links
        const nextPageLink = await page.$('nav a[href*="page"]:not([aria-current]), .pagination a.next, a.page-numbers:not(.current):not(.prev):not(.next)');
        
        // Also check for numbered pagination - find next page number
        const nextPageNumber = await page.evaluate((currentPageNum: number) => {
          // Look for pagination container
          const navContainer = document.querySelector('nav') || document.querySelector('.pagination');
          if (!navContainer) return null;
          
          // Find all page links
          const pageLinks = navContainer.querySelectorAll('a');
          for (const link of Array.from(pageLinks)) {
            const text = link.textContent?.trim();
            const num = parseInt(text || '', 10);
            if (num === currentPageNum + 1) {
              return link.getAttribute('href');
            }
          }
          
          // Try "Próxima página" link
          const nextLink = navContainer.querySelector('a[rel="next"], a:contains("Próxima")');
          if (nextLink) {
            return nextLink.getAttribute('href');
          }
          
          return null;
        }, currentPage);
        
        if (nextPageNumber || nextPageLink) {
          currentPage++;
          
          if (nextPageNumber) {
            // Navigate directly to the next page URL
            const nextUrl = nextPageNumber.startsWith('http') 
              ? nextPageNumber 
              : `${new URL(this.baseUrl).origin}${nextPageNumber}`;
            logger.debug(`Navigating to next page: ${nextUrl}`);
            await page.goto(nextUrl, { waitUntil: 'networkidle0', timeout: 30000 });
          } else if (nextPageLink) {
            logger.debug('Clicking next page link');
            await nextPageLink.click();
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
          
          this.requestCount++;
        } else {
          hasMorePages = false;
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from Suzano`);

    } catch (error) {
      logger.error(`Error crawling Suzano:`, error as Error);
      throw error;
    } finally {
      // Clean up
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

  /**
   * Extract gazettes from current browser page
   * 
   * Site structure (from accessibility snapshot):
   * - Each gazette is in a div container with:
   *   - Link with img (name like "Edição 002 – 06.01.2026")
   *   - Date div with format DD/MM/YYYY
   *   - Heading with link to gazette detail page
   */
  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Extract gazette data from the page
      const gazetteData = await page.evaluate(() => {
        const results: Array<{
          title: string;
          date: string;
          viewUrl: string;
        }> = [];
        const processedUrls = new Set<string>();
        
        // Debug: Log page structure
        const bodyHTML = document.body?.innerHTML?.substring(0, 1000) || 'No body';
        console.log('[Suzano Debug] Body preview:', bodyHTML);
        
        // Method 1: Find all links that point to gazette pages (contain "edicao" in URL)
        const allLinks = document.querySelectorAll('a');
        console.log('[Suzano Debug] Total links found:', allLinks.length);
        
        for (const link of Array.from(allLinks)) {
          const href = link.getAttribute('href') || '';
          const text = link.textContent?.trim() || '';
          
          // Filter for gazette-related links (contain "edicao" or "Edição" in URL or text)
          const isGazetteLink = href.includes('edicao') || 
                                href.includes('imprensa-oficial') && href !== 'https://suzano.sp.gov.br/imprensa-oficial/' ||
                                text.toLowerCase().includes('edição') ||
                                text.toLowerCase().includes('edicao');
          
          if (!isGazetteLink) continue;
          
          // Skip main page link and pagination
          if (href === 'https://suzano.sp.gov.br/imprensa-oficial/' || 
              href === '/imprensa-oficial/' ||
              href.includes('page')) continue;
          
          // Skip if already processed
          if (processedUrls.has(href)) continue;
          
          // Find the title from link text or nearby heading
          let title = '';
          if (text.includes('Edição') || text.includes('edição') || text.includes('Edicao') || text.includes('edicao')) {
            title = text;
          } else {
            // Look for img alt text
            const img = link.querySelector('img');
            if (img && img.alt && (img.alt.includes('Edição') || img.alt.includes('edição'))) {
              title = img.alt;
            }
          }
          
          // If no title yet, find nearby heading
          if (!title) {
            // Navigate up to find container
            let container: Element | null = link.parentElement;
            for (let i = 0; i < 5 && container; i++) {
              const h = container.querySelector('h1, h2, h3, h4, h5, h6');
              if (h) {
                const hText = h.textContent?.trim() || '';
                if (hText.includes('Edição') || hText.includes('edição')) {
                  title = hText;
                  break;
                }
              }
              container = container.parentElement;
            }
          }
          
          if (!title || !title.includes('Edi')) continue;
          
          // Find date - look for DD/MM/YYYY pattern nearby
          let date = '';
          let container: Element | null = link.parentElement;
          for (let i = 0; i < 5 && container && !date; i++) {
            const allText = container.textContent || '';
            const dateMatch = allText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (dateMatch) {
              date = dateMatch[0];
            }
            container = container.parentElement;
          }
          
          // Also try to extract date from title (format DD.MM.YYYY)
          if (!date) {
            const titleDateMatch = title.match(/(\d{2})\.(\d{2})\.(\d{4})/);
            if (titleDateMatch) {
              date = `${titleDateMatch[1]}/${titleDateMatch[2]}/${titleDateMatch[3]}`;
            }
          }
          
          if (date && href) {
            processedUrls.add(href);
            results.push({ title, date, viewUrl: href });
            console.log('[Suzano Debug] Found gazette:', { title: title.substring(0, 50), date, viewUrl: href });
          }
        }
        
        console.log('[Suzano Debug] Total results:', results.length);
        return results;
      });
      
      logger.debug(`Extracted ${gazetteData.length} gazette entries from page`);
      
      // Process each gazette entry
      for (const data of gazetteData) {
        try {
          // Parse date (DD/MM/YYYY)
          const dateMatch = data.date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) {
            logger.warn(`Could not parse date: ${data.date}`);
            continue;
          }
          
          const [, day, month, year] = dateMatch;
          const gazetteDate = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));
          
          // Extract edition number from title (e.g., "Edição 002 – 06.01.2026")
          const editionMatch = data.title.match(/[Ee]di[çc][ãa]o\s+(?:EXTRA\s+)?(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;
          
          // Check if extra edition
          const isExtraEdition = data.title.toLowerCase().includes('extra');
          
          // Get the PDF URL - need to navigate to the view page and extract PDF
          let pdfUrl = data.viewUrl;
          
          // For now, use the view URL - we'll get the actual PDF when needed
          // The view URL typically redirects to PDF or contains an embed
          if (!pdfUrl.startsWith('http')) {
            pdfUrl = `${new URL(this.baseUrl).origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }
          
          // Create gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber,
            isExtraEdition,
            power: 'executive_legislative',
            sourceText: data.title,
          });
          
          if (gazette) {
            gazettes.push(gazette);
          }
          
        } catch (error) {
          logger.error(`Error processing gazette entry:`, error as Error);
        }
      }
      
    } catch (error) {
      logger.error(`Error extracting gazettes from page:`, error as Error);
    }
    
    return gazettes;
  }
}

