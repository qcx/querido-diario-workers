import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, DioenetConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../../../utils/logger'

/**
 * Spider for Dioenet platform (plenussistemas.dioenet.com.br)
 * Used by 4 cities (RJ, SP, PR)
 */
export class DioenetSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as DioenetConfig;
    this.baseUrl = platformConfig.baseUrl;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Dioenet for ${this.config.name}...`);

    try {
      // Generate weekly windows
      const weeks = this.generateWeeklyWindows();
      
      for (const week of weeks) {
        let currentPage = 1;
        let hasNextPage = true;
        
        while (hasNextPage) {
          const url = `${this.baseUrl}?d=${week}&pagina=${currentPage}`;
          
          logger.debug(`Fetching: ${url}`);
          
          const response = await fetch(url);
          if (!response.ok) {
            logger.warn(`Failed to fetch page ${currentPage}: ${response.status}`);
            break;
          }

          const html = await response.text();
          
          // Parse gazette list
          const gazetteMatches = html.matchAll(/<li[^>]*class="[^"]*diario[^"]*"[^>]*>([\s\S]*?)<\/li>/g);
          let foundGazettes = 0;
          
          for (const match of gazetteMatches) {
            const gazetteHtml = match[1];
            
            // Extract edition number
            const editionMatch = gazetteHtml.match(/Edição nº\s*(\d+)/i);
            if (!editionMatch) continue;
            const editionNumber = editionMatch[1];
            
            // Check if extra edition
            const isExtraEdition = /Extra/i.test(gazetteHtml);
            
            // Extract gazette URL
            const urlMatch = gazetteHtml.match(/href="([^"]+)"/);
            if (!urlMatch) continue;
            const gazettePageUrl = urlMatch[1];
            
            // Extract date from title attribute
            const dateMatch = gazetteHtml.match(/title="[^"]*(\d{2}\/\d{2}\/\d{4})[^"]*"/);
            if (!dateMatch) continue;
            
            const [day, month, year] = dateMatch[1].split('/');
            const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            
            // Fetch the gazette page to get the actual PDF URL
            try {
              const gazettePageResponse = await fetch(gazettePageUrl);
              const gazettePageHtml = await gazettePageResponse.text();
              
              // Extract PDF URL from iframe
              const iframeMatch = gazettePageHtml.match(/<iframe[^>]*src="([^"]+)"/);
              if (iframeMatch) {
                const iframeSrc = iframeMatch[1];
                const fileMatch = iframeSrc.match(/file=([^&]+)/);
                if (fileMatch) {
                  const fileUrl = decodeURIComponent(fileMatch[1]);
                  
                  gazettes.push({
                    date,
                    editionNumber,
                    fileUrl,
                    territoryId: this.config.territoryId,
                    isExtraEdition,
                    power: 'executive',
                    scrapedAt: new Date().toISOString(),
                  });
                  
                  foundGazettes++;
                }
              }
            } catch (error) {
              logger.warn(`Failed to fetch gazette page: ${gazettePageUrl}`);
            }
            
            // Add delay between requests
            await new Promise(resolve => setTimeout(resolve, 300));
          }
          
          logger.debug(`Found ${foundGazettes} gazettes on page ${currentPage}`);
          
          // Check for next page
          hasNextPage = /<li[^>]*class="[^"]*next[^"]*page[^"]*"/.test(html) && foundGazettes > 0;
          if (hasNextPage) {
            currentPage++;
          }
        }
        
        // Add delay between weeks
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from Dioenet`);
    } catch (error) {
      logger.error(`Error crawling Dioenet: ${error}`);
      throw error;
    }

    return gazettes;
  }

  /**
   * Generate weekly windows in format "DD/MM/YYYY a DD/MM/YYYY"
   */
  private generateWeeklyWindows(): string[] {
    const windows: string[] = [];
    const start = new Date(this.dateRange.start);
    const end = new Date(this.dateRange.end);
    
    let current = new Date(start);
    
    while (current <= end) {
      const weekStart = new Date(current);
      const weekEnd = new Date(current);
      weekEnd.setDate(weekEnd.getDate() + 6);
      
      // Don't exceed end date
      if (weekEnd > end) {
        weekEnd.setTime(end.getTime());
      }
      
      const formatDate = (date: Date) => {
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
      };
      
      windows.push(`${formatDate(weekStart)} a ${formatDate(weekEnd)}`);
      
      current.setDate(current.getDate() + 7);
    }
    
    return windows;
  }
}
