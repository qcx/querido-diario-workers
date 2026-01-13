import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraNovaLimaConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * PrefeituraNovaLimaSpider implementation
 * 
 * Crawls Nova Lima's Diário Oficial website which requires browser rendering
 * to interact with the search form and extract gazettes.
 * 
 * Site structure:
 * - Base URL: https://novalima.mg.gov.br/empresas/publicacoes-oficiais
 * - Page has a search form with filters for:
 *   - Tipo de publicação (Type of publication)
 *   - Ano (Year) - dropdown with years from 1987 to 2026
 *   - Mês (Month) - dropdown with months
 * - Requires browser rendering to fill form and submit search
 * - Results are displayed dynamically after form submission
 * 
 * The spider:
 * 1. Navigates directly to the publicações oficiais page
 * 2. Waits for page to load
 * 3. Fills the search form with date range filters
 * 4. Submits the search form
 * 5. Extracts PDF links from the results
 * 6. Filters gazettes to match the requested date range
 */
export class PrefeituraNovaLimaSpider extends BaseSpider {
  protected novalimaConfig: PrefeituraNovaLimaConfig;
  private browser: Fetcher | null = null;

  // Month name mapping for Brazilian Portuguese
  private static readonly MONTH_MAP: { [key: string]: string } = {
    'janeiro': '01',
    'fevereiro': '02',
    'março': '03',
    'abril': '04',
    'maio': '05',
    'junho': '06',
    'julho': '07',
    'agosto': '08',
    'setembro': '09',
    'outubro': '10',
    'novembro': '11',
    'dezembro': '12',
  };

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.novalimaConfig = spiderConfig.config as PrefeituraNovaLimaConfig;
    this.browser = browser || null;
    
    if (!this.novalimaConfig.baseUrl) {
      throw new Error(`PrefeituraNovaLimaSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraNovaLimaSpider for ${spiderConfig.name}`, {
      hasBrowser: !!this.browser,
    });
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  /**
   * Parse date from various formats
   */
  private parseDate(dateText: string): Date | null {
    // Try DD/MM/YYYY format
    const slashMatch = dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (slashMatch) {
      const [, day, month, year] = slashMatch;
      return new Date(`${year}-${month}-${day}`);
    }

    // Try "DD de Mês de YYYY" format
    const monthMatch = dateText.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
    if (monthMatch) {
      const [, day, monthName, year] = monthMatch;
      const month = PrefeituraNovaLimaSpider.MONTH_MAP[monthName.toLowerCase()];
      if (month) {
        return new Date(`${year}-${month}-${day.padStart(2, '0')}`);
      }
    }

    // Try YYYY-MM-DD format
    const dashMatch = dateText.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (dashMatch) {
      const [, year, month, day] = dashMatch;
      return new Date(`${year}-${month}-${day}`);
    }

    return null;
  }

  /**
   * Extract edition number from text
   */
  private extractEditionNumber(text: string): string | undefined {
    const edicaoMatch = text.match(/[Ee]di[çc][ãa]o\s*[Nn]?[°º]?\s*(\d+)/);
    if (edicaoMatch) {
      return edicaoMatch[1];
    }

    const numeroMatch = text.match(/[Nn][°º]?\s*(\d+)/);
    if (numeroMatch) {
      return numeroMatch[1];
    }

    return undefined;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.novalimaConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error('PrefeituraNovaLimaSpider requires browser rendering');
    }
    
    return this.crawlWithBrowser();
  }

  /**
   * Browser-based crawling for Nova Lima site
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Navigate to base URL with retry logic and multiple strategies
      logger.debug(`Navigating to: ${this.novalimaConfig.baseUrl}`);
      let navigationSuccess = false;
      
      // Strategy 1: Try with domcontentloaded (faster, less strict)
      try {
        await page.goto(this.novalimaConfig.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        navigationSuccess = true;
        logger.debug('Navigation successful with domcontentloaded');
      } catch (error) {
        logger.debug('Navigation with domcontentloaded failed, trying networkidle0', error as Error);
      }
      
      // Strategy 2: If domcontentloaded fails, try networkidle0 with longer timeout
      if (!navigationSuccess) {
        try {
          await page.goto(this.novalimaConfig.baseUrl, { waitUntil: 'networkidle0', timeout: 60000 });
          navigationSuccess = true;
          logger.debug('Navigation successful with networkidle0');
        } catch (error) {
          logger.warn('Navigation with networkidle0 also failed, trying load', error as Error);
        }
      }
      
      // Strategy 3: If both fail, try with just 'load' event
      if (!navigationSuccess) {
        try {
          await page.goto(this.novalimaConfig.baseUrl, { waitUntil: 'load', timeout: 60000 });
          navigationSuccess = true;
          logger.debug('Navigation successful with load');
        } catch (error) {
          // Even if navigation fails, try to continue with whatever page we have
          logger.warn('Navigation failed, but continuing with current page state', error as Error);
          // Wait a bit for any partial content to load
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
      
      if (navigationSuccess) {
      this.requestCount++;
      }
      
      // Wait for page to load
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Wait for the search form to be available
      try {
        await page.waitForSelector('select, input[type="text"], button[type="submit"], button', { timeout: 15000 });
        logger.debug('Search form found');
      } catch (error) {
        logger.warn('Search form not found, continuing anyway', error as Error);
      }

      // Additional wait for dynamic content
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Fill and submit the search form with date range
      // We'll search for the start month/year first, then extract all visible results
      try {
        const startDate = new Date(this.dateRange.start);
        const startYear = startDate.getFullYear();
        const startMonth = startDate.getMonth() + 1; // JavaScript months are 0-indexed
        
        const formFilled = await page.evaluate((year, month) => {
          // Map month number to Portuguese month name
          const monthNames = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 
                            'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
          const monthName = monthNames[month];
          
          // Find all select elements
          const selects = Array.from(document.querySelectorAll('select'));
          
          // Find year select (look for one with year options)
          let yearSelect: HTMLSelectElement | null = null;
          for (const select of selects) {
            const options = Array.from(select.options);
            const hasYearOption = options.some(opt => {
              const text = opt.textContent?.trim();
              return text === String(year) || text === String(year - 1) || text === String(year + 1);
            });
            if (hasYearOption) {
              yearSelect = select as HTMLSelectElement;
              break;
            }
          }
          
          // Find month select (look for one with month options)
          let monthSelect: HTMLSelectElement | null = null;
          for (const select of selects) {
            if (select === yearSelect) continue;
            const options = Array.from(select.options);
            const hasMonthOption = options.some(opt => {
              const text = opt.textContent?.trim().toLowerCase();
              return text === monthName.toLowerCase() || text.includes('janeiro') || text.includes('fevereiro');
            });
            if (hasMonthOption) {
              monthSelect = select as HTMLSelectElement;
              break;
            }
          }
          
          // Fill year
          if (yearSelect) {
            const yearOption = Array.from(yearSelect.options).find(opt => opt.textContent?.trim() === String(year));
            if (yearOption) {
              yearSelect.value = yearOption.value;
              yearSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
          
          // Fill month
          if (monthSelect) {
            const monthOption = Array.from(monthSelect.options).find(opt => 
              opt.textContent?.trim().toLowerCase() === monthName.toLowerCase()
            );
            if (monthOption) {
              monthSelect.value = monthOption.value;
              monthSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
          
          return { yearFilled: !!yearSelect, monthFilled: !!monthSelect };
        }, startYear, startMonth);
        
        logger.debug(`Form fill for ${startYear}/${startMonth}:`, formFilled);
        
        // Wait for form changes
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Find and click search button
        const searchButton = await page.evaluateHandle(() => {
          const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], a, [type="button"]'));
          return buttons.find(btn => {
            const text = (btn.textContent || '').toLowerCase().trim();
            const value = ((btn as HTMLInputElement).value || '').toLowerCase();
            return text === 'buscar' || text.includes('buscar') || 
                   value === 'buscar' || value.includes('buscar');
          });
        });
        
        if (searchButton && searchButton.asElement()) {
          logger.debug('Clicking search button');
          await (searchButton.asElement() as any).click();
          await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for results to load
        } else {
          logger.warn('Search button not found, trying to submit form directly');
          // Try to submit form directly
          await page.evaluate(() => {
            const forms = document.querySelectorAll('form');
            if (forms.length > 0) {
              (forms[0] as HTMLFormElement).submit();
            }
          });
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      } catch (error) {
        logger.warn('Could not fill or submit search form, trying to extract from page as-is', error as Error);
      }
      
      // Scroll to trigger lazy loading
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await new Promise(resolve => setTimeout(resolve, 2000));
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Wait for content to load
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Extract gazettes from the page, handling pagination if needed
      let currentPage = 1;
      const maxPages = 10; // Safety limit
      let hasMorePages = true;

      while (hasMorePages && currentPage <= maxPages) {
        logger.debug(`Extracting gazettes from page ${currentPage}`);
        
      const pageGazettes = await this.extractGazettesFromPage(page);
      
        // Filter by date range and add to results
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

        // Try to find and click next page button
        try {
          const nextPageInfo = await page.evaluate(() => {
            // Look for common pagination patterns
            const nextButtons = Array.from(document.querySelectorAll('a, button')).filter(btn => {
              const text = btn.textContent?.toLowerCase() || '';
              const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
              return text.includes('próximo') || text.includes('proximo') || 
                     text.includes('next') || text === '»' || text === '>' ||
                     ariaLabel.includes('próximo') || ariaLabel.includes('next');
            });

            const pageLinks = Array.from(document.querySelectorAll('a')).filter(link => {
              const text = link.textContent?.trim();
              return text === '»' || text === '>' || text?.toLowerCase().includes('próximo');
            });

            return {
              hasNext: nextButtons.length > 0 || pageLinks.length > 0,
              nextButtonText: nextButtons[0]?.textContent?.trim() || pageLinks[0]?.textContent?.trim() || ''
            };
          });

          if (nextPageInfo.hasNext) {
            logger.debug(`Found next page button: ${nextPageInfo.nextButtonText}`);
            const nextButton = await page.evaluateHandle(() => {
              const buttons = Array.from(document.querySelectorAll('a, button'));
              return buttons.find(btn => {
                const text = btn.textContent?.toLowerCase() || '';
                const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
                return text.includes('próximo') || text.includes('proximo') || 
                       text.includes('next') || text === '»' || text === '>' ||
                       ariaLabel.includes('próximo') || ariaLabel.includes('next');
              });
            });

            if (nextButton && nextButton.asElement()) {
              await (nextButton.asElement() as any).click();
              await new Promise(resolve => setTimeout(resolve, 3000));
              currentPage++;
            } else {
              hasMorePages = false;
            }
          } else {
            hasMorePages = false;
          }
        } catch (error) {
          logger.debug('Could not find next page button, stopping pagination', error as Error);
          hasMorePages = false;
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name} across ${currentPage} page(s)`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
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
   * Extract gazettes from the current page
   */
  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const processedUrls = new Set<string>();

    try {
      // First, try to get page HTML for debugging
      const pageUrl = page.url();
      logger.debug(`Extracting gazettes from page: ${pageUrl}`);

      // Extract all PDF links and their associated text with multiple strategies
      const pdfLinks = await page.evaluate(() => {
        const links: Array<{ url: string; text: string; parentText: string; surroundingText: string }> = [];
        const allLinks = new Set<HTMLAnchorElement>();
        
        // Strategy 1: Find all links that point to PDFs
        const pdfLinks = document.querySelectorAll('a[href$=".pdf"], a[href*=".pdf?"], a[href*=".pdf#"]');
        for (const link of Array.from(pdfLinks)) {
          if (link instanceof HTMLAnchorElement) {
            allLinks.add(link);
          }
        }
        
        // Strategy 2: Find links with diário oficial keywords in href or text
        const diarioLinks = document.querySelectorAll('a[href*="diario"], a[href*="DOM"], a[href*="publicacao"], a[href*="jornal"], a[href*="Diario"], a[href*="DIARIO"]');
        for (const link of Array.from(diarioLinks)) {
          if (link instanceof HTMLAnchorElement) {
            const text = link.textContent?.toLowerCase() || '';
            const href = link.href || '';
            if (href.includes('.pdf') || text.includes('diário') || text.includes('diario') || text.includes('oficial')) {
              allLinks.add(link);
            }
          }
        }
        
        // Strategy 3: Look for Elementor widgets and WordPress posts
        const selectors = [
          'article a',
          '.list-item a',
          '.gazette a',
          'table a',
          'tbody a',
          'tr a',
          '.entry-content a',
          '.post-content a',
          '.content a',
          // Elementor specific selectors
          '.elementor-post a',
          '.elementor-post__title a',
          '.elementor-post__excerpt a',
          '.elementor-widget-post a',
          '.elementor-loop-item a',
          '.elementor-posts-container a',
          '.elementor-post__card a',
          // WordPress post selectors
          '.post a',
          '.wp-block-post a',
          '.entry-title a',
          'h2 a',
          'h3 a',
          'h4 a'
        ];
        
        for (const selector of selectors) {
          try {
            const foundLinks = document.querySelectorAll(selector);
            foundLinks.forEach(link => {
              if (link instanceof HTMLAnchorElement) {
                const href = link.href || '';
                const text = link.textContent?.toLowerCase() || '';
                if (href.includes('.pdf') || href.includes('diario') || href.includes('DOM') || 
                    text.includes('diário') || text.includes('diario') || text.includes('edição')) {
                  allLinks.add(link);
                }
              }
            });
          } catch (e) {
            // Ignore selector errors
          }
        }
        
        // Strategy 4: Check all links in Elementor post widgets
        try {
          const elementorPosts = document.querySelectorAll('.elementor-post, .elementor-widget-post, .elementor-loop-item');
          elementorPosts.forEach(post => {
            const postLinks = post.querySelectorAll('a');
            postLinks.forEach(link => {
              if (link instanceof HTMLAnchorElement) {
                const postText = post.textContent?.toLowerCase() || '';
                if (postText.includes('diário') || postText.includes('diario') || postText.includes('edição')) {
                  allLinks.add(link);
                }
              }
            });
          });
        } catch (e) {
          // Ignore errors
        }
        
        // Strategy 5: Look for iframes that might contain PDFs
        const iframes = document.querySelectorAll('iframe');
        for (const iframe of Array.from(iframes)) {
          const src = (iframe as HTMLIFrameElement).src;
          if (src && src.includes('.pdf')) {
            // Create a pseudo-link object for iframe PDFs
            const pseudoLink = document.createElement('a');
            pseudoLink.href = src;
            allLinks.add(pseudoLink);
          }
        }
        
        // Process all collected links
        for (const link of allLinks) {
          const href = link.href || '';
          const text = link.textContent?.trim() || '';
          
          // Get parent context (try multiple levels up)
          let parentElement: HTMLElement | null = link.parentElement;
          let parentText = '';
          let surroundingText = '';
          
          // Look for context in parent elements (up to 3 levels)
          for (let i = 0; i < 3 && parentElement; i++) {
            const parentTextContent = parentElement.textContent?.trim() || '';
            if (parentTextContent) {
              parentText = parentTextContent;
              if (!surroundingText) {
                surroundingText = parentTextContent;
              }
            }
            parentElement = parentElement.parentElement;
          }
          
          // Also check closest container
          const container = link.closest('.elementor-post, .post, article, .entry, div, li, tr, td');
          if (container) {
            const containerText = container.textContent?.trim() || '';
            if (containerText && !surroundingText) {
              surroundingText = containerText;
            }
          }
          
          if (href) {
            links.push({
              url: href,
              text,
              parentText: parentText || text,
              surroundingText: surroundingText || parentText || text
            });
          }
        }
        
        // Remove duplicates based on URL
        const uniqueLinks = new Map<string, typeof links[0]>();
        for (const link of links) {
          if (!uniqueLinks.has(link.url)) {
            uniqueLinks.set(link.url, link);
          }
        }
        
        return Array.from(uniqueLinks.values());
      });

      logger.info(`Found ${pdfLinks.length} potential PDF/diário links on page`);

      // Debug: Log page content structure
      const pageInfo = await page.evaluate(() => {
        return {
          title: document.title,
          url: window.location.href,
          allLinks: document.querySelectorAll('a').length,
          pdfLinks: document.querySelectorAll('a[href*=".pdf"]').length,
          iframes: document.querySelectorAll('iframe').length,
          bodyText: document.body?.textContent?.substring(0, 500) || '',
          // Check for common WordPress/Elementor classes
          elementorWidgets: document.querySelectorAll('.elementor-widget, .elementor-element').length,
          wpContent: document.querySelectorAll('.wp-content, .entry-content, .post-content').length
        };
      });
      logger.debug('Page structure info', pageInfo);

      // If no links found, log more details for debugging
      if (pdfLinks.length === 0) {
        const allPageLinks = await page.evaluate(() => {
          const links: Array<{ url: string; text: string }> = [];
          document.querySelectorAll('a[href]').forEach(link => {
            const href = (link as HTMLAnchorElement).href || '';
            const text = link.textContent?.trim() || '';
            if (href && (href.includes('diario') || text.toLowerCase().includes('diário') || text.toLowerCase().includes('diario'))) {
              links.push({
                url: href.substring(0, 200),
                text: text.substring(0, 100)
              });
            }
          });
          return links;
        });
        logger.debug(`Found ${allPageLinks.length} links related to diário (non-PDF)`, allPageLinks.slice(0, 10));
      }

      for (const linkData of pdfLinks) {
        try {
          // Make URL absolute if needed
          let pdfUrl = linkData.url;
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.novalimaConfig.baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }

          // Skip if already processed
          if (processedUrls.has(pdfUrl)) {
            continue;
          }

          // Try to extract date from multiple sources
          const dateSources = [
            linkData.surroundingText,
            linkData.parentText,
            linkData.text,
            pdfUrl
          ];

          let gazetteDate: Date | null = null;
          let dateSourceUsed = '';

          for (const dateSource of dateSources) {
            const parsedDate = this.parseDate(dateSource);
            if (parsedDate && !isNaN(parsedDate.getTime())) {
              gazetteDate = parsedDate;
              dateSourceUsed = dateSource;
              break;
            }
          }

          // If we still don't have a date, try to get it from PDF headers
          if (!gazetteDate) {
            try {
              // Use fetch from the global scope (not inside page.evaluate)
              const response = await fetch(pdfUrl, { method: 'HEAD' });
              const lastModified = response.headers.get('last-modified');
              if (lastModified) {
                gazetteDate = new Date(lastModified);
                dateSourceUsed = 'PDF Last-Modified header';
                logger.debug(`Using Last-Modified header for date: ${toISODate(gazetteDate)}`);
              }
            } catch (e) {
              // Ignore errors when fetching headers
              logger.debug(`Could not fetch headers for ${pdfUrl}: ${e instanceof Error ? e.message : String(e)}`);
            }
          }

          // If we still don't have a date, skip this link but log it
          if (!gazetteDate || isNaN(gazetteDate.getTime())) {
            logger.debug(`Could not parse date from any source for: ${pdfUrl}. Sources tried: ${dateSources.join(', ')}`);
            continue;
          }

          // Extract edition number
          const editionNumber = this.extractEditionNumber(linkData.surroundingText || linkData.parentText || linkData.text || pdfUrl);

          // Mark URL as processed
          processedUrls.add(pdfUrl);

          logger.debug(`Processing gazette: ${linkData.text || pdfUrl} - Date: ${toISODate(gazetteDate)} (from: ${dateSourceUsed.substring(0, 50)})`);

          // Create the gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber,
            power: 'executive',
            sourceText: linkData.text || linkData.parentText,
          });

          if (gazette) {
            gazettes.push(gazette);
            logger.info(`Added gazette: ${linkData.text || pdfUrl} - ${toISODate(gazetteDate)}`);
          } else {
            logger.warn(`Failed to create gazette for: ${pdfUrl}`);
          }

        } catch (error) {
          logger.error(`Error processing PDF link ${linkData.url}:`, error as Error);
        }
      }

    } catch (error) {
      logger.error(`Error extracting gazettes from page:`, error as Error);
    }

    logger.info(`Extracted ${gazettes.length} gazettes from page`);
    return gazettes;
  }
}

