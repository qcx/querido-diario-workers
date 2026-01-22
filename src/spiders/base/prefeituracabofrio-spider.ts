import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraCaboFrioConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Spider for Prefeitura de Cabo Frio official gazette
 * 
 * Site Structure:
 * - URL: https://transparencia.cabofrio.rj.gov.br/diariooficial.php
 * - List of gazettes with "Visualizar edição" links
 * - Each item has date and edition information
 * - Requires browser rendering for JavaScript-rendered content
 */
export class PrefeituraCaboFrioSpider extends BaseSpider {
  private _baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraCaboFrioConfig;
    this._baseUrl = platformConfig.baseUrl || 'https://transparencia.cabofrio.rj.gov.br/diariooficial.php';
    this.browser = browser || null;
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(`PrefeituraCaboFrioSpider for ${this.config.name} requires browser binding`);
      return [];
    }

    logger.info(`Crawling Prefeitura Cabo Frio for ${this.config.name}... (${this._baseUrl})`);
    return this.crawlWithBrowser();
  }

  /**
   * Browser-based crawling to extract gazettes from the list
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Capture console messages for debugging
      page.on('console', (msg) => {
        const type = msg.type();
        if (type === 'error' || type === 'warning') {
          logger.debug(`Browser console ${type}: ${msg.text()}`);
        }
      });
      
      // Navigate to the page
      logger.debug(`Navigating to ${this._baseUrl}`);
      await page.goto(this._baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Wait for content to load
      await page.waitForSelector('a', { timeout: 10000 }).catch(() => {
        logger.warn('Links not found immediately, continuing...');
      });
      
      let currentPage = 1;
      const maxPages = 100; // Safety limit
      let hasMorePages = true;
      const processedUrls = new Set<string>(); // Track processed URLs to avoid duplicates
      let previousPageContent = ''; // Track page content to detect if pagination is stuck
      
      while (hasMorePages && currentPage <= maxPages) {
        logger.debug(`Extracting gazettes from page ${currentPage}`);
        
        // Wait for gazette list to load
        try {
          await page.waitForSelector('a, [role="link"]', { timeout: 10000 });
        } catch (error) {
          logger.warn('Gazette list not found, may be empty');
          break;
        }
        
        // Get current page content hash to detect if page changed
        const currentPageContent = await page.evaluate(() => {
          // Get a hash of visible gazette links to detect if page changed
          const links = Array.from(document.querySelectorAll('a[href*="diariooficial.php?id="]'));
          return links.map(link => link.getAttribute('href')).sort().join('|');
        });
        
        // Check if page content is the same as previous page (pagination stuck)
        if (currentPageContent === previousPageContent && currentPage > 1) {
          logger.debug('Page content unchanged, pagination may be stuck. Stopping.');
          break;
        }
        previousPageContent = currentPageContent;
        
        // Extract gazettes from current page
        const pageGazettes = await this.extractGazettesFromPage(page);
        
        // Filter by date range, deduplicate, and check if we should continue
        let foundOlderThanRange = false;
        let newGazettesCount = 0;
        for (const gazette of pageGazettes) {
          if (gazette) {
            // Deduplicate by URL
            if (processedUrls.has(gazette.url)) {
              continue;
            }
            processedUrls.add(gazette.url);
            
            const gazetteDate = new Date(gazette.date);
            if (this.isInDateRange(gazetteDate)) {
              gazettes.push(gazette);
              newGazettesCount++;
            } else if (gazetteDate < new Date(this.dateRange.start)) {
              foundOlderThanRange = true;
            }
          }
        }
        
        logger.debug(`Found ${pageGazettes.length} gazettes on page ${currentPage}, ${newGazettesCount} new, ${gazettes.length} total in date range`);
        
        // Stop if we found gazettes older than our date range
        if (foundOlderThanRange) {
          logger.debug('Found gazettes older than date range, stopping pagination');
          break;
        }
        
        // Stop if no new gazettes found (all were duplicates)
        if (newGazettesCount === 0 && currentPage > 1) {
          logger.debug('No new gazettes found, stopping pagination');
          break;
        }
        
        // Check for pagination - look for "next" button or page links
        const paginationInfo = await page.evaluate(() => {
          const allElements = Array.from(document.querySelectorAll('a, button, [role="link"]'));
          const nextElements = allElements.filter(el => {
            const text = (el.textContent || '').toLowerCase().trim();
            const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';
            const isDisabled = el.classList.contains('disabled') || 
                             el.getAttribute('aria-disabled') === 'true' ||
                             el.hasAttribute('disabled');
            return (text.includes('avançar') || text.includes('próximo') || text.includes('next') ||
                   ariaLabel.includes('próximo') || ariaLabel.includes('next')) && !isDisabled;
          });
          
          return {
            hasNext: nextElements.length > 0,
            nextElement: nextElements.length > 0 ? {
              tagName: nextElements[0].tagName,
              text: nextElements[0].textContent?.trim() || '',
              href: nextElements[0].getAttribute('href') || ''
            } : null
          };
        });
        
        if (paginationInfo.hasNext && paginationInfo.nextElement) {
          try {
            // Get current URL before clicking
            const urlBefore = page.url();
            
            // Find the element again and click it
            const nextElement = await page.evaluateHandle((text, href) => {
              const allElements = Array.from(document.querySelectorAll('a, button, [role="link"]'));
              return allElements.find(el => {
                const elText = (el.textContent || '').toLowerCase().trim();
                const elHref = el.getAttribute('href') || '';
                return (elText.includes('avançar') || elText.includes('próximo') || elText.includes('next') ||
                       elHref === href) && 
                       !el.classList.contains('disabled') &&
                       el.getAttribute('aria-disabled') !== 'true';
              });
            }, paginationInfo.nextElement.text, paginationInfo.nextElement.href);
            
            if (nextElement) {
              logger.debug(`Clicking next page button`);
              await (nextElement as any).click();
              await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for page to load
              
              // Check if URL actually changed
              const urlAfter = page.url();
              if (urlBefore === urlAfter) {
                logger.debug('URL did not change after clicking next, stopping pagination');
                hasMorePages = false;
              } else {
                currentPage++;
              }
            } else {
              hasMorePages = false;
            }
          } catch (error) {
            logger.debug(`Could not click next page button: ${error}`);
            hasMorePages = false;
          }
        } else {
          hasMorePages = false;
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`);
    } catch (error) {
      logger.error(`Error crawling ${this.config.name}:`, error as Error);
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (error) {
          logger.warn(`Error closing page: ${error}`);
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (error) {
          logger.warn(`Error closing browser: ${error}`);
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
    
    try {
      const gazetteData = await page.evaluate(() => {
        const data: any[] = [];
        
        // Find all "Visualizar edição" links
        const allLinks = Array.from(document.querySelectorAll('a'));
        const visualizarLinks: Array<{ link: Element; parent: Element | null; text: string }> = [];
        
        for (const link of allLinks) {
          const linkText = (link.textContent || '').toLowerCase().trim();
          const href = link.getAttribute('href') || link.href || '';
          
          // Look for "Visualizar edição" or similar patterns
          if (linkText.includes('visualizar') && (linkText.includes('edição') || linkText.includes('edicao') || linkText.includes('edi'))) {
            // Find parent container that might have date/edition info
            let parent: Element | null = link.parentElement;
            let depth = 0;
            while (parent && depth < 10) {
              const parentText = parent.textContent || '';
              // Check if parent has date pattern
              if (/\d{2}\/\d{2}\/\d{4}/.test(parentText)) {
                visualizarLinks.push({ link, parent, text: parentText });
                break;
              }
              parent = parent.parentElement;
              depth++;
            }
            
            // If no parent with date found, still add the link
            if (depth >= 10) {
              visualizarLinks.push({ link, parent: link.parentElement, text: linkText });
            }
          }
        }
        
        // Process each visualizar link
        for (const { link, parent, text } of visualizarLinks) {
          // Extract date (format: DD/MM/YYYY)
          const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) {
            continue;
          }
          
          // Extract edition number
          const editionMatch = text.match(/[Nn][°º]?\s*(\d+)/) || text.match(/[Ee]di[çc][ãa]o\s*[Nn]?[°º]?\s*(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;
          
          // Check if it's an extra edition
          const isExtra = /\b(vol|suplemento|extra)\d*\b/i.test(text);
          
          // Get the PDF URL - the "Visualizar edição" link might point to a page, not directly to PDF
          // First, check if there's a direct PDF link in the same container
          let pdfUrl = '';
          
          if (parent) {
            // Look for direct PDF links first
            const pdfLinks = parent.querySelectorAll('a[href$=".pdf"], a[href*=".pdf"]');
            if (pdfLinks.length > 0) {
              pdfUrl = pdfLinks[0].getAttribute('href') || pdfLinks[0].href || '';
            }
          }
          
          // If no direct PDF link found, use the "Visualizar edição" link
          // It might point to a page that shows the PDF, which we'll handle later
          if (!pdfUrl) {
            pdfUrl = link.getAttribute('href') || link.href || '';
          }
          
          // Make URL absolute if needed
          if (pdfUrl && !pdfUrl.startsWith('http')) {
            const baseUrl = window.location.origin;
            pdfUrl = pdfUrl.startsWith('/') 
              ? `${baseUrl}${pdfUrl}`
              : `${baseUrl}/${pdfUrl}`;
          }
          
          if (!pdfUrl) {
            continue;
          }
          
          data.push({
            date: dateMatch[0],
            editionNumber,
            pdfUrl,
            isExtra,
          });
        }
        
        return data;
      });
      
      // Process extracted data
      for (const data of gazetteData) {
        try {
          // Parse date
          const [day, month, year] = data.date.split('/');
          const gazetteDate = new Date(`${year}-${month}-${day}`);
          
          if (isNaN(gazetteDate.getTime())) {
            logger.warn(`Invalid date: ${data.date}`);
            continue;
          }
          
          // Filter by date range
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }
          
          // If the URL doesn't point to a PDF directly, follow it to find the PDF
          let finalPdfUrl = data.pdfUrl;
          
          // If the URL is a detail page (diariooficial.php?id=XXX), follow it to get the PDF
          if (!finalPdfUrl.toLowerCase().includes('.pdf') && finalPdfUrl.includes('diariooficial.php?id=')) {
            try {
              const pdfUrl = await this.findPdfUrlInDetailPage(page, finalPdfUrl);
              if (pdfUrl) {
                finalPdfUrl = pdfUrl;
                logger.debug(`Found PDF URL from detail page: ${finalPdfUrl}`);
              } else {
                logger.warn(`Could not find PDF URL in detail page: ${data.pdfUrl}`);
              }
            } catch (error) {
              logger.debug(`Error finding PDF URL in detail page ${data.pdfUrl}: ${error}`);
              // Continue with the original URL - the system will handle it
            }
          }
          
          // Create gazette
          const gazette = await this.createGazette(gazetteDate, finalPdfUrl, {
            power: 'executive_legislative',
            editionNumber: data.editionNumber,
            isExtraEdition: data.isExtra,
          });
          
          if (gazette) {
            gazettes.push(gazette);
            logger.info(`Found gazette for ${toISODate(gazetteDate)} (edição ${data.editionNumber || 'N/A'}): ${finalPdfUrl}`);
          } else {
            logger.warn(`Failed to create gazette for ${toISODate(gazetteDate)} with URL: ${finalPdfUrl}`);
          }
        } catch (error) {
          logger.error(`Error processing extracted data:`, error as Error);
        }
      }
    } catch (error) {
      logger.error(`Error extracting gazettes from page:`, error as Error);
    }
    
    return gazettes;
  }

  /**
   * Follow a detail page URL to find the actual PDF link
   */
  private async findPdfUrlInDetailPage(page: any, detailUrl: string): Promise<string | null> {
    try {
      // Save current URL
      const currentUrl = page.url();
      
      // Navigate to the detail page
      await page.goto(detailUrl, { waitUntil: 'networkidle0', timeout: 10000 });
      this.requestCount++;
      
      // Wait for the page to load
      await page.waitForSelector('a, button', { timeout: 5000 }).catch(() => {
        // Continue even if selector not found
      });
      
      // Look for the "Clique aqui para visualizar o documento" link or PDF links
      const pdfUrl = await page.evaluate(() => {
        // Look for link with text "visualizar o documento" or "visualizar documento"
        const allLinks = Array.from(document.querySelectorAll('a, button'));
        
        for (const link of allLinks) {
          const linkText = (link.textContent || '').toLowerCase().trim();
          let href = link.getAttribute('href') || (link as any).href || '';
          
          // Check for "visualizar o documento" or "visualizar documento"
          if (linkText.includes('visualizar') && linkText.includes('documento')) {
            // Get the href - it might be in onclick, data attributes, or href
            if (!href) {
              // Check onclick
              const onclick = link.getAttribute('onclick') || '';
              const onclickMatch = onclick.match(/['"]([^'"]+)['"]/);
              if (onclickMatch) {
                href = onclickMatch[1];
              }
              
              // Check data attributes
              if (!href) {
                href = link.getAttribute('data-url') || 
                       link.getAttribute('data-href') || 
                       link.getAttribute('data-pdf') ||
                       link.getAttribute('data-link') || '';
              }
            }
            
            // If we found an href, return it (even if not .pdf, it might be a download endpoint)
            if (href) {
              return href;
            }
          }
          
          // Also check for direct PDF links anywhere on the page
          if (href && (href.includes('.pdf') || href.includes('pdf') || href.includes('download'))) {
            return href;
          }
        }
        
        // Check for iframe/embed with PDF
        const iframes = document.querySelectorAll('iframe[src*=".pdf"], iframe[src*="pdf"], embed[src*=".pdf"], embed[src*="pdf"]');
        for (const iframe of Array.from(iframes)) {
          const src = iframe.getAttribute('src') || (iframe as any).src || '';
          if (src.includes('.pdf') || src.includes('pdf')) {
            return src;
          }
        }
        
        // Check for script tags that might contain PDF URLs
        const scripts = document.querySelectorAll('script');
        for (const script of Array.from(scripts)) {
          const scriptText = script.textContent || '';
          const pdfMatch = scriptText.match(/['"]([^'"]*\.pdf[^'"]*)['"]/i);
          if (pdfMatch) {
            return pdfMatch[1];
          }
        }
        
        return null;
      });
      
      // Navigate back to original page if we changed pages
      if (currentUrl !== detailUrl) {
        await page.goto(currentUrl, { waitUntil: 'networkidle0', timeout: 10000 });
        this.requestCount++;
      }
      
      if (pdfUrl) {
        // Make URL absolute if needed
        if (!pdfUrl.startsWith('http')) {
          const baseUrl = new URL(detailUrl).origin;
          return pdfUrl.startsWith('/') 
            ? `${baseUrl}${pdfUrl}`
            : `${baseUrl}/${pdfUrl}`;
        }
        return pdfUrl;
      }
      
      return null;
    } catch (error) {
      logger.debug(`Error finding PDF URL in detail page ${detailUrl}: ${error}`);
      return null;
    }
  }
}
