import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, AdiariosConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for ADiarios V2 platform (Layout 2)
 * Used by 5 cities in Rio de Janeiro
 * 
 * Uses Cloudflare Browser Rendering (Puppeteer) to handle JavaScript-heavy pages
 */
export class ADiariosV2Spider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as AdiariosConfig;
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
      logger.error(`ADiariosV2Spider for ${this.config.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling ADiarios V2 for ${this.config.name}...`);

    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      
      // Format dates as DD/MM/YYYY
      const startDate = this.formatDateBR(this.dateRange.start);
      const endDate = this.formatDateBR(this.dateRange.end);
      
      logger.info(`Searching gazettes from ${startDate} to ${endDate}`);
      
      // Navigate to search page
      const searchUrl = `${this.baseUrl}/jornal.php?dtini=${startDate}&dtfim=${endDate}`;
      await page.goto(searchUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      
      this.requestCount++;
      
      // Get last page number
      const lastPage = await this.getLastPageNumber(page);
      logger.info(`Found ${lastPage} page(s) to process`);
      
      // Iterate through pages
      for (let pageNum = 1; pageNum <= lastPage; pageNum++) {
        if (pageNum > 1) {
          const pageUrl = `${searchUrl}&pagina=${pageNum}`;
          await page.goto(pageUrl, { waitUntil: 'networkidle0', timeout: 30000 });
          this.requestCount++;
        }
        
        logger.info(`Processing page ${pageNum}/${lastPage}`);
        
        // Extract gazettes from current page
        const pageGazettes = await this.extractGazettesFromPage(page);
        gazettes.push(...pageGazettes);
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from ADiarios V2`);
      
    } catch (error) {
      logger.error(`Error crawling ADiarios V2: ${error}`);
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
   * Extract the last page number from pagination
   */
  private async getLastPageNumber(page: any): Promise<number> {
    try {
      // Try to extract from pagination: .pagination li a span::text
      const paginationText = await page.$$eval('.pagination li a span', 
        (elements: any[]) => elements.map((el: any) => el.textContent)
      ).catch(() => []);
      
      if (paginationText.length > 0) {
        const numbers = paginationText
          .map((text: string) => parseInt(text.trim()))
          .filter((num: number) => !isNaN(num));
        
        if (numbers.length > 0) {
          return Math.max(...numbers);
        }
      }
      
      // If no pagination found, assume single page
      return 1;
    } catch (error) {
      logger.warn('Error extracting page number, assuming single page', error as Error);
      return 1;
    }
  }

  /**
   * Extract gazettes from current page
   */
  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Get all table rows (skip header)
      const rows = await page.$$('table tr');
      
      if (rows.length <= 1) {
        logger.info('No gazette rows found on this page');
        return gazettes;
      }
      
      // Skip first row (header)
      for (let i = 1; i < rows.length; i++) {
        try {
          const row = rows[i];
          
          // Extract date
          const dateText = await row.$eval('td[data-title="Publicação"]', 
            (el: any) => el.textContent
          ).catch(() => null);
          
          if (!dateText) {
            logger.warn(`Skipping row ${i}: no date found`);
            continue;
          }
          
          const [day, month, year] = dateText.trim().split('/');
          const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
          
          // Extract edition number
          const editionText = await row.$eval('td[data-title="Número"]', 
            (el: any) => el.textContent
          ).catch(() => '');
          
          const isExtraEdition = /complementar|suplement|extra|especial|anexo/i.test(editionText);
          const editionNumber = editionText.trim();
          
          // Extract gazette ID from link
          const href = await row.$eval('td a', (el: any) => el.getAttribute('href')).catch(() => null);
          
          if (!href) {
            logger.warn(`Skipping row ${i}: no link found`);
            continue;
          }
          
          const idMatch = href.match(/id=(\d+)/);
          if (!idMatch) {
            logger.warn(`Skipping row ${i}: could not extract gazette ID from ${href}`);
            continue;
          }
          
          const gazetteId = idMatch[1];
          
          // Navigate to intermediary page to get PDF URL
          const gazetteUrl = `${this.baseUrl}/jornal.php?id=${gazetteId}`;
          const pdfUrl = await this.getPdfUrl(page, gazetteUrl);
          
          if (pdfUrl) {
            const gazette = await this.createGazette(new Date(date), pdfUrl, {
              editionNumber,
              isExtraEdition,
              power: 'executive',
            });
            
            if (gazette) {
              gazettes.push(gazette);
            }
            
            logger.info(`Extracted gazette: ${date} - ${editionNumber}`);
          } else {
            logger.warn(`Could not extract PDF URL for gazette ${gazetteId}`);
          }
          
        } catch (error) {
          logger.warn(`Error processing row ${i}`, error as Error);
          continue;
        }
      }
      
    } catch (error) {
      logger.error('Error extracting gazettes from page', error as Error);
    }
    
    return gazettes;
  }

  /**
   * Navigate to gazette detail page and extract PDF URL
   */
  private async getPdfUrl(page: any, gazetteUrl: string): Promise<string | null> {
    try {
      await page.goto(gazetteUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Try to find PDF link in the page
      const pdfPath = await page.$eval('div.public_paginas > div.titulo > a', 
        (el: any) => el.getAttribute('href')
      ).catch(() => null);
      
      if (!pdfPath) {
        // Try alternative selectors
        const altPdfPath = await page.$eval('a[href*=".pdf"]', 
          (el: any) => el.getAttribute('href')
        ).catch(() => null);
        
        if (altPdfPath) {
          return this.normalizeUrl(altPdfPath);
        }
        
        return null;
      }
      
      return this.normalizeUrl(pdfPath);
      
    } catch (error) {
      logger.warn(`Error getting PDF URL from ${gazetteUrl}`, error as Error);
      return null;
    }
  }

  /**
   * Normalize URL (handle relative paths)
   */
  private normalizeUrl(url: string): string {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    
    // Remove leading slash if present
    const cleanPath = url.startsWith('/') ? url.substring(1) : url;
    return `${this.baseUrl}/${cleanPath}`;
  }

  /**
   * Format ISO date to Brazilian format (DD/MM/YYYY)
   */
  private formatDateBR(isoDate: string): string {
    const [year, month, day] = isoDate.split('-');
    return `${day}/${month}/${year}`;
  }
}
