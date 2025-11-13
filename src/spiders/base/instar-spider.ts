import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, InstarConfig } from '../../types';
import { logger } from '../../utils/logger';
// @ts-ignore
import { parse } from 'node-html-parser';
import { formatBrazilianDate, toISODate } from '../../utils/date-utils';

/**
 * BaseInstarSpider implementation for Cloudflare Workers
 * 
 * The Instar platform is used by many Brazilian municipalities to publish their official gazettes.
 * 
 * Two modes:
 * 1. Standard mode (no browser): Uses URL pattern {base_url}/{page}/{start_date}/{end_date}/0/0/
 * 2. Browser mode (with browser): Navigates to base URL, extracts from either:
 *    a. Joomla edocman format (table with edocman-document-title-td)
 *    b. Standard Instar format (.dof_publicacao_diario)
 * 
 * HTML Structure (Standard Instar):
 * - Container: .dof_publicacao_diario
 * - Title/Edition: .dof_titulo_publicacao span (first)
 * - Date: Found in spans with pattern DD/MM/YYYY
 * - PDF Download: .dof_download[data-href]
 * 
 * HTML Structure (Browser - Joomla edocman):
 * - Table rows with class: edocman-document-title-td
 * - Date element: dateinformation
 * - PDF URL: documents_table_view (if exists) or edocmandownloadlink btn btn-secondary (on detail page)
 * 
 * HTML Structure (Browser - Standard Instar):
 * - Container: .dof_publicacao_diario
 * - Title/Edition: .dof_titulo_publicacao span
 * - Date: Found in spans with pattern DD/MM/YYYY
 * - PDF Download: .dof_download[data-href]
 */
export class InstarSpider extends BaseSpider {
  protected instarConfig: InstarConfig;
  protected resultsPerPage = 50;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.instarConfig = spiderConfig.config as InstarConfig;
    this.browser = browser || null;
    
    if (!this.instarConfig.url) {
      throw new Error(`InstarSpider requires a base_url in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing InstarSpider for ${spiderConfig.name} with URL: ${this.instarConfig.url}`, {
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
    logger.info(`Crawling ${this.instarConfig.url} for ${this.spiderConfig.name}...`);
    
    // Use browser-based crawling if browser is available
    if (this.browser) {
      return this.crawlWithBrowser();
    }
    
    // Otherwise use standard fetch-based crawling
    return this.crawlWithFetch();
  }

  /**
   * Browser-based crawling for Instar sites that require JavaScript rendering
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Navigate to the base URL (or iframe src if it's an iframe)
      // Check if URL ends with /diario-oficial/ and extract iframe src
      let targetUrl = this.instarConfig.url;
      if (targetUrl.endsWith('/diario-oficial/')) {
        // Navigate to main page first to get iframe src
        logger.debug(`Navigating to main page: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'networkidle0', timeout: 30000 });
        this.requestCount++;
        
        // Wait for iframe to load
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Get iframe src
        const iframeSrc = await page.evaluate(() => {
          const iframe = document.querySelector('iframe[src*="diariooficial"]');
          return iframe ? (iframe as HTMLIFrameElement).src : null;
        });
        
        if (iframeSrc) {
          targetUrl = iframeSrc;
          logger.debug(`Found iframe src: ${targetUrl}`);
        } else {
          // Try direct navigation to diariooficial
          const baseUrlObj = new URL(this.instarConfig.url);
          targetUrl = `${baseUrlObj.origin}/diariooficial`;
          logger.debug(`No iframe found, trying direct URL: ${targetUrl}`);
        }
      }
      
      // Navigate to target URL
      logger.debug(`Navigating to: ${targetUrl}`);
      await page.goto(targetUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Wait for page to stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extract gazettes from all pages
      let hasMorePages = true;
      let currentPage = 1;
      
      while (hasMorePages) {
        logger.debug(`Extracting gazettes from page ${currentPage}`);
        
        // Wait for either edocman structure or standard Instar format
        try {
          await page.waitForSelector('.edocman-document-title-td, table tbody tr, .dof_publicacao_diario', { timeout: 10000 });
        } catch (error) {
          logger.warn('Document table/list not found, may be empty');
          break;
        }
        
        // Check which format the page uses
        const hasEdocman = await page.$('.edocman-document-title-td, table tbody tr');
        const hasStandardInstar = await page.$('.dof_publicacao_diario');
        
        let pageGazettes: Gazette[] = [];
        
        if (hasEdocman) {
          // Extract using edocman format
          logger.debug('Using edocman format extraction');
          pageGazettes = await this.extractGazettesFromPage(page);
        } else if (hasStandardInstar) {
          // Extract using standard Instar format
          logger.debug('Using standard Instar format extraction');
          pageGazettes = await this.extractStandardInstarGazettes(page);
        } else {
          logger.warn('No recognized format found on page');
          break;
        }
        
        // Filter by date range
        for (const gazette of pageGazettes) {
          if (gazette && this.isInDateRange(new Date(gazette.date))) {
            gazettes.push(gazette);
          }
        }
        
        logger.debug(`Found ${pageGazettes.length} gazettes on page ${currentPage}, ${gazettes.length} in date range`);
        
        // Check for pagination
        const nextPageButton = await page.$('a[href*="page"], .pagination .next:not(.disabled), .pager .next:not(.disabled)');
        if (nextPageButton) {
          logger.debug(`Clicking next page button`);
          await nextPageButton.click();
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for page to load
          currentPage++;
        } else {
          hasMorePages = false;
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
   * Standard fetch-based crawling for Instar sites with URL pattern
   */
  private async crawlWithFetch(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      const startDate = formatBrazilianDate(new Date(this.dateRange.start));
      const endDate = formatBrazilianDate(new Date(this.dateRange.end));
      
      // Step 1: Fetch first page to get total results
      const firstPageUrl = `${this.instarConfig.url}/1/${startDate}/${endDate}/0/0/`;
      logger.info(`Fetching first page: ${firstPageUrl}`);
      
      const firstPageHtml = await this.fetch(firstPageUrl);
      const firstPageRoot = parse(firstPageHtml);
      
      // Get total number of results
      const resultsText = firstPageRoot.querySelector('.sw_qtde_resultados')?.text || '0';
      const totalResults = parseInt(resultsText.trim(), 10);
      logger.info(`Found ${totalResults} total results`);
      
      if (totalResults === 0) {
        logger.info(`No gazettes found for ${this.spiderConfig.name}`);
        return gazettes;
      }
      
      // Calculate total pages
      const totalPages = Math.ceil(totalResults / this.resultsPerPage);
      logger.info(`Total pages to fetch: ${totalPages}`);
      
      // Step 2: Fetch all pages (including first page we already have)
      const pagePromises: Promise<string>[] = [];
      
      // Process first page
      pagePromises.push(Promise.resolve(firstPageHtml));
      
      // Fetch remaining pages
      for (let page = 2; page <= totalPages; page++) {
        const pageUrl = `${this.instarConfig.url}/${page}/${startDate}/${endDate}/0/0/`;
        pagePromises.push(this.fetch(pageUrl));
      }
      
      const allPagesHtml = await Promise.all(pagePromises);
      
      // Step 3: Parse all pages and collect gazettes
      for (const pageHtml of allPagesHtml) {
        const root = parse(pageHtml);
        const gazetteElements = root.querySelectorAll('.dof_publicacao_diario');
        
        for (const gazetteElement of gazetteElements) {
          const gazette = await this.parseGazetteElement(gazetteElement);
          if (gazette) {
            gazettes.push(gazette);
          }
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Extract gazettes from a browser-rendered page
   */
  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Extract document rows - look for table rows that contain edocman-document-title-td
      const documentRows = await page.evaluate(() => {
        const rows: any[] = [];
        
        // Find all table rows
        const tableRows = document.querySelectorAll('table tbody tr, tr');
        
        for (const row of Array.from(tableRows)) {
          // Check if this row has edocman-document-title-td or dateinformation
          const titleTd = row.querySelector('.edocman-document-title-td, td.edocman-document-title-td');
          const dateInfo = row.querySelector('.dateinformation, [class*="dateinformation"], td.dateinformation');
          
          if (!titleTd && !dateInfo) {
            continue; // Skip rows without the expected structure
          }
          
          // Try to find dateinformation element
          const dateText = dateInfo ? dateInfo.textContent?.trim() : '';
          
          // Try to find title element
          const titleLink = titleTd ? titleTd.querySelector('a') : null;
          const titleHref = titleLink ? titleLink.getAttribute('href') : null;
          const titleText = titleLink ? titleLink.textContent?.trim() : '';
          
          // Try to find documents_table_view (PDF link in table)
          const tableView = row.querySelector('.documents_table_view, [class*="documents_table_view"], td.documents_table_view');
          const pdfLink = tableView ? tableView.querySelector('a') : null;
          const pdfHref = pdfLink ? pdfLink.getAttribute('href') : null;
          
          if (dateText || titleHref) {
            rows.push({
              dateText,
              titleHref,
              titleText,
              pdfHref,
              hasTableView: !!tableView,
            });
          }
        }
        
        return rows;
      });
      
      logger.debug(`Found ${documentRows.length} document rows on page`);
      
      // Process each row
      for (const row of documentRows) {
        try {
          // Parse date from dateinformation
          let gazetteDate: Date | null = null;
          if (row.dateText) {
            // Try different date formats
            const dateMatch = row.dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (dateMatch) {
              const [, day, month, year] = dateMatch;
              gazetteDate = new Date(`${year}-${month}-${day}`);
            }
          }
          
          if (!gazetteDate) {
            logger.warn(`Could not parse date from: ${row.dateText}`);
            continue;
          }
          
          // Check if date is in range
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }
          
          // Get PDF URL
          let pdfUrl: string | null = null;
          
          if (row.pdfHref && row.hasTableView) {
            // PDF URL is directly in the table view
            pdfUrl = row.pdfHref;
          } else if (row.titleHref) {
            // Need to navigate to detail page to get PDF URL
            logger.debug(`Navigating to detail page: ${row.titleHref}`);
            
            // Construct full URL
            let detailUrl = row.titleHref;
            if (!detailUrl.startsWith('http')) {
              const baseUrlObj = new URL(this.instarConfig.url);
              detailUrl = `${baseUrlObj.origin}${detailUrl.startsWith('/') ? '' : '/'}${detailUrl}`;
            }
            
            // Navigate to detail page
            await page.goto(detailUrl, { waitUntil: 'networkidle0', timeout: 15000 });
            this.requestCount++;
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Find PDF download link
            const pdfLink = await page.$('.edocmandownloadlink.btn.btn-secondary, a.edocmandownloadlink');
            if (pdfLink) {
              pdfUrl = await page.evaluate((el: any) => el.getAttribute('href'), pdfLink);
            }
            
            // Go back to list page
            await page.goBack();
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          
          if (!pdfUrl) {
            logger.warn(`Could not find PDF URL for document: ${row.titleText}`);
            continue;
          }
          
          // Construct full PDF URL if relative
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.instarConfig.url);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }
          
          // Extract edition number from title if possible
          const editionMatch = row.titleText?.match(/[Ee]di[çc][ãa]o\s+[nN]?[°º]?\s*(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;
          
          // Create gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber,
            isExtraEdition: row.titleText?.toLowerCase().includes('extra') || false,
            power: 'executive_legislative',
            sourceText: row.titleText || `Gazette ${toISODate(gazetteDate)}`,
          });
          
          if (gazette) {
            gazettes.push(gazette);
          }
          
        } catch (error) {
          logger.error(`Error processing document row:`, error as Error);
        }
      }
      
    } catch (error) {
      logger.error(`Error extracting gazettes from page:`, error as Error);
    }
    
    return gazettes;
  }

  /**
   * Extract gazettes from browser page using standard Instar format (.dof_publicacao_diario)
   */
  private async extractStandardInstarGazettes(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Extract all gazette elements
      const gazetteElements = await page.evaluate(() => {
        const elements: any[] = [];
        const containers = document.querySelectorAll('.dof_publicacao_diario');
        
        for (const container of Array.from(containers)) {
          // Extract title/edition
          const titleElement = container.querySelector('.dof_titulo_publicacao span');
          const titleText = titleElement ? titleElement.textContent?.trim() : '';
          
          // Extract download link
          const downloadElement = container.querySelector('.dof_download');
          const downloadHref = downloadElement ? downloadElement.getAttribute('data-href') : null;
          
          // Extract date from spans (look for DD/MM/YYYY pattern)
          let dateText = '';
          const allSpans = container.querySelectorAll('span');
          for (const span of Array.from(allSpans)) {
            const text = span.textContent?.trim() || '';
            if (text.match(/\d{2}\/\d{2}\/\d{4}/)) {
              dateText = text;
              break;
            }
          }
          
          if (titleText || downloadHref || dateText) {
            elements.push({
              titleText,
              downloadHref,
              dateText,
            });
          }
        }
        
        return elements;
      });
      
      logger.debug(`Found ${gazetteElements.length} standard Instar gazette elements on page`);
      
      // Process each element
      for (const element of gazetteElements) {
        try {
          // Parse date
          let gazetteDate: Date | null = null;
          if (element.dateText) {
            const dateMatch = element.dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (dateMatch) {
              const [, day, month, year] = dateMatch;
              gazetteDate = new Date(`${year}-${month}-${day}`);
            }
          }
          
          if (!gazetteDate) {
            logger.warn(`Could not parse date from: ${element.dateText}`);
            continue;
          }
          
          // Check if date is in range
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }
          
          // Get PDF URL
          if (!element.downloadHref) {
            logger.warn(`No download link found for gazette: ${element.titleText}`);
            continue;
          }
          
          // Construct full PDF URL
          let pdfUrl = element.downloadHref;
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.instarConfig.url);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }
          
          // Extract edition number
          const editionMatch = element.titleText?.match(/[Ee]di[çc][ãa]o\s+[nN]?[°º]?\s*(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;
          
          // Check if it's an extra edition
          const isExtraEdition = element.titleText?.toLowerCase().includes('extra') || false;
          
          // Create gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber,
            isExtraEdition,
            power: 'executive_legislative',
            sourceText: element.titleText || `Gazette ${toISODate(gazetteDate)}`,
          });
          
          if (gazette) {
            gazettes.push(gazette);
          }
          
        } catch (error) {
          logger.error(`Error processing standard Instar gazette element:`, error as Error);
        }
      }
      
    } catch (error) {
      logger.error(`Error extracting standard Instar gazettes from page:`, error as Error);
    }
    
    return gazettes;
  }

  /**
   * Parse a single gazette element from the listing page
   * 
   * HTML structure:
   * <div class="dof_publicacao_diario">
   *   <div class="dof_titulo_publicacao"><span>Edição nº 3249</span></div>
   *   <div class="dof_download" data-href="/portal/download/diario-oficial/xxx/">
   *   <span>Postagem: <span>02/10/2025 às 22h31</span></span>
   * </div>
   */
  private async parseGazetteElement(gazetteElement: any): Promise<Gazette | null> {
    try {
      // Extract edition number from title
      const titleElement = gazetteElement.querySelector('.dof_titulo_publicacao span');
      const titleText = titleElement?.text || '';
      const editionMatch = titleText.match(/\d+/);
      const editionNumber = editionMatch ? editionMatch[0] : 'N/A';
      
      // Extract date from the info section
      // Look for pattern DD/MM/YYYY in all spans
      const allSpans = gazetteElement.querySelectorAll('span');
      let gazetteDate: Date | null = null;
      
      for (const span of allSpans) {
        const text = span.text || '';
        const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        
        if (dateMatch) {
          const [, day, month, year] = dateMatch;
          gazetteDate = new Date(`${year}-${month}-${day}`);
          break;
        }
      }
      
      if (!gazetteDate) {
        logger.warn(`Could not extract date from gazette element: ${titleText}`);
        return null;
      }
      
      // Check if date is in range
      if (!this.isInDateRange(gazetteDate)) {
        return null;
      }
      
      // Extract PDF download URL
      const downloadElement = gazetteElement.querySelector('.dof_download');
      const downloadHref = downloadElement?.getAttribute('data-href');
      
      if (!downloadHref) {
        logger.warn(`No download link found for gazette ${titleText} on ${gazetteDate.toISOString().split('T')[0]}`);
        return null;
      }
      
      // Construct full PDF URL
      let pdfUrl = downloadHref;
      if (pdfUrl.startsWith('/')) {
        const baseUrlObj = new URL(this.instarConfig.url);
        pdfUrl = `${baseUrlObj.origin}${pdfUrl}`;
      }
      
      // Check if it's an extra edition
      const isExtraEdition = titleText.toLowerCase().includes('extra');
      
      return await this.createGazette(gazetteDate, pdfUrl, {
        editionNumber,
        isExtraEdition,
        power: 'executive_legislative',
      });
      
    } catch (error) {
      logger.error(`Error parsing gazette element:`, error as Error);
      return null;
    }
  }
}
