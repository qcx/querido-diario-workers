import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, DomunicipalConfig } from '../../types';
import { logger } from '../../utils/logger';
import { fromISODate, toISODate } from '../../utils/date-utils';

/**
 * DomunicipalSpider implementation for Cloudflare Workers
 * 
 * This spider crawls the domunicipal.com.br platform which is used by various Brazilian municipalities.
 * The platform provides:
 * 
 * 1. Default view: Shows recent gazettes from the last 30 days
 *    - URL pattern: https://domunicipal.com.br/ir.php?id_orgao={orgaoId}
 * 
 * 2. Date range view: Shows gazettes for a specific date range
 *    - URL pattern: https://domunicipal.com.br/ir.php?daterange={startDate}+-+{endDate}&id_orgao={orgaoId}&palavra=&anox={year}
 *    - Date format: DD%2FMM%2FYYYY (URL encoded DD/MM/YYYY)
 * 
 * The spider extracts:
 * - PDF URLs from gazette links
 * - Edition numbers from the gazette listings
 * - Publication dates from the gazette metadata
 * - Additional context from gazette descriptions
 */
export class DomunicipalSpider extends BaseSpider {
  protected domunicipalConfig: DomunicipalConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.domunicipalConfig = spiderConfig.config as DomunicipalConfig;
    
    if (!this.domunicipalConfig.baseUrl) {
      throw new Error(`DomunicipalSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    if (!this.domunicipalConfig.orgaoId) {
      throw new Error(`DomunicipalSpider requires orgaoId in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing DomunicipalSpider for ${spiderConfig.name} with orgaoId: ${this.domunicipalConfig.orgaoId}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.domunicipalConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Build the URL with date range
      const crawlUrl = this.buildCrawlUrl();
      logger.info(`Fetching gazettes from: ${crawlUrl}`);

      console.log('🔴 Fetching DOMunicipal data for', crawlUrl);

      // Fetch the HTML page
      const pageHtml = await this.fetch(crawlUrl);
      
      // Parse the HTML to extract gazette information
      const $ = this.loadHTML(pageHtml);
      
      // Debug: Log a snippet of the HTML to see what we got
      logger.debug(`HTML snippet: ${pageHtml.substring(0, 500)}...`);
      
      // Find all gazette entries in the search results
      const gazetteElements = $('.post-id');
      logger.info(`Found ${gazetteElements.length} gazette elements on page`);
      
      // Debug: If no elements found, try alternative selectors
      if (gazetteElements.length === 0) {
        const alternativeSelectors = ['.search-result', '.gazette-item', '.result-item'];
        for (const selector of alternativeSelectors) {
          const altElements = $(selector);
          logger.debug(`Alternative selector '${selector}' found ${altElements.length} elements`);
        }
      }

      for (let i = 0; i < gazetteElements.length; i++) {
        const element = gazetteElements.eq(i);
        const gazette = await this.parseGazetteElement(element, $);
        
        if (gazette) {
          gazettes.push(gazette);
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Build the crawl URL with appropriate date range parameters
   */
  private buildCrawlUrl(): string {
    const baseUrl = this.domunicipalConfig.baseUrl;
    const orgaoId = this.domunicipalConfig.orgaoId;
    
    // Format dates as DD/MM/YYYY for the URL
    const startDateFormatted = this.formatDateForUrl(this.startDate);
    const endDateFormatted = this.formatDateForUrl(this.endDate);
    
    // Get the year for the anox parameter (required by the platform)
    const year = this.endDate.getFullYear();
    
    // Build the date range parameter (URL encoded)
    const dateRange = `${startDateFormatted} - ${endDateFormatted}`;
    const encodedDateRange = encodeURIComponent(dateRange);
    
    // Construct the full URL
    const url = `${baseUrl}/ir.php?daterange=${encodedDateRange}&id_orgao=${orgaoId}&palavra=&anox=${year}`;
    
    logger.debug(`Built crawl URL: ${url}`);
    return url;
  }

  /**
   * Format a Date object as DD/MM/YYYY for URL parameters
   */
  private formatDateForUrl(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }

  /**
   * Parse a single gazette element from the HTML
   */
  private async parseGazetteElement(element: any, $: any): Promise<Gazette | null> {
    try {
      // Extract the PDF URL from the "Abrir na Integra" link
      const pdfLink = element.find('a[href*=".pdf"]').first();
      if (pdfLink.length === 0) {
        logger.warn('No PDF link found in gazette element');
        return null;
      }
      
      const pdfUrl = pdfLink.attr('href');
      if (!pdfUrl) {
        logger.warn('PDF URL is empty');
        return null;
      }

      // Extract edition number
      const editionText = element.find('l.text-success').first().text();
      const editionMatch = editionText.match(/Edição\s*-\s*(\d+)/i);
      const editionNumber = editionMatch ? editionMatch[1] : undefined;

      // Extract publication date
      const dateText = element.find('l.text-success').eq(1).text();
      const dateMatch = dateText.match(/Data da Publicação\s*-\s*(\d{2}\/\d{2}\/\d{4})/i);
      
      if (!dateMatch) {
        logger.warn('Could not extract publication date from gazette element');
        return null;
      }

      // Parse the date (DD/MM/YYYY format)
      const [day, month, year] = dateMatch[1].split('/').map(Number);
      const gazetteDate = new Date(year, month - 1, day);

      // Check if date is in our crawl range
      if (!this.isInDateRange(gazetteDate)) {
        logger.debug(`Gazette date ${toISODate(gazetteDate)} is outside crawl range`);
        return null;
      }

      // Extract additional context from the gazette description
      const descriptionElement = element.find('b[style*="font-size: 10px"]');
      const sourceText = descriptionElement.length > 0 ? descriptionElement.text().trim() : undefined;

      // Create the gazette object
      return await this.createGazette(gazetteDate, pdfUrl, {
        editionNumber,
        isExtraEdition: false, // DOMunicipal doesn't seem to distinguish extra editions in the HTML
        power: 'executive_legislative', // Municipal gazettes typically cover both powers
        sourceText,
      });

    } catch (error) {
      logger.error('Error parsing gazette element:', error as Error);
      return null;
    }
  }
}
