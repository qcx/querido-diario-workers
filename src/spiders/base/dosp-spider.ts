import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, DospConfig } from '../../types';
import { logger } from '../../utils/logger';

/**
 * DospSpider implementation for Cloudflare Workers
 * 
 * This spider handles two different types of DOSP platforms:
 * 
 * 1. Traditional DOSP (imprensaoficialmunicipal.com.br) - two-step process:
 *    - Fetch the initial page to extract the API code from JavaScript
 *    - Call the JSON API to get all gazette data
 *    - Generate PDF URLs using base64-encoded gazette IDs
 *    - API URL pattern: https://dosp.com.br/api/index.php/dioe.js/{code}
 *    - PDF URL pattern: https://dosp.com.br/exibe_do.php?i={base64(iddo)}.pdf
 * 
 * 2. DOE SP API (do-api-web-search.doe.sp.gov.br) - direct API access:
 *    - Call structured API endpoint with date and journal parameters
 *    - Extract publications from hierarchical JSON structure
 *    - Generate URLs from publication slugs
 */
export class DospSpider extends BaseSpider {
  protected dospConfig: DospConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.dospConfig = spiderConfig.config as DospConfig;
    
    if (!this.dospConfig.url && !this.dospConfig.apiUrl) {
      throw new Error(`DospSpider requires either url or apiUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing DospSpider for ${spiderConfig.name} with ${this.dospConfig.apiUrl ? 'API URL' : 'URL'}: ${this.dospConfig.apiUrl || this.dospConfig.url}`);
  }

  async crawl(): Promise<Gazette[]> {
    const source = this.dospConfig.apiUrl || this.dospConfig.url;
    logger.info(`Crawling ${source} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      if (this.dospConfig.apiUrl) {
        // Use DOE SP API approach
        await this.crawlDoeSpApi(gazettes);
      } else {
        // Use traditional DOSP approach
        await this.crawlTraditionalDosp(gazettes);
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Crawl using the DOE SP API approach
   */
  private async crawlDoeSpApi(gazettes: Gazette[]): Promise<void> {
    logger.info('Using DOE SP API approach');
    const baseApiUrl = this.dospConfig.apiUrl!;
    const journalId = this.dospConfig.journalId || 'd65936d7-1ca8-4267-934e-1dea132fa237'; // Default to Municípios
    const sectionId = this.dospConfig.sectionId || 'b3477daf-479d-4f3d-7d60-08db6b94d2bf'; // Default to Atos Municipais
    
    // Iterate through each date in the range
    const currentDate = new Date(this.startDate);
    const endDate = new Date(this.endDate);
    
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0]; // YYYY-MM-DD format
      const apiUrl = `${baseApiUrl}?Date=${dateStr}&JournalId=${journalId}&SectionId=${sectionId}`;
      
      logger.info(`Fetching DOE SP API data for ${dateStr}: ${apiUrl}`);
      
      try {
        const apiResponse = await this.fetch(apiUrl);
        const jsonData = JSON.parse(apiResponse);
        
        logger.info(`DOE SP API response for ${dateStr}: ${JSON.stringify(jsonData).substring(0, 200)}...`);
        
        // Extract publications from the hierarchical structure
        this.extractPublicationsFromDoeSpResponse(jsonData, currentDate, gazettes);
        
      } catch (error) {
        logger.error(`Error fetching DOE SP API data for ${dateStr}:`, error as Error);
      }
      
      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }
  }

  /**
   * Crawl using the traditional DOSP approach
   */
  private async crawlTraditionalDosp(gazettes: Gazette[]): Promise<void> {
    // Step 1: Fetch the initial page to extract the API code
    logger.info(`Fetching initial page: ${this.dospConfig.url}`);
    const pageHtml = await this.fetch(this.dospConfig.url!);
    
    // Extract API code from JavaScript
    const codeMatch = pageHtml.match(/urlapi\+['"]\.js\/(\d+)\/['"]\+idsecao/);
    
    if (!codeMatch) {
      logger.error(`Could not extract API code from page: ${this.dospConfig.url}`);
      return;
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
      return;
    }
    
    const jsonData = JSON.parse(jsonMatch[1]);
    const gazetteData = jsonData.data || [];
    
    logger.info(`Found ${gazetteData.length} gazettes in API response`);
    
    // Step 3: Process each gazette
    for (const item of gazetteData) {
      const gazette = this.parseTraditionalGazetteItem(item);
      if (gazette) {
        gazettes.push(gazette);
      }
    }
  }

  /**
   * Extract publications from DOE SP API response
   */
  private extractPublicationsFromDoeSpResponse(jsonData: any, date: Date, gazettes: Gazette[]): void {
    if (!jsonData.items || !Array.isArray(jsonData.items)) {
      logger.warn(`No items found in DOE SP API response for ${date.toISOString().split('T')[0]}`);
      return;
    }

    // Recursively traverse the hierarchical structure to find publications
    this.traverseDoeSpItems(jsonData.items, date, gazettes);
  }

  /**
   * Recursively traverse DOE SP items to find publications
   */
  private traverseDoeSpItems(items: any[], date: Date, gazettes: Gazette[]): void {
    for (const item of items) {
      // Check if this item has publications
      if (item.publications && Array.isArray(item.publications)) {
        for (const publication of item.publications) {
          const gazette = this.parseDoeSpPublication(publication, date, item);
          if (gazette) {
            gazettes.push(gazette);
          }
        }
      }

      // Recursively check children
      if (item.children && Array.isArray(item.children)) {
        this.traverseDoeSpItems(item.children, date, gazettes);
      }
    }
  }

  /**
   * Parse a single publication from DOE SP API
   */
  private parseDoeSpPublication(publication: any, date: Date, parentItem: any): Gazette | null {
    try {
      // Check if date is in range
      if (!this.isInDateRange(date)) {
        return null;
      }

      // Extract municipality name from parent item hierarchy
      let municipalityName = 'Unknown';
      if (parentItem.name && parentItem.name !== 'Atos Municipais') {
        municipalityName = parentItem.name;
      }

      // Apply territory filter if specified
      if (this.dospConfig.territoryFilter) {
        const filterName = this.dospConfig.territoryFilter.toUpperCase();
        const itemName = municipalityName.toUpperCase();
        
        if (!itemName.includes(filterName)) {
          return null; // Skip this publication as it doesn't match the filter
        }
      }

      // Generate URL from slug
      const baseUrl = 'https://www.doe.sp.gov.br/';
      const publicationUrl = `${baseUrl}${publication.slug}`;

      return this.createGazette(date, publicationUrl, {
        power: 'executive',
        sourceText: `Municipality: ${municipalityName} | Title: ${publication.title} | ID: ${publication.id}`,
      });

    } catch (error) {
      logger.error(`Error parsing DOE SP publication:`, error as Error);
      return null;
    }
  }

  /**
   * Parse a single gazette item from the traditional DOSP API response
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
  private parseTraditionalGazetteItem(item: any): Gazette | null {
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
