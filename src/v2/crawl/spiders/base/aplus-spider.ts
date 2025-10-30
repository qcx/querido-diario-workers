import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, AplusConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../../../utils/logger'

/**
 * Spider for Aplus platform
 * Used by 4 cities in Maranhão
 */
export class AplusSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as AplusConfig;
    this.baseUrl = platformConfig.baseUrl;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Aplus for ${this.config.name}...`);

    try {
      // Format dates as YYYY/MM/DD
      const startDate = this.dateRange.start.replace(/-/g, '/');
      const endDate = this.dateRange.end.replace(/-/g, '/');
      
      const formData = new URLSearchParams({
        data: startDate,
        data2: endDate,
        termo: '',
        submit: '',
      });

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });

      if (!response.ok) {
        logger.warn(`Failed to fetch Aplus data: ${response.status}`);
        return gazettes;
      }

      const html = await response.text();
      
      // Parse table rows
      const rowMatches = html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g);
      
      for (const match of rowMatches) {
        const rowHtml = match[1];
        
        // Skip header and empty rows
        if (rowHtml.includes('Nenhum registro encontrado') || rowHtml.includes('<th')) {
          continue;
        }
        
        // Extract date (second td)
        const dateMatch = rowHtml.match(/<td[^>]*>.*?<\/td>\s*<td[^>]*>(\d{2}\/\d{2}\/\d{4})<\/td>/);
        if (!dateMatch) continue;
        
        const [day, month, year] = dateMatch[1].split('/');
        const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        
        // Extract edition number (first td)
        const editionMatch = rowHtml.match(/<td[^>]*>([^<]+)<\/td>/);
        let editionNumber: string | undefined;
        if (editionMatch) {
          const editionNumberMatch = editionMatch[1].match(/(\d+)\//);
          editionNumber = editionNumberMatch ? editionNumberMatch[1] : undefined;
        }
        
        // Extract URL
        const urlMatch = rowHtml.match(/href="([^"]+)"/);
        if (!urlMatch) continue;
        
        const fileUrl = urlMatch[1].startsWith('http') 
          ? urlMatch[1] 
          : `${this.baseUrl}${urlMatch[1]}`;
        
        // Check if extra edition (ends with -digit)
        const isExtraEdition = editionNumber ? /-\d+$/.test(editionNumber) : false;
        
        gazettes.push({
          date,
          editionNumber,
          fileUrl,
          territoryId: this.config.territoryId,
          isExtraEdition,
          power: 'executive',
          scrapedAt: new Date().toISOString(),
        });
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from Aplus`);
    } catch (error) {
      logger.error(`Error crawling Aplus: ${error}`);
      throw error;
    }

    return gazettes;
  }
}
