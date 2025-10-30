import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, DiarioOficialBRConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for DiarioOficialBR platform (diariooficialbr.com.br)
 * Used by 10 cities in Tocantins
 */
export class DiarioOficialBRSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as DiarioOficialBRConfig;
    this.baseUrl = platformConfig.baseUrl;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling DiarioOficialBR for ${this.config.name}...`);

    try {
      // Format dates as YYYY-MM-DD
      const initDate = this.dateRange.start;
      const endDate = this.dateRange.end;
      
      let currentPage = 1;
      let hasNextPage = true;

      while (hasNextPage) {
        const searchUrl = `${this.baseUrl}/pesquisa/search?initDate=${initDate}&endDate=${endDate}&page=${currentPage}`;
        
        logger.debug(`Fetching page ${currentPage}: ${searchUrl}`);
        
        const response = await fetch(searchUrl);
        if (!response.ok) {
          logger.warn(`Failed to fetch page ${currentPage}: ${response.status}`);
          break;
        }

        const html = await response.text();
        
        // Parse editions
        const editionMatches = html.matchAll(/<div[^>]*class="[^"]*card-downloads[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g);
        let foundEditions = 0;

        for (const match of editionMatches) {
          const editionHtml = match[1];
          
          // Extract date
          const dateMatch = editionHtml.match(/Publicado[^<]*dia\s+(\d{2}\/\d{2}\/\d{4})/);
          if (!dateMatch) continue;
          
          const [day, month, year] = dateMatch[1].split('/');
          const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
          
          // Extract edition number
          const editionMatch = editionHtml.match(/Edição[^<]*nº\s*(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;
          
          // Check if extra edition
          const isExtraEdition = /extra/i.test(editionHtml);
          
          // Extract download URL
          const urlMatch = editionHtml.match(/href="([^"]*\/download[^"]*)"/);
          if (!urlMatch) continue;
          
          const fileUrl = urlMatch[1].startsWith('http') 
            ? urlMatch[1] 
            : `${this.baseUrl}${urlMatch[1]}`;

          gazettes.push({
            date,
            editionNumber,
            fileUrl,
            territoryId: this.config.territoryId,
            isExtraEdition,
            power: 'executive',
            scrapedAt: new Date().toISOString(),
          });
          
          foundEditions++;
        }

        logger.debug(`Found ${foundEditions} editions on page ${currentPage}`);

        // Check for next page
        const nextPageMatch = html.match(/<a[^>]*aria-label="pagination\.next"[^>]*href="([^"]*)"/);
        hasNextPage = !!nextPageMatch && foundEditions > 0;
        
        if (hasNextPage) {
          currentPage++;
          // Add delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from DiarioOficialBR`);
    } catch (error) {
      logger.error(`Error crawling DiarioOficialBR: ${error}`);
      throw error;
    }

    return gazettes;
  }
}
