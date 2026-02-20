import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, EcrieConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * EcrieSpider implementation for Cloudflare Workers
 * 
 * The Ecrie platform is used by municipalities like Boituva, Porto Ferreira,
 * Guararema, Jarinu, Araçoiaba da Serra, and Embu-Guaçu.
 * 
 * Site Structure:
 * - URL: {cidade}.sp.gov.br/diariooficial
 * - PDFs hosted on ecrie.com.br
 * - "Visualizar edição" buttons that open PDFs directly
 * - List of gazettes with date, edition number, and view button
 * - Pagination for navigating through gazettes
 * - Search form with date range and edition filters
 * 
 * This spider requires browser rendering due to JavaScript-rendered content.
 */
export class EcrieSpider extends BaseSpider {
  protected ecrieConfig: EcrieConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.ecrieConfig = spiderConfig.config as EcrieConfig;
    this.browser = browser || null;
    
    if (!this.ecrieConfig.baseUrl) {
      throw new Error(`EcrieSpider requires a baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing EcrieSpider for ${spiderConfig.name} with URL: ${this.ecrieConfig.baseUrl}`, {
      hasBrowser: !!this.browser,
    });
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.ecrieConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    // Try HTTP-based crawling first (faster and works for sites with static HTML)
    try {
      const gazettes = await this.crawlWithHttp();
      if (gazettes.length > 0) {
        logger.info(`Successfully crawled ${gazettes.length} gazettes via HTTP`);
        return gazettes;
      }
    } catch (error) {
      logger.debug('HTTP crawling failed, falling back to browser', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
    
    // Fallback to browser-based crawling if HTTP failed or returned no results
    if (!this.browser) {
      throw new Error('EcrieSpider requires a browser instance for crawling (HTTP crawling returned no results)');
    }
    
    return this.crawlWithBrowser();
  }

  /**
   * HTTP-based crawling for Ecrie sites with static HTML
   * This is faster than browser-based crawling and works for sites like Limeira
   */
  private async crawlWithHttp(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let currentPage = 1;
    const maxPages = 50; // Safety limit
    let hasMorePages = true;

    while (hasMorePages && currentPage <= maxPages) {
      // Build URL with pagination if needed
      // Support both ?p= (standard) and ?pagina= (Itapecerica da Serra and others)
      const paginationParam = this.ecrieConfig.paginationParam || 'p';
      const url = currentPage === 1 
        ? this.ecrieConfig.baseUrl 
        : `${this.ecrieConfig.baseUrl}?${paginationParam}=${currentPage}`;
      
      logger.debug(`Fetching page ${currentPage}: ${url}`);
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        }
      });
      this.requestCount++;
      
      if (!response.ok) {
        throw new Error(`HTTP request failed with status ${response.status}`);
      }
      
      const html = await response.text();
      
      // Extract gazettes from HTML
      const pageGazettes = this.extractGazettesFromHtml(html);
      
      if (pageGazettes.length === 0) {
        hasMorePages = false;
        continue;
      }
      
      // Filter by date range and check if we should continue
      let foundOlderThanRange = false;
      for (const gazette of pageGazettes) {
        const gazetteDate = new Date(gazette.date);
        if (this.isInDateRange(gazetteDate)) {
          gazettes.push(gazette);
        } else if (gazetteDate < new Date(this.dateRange.start)) {
          foundOlderThanRange = true;
        }
      }
      
      logger.debug(`Found ${pageGazettes.length} gazettes on page ${currentPage}, ${gazettes.length} total in date range`);
      
      // Stop if we found gazettes older than our date range
      if (foundOlderThanRange) {
        logger.debug('Found gazettes older than date range, stopping pagination');
        break;
      }
      
      // Check for more pages - look for pagination links in HTML
      // Support both ?p= and ?pagina= formats
      const hasNextPage = html.includes(`?p=${currentPage + 1}`) || 
                          html.includes(`&p=${currentPage + 1}`) ||
                          html.includes(`?pagina=${currentPage + 1}`) ||
                          html.includes(`&pagina=${currentPage + 1}`) ||
                          html.match(new RegExp(`href="[^"]*[?&](?:p|pagina)=${currentPage + 1}[^"]*"`)) !== null ||
                          // Also check for select options (Itapecerica format)
                          html.includes(`<option>${currentPage + 1}</option>`);
      
      if (hasNextPage) {
        currentPage++;
      } else {
        hasMorePages = false;
      }
    }

    return gazettes;
  }

  /**
   * Extract gazettes from HTML content
   */
  private extractGazettesFromHtml(html: string): Gazette[] {
    const gazettes: Gazette[] = [];
    
    // Pattern to match gazette articles with PDF links
    // Example 1: <a href="https://ecrie.com.br/..." title="Visualizar Diário Oficial nº 7151"
    // Example 2: <a title="Imprensa Oficial 1221" href="https://ecrie.com.br/...">Edição 1221 / 30.12.2025</a>
    const articlePattern = /<article[^>]*class="[^"]*list-item[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
    // Support both href before title and title before href
    const linkPattern1 = /<a[^>]*href="([^"]*(?:ecrie|pdf)[^"]*)"[^>]*title="([^"]*)"[^>]*>/gi;
    const linkPattern2 = /<a[^>]*title="([^"]*)"[^>]*href="([^"]*(?:ecrie|pdf)[^"]*)"[^>]*>([^<]*)</gi;
    
    // First try to find articles
    let match;
    while ((match = articlePattern.exec(html)) !== null) {
      const articleHtml = match[1];
      
      // Try link pattern 1: href before title
      linkPattern1.lastIndex = 0;
      let linkMatch = linkPattern1.exec(articleHtml);
      let pdfUrl: string | null = null;
      let title: string = '';
      let linkText: string = '';
      
      if (linkMatch) {
        pdfUrl = linkMatch[1];
        title = linkMatch[2];
      } else {
        // Try link pattern 2: title before href (Itapecerica da Serra format)
        linkPattern2.lastIndex = 0;
        const linkMatch2 = linkPattern2.exec(articleHtml);
        if (linkMatch2) {
          title = linkMatch2[1];
          pdfUrl = linkMatch2[2];
          linkText = linkMatch2[3]; // The link text contains edition and date
        }
      }
      
      if (!pdfUrl) continue;
      
      // Extract edition number from title or link text
      // Example: "Edição 1221 / 30.12.2025" or "Imprensa Oficial 1221"
      const editionSource = linkText || title || articleHtml;
      const editionMatch = editionSource.match(/[Ee]di[çc][ãa]o\s*(\d+)/i) || 
                           editionSource.match(/[Nn]?[°º]?\s*(\d+)/) ||
                           title.match(/(\d+)/);
      const editionNumber = editionMatch ? editionMatch[1] : undefined;
      
      // Extract date from filename, link text, or article content
      // Filename pattern 1: u_137_DDMMYYYYHHMMSS.pdf
      // Filename pattern 2: a_X_X_X_DDMMYYYYHHMMSS.pdf (Itapecerica da Serra format)
      const filenameMatch = pdfUrl.match(/(?:u_\d+|a_\d+_\d+_\d+)_(\d{2})(\d{2})(\d{4})\d{6}\.pdf/);
      let gazetteDate: Date | null = null;
      
      if (filenameMatch) {
        const [, day, month, year] = filenameMatch;
        gazetteDate = new Date(`${year}-${month}-${day}`);
      } else {
        // First check linkText for date (more reliable for Itapecerica format)
        const dateSource = linkText || articleHtml;
        
        // Try DD/MM/YYYY format
        const slashDateMatch = dateSource.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (slashDateMatch) {
          const [, day, month, year] = slashDateMatch;
          gazetteDate = new Date(`${year}-${month}-${day}`);
        } else {
          // Try DD.MM.YYYY format (Itapecerica da Serra format)
          const dotDateMatch = dateSource.match(/(\d{2})\.(\d{2})\.(\d{4})/);
          if (dotDateMatch) {
            const [, day, month, year] = dotDateMatch;
            gazetteDate = new Date(`${year}-${month}-${day}`);
          }
        }
      }
      
      if (!gazetteDate || isNaN(gazetteDate.getTime())) continue;
      
      // Check if extra edition
      const isExtra = title.toLowerCase().includes('extra') || 
                      articleHtml.toLowerCase().includes('extra') ||
                      linkText.toLowerCase().includes('extra');
      
      const gazette = this.createGazetteSync(gazetteDate, pdfUrl, {
        editionNumber,
        isExtraEdition: isExtra,
        power: 'executive_legislative',
        sourceText: linkText || title,
      });
      
      if (gazette) {
        gazettes.push(gazette);
      }
    }
    
    // If no articles found, try direct link pattern
    if (gazettes.length === 0) {
      // Pattern for direct links: href="...ecrie...pdf" title="Visualizar Diário Oficial nº XXXX"
      const directLinkPattern = /<a[^>]*href="(https?:\/\/[^"]*ecrie[^"]*\.pdf)"[^>]*title="Visualizar[^"]*[Nn]?[°º]?\s*(\d+)"[^>]*>/gi;
      
      while ((match = directLinkPattern.exec(html)) !== null) {
        const pdfUrl = match[1];
        const editionNumber = match[2];
        
        // Extract date from filename
        const filenameMatch = pdfUrl.match(/u_\d+_(\d{2})(\d{2})(\d{4})\d{6}\.pdf/);
        if (!filenameMatch) continue;
        
        const [, day, month, year] = filenameMatch;
        const gazetteDate = new Date(`${year}-${month}-${day}`);
        
        if (isNaN(gazetteDate.getTime())) continue;
        
        const gazette = this.createGazetteSync(gazetteDate, pdfUrl, {
          editionNumber,
          isExtraEdition: false,
          power: 'executive_legislative',
          sourceText: `Diário Oficial nº ${editionNumber}`,
        });
        
        if (gazette) {
          gazettes.push(gazette);
        }
      }
    }
    
    return gazettes;
  }

  /**
   * Synchronous version of createGazette for use in extractGazettesFromHtml
   */
  private createGazetteSync(date: Date, pdfUrl: string, options: {
    editionNumber?: string;
    isExtraEdition?: boolean;
    power?: string;
    sourceText?: string;
  }): Gazette | null {
    try {
      return {
        date: toISODate(date),
        fileUrl: pdfUrl,
        territoryId: this.spiderConfig.territoryId,
        power: (options.power || 'executive_legislative') as 'executive' | 'legislative' | 'executive_legislative',
        isExtraEdition: options.isExtraEdition || false,
        editionNumber: options.editionNumber,
        scrapedAt: new Date().toISOString(),
        sourceText: options.sourceText,
      };
    } catch (error) {
      logger.warn('Failed to create gazette', { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  /**
   * Browser-based crawling for Ecrie sites
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Navigate to the gazette page
      logger.debug(`Navigating to: ${this.ecrieConfig.baseUrl}`);
      await page.goto(this.ecrieConfig.baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Wait for page to stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extract gazettes from all pages
      let hasMorePages = true;
      let currentPage = 1;
      const maxPages = 50; // Safety limit
      
      while (hasMorePages && currentPage <= maxPages) {
        logger.debug(`Extracting gazettes from page ${currentPage}`);
        
        // Wait for gazette list to load
        try {
          await page.waitForSelector('article, .post, .gazette-item, tr', { timeout: 10000 });
        } catch (error) {
          logger.warn('Gazette list not found, may be empty');
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
        
        // Check for pagination - look for "next" button or page links
        // Use valid CSS selectors only (no jQuery :contains pseudo-selector)
        const nextPageButton = await page.$('a.page-link[rel="next"], .pagination .next:not(.disabled) a, button[aria-label="Next"], a[aria-label="Próximo"], nav.paginacao a.proximo, .paginacao a.next');
        if (nextPageButton) {
          logger.debug(`Clicking next page button`);
          await nextPageButton.click();
          await new Promise(resolve => setTimeout(resolve, 2000));
          currentPage++;
        } else {
          // Try to find page number links or next page via text content
          const paginationLinks = await page.$$('nav.paginacao a, .pagination a, .page-numbers a, .pager a');
          let foundNextPage = false;
          
          for (const link of paginationLinks) {
            const text = await page.evaluate((el: any) => el.textContent?.trim(), link);
            // Check for next page number or "»" or "Próximo" text
            if (text === String(currentPage + 1) || text === '»' || text === '>' || text?.toLowerCase().includes('próximo') || text?.toLowerCase().includes('proximo')) {
              await link.click();
              await new Promise(resolve => setTimeout(resolve, 2000));
              currentPage++;
              foundNextPage = true;
              break;
            }
          }
          
          if (!foundNextPage) {
            hasMorePages = false;
          }
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from browser`);
      
    } catch (error) {
      logger.error(`Error crawling with browser:`, error as Error);
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
   * Parse date text in various formats
   * Supports: DD/MM/YYYY, DD.MM.YYYY, and "DD de MMMM de YYYY"
   */
  private parseDateText(dateText: string): Date | null {
    // Try DD/MM/YYYY format first
    const slashMatch = dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (slashMatch) {
      const [, day, month, year] = slashMatch;
      return new Date(`${year}-${month}-${day}`);
    }
    
    // Try DD.MM.YYYY format (Itapecerica da Serra and other municipalities)
    const dotMatch = dateText.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (dotMatch) {
      const [, day, month, year] = dotMatch;
      return new Date(`${year}-${month}-${day}`);
    }
    
    // Try "DD de MMMM de YYYY" format (Portuguese month names)
    const monthNames: { [key: string]: number } = {
      'janeiro': 1, 'fevereiro': 2, 'março': 3, 'marco': 3, 'abril': 4,
      'maio': 5, 'junho': 6, 'julho': 7, 'agosto': 8,
      'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12
    };
    
    const ptMatch = dateText.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
    if (ptMatch) {
      const [, day, monthName, year] = ptMatch;
      const month = monthNames[monthName.toLowerCase()];
      if (month) {
        return new Date(parseInt(year), month - 1, parseInt(day));
      }
    }
    
    return null;
  }

  /**
   * Extract gazettes from a browser-rendered page
   */
  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Get all gazette rows/articles
      const gazetteElements = await page.evaluate(() => {
        const elements: any[] = [];
        
        // Helper function to extract date text from content
        // Supports DD/MM/YYYY, DD.MM.YYYY, and "DD de MMMM de YYYY" formats
        const extractDateText = (text: string): string => {
          // Try DD/MM/YYYY format
          const slashMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (slashMatch) return slashMatch[0];
          
          // Try DD.MM.YYYY format (Itapecerica da Serra format)
          const dotMatch = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
          if (dotMatch) return dotMatch[0];
          
          // Try "DD de MMMM de YYYY" format
          const ptMatch = text.match(/(\d{1,2})\s+de\s+\w+\s+de\s+(\d{4})/i);
          if (ptMatch) return ptMatch[0];
          
          return '';
        };
        
        // Pattern 0: .list-item elements (Piracaia and similar ecrie sites)
        const listItems = document.querySelectorAll('li.list-item, .list-item');
        for (const item of Array.from(listItems)) {
          const text = item.textContent || '';
          const dateText = extractDateText(text);
          
          // Look for edition number
          const editionMatch = text.match(/[Ee]di[çc][ãa]o\s*(?:[Nn]?[°º]?\s*)?(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : '';
          
          // Look for PDF link - try .list-item__button first (Piracaia), then other patterns
          const viewLink = item.querySelector('.list-item__button[href], a[href*="ecrie"], a[href*="pdf"], a[title*="Visualizar"]');
          const viewHref = viewLink?.getAttribute('href') || '';
          
          // Check if it's an extra edition
          const isExtra = text.toLowerCase().includes('extra');
          
          if (dateText || viewHref) {
            elements.push({
              dateText,
              editionNumber,
              viewHref,
              isExtra,
              sourceText: text.trim().substring(0, 200)
            });
          }
        }
        
        // Pattern 1: Article cards (common in Ecrie)
        if (elements.length === 0) {
          const articles = document.querySelectorAll('article');
          for (const article of Array.from(articles)) {
            const text = article.textContent || '';
            const dateText = extractDateText(text);
            
            // Look for edition number
            const editionMatch = text.match(/[Ee]di[çc][ãa]o\s*(?:[Nn]?[°º]?\s*)?(\d+)/i);
            const editionNumber = editionMatch ? editionMatch[1] : '';
            
            // Look for "Visualizar edição" link
            const viewLink = article.querySelector('a[href*="ecrie"], a[href*="pdf"], a[title*="Visualizar"]');
            const viewHref = viewLink?.getAttribute('href') || '';
            
            // Check if it's an extra edition
            const isExtra = text.toLowerCase().includes('extra');
            
            if (dateText) {
              elements.push({
                dateText,
                editionNumber,
                viewHref,
                isExtra,
                sourceText: text.trim().substring(0, 200)
              });
            }
          }
        }
        
        // Pattern 2: Table rows (some Ecrie sites use tables)
        if (elements.length === 0) {
          const rows = document.querySelectorAll('table tbody tr, .gazette-list tr');
          for (const row of Array.from(rows)) {
            const text = row.textContent || '';
            const dateText = extractDateText(text);
            const editionMatch = text.match(/[Ee]di[çc][ãa]o\s*(?:[Nn]?[°º]?\s*)?(\d+)/i);
            const editionNumber = editionMatch ? editionMatch[1] : '';
            const viewLink = row.querySelector('a[href*="ecrie"], a[href*="pdf"]');
            const viewHref = viewLink?.getAttribute('href') || '';
            const isExtra = text.toLowerCase().includes('extra');
            
            if (dateText) {
              elements.push({
                dateText,
                editionNumber,
                viewHref,
                isExtra,
                sourceText: text.trim().substring(0, 200)
              });
            }
          }
        }
        
        // Pattern 3: Generic list items
        if (elements.length === 0) {
          const items = document.querySelectorAll('.post, .gazette-item, .diario-item, li[class*="diario"], div[class*="diario"]');
          for (const item of Array.from(items)) {
            const text = item.textContent || '';
            const dateText = extractDateText(text);
            const editionMatch = text.match(/[Ee]di[çc][ãa]o\s*(?:[Nn]?[°º]?\s*)?(\d+)/i);
            const editionNumber = editionMatch ? editionMatch[1] : '';
            const viewLink = item.querySelector('a[href*="ecrie"], a[href*="pdf"]');
            const viewHref = viewLink?.getAttribute('href') || '';
            const isExtra = text.toLowerCase().includes('extra');
            
            if (dateText) {
              elements.push({
                dateText,
                editionNumber,
                viewHref,
                isExtra,
                sourceText: text.trim().substring(0, 200)
              });
            }
          }
        }
        
        return elements;
      });
      
      logger.debug(`Found ${gazetteElements.length} gazette elements on page`);
      
      // If we didn't find elements with PDF links, we need to click on "Visualizar edição" links
      if (gazetteElements.length === 0 || !gazetteElements.some(e => e.viewHref)) {
        // Try to get gazettes by clicking view buttons
        return await this.extractGazettesByClicking(page);
      }
      
      // Process each element
      for (const element of gazetteElements) {
        try {
          // Parse date using the helper method that supports multiple formats
          const gazetteDate = this.parseDateText(element.dateText);
          if (!gazetteDate) {
            logger.warn(`Could not parse date from: ${element.dateText}`);
            continue;
          }
          
          // Skip if not in date range
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }
          
          // Get PDF URL
          let pdfUrl = element.viewHref;
          if (!pdfUrl) {
            logger.warn(`No PDF URL found for gazette: ${element.sourceText}`);
            continue;
          }
          
          // Make absolute URL if relative
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.ecrieConfig.baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }
          
          // Create gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber: element.editionNumber || undefined,
            isExtraEdition: element.isExtra || false,
            power: 'executive_legislative',
            sourceText: element.sourceText || `Gazette ${toISODate(gazetteDate)}`,
          });
          
          if (gazette) {
            gazettes.push(gazette);
          }
          
        } catch (error) {
          logger.error(`Error processing gazette element:`, error as Error);
        }
      }
      
    } catch (error) {
      logger.error(`Error extracting gazettes from page:`, error as Error);
    }
    
    return gazettes;
  }

  /**
   * Extract gazettes by clicking on "Visualizar edição" buttons and capturing network requests
   */
  private async extractGazettesByClicking(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Get all "Visualizar edição" links
      // Use valid CSS selectors only - no :contains pseudo-selector
      const viewLinks = await page.$$('a[title*="Visualizar"], a[href*="ecrie"], a[href*=".pdf"], .view-btn, a.btn-primary, a.btn-secondary');
      
      logger.debug(`Found ${viewLinks.length} view links to click`);
      
      // Get gazette info for each link
      for (let i = 0; i < viewLinks.length; i++) {
        try {
          // Re-query the links as the page might have changed
          const currentLinks = await page.$$('a[title*="Visualizar"], a[href*="ecrie"], a[href*=".pdf"], .view-btn, a.btn-primary, a.btn-secondary');
          if (i >= currentLinks.length) break;
          
          const link = currentLinks[i];
          
          // Get the parent element to extract date and edition info
          const parentInfo = await page.evaluate((el: any) => {
            const parent = el.closest('article, tr, .post, .gazette-item, div');
            if (!parent) return null;
            
            const text = parent.textContent || '';
            const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            const editionMatch = text.match(/[Ee]di[çc][ãa]o\s*(?:[Nn]?[°º]?\s*)?(\d+)/i);
            const isExtra = text.toLowerCase().includes('extra');
            
            return {
              dateText: dateMatch ? dateMatch[0] : null,
              editionNumber: editionMatch ? editionMatch[1] : null,
              isExtra,
              sourceText: text.trim().substring(0, 200)
            };
          }, link);
          
          if (!parentInfo || !parentInfo.dateText) {
            continue;
          }
          
          // Parse date
          const dateMatch = parentInfo.dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) continue;
          
          const [, day, month, year] = dateMatch;
          const gazetteDate = new Date(`${year}-${month}-${day}`);
          
          // Skip if not in date range
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }
          
          // Set up network interception to capture PDF URL
          let pdfUrl: string | null = null;
          
          // Listen for new page (popup) or navigation
          const [newPage] = await Promise.all([
            new Promise<any>(resolve => {
              page.once('popup', (popup: any) => resolve(popup));
              // Also listen for frame navigations
              setTimeout(() => resolve(null), 2000);
            }),
            link.click().catch(() => {})
          ]);
          
          if (newPage) {
            // A new page was opened (popup with PDF)
            await new Promise(resolve => setTimeout(resolve, 1000));
            pdfUrl = newPage.url();
            await newPage.close().catch(() => {});
          } else {
            // Check if current page URL changed
            await new Promise(resolve => setTimeout(resolve, 500));
            const currentUrl = page.url();
            if (currentUrl.includes('ecrie') && currentUrl.includes('.pdf')) {
              pdfUrl = currentUrl;
              await page.goBack();
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
          
          if (pdfUrl && pdfUrl.includes('.pdf')) {
            const gazette = await this.createGazette(gazetteDate, pdfUrl, {
              editionNumber: parentInfo.editionNumber || undefined,
              isExtraEdition: parentInfo.isExtra || false,
              power: 'executive_legislative',
              sourceText: parentInfo.sourceText || `Gazette ${toISODate(gazetteDate)}`,
            });
            
            if (gazette) {
              gazettes.push(gazette);
            }
          }
          
        } catch (error) {
          logger.warn(`Error clicking view link ${i}:`, { error: error instanceof Error ? error.message : String(error) });
        }
      }
      
    } catch (error) {
      logger.error(`Error extracting gazettes by clicking:`, error as Error);
    }
    
    return gazettes;
  }
}

