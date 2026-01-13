import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraParademinasConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * PrefeituraParademinasSpider implementation
 * 
 * Crawls Pará de Minas's Diário Oficial from the official website
 * which requires JavaScript rendering to load content.
 * 
 * Site structure:
 * - Base URL: https://diario.parademinas.mg.gov.br/
 * - List page: https://diario.parademinas.mg.gov.br/diarios
 * - Table structure with columns: Edição, Data, Páginas, Visualizar
 * - Each row has a "Visualizar" link that opens the PDF
 * 
 * The spider:
 * 1. Navigates to /diarios page
 * 2. Waits for table to load
 * 3. Extracts gazette data from table rows (edition, date)
 * 4. Clicks "Visualizar" links to get PDF URLs
 * 5. Filters gazettes to match the requested date range
 */
export class PrefeituraParademinasSpider extends BaseSpider {
  protected parademinasConfig: PrefeituraParademinasConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.parademinasConfig = spiderConfig.config as PrefeituraParademinasConfig;
    this.browser = browser || null;
    
    if (!this.parademinasConfig.baseUrl) {
      throw new Error(`PrefeituraParademinasSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraParademinasSpider for ${spiderConfig.name}`, {
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

    return null;
  }

  /**
   * Extract edition number from text
   */
  private extractEditionNumber(text: string): string | undefined {
    // Try pattern: "Nº XXXX" or "Edição nº XXXX"
    const edicaoMatch = text.match(/(?:N[°º]|Edi[çc][ãa]o\s+n[°º]?)\s*(\d+)/i);
    if (edicaoMatch) {
      return edicaoMatch[1];
    }

    return undefined;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.parademinasConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error('PrefeituraParademinasSpider requires browser rendering');
    }
    
    return this.crawlWithBrowser();
  }

  /**
   * Browser-based crawling for Pará de Minas diário oficial page
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Build the diarios list page URL
      const baseUrlObj = new URL(this.parademinasConfig.baseUrl);
      const diariosUrl = `${baseUrlObj.origin}/diarios`;
      
      // Navigate to diarios list page
      logger.debug(`Navigating to: ${diariosUrl}`);
      await page.goto(diariosUrl, { waitUntil: 'networkidle0', timeout: 45000 });
      this.requestCount++;
      
      // Wait for table to load
      logger.debug('Waiting for table to load...');
      try {
        await page.waitForSelector('table, table tr', { timeout: 15000 });
        logger.debug('Table found');
      } catch (error) {
        logger.warn('Table selector not found, trying alternative selectors');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      // Extract gazettes from the table
      const pageGazettes = await this.extractGazettesFromTable(page, baseUrlObj.origin);
      
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
   * Extract gazettes from the table on /diarios page
   */
  private async extractGazettesFromTable(page: any, baseOrigin: string): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const processedUrls = new Set<string>();

    try {
      // Extract gazette data from the table
      const tableData = await page.evaluate(() => {
        const data: Array<{
          editionNumber: string;
          dateText: string;
          viewLinkHref: string;
        }> = [];
        
        // Find all table rows (skip header row)
        const rows = Array.from(document.querySelectorAll('table tr'));
        
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll('td'));
          
          // Table structure: Edição | Data | Páginas | Visualizar
          if (cells.length >= 4) {
            const editionText = cells[0]?.textContent?.trim() || '';
            const dateText = cells[1]?.textContent?.trim() || '';
            const viewLink = cells[3]?.querySelector('a');
            const viewLinkHref = viewLink?.getAttribute('href') || '';
            
            // Only process rows with valid data
            if (editionText && dateText && viewLinkHref) {
              data.push({
                editionNumber: editionText,
                dateText: dateText,
                viewLinkHref: viewLinkHref
              });
            }
          }
        }
        
        return data;
      });

      logger.debug(`Found ${tableData.length} gazette entries in table`);
      
      if (tableData.length === 0) {
        logger.warn(`No gazette data found in table. Page might have different structure.`);
        // Try to get page HTML for debugging
        const pageContent = await page.content();
        logger.debug(`Page content length: ${pageContent.length} characters`);
        const pageInfo = await page.evaluate(() => ({
          title: document.title,
          url: window.location.href,
          tableCount: document.querySelectorAll('table').length,
          rowCount: document.querySelectorAll('table tr').length
        }));
        logger.debug(`Page info:`, pageInfo);
      }
      
      // Process each table row
      for (const item of tableData) {
        try {
          // Parse date
          const gazetteDate = this.parseDate(item.dateText);
          
          if (!gazetteDate || isNaN(gazetteDate.getTime())) {
            logger.warn(`Could not parse date from: ${item.dateText}`);
            continue;
          }
          
          // Skip if outside date range (optimization)
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }
          
          // Build PDF URL from the view link href (it points directly to the PDF)
          let pdfUrl: string;
          
          if (item.viewLinkHref.startsWith('http')) {
            pdfUrl = item.viewLinkHref;
          } else {
            // Make URL absolute
            pdfUrl = `${baseOrigin}${item.viewLinkHref.startsWith('/') ? '' : '/'}${item.viewLinkHref}`;
          }
          
          // Verify it's a PDF URL
          if (!pdfUrl.includes('.pdf') && !pdfUrl.includes('pdf')) {
            logger.warn(`View link doesn't appear to be a PDF: ${pdfUrl} for edition ${item.editionNumber}`);
            // Still try to use it, might work
          }
          
          // Skip if already processed
          if (processedUrls.has(pdfUrl)) {
            logger.debug(`Skipping duplicate PDF URL: ${pdfUrl}`);
            continue;
          }

          // Mark URL as processed
          processedUrls.add(pdfUrl);

          // Create the gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber: item.editionNumber,
            power: 'executive',
            sourceText: `Edição ${item.editionNumber} - ${item.dateText}`,
          });

          if (gazette) {
            gazettes.push(gazette);
            logger.debug(`Added gazette: Edição ${item.editionNumber} - ${toISODate(gazetteDate)} - ${pdfUrl}`);
          }

        } catch (error) {
          logger.error(`Error processing gazette item:`, error as Error);
        }
      }

    } catch (error) {
      logger.error(`Error extracting gazettes from table:`, error as Error);
    }

    return gazettes;
  }
}

