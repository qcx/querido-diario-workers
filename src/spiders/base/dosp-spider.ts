import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, DospConfig } from '../../types';
import { logger } from '../../utils/logger';

/**
 * BaseDospSpider implementation for Cloudflare Workers
 * 
 * The DOSP platform (Diário Oficial de São Paulo) is used by many Brazilian municipalities
 * to publish their official gazettes. The platform has a two-step process:
 * 
 * 1. Fetch the initial page to extract the API code from JavaScript
 * 2. Call the JSON API to get all gazette data
 * 3. Generate PDF URLs using base64-encoded gazette IDs
 * 
 * API URL pattern: https://dosp.com.br/api/index.php/dioe.js/{code}
 * PDF URL pattern: https://dosp.com.br/exibe_do.php?i={base64(iddo)}.pdf
 */
export class DospSpider extends BaseSpider {
  protected dospConfig: DospConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.dospConfig = spiderConfig.config as DospConfig;
    
    if (!this.dospConfig.url) {
      throw new Error(`DospSpider requires a url in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing DospSpider for ${spiderConfig.name} with URL: ${this.dospConfig.url}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.dospConfig.url} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Step 1: Fetch the initial page to extract the API code
      logger.info(`Fetching initial page: ${this.dospConfig.url}`);
      const pageHtml = await this.fetch(this.dospConfig.url);
      
      // Extract API code from JavaScript
      const codeMatch = pageHtml.match(/urlapi\+['"]\.js\/(\d+)\/['"]\+idsecao/);
      
      if (!codeMatch) {
        logger.error(`Could not extract API code from page: ${this.dospConfig.url}`);
        return gazettes;
      }
      
      const apiCode = codeMatch[1];
      logger.info(`Extracted API code: ${apiCode}`);
      
      // Step 2: Fetch JSON data from API
      const apiUrl = `https://dosp.com.br/api/index.php/dioe.js/${apiCode}`;
      logger.info(`Fetching API data: ${apiUrl}`);
      
      const apiResponse = await this.fetch(apiUrl);
      
      // Parse the JSONP response
      // Format: parseResponse({ "meta": {...}, "data": [...] });
      const jsonMatch = apiResponse.match(/parseResponse\((.*)\);?$/s);
      
      if (!jsonMatch) {
        logger.error(`Could not parse JSONP response from API`);
        return gazettes;
      }
      
      const jsonData = JSON.parse(jsonMatch[1]);
      const gazetteData = jsonData.data || [];
      
      logger.info(`Found ${gazetteData.length} gazettes in API response`);
      
      // Step 3: Process each gazette
      for (const item of gazetteData) {
        const gazette = this.parseGazetteItem(item);
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
   * Parse a single gazette item from the API response
   * 
   * Item structure:
   * {
   *   "iddo": "719590",
   *   "data": "2025-10-02",
   *   "edicao_do": "541",
   *   "flag_extra": 0,
   *   ...
   * }
   */
  private parseGazetteItem(item: any): Gazette | null {
    try {
      // Parse date
      const dateStr = item.data; // Format: YYYY-MM-DD
      const gazetteDate = new Date(dateStr);
      
      // Check if date is in range
      if (!this.isInDateRange(gazetteDate)) {
        return null;
      }
      
      // Generate PDF URL from iddo
      const iddo = String(item.iddo);
      const base64Id = this.base64Encode(iddo);
      const pdfUrl = `https://dosp.com.br/exibe_do.php?i=${base64Id}.pdf`;
      
      // Extract edition number
      const editionNumber = item.edicao_do ? String(item.edicao_do) : 'N/A';
      
      // Check if it's an extra edition
      const isExtraEdition = item.flag_extra > 0;
      
      return this.createGazette(gazetteDate, pdfUrl, {
        editionNumber,
        isExtraEdition,
        power: 'executive',
      });
      
    } catch (error) {
      logger.error(`Error parsing gazette item:`, error as Error);
      return null;
    }
  }

  /**
   * Base64 encode a string (compatible with browser's btoa)
   */
  private base64Encode(str: string): string {
    // In Node.js/Cloudflare Workers, we can use Buffer
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(str, 'utf-8').toString('base64');
    }
    
    // Fallback for browser environments
    return btoa(str);
  }
}
