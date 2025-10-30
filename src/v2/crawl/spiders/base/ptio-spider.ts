import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PtioConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../../../utils/logger'

/**
 * Spider for PTIO platform (portaldatransparencia.com.br)
 * Used by 3 cities in Rio de Janeiro
 */
export class PtioSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PtioConfig;
    this.baseUrl = platformConfig.baseUrl;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling PTIO for ${this.config.name}...`);

    try {
      let currentPage = 1;
      let hasNextPage = true;
      
      while (hasNextPage) {
        const url = currentPage === 1 ? this.baseUrl : `${this.baseUrl}?pagina=${currentPage}`;
        
        logger.debug(`Fetching page ${currentPage}: ${url}`);
        
        const response = await fetch(url);
        if (!response.ok) {
          logger.warn(`Failed to fetch page ${currentPage}: ${response.status}`);
          break;
        }

        const html = await response.text();
        
        // Parse gazette divs
        const gazetteMatches = html.matchAll(/<div[^>]*class="edicoes"[^>]*>([\s\S]*?)<\/div>/g);
        let foundGazettes = 0;
        
        for (const match of gazetteMatches) {
          const gazetteHtml = match[1];
          
          // Extract date
          const dateMatch = gazetteHtml.match(/class="data-caderno[^"]*"[^>]*>([^<]+)</);
          if (!dateMatch) continue;
          
          const rawDate = dateMatch[1].trim();
          // Parse date (format: "DD/MM/YYYY" or similar)
          const dateParts = rawDate.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateParts) continue;
          
          const [_, day, month, year] = dateParts;
          const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
          
          // Check date range
          if (date > this.dateRange.end) continue;
          if (date < this.dateRange.start) {
            hasNextPage = false;
            break;
          }
          
          // Extract edition number
          const editionMatch = gazetteHtml.match(/class="edicao"[^>]*>.*?<strong[^>]*>Edição\s+(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1].replace('.', '') : undefined;
          
          // Extract gazette URL
          const urlMatch = gazetteHtml.match(/<button[^>]*href="([^"]+)"/);
          if (!urlMatch) continue;
          
          const subDir = urlMatch[1];
          const queryIndex = subDir.indexOf('?');
          if (queryIndex === -1) continue;
          
          const fileUrl = `${this.baseUrl.split('/').slice(0, 3).join('/')}${subDir.substring(queryIndex)}`;
          
          gazettes.push({
            date,
            editionNumber,
            fileUrl,
            territoryId: this.config.territoryId,
            isExtraEdition: false,
            power: 'executive',
            scrapedAt: new Date().toISOString(),
          });
          
          foundGazettes++;
        }
        
        logger.debug(`Found ${foundGazettes} gazettes on page ${currentPage}`);
        
        // Check for next page
        const nextPageMatch = html.match(/<a[^>]*class="proximo"[^>]*href="([^"]+)"/);
        hasNextPage = !!nextPageMatch && foundGazettes > 0;
        
        if (hasNextPage) {
          currentPage++;
          // Add delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from PTIO`);
    } catch (error) {
      logger.error(`Error crawling PTIO: ${error}`);
      throw error;
    }

    return gazettes;
  }
}
