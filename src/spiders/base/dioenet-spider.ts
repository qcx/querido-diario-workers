import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, DioenetConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * API response item from dioenet
 */
interface DioenetApiItem {
  title: string; // e.g., "Ed.264" or "Ed.262 Extra"
  start: string; // e.g., "2025-12-30"
  url: string;   // e.g., "https://plenussistemas.dioenet.com.br/uploads/view/32543"
}

/**
 * Spider for Dioenet platform (plenussistemas.dioenet.com.br)
 * Uses the JSON API to fetch gazette listings
 */
export class DioenetSpider extends BaseSpider {
  private baseUrl: string;
  private cityId: number;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as DioenetConfig;
    this.baseUrl = platformConfig.baseUrl;
    this.cityId = platformConfig.cityId;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Dioenet for ${this.config.name} (cityId: ${this.cityId})...`);

    try {
      // Format dates for API
      const startDate = new Date(this.dateRange.start);
      const endDate = new Date(this.dateRange.end);
      
      // Add buffer to end date to ensure we capture all gazettes
      endDate.setDate(endDate.getDate() + 1);
      
      const formatDateForApi = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}T00:00:00-03:00`;
      };
      
      const apiUrl = `https://plenussistemas.dioenet.com.br/uploads/diariosList/${this.cityId}?start=${encodeURIComponent(formatDateForApi(startDate))}&end=${encodeURIComponent(formatDateForApi(endDate))}`;
      
      logger.debug(`Fetching API: ${apiUrl}`);
      
      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const items: DioenetApiItem[] = await response.json();
      
      logger.debug(`API returned ${items.length} items`);
      
      for (const item of items) {
        // Filter by date range
        const itemDate = new Date(item.start);
        if (itemDate < new Date(this.dateRange.start) || itemDate > new Date(this.dateRange.end)) {
          continue;
        }
        
        // Extract edition number from title (e.g., "Ed.264" or "Ed.262 Extra")
        const editionMatch = item.title.match(/Ed\.?\s*(\d+)/i);
        const editionNumber = editionMatch ? editionMatch[1] : undefined;
        
        // Check if extra edition
        const isExtraEdition = /Extra/i.test(item.title);
        
        // Fetch the view page to get the actual PDF URL
        try {
          const viewResponse = await fetch(item.url);
          if (!viewResponse.ok) {
            logger.warn(`Failed to fetch view page: ${item.url}`);
            continue;
          }

          const viewHtml = await viewResponse.text();
          
          // Extract PDF URL from the page
          // The PDF URL is embedded in the viewer.php src with file= parameter
          const fileMatch = viewHtml.match(/file=([^"&]+)/);
          if (!fileMatch) {
            logger.warn(`Could not find PDF URL in view page: ${item.url}`);
            continue;
          }
          
          const fileUrl = decodeURIComponent(fileMatch[1]);
          
          gazettes.push({
            date: item.start,
            editionNumber,
            fileUrl,
            territoryId: this.config.territoryId,
            isExtraEdition,
            power: 'executive',
            scrapedAt: new Date().toISOString(),
          });
          
          logger.debug(`Found gazette: ${item.title} - ${item.start} - ${fileUrl}`);
          
        } catch (error) {
          logger.warn(`Failed to fetch gazette view page: ${item.url} - ${error}`);
        }
        
        // Add delay between requests to avoid overloading the server
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from Dioenet`);
    } catch (error) {
      logger.error(`Error crawling Dioenet: ${error}`);
      throw error;
    }

    return gazettes;
  }
}
