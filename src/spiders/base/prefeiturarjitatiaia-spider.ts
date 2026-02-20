import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, fromISODate } from '../../utils/date-utils';

/**
 * Configuration interface for Itatiaia spider
 */
interface PrefeituraRjItatiaiaConfig {
  type: string;
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/**
 * Spider for Itatiaia-RJ gazette extraction
 * 
 * The Itatiaia website uses WordPress + JetEngine for gazette listings.
 * The structure is:
 * - Each gazette is in a div with class "jet-listing-grid__item"
 * - Date is in an h6 element in DD/MM/YYYY format
 * - Title is in an h5 element
 * - PDF link is in an anchor inside "jet-listing-dynamic-field"
 * 
 * The site also has pagination via JetEngine AJAX, but the HTML already
 * contains 16 gazettes per page which is enough for regular crawling.
 */
export class PrefeituraRjItatiaiaSpider extends BaseSpider {
  private itatiaiaConfig: PrefeituraRjItatiaiaConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.itatiaiaConfig = spiderConfig.config as PrefeituraRjItatiaiaConfig;
    
    if (!this.itatiaiaConfig.baseUrl) {
      throw new Error(`PrefeituraRjItatiaiaSpider requires baseUrl in config`);
    }
    
    logger.info(`Initializing PrefeituraRjItatiaiaSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.itatiaiaConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    let currentPage = 1;
    let hasMorePages = true;
    const maxPages = 10; // Safety limit
    
    while (hasMorePages && currentPage <= maxPages) {
      try {
        const pageGazettes = await this.fetchPage(currentPage);
        
        if (pageGazettes.length === 0) {
          hasMorePages = false;
          continue;
        }
        
        // Check if we've gone past our date range
        let foundInRange = false;
        let foundBeforeRange = false;
        
        for (const gazette of pageGazettes) {
          gazettes.push(gazette);
          const gazetteDate = fromISODate(gazette.date);
          if (this.isInDateRange(gazetteDate)) {
            foundInRange = true;
          }
          // Check if gazette date is before our start date
          if (gazetteDate < this.startDate) {
            foundBeforeRange = true;
          }
        }
        
        // If we found gazettes before our date range and none in range,
        // we've gone too far back
        if (foundBeforeRange && !foundInRange && gazettes.length > 0) {
          logger.info(`Reached gazettes before date range, stopping pagination`);
          hasMorePages = false;
        }
        
        currentPage++;
      } catch (error) {
        logger.error(`Error fetching page ${currentPage}:`, error as Error);
        hasMorePages = false;
      }
    }
    
    // Filter gazettes by date range
    logger.debug(`Filtering ${gazettes.length} gazettes. Date range: ${toISODate(this.startDate)} to ${toISODate(this.endDate)}`);
    const filteredGazettes = gazettes.filter(g => {
      const gazetteDate = fromISODate(g.date);
      const inRange = this.isInDateRange(gazetteDate);
      logger.debug(`Gazette ${g.date}: inRange=${inRange} (start=${toISODate(this.startDate)}, end=${toISODate(this.endDate)})`);
      return inRange;
    });
    
    logger.info(`Successfully crawled ${filteredGazettes.length} gazettes for ${this.spiderConfig.name}`);
    return filteredGazettes;
  }

  /**
   * Fetch a single page of gazettes
   */
  private async fetchPage(page: number): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    // Build URL with pagination
    const url = page === 1 
      ? this.itatiaiaConfig.baseUrl 
      : `${this.itatiaiaConfig.baseUrl}?jsf=jet-engine:default&tax=&pagenum=${page}`;
    
    logger.debug(`Fetching page ${page}: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    this.requestCount++;
    
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status} fetching ${url}`);
    }
    
    const html = await response.text();
    
    // Extract gazette data from HTML
    const gazetteItems = this.extractGazettesFromHtml(html);
    
    for (const item of gazetteItems) {
      try {
        const gazette = await this.createGazette(item.date, item.pdfUrl, {
          power: 'executive_legislative',
          editionNumber: item.editionNumber,
          isExtraEdition: item.isExtra,
        });
        
        if (gazette) {
          gazettes.push(gazette);
          logger.info(`Found gazette for ${toISODate(item.date)} (edição ${item.editionNumber || 'N/A'}): ${item.pdfUrl}`);
        }
      } catch (error) {
        logger.error(`Error creating gazette:`, error as Error);
      }
    }
    
    return gazettes;
  }

  /**
   * Extract gazette data from HTML using regex
   */
  private extractGazettesFromHtml(html: string): Array<{
    date: Date;
    pdfUrl: string;
    editionNumber?: string;
    isExtra: boolean;
  }> {
    const results: Array<{
      date: Date;
      pdfUrl: string;
      editionNumber?: string;
      isExtra: boolean;
    }> = [];
    
    // Match jet-listing-grid__item blocks
    // Each block contains a gazette entry
    const itemPattern = /<div class="jet-listing-grid__item[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/g;
    
    // Alternative: Match based on the structured data we know exists
    // Pattern to find date (h6), title (h5), and PDF link
    const blockPattern = /<h6[^>]*>(\d{2}\/\d{2}\/\d{4})<\/h6>[\s\S]*?<h5[^>]*>(.*?)<\/h5>[\s\S]*?<a href="([^"]+\.pdf)"[^>]*>/gi;
    
    let match;
    const processedUrls = new Set<string>();
    
    while ((match = blockPattern.exec(html)) !== null) {
      const [, dateStr, title, pdfUrl] = match;
      
      // Skip duplicates
      if (processedUrls.has(pdfUrl)) {
        continue;
      }
      processedUrls.add(pdfUrl);
      
      // Parse date DD/MM/YYYY
      const [day, month, year] = dateStr.split('/').map(Number);
      const date = new Date(year, month - 1, day);
      
      if (isNaN(date.getTime())) {
        logger.warn(`Invalid date: ${dateStr}`);
        continue;
      }
      
      // Extract edition number from title
      // Pattern: "EDIÇÃO Nº 032" or similar
      const editionMatch = title.match(/EDI[ÇC][ÃA]O\s*N[º°]?\s*(\d+)/i);
      const editionNumber = editionMatch ? editionMatch[1] : undefined;
      
      // Check if extra edition
      const isExtra = /\b(EXTRA|EXTRAORDIN[ÁA]RI[OA]|SUPLEMENTO)\b/i.test(title);
      
      results.push({
        date,
        pdfUrl,
        editionNumber,
        isExtra,
      });
    }
    
    // If no results with the primary pattern, try a more lenient approach
    if (results.length === 0) {
      logger.debug('Primary pattern found no results, trying fallback pattern');
      
      // Find all PDF links that look like gazette files
      const pdfPattern = /<a[^>]+href="(https:\/\/itatiaia\.rj\.gov\.br\/wp-content\/uploads\/\d{4}\/\d{2}\/Diario[^"]+\.pdf)"[^>]*>/gi;
      
      while ((match = pdfPattern.exec(html)) !== null) {
        const pdfUrl = match[1];
        
        if (processedUrls.has(pdfUrl)) {
          continue;
        }
        processedUrls.add(pdfUrl);
        
        // Try to extract date from URL: /2025/02/
        const urlDateMatch = pdfUrl.match(/\/(\d{4})\/(\d{2})\//);
        if (!urlDateMatch) {
          continue;
        }
        
        const year = parseInt(urlDateMatch[1]);
        const month = parseInt(urlDateMatch[2]);
        
        // Default to first of the month if we can't get exact date
        const date = new Date(year, month - 1, 1);
        
        // Try to extract edition from filename
        const editionMatch = pdfUrl.match(/Ed\.?-?(\d+)/i);
        const editionNumber = editionMatch ? editionMatch[1] : undefined;
        
        // Check if extra edition
        const isExtra = /\bExtra\b/i.test(pdfUrl);
        
        results.push({
          date,
          pdfUrl,
          editionNumber,
          isExtra,
        });
      }
    }
    
    logger.debug(`Extracted ${results.length} gazette entries from HTML`);
    return results;
  }
}
