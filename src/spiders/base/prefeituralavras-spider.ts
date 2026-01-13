import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraLavrasConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * PrefeituraLavrasSpider implementation
 * 
 * Crawls Lavras's Diário Oficial from the official website
 * which requires JavaScript rendering to load content.
 * 
 * Site structure:
 * - Base URL: https://sistemas.lavras.mg.gov.br/GRP/
 * - HTML page with JavaScript-rendered content
 * - Diário Oficial listings with PDF links
 * - Requires browser rendering to execute JavaScript and load content
 * 
 * HTML Structure (after JavaScript loads):
 * - Container: HTML content with gazette listings
 * - Links: PDF links to diários oficiais
 * - Dates: Extracted from link text, parent elements, or PDF filenames
 * 
 * The spider:
 * 1. Navigates to diário oficial page
 * 2. Waits for JavaScript to load content
 * 3. Extracts gazettes from the loaded content
 * 4. Filters gazettes to match the requested date range
 */
export class PrefeituraLavrasSpider extends BaseSpider {
  protected lavrasConfig: PrefeituraLavrasConfig;
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
    this.lavrasConfig = spiderConfig.config as PrefeituraLavrasConfig;
    this.browser = browser || null;
    
    if (!this.lavrasConfig.baseUrl) {
      throw new Error(`PrefeituraLavrasSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraLavrasSpider for ${spiderConfig.name}`, {
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
   * Parse date from various formats:
   * - "DD/MM/YYYY"
   * - "DD de Mês de YYYY"
   * - Filename pattern: "DOM-XXXX-DD-MM-YYYY.pdf"
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
      const month = PrefeituraLavrasSpider.MONTH_MAP[monthName.toLowerCase()];
      if (month) {
        return new Date(`${year}-${month}-${day.padStart(2, '0')}`);
      }
    }

    // Try filename pattern: DOM-XXXX-DD-MM-YYYY.pdf
    const filenameMatch = dateText.match(/DOM-\d+-(\d{2})-(\d{2})-(\d{4})/);
    if (filenameMatch) {
      const [, day, month, year] = filenameMatch;
      return new Date(`${year}-${month}-${day}`);
    }

    return null;
  }

  /**
   * Extract edition number from text or filename
   */
  private extractEditionNumber(text: string): string | undefined {
    // Try pattern: "DOM-XXXX-..." where XXXX is edition
    const domMatch = text.match(/DOM-(\d+)/);
    if (domMatch) {
      return domMatch[1];
    }

    // Try pattern: "Edição XXXX" or "Ed. XXXX"
    const edicaoMatch = text.match(/[Ee]di[çc][ãa]o\s*[Nn]?[°º]?\s*(\d+)/);
    if (edicaoMatch) {
      return edicaoMatch[1];
    }

    return undefined;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.lavrasConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error('PrefeituraLavrasSpider requires browser rendering');
    }
    
    return this.crawlWithBrowser();
  }

  /**
   * Browser-based crawling for Lavras diário oficial page
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Navigate to diário oficial page
      logger.debug(`Navigating to: ${this.lavrasConfig.baseUrl}`);
      await page.goto(this.lavrasConfig.baseUrl, { waitUntil: 'networkidle0', timeout: 45000 });
      this.requestCount++;
      
      // Wait for JavaScript to load content
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Log final URL after redirects
      const finalUrl = page.url();
      logger.debug(`Final page URL after navigation: ${finalUrl}`);
      
      // Check for iframes that might contain the diário oficial content
      const iframesInfo = await page.evaluate(() => {
        const iframes = Array.from(document.querySelectorAll('iframe'));
        return iframes.map(iframe => ({
          src: (iframe as HTMLIFrameElement).src,
          id: iframe.id,
          title: iframe.title
        }));
      });

      if (iframesInfo.length > 0) {
        logger.debug(`Found ${iframesInfo.length} iframes on page`, iframesInfo);
        
        // Try to access iframe content for each iframe that might contain diário content
        for (const iframeInfo of iframesInfo) {
          if (iframeInfo.src && (
            iframeInfo.src.includes('diario') || 
            iframeInfo.src.includes('DOM') || 
            iframeInfo.src.includes('pdf') ||
            iframeInfo.src.includes('transparencia')
          )) {
            logger.debug(`Found potentially relevant iframe: ${iframeInfo.src}`);
            try {
              // Try to navigate to iframe src
              await page.goto(iframeInfo.src, { waitUntil: 'networkidle0', timeout: 45000 });
              this.requestCount++;
              await new Promise(resolve => setTimeout(resolve, 3000));
              
              // Extract from iframe page
              const iframeGazettes = await this.extractGazettesFromPage(page);
              if (iframeGazettes.length > 0) {
                logger.debug(`Found ${iframeGazettes.length} gazettes in iframe content`);
                gazettes.push(...iframeGazettes);
              }
              
              // Go back to main page
              await page.goBack({ waitUntil: 'networkidle0', timeout: 30000 });
              await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error) {
              logger.warn(`Could not access iframe ${iframeInfo.src}`, error as Error);
            }
          }
        }
      }
      
      // Wait for content to load - look for common selectors
      try {
        await page.waitForSelector('a, article, .list-item, .gazette, table, iframe', { timeout: 15000 });
      } catch (error) {
        logger.warn('Content selectors not found, continuing anyway', error as Error);
      }

      // Additional wait for dynamic content
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Try to find and click any buttons/links that might load diário content
      // This includes Elementor "Load More" buttons and pagination
      try {
        const clickableElements = await page.evaluate(() => {
          const elements: Array<{ text: string; selector: string; href?: string }> = [];
          
          // Look for Elementor load more buttons
          const loadMoreButtons = document.querySelectorAll('.elementor-button, .load-more, [data-action="load-more"], button[class*="load"]');
          loadMoreButtons.forEach(el => {
            const text = el.textContent?.toLowerCase() || '';
            if (text.includes('ver mais') || text.includes('carregar') || text.includes('mais') || text.includes('load')) {
              elements.push({
                text: el.textContent || '',
                selector: el.tagName.toLowerCase() + (el.className ? '.' + el.className.split(' ').filter(c => c).slice(0, 2).join('.') : '')
              });
            }
          });
          
          // Look for pagination links
          const paginationLinks = document.querySelectorAll('.page-numbers a, .pagination a, .nav-links a, a[class*="page"]');
          paginationLinks.forEach(el => {
            const text = el.textContent?.toLowerCase() || '';
            const href = (el as HTMLAnchorElement).href || '';
            if (text.includes('próxima') || text.includes('proxima') || text.includes('next') || text.match(/^\d+$/)) {
              elements.push({
                text: el.textContent || '',
                selector: el.tagName.toLowerCase() + (el.className ? '.' + el.className.split(' ').filter(c => c).slice(0, 2).join('.') : ''),
                href: href
              });
            }
          });
          
          // Look for any links/buttons related to diário
          const allClickable = document.querySelectorAll('button, a, [onclick], [role="button"]');
          allClickable.forEach(el => {
            const text = el.textContent?.toLowerCase() || '';
            if (text.includes('diário') || text.includes('diario')) {
              elements.push({
                text: el.textContent || '',
                selector: el.tagName.toLowerCase() + (el.className ? '.' + el.className.split(' ').filter(c => c).slice(0, 2).join('.') : '')
              });
            }
          });
          
          return elements;
        });
        
        if (clickableElements.length > 0) {
          logger.debug(`Found ${clickableElements.length} potentially relevant clickable elements`);
          // Try clicking the first few relevant elements
          for (const element of clickableElements.slice(0, 5)) {
            try {
              if (element.href) {
                // If it's a link, navigate directly
                await page.goto(element.href, { waitUntil: 'networkidle0', timeout: 30000 });
                await new Promise(resolve => setTimeout(resolve, 3000));
                logger.debug(`Navigated to: ${element.href}`);
              } else {
                // Otherwise try to click
                await page.click(element.selector);
                await new Promise(resolve => setTimeout(resolve, 3000));
                logger.debug(`Clicked element: ${element.text}`);
              }
            } catch (e) {
              // Ignore click/navigation errors
              logger.debug(`Could not interact with element: ${element.text}`);
            }
          }
        }
      } catch (error) {
        logger.debug('Could not find clickable elements', error as Error);
      }
      
      // Try to trigger any lazy-loaded content by scrolling
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await new Promise(resolve => setTimeout(resolve, 2000));
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Debug: Log page content structure
      const pageInfo = await page.evaluate(() => {
        return {
          title: document.title,
          url: window.location.href,
          allLinks: document.querySelectorAll('a').length,
          pdfLinks: document.querySelectorAll('a[href*=".pdf"]').length,
          iframes: document.querySelectorAll('iframe').length,
          bodyText: document.body.textContent?.substring(0, 500) || '',
          // Check for common WordPress/Elementor classes
          elementorWidgets: document.querySelectorAll('.elementor-widget, .elementor-element').length,
          wpContent: document.querySelectorAll('.wp-content, .entry-content, .post-content').length
        };
      });
      logger.debug('Page structure info', pageInfo);

      // Try to find and follow links to diário pages if no PDFs found directly
      let pageGazettes: Gazette[] = [];
      
      // First, try extracting from current page
      pageGazettes = await this.extractGazettesFromPage(page);
      
      // If no gazettes found, try to find links to diário pages and follow them
      if (pageGazettes.length === 0) {
        logger.debug('No gazettes found on main page, searching for diário page links...');
        const diarioPageLinks = await page.evaluate(() => {
          const links: string[] = [];
          document.querySelectorAll('a[href]').forEach(link => {
            const href = (link as HTMLAnchorElement).href || '';
            const text = (link.textContent || '').toLowerCase();
            // Look for links that might lead to diário pages
            if (href.includes('diario') || 
                href.includes('DOM') || 
                text.includes('diário') || 
                text.includes('diario') ||
                text.includes('ver mais') ||
                text.includes('acessar')) {
              links.push(href);
            }
          });
          return [...new Set(links)];
        });
        
        logger.debug(`Found ${diarioPageLinks.length} potential diário page links`);
        
        // Try following up to 3 links to find diários
        for (const linkUrl of diarioPageLinks.slice(0, 3)) {
          try {
            logger.debug(`Following link to: ${linkUrl}`);
            await page.goto(linkUrl, { waitUntil: 'networkidle0', timeout: 30000 });
            this.requestCount++;
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            const linkGazettes = await this.extractGazettesFromPage(page);
            if (linkGazettes.length > 0) {
              logger.debug(`Found ${linkGazettes.length} gazettes on linked page`);
              pageGazettes.push(...linkGazettes);
            }
            
            // Go back to main page for next iteration
            await page.goBack({ waitUntil: 'networkidle0', timeout: 30000 });
            await new Promise(resolve => setTimeout(resolve, 2000));
          } catch (error) {
            logger.debug(`Error following link ${linkUrl}:`, error as Error);
          }
        }
      }
      
      // Filter by date range
      for (const gazette of pageGazettes) {
        if (gazette && this.isInDateRange(new Date(gazette.date))) {
          gazettes.push(gazette);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
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
      // Extract all PDF links and their associated text with more comprehensive selectors
      const pdfLinks = await page.evaluate(() => {
        const links: Array<{ url: string; text: string; parentText: string; dateText: string }> = [];
        
        // First, try to find iframes that might contain the content
        const iframes = document.querySelectorAll('iframe');
        for (const iframe of Array.from(iframes)) {
          const src = (iframe as HTMLIFrameElement).src;
          if (src && (src.includes('diario') || src.includes('DOM') || src.includes('.pdf'))) {
            // If iframe src is a PDF, add it directly
            if (src.includes('.pdf')) {
              links.push({
                url: src,
                text: 'Diário Oficial',
                parentText: '',
                dateText: ''
              });
            }
          }
        }
        
        // Find all links that point to PDFs or contain diario-related keywords
        // Also check Elementor widgets and WordPress posts
        const selectors = [
          'a[href*=".pdf"]',
          'a[href*="DOM"]',
          'a[href*="diario"]',
          'a[href*="Diario"]',
          'a[href*="DIARIO"]',
          'a[download*=".pdf"]',
          'a[download]',
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
        
        const allLinks = new Set<HTMLAnchorElement>();
        
        // Collect all matching links
        for (const selector of selectors) {
          try {
            const foundLinks = document.querySelectorAll(selector);
            foundLinks.forEach(link => {
              if (link instanceof HTMLAnchorElement) {
                const href = link.href || link.getAttribute('href') || '';
                const text = link.textContent?.toLowerCase() || '';
                const parentText = link.closest('.elementor-post, .post, article, .entry')?.textContent?.toLowerCase() || '';
                
                // Include any link that might be related to diário oficial
                if (href.includes('.pdf') || 
                    href.includes('diario') || 
                    href.includes('DOM') ||
                    href.includes('download') ||
                    text.includes('diário') ||
                    text.includes('diario') ||
                    text.includes('edição') ||
                    text.includes('edicao') ||
                    parentText.includes('diário') ||
                    parentText.includes('diario') ||
                    parentText.includes('edição') ||
                    parentText.includes('edicao')) {
                  allLinks.add(link);
                }
              }
            });
          } catch (e) {
            // Ignore selector errors
          }
        }
        
        // Also check all links in Elementor post widgets
        try {
          const elementorPosts = document.querySelectorAll('.elementor-post, .elementor-widget-post, .elementor-loop-item');
          elementorPosts.forEach(post => {
            const postLinks = post.querySelectorAll('a');
            postLinks.forEach(link => {
              if (link instanceof HTMLAnchorElement) {
                const href = link.href || link.getAttribute('href') || '';
                const postText = post.textContent?.toLowerCase() || '';
                // If the post contains diário-related text, include all its links
                if (postText.includes('diário') || postText.includes('diario') || postText.includes('edição') || postText.includes('edicao')) {
                  allLinks.add(link);
                }
              }
            });
          });
        } catch (e) {
          // Ignore errors
        }
        
        for (const link of allLinks) {
          const href = link.href;
          const text = link.textContent?.trim() || '';
          
          // Get parent context (try multiple levels up)
          let parentElement: HTMLElement | null = link.parentElement;
          let parentText = '';
          let dateText = '';
          
          // Look for date in parent elements (up to 3 levels)
          for (let i = 0; i < 3 && parentElement; i++) {
            const parentTextContent = parentElement.textContent?.trim() || '';
            if (parentTextContent) {
              parentText = parentTextContent;
              
              // Try to find date patterns in parent text
              if (!dateText) {
                const dateMatch = parentTextContent.match(/(\d{2}\/\d{2}\/\d{4})|(\d{2}\s+de\s+\w+\s+de\s+\d{4})/i);
                if (dateMatch) {
                  dateText = dateMatch[0];
                }
              }
            }
            parentElement = parentElement.parentElement;
          }
          
          // Also check for date in nearby elements (siblings, previous/next)
          if (!dateText) {
            const siblings = Array.from(link.parentElement?.children || []);
            for (const sibling of siblings) {
              const siblingText = sibling.textContent?.trim() || '';
              const dateMatch = siblingText.match(/(\d{2}\/\d{2}\/\d{4})|(\d{2}\s+de\s+\w+\s+de\s+\d{4})/i);
              if (dateMatch) {
                dateText = dateMatch[0];
                break;
              }
            }
          }
          
          if (href && (href.includes('.pdf') || href.includes('DOM') || href.includes('diario') || href.includes('Diario'))) {
            links.push({
              url: href,
              text,
              parentText: parentText || text,
              dateText: dateText || text || parentText
            });
          }
        }
        
        return links;
      });

      logger.debug(`Found ${pdfLinks.length} potential PDF links`);
      
      // Debug: Log all links found (even non-PDF) for troubleshooting
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
        
        // Also check for any content sections that might contain diário information
        const pageContent = await page.evaluate(() => {
          const sections = [];
          // Check for Elementor sections
          const elementorSections = document.querySelectorAll('.elementor-section, .elementor-widget, .elementor-post');
          elementorSections.forEach(section => {
            const text = section.textContent?.toLowerCase() || '';
            if (text.includes('diário') || text.includes('diario') || text.includes('edição') || text.includes('edicao')) {
              sections.push({
                type: 'elementor',
                text: text.substring(0, 200),
                html: section.innerHTML?.substring(0, 500) || ''
              });
            }
          });
          // Check for WordPress content areas
          const wpContent = document.querySelectorAll('.entry-content, .post-content, .content, article');
          wpContent.forEach(content => {
            const text = content.textContent?.toLowerCase() || '';
            if (text.includes('diário') || text.includes('diario') || text.includes('edição') || text.includes('edicao')) {
              sections.push({
                type: 'wp-content',
                text: text.substring(0, 200),
                html: content.innerHTML?.substring(0, 500) || ''
              });
            }
          });
          return sections;
        });
        
        if (pageContent.length > 0) {
          logger.debug(`Found ${pageContent.length} content sections mentioning diário`, pageContent.slice(0, 3));
        }
      }

      for (const linkData of pdfLinks) {
        try {
          // Make URL absolute if needed
          let pdfUrl = linkData.url;
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.lavrasConfig.baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }

          // Skip if already processed
          if (processedUrls.has(pdfUrl)) {
            continue;
          }

          // Try to extract date from dateText, link text, parent text, or URL
          const dateSource = linkData.dateText || linkData.parentText || linkData.text || pdfUrl;
          const gazetteDate = this.parseDate(dateSource);

          if (!gazetteDate || isNaN(gazetteDate.getTime())) {
            logger.debug(`Could not parse date from: ${dateSource}`);
            continue;
          }

          // Extract edition number
          const editionNumber = this.extractEditionNumber(dateSource);

          // Mark URL as processed
          processedUrls.add(pdfUrl);

          // Create the gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber,
            power: 'executive',
            sourceText: linkData.text || linkData.parentText,
          });

          if (gazette) {
            gazettes.push(gazette);
            logger.debug(`Added gazette: ${linkData.text} - ${toISODate(gazetteDate)}`);
          }

        } catch (error) {
          logger.error(`Error processing PDF link:`, error as Error);
        }
      }

    } catch (error) {
      logger.error(`Error extracting gazettes from page:`, error as Error);
    }

    return gazettes;
  }
}

