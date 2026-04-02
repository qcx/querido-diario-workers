import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, AdiariosConfig } from '../../types';
import { logger } from '../../../../utils/logger'
// @ts-ignore
import { parse } from 'node-html-parser';

/**
 * BaseAdiariosV1Spider implementation for Cloudflare Workers
 * 
 * ADiarios V1 is a common platform layout used by many Brazilian municipalities.
 * The platform has a simple structure:
 * 
 * 1. Main page with date filter: /diariooficial.php?dtini={start}&dtfim={end}
 * 2. Pagination: &pagina={page_number}
 * 3. Each gazette has an ID that's used to download the PDF
 * 4. PDF URL: /arquivos_download.php?id={gazette_id}&pg=diariooficial
 * 
 * Date format: DD/MM/YYYY
 */
export class ADiariosV1Spider extends BaseSpider {
  protected adiariosConfig: AdiariosConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.adiariosConfig = spiderConfig.config as AdiariosConfig;
    
    if (!this.adiariosConfig.baseUrl) {
      throw new Error(`ADiariosV1Spider requires a baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing ADiariosV1Spider for ${spiderConfig.name} with URL: ${this.adiariosConfig.baseUrl}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.adiariosConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Format dates as DD/MM/YYYY
      const startDate = this.formatBrazilianDate(new Date(this.dateRange.start));
      const endDate = this.formatBrazilianDate(new Date(this.dateRange.end));
      
      // Step 1: Fetch first page to get total pages
      const firstPageUrl = `${this.adiariosConfig.baseUrl}/diariooficial.php?dtini=${startDate}&dtfim=${endDate}`;
      logger.info(`Fetching first page: ${firstPageUrl}`);
      
      const firstPageHtml = await this.fetch(firstPageUrl);
      const firstPageRoot = parse(firstPageHtml);
      
      // Get last page number from pagination
      const lastPageNumber = this.getLastPageNumber(firstPageRoot);
      logger.info(`Total pages to fetch: ${lastPageNumber}`);
      
      // Step 2: Fetch all pages
      const pagePromises: Promise<string>[] = [];
      
      // Process first page
      pagePromises.push(Promise.resolve(firstPageHtml));
      
      // Fetch remaining pages
      for (let page = 2; page <= lastPageNumber; page++) {
        const pageUrl = `${firstPageUrl}&pagina=${page}`;
        pagePromises.push(this.fetch(pageUrl));
      }
      
      const allPagesHtml = await Promise.all(pagePromises);
      
      // Step 3: Parse all pages
      for (const pageHtml of allPagesHtml) {
        const root = parse(pageHtml);
        const gazetteElements = root.querySelectorAll('#diario_lista');
        
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
   * Parse a single gazette element from the listing
   */
  private async parseGazetteElement(gazetteElement: any): Promise<Gazette | null> {
    try {
      // Extract date
      const dateText = gazetteElement.querySelector('.calendarioIcon')?.text?.trim();
      if (!dateText) {
        logger.warn(`Could not extract date from gazette element`);
        return null;
      }
      
      const dateMatch = dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (!dateMatch) {
        logger.warn(`Invalid date format: ${dateText}`);
        return null;
      }
      
      const [, day, month, year] = dateMatch;
      const gazetteDate = new Date(`${year}-${month}-${day}`);
      
      // Check if date is in range
      if (!this.isInDateRange(gazetteDate)) {
        return null;
      }
      
      // Extract edition number and title
      const strongText = gazetteElement.querySelector('span strong')?.text || '';
      const editionMatch = strongText.match(/:\s*(\d+)\.*\//);
      const editionNumber = editionMatch ? editionMatch[1] : 'N/A';
      
      // Get title (second span text)
      const spanTexts = gazetteElement.querySelectorAll('span');
      let title = '';
      if (spanTexts.length > 1) {
        // Get all text nodes from the second span
        const secondSpan = spanTexts[1];
        title = secondSpan.text || '';
      }
      
      // Check if it's an extra edition
      const isExtraEdition = /complementar|suplementar|extra|especial/i.test(title) || 
                             /complementar|suplementar|extra|especial/i.test(strongText);
      
      // Determine power
      const power = this.getPower(title);
      
      // Extract gazette ID from link
      const link = gazetteElement.querySelector('a');
      const href = link?.getAttribute('href') || '';
      const idMatch = href.match(/id=(\d+)/);
      
      if (!idMatch) {
        logger.warn(`Could not extract gazette ID from href: ${href}`);
        return null;
      }
      
      const gazetteId = idMatch[1];
      const fileUrl = `${this.adiariosConfig.baseUrl}/arquivos_download.php?id=${gazetteId}&pg=diariooficial`;
      
      return await this.createGazette(gazetteDate, fileUrl, {
        editionNumber,
        isExtraEdition,
        power,
      });
      
    } catch (error) {
      logger.error(`Error parsing gazette element:`, error as Error);
      return null;
    }
  }

  /**
   * Get the last page number from pagination
   */
  private getLastPageNumber(root: any): number {
    try {
      const paginationItems = root.querySelectorAll('.pagination li a span');
      const pageNumbers: number[] = [];
      
      for (const item of paginationItems) {
        const text = item.text?.trim();
        if (text) {
          const num = parseInt(text, 10);
          if (!isNaN(num)) {
            pageNumbers.push(num);
          }
        }
      }
      
      if (pageNumbers.length === 0) {
        return 1; // No pagination, only one page
      }
      
      return Math.max(...pageNumbers);
    } catch (error) {
      logger.warn(`Error getting last page number, defaulting to 1:`, error as Error);
      return 1;
    }
  }

  /**
   * Determine the power (executive/legislative) from the title
   */
  private getPower(title: string): 'executive' | 'legislative' | 'executive_legislative' {
    const normalizedTitle = title.toLowerCase().trim();
    
    if (normalizedTitle.includes('executivo')) {
      return 'executive';
    } else if (normalizedTitle.includes('legislativo')) {
      return 'legislative';
    } else {
      // Categories like "Terceiro" and "Especial" are unclear
      // So they're considered "executive_legislative"
      return 'executive_legislative';
    }
  }

  /**
   * Format date as DD/MM/YYYY for ADiarios platform
   */
  private formatBrazilianDate(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }
}
