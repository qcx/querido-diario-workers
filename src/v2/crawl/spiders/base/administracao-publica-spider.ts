import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, AdministracaoPublicaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../../../utils/logger'

/**
 * Spider for AdministracaoPublica platform
 * Used by 3 cities in Maranhão
 */
export class AdministracaoPublicaSpider extends BaseSpider {
  private token: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as AdministracaoPublicaConfig;
    this.token = platformConfig.token;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling AdministracaoPublica for ${this.config.name}...`);

    try {
      // Generate weekly windows
      const weeks = this.generateWeeklyWindows();
      
      for (const week of weeks) {
        const url = `https://www.administracaopublica.com.br/diario-oficial?token=${this.token}&de=${week.start}&ate=${week.end}`;
        
        logger.debug(`Fetching: ${url}`);
        
        const response = await fetch(url);
        if (!response.ok) {
          logger.warn(`Failed to fetch week ${week.start} - ${week.end}: ${response.status}`);
          continue;
        }

        const html = await response.text();
        
        // Skip if no results
        if (html.includes('Nenhum resultado encontrado')) {
          continue;
        }
        
        // Parse gazette items
        const gazetteMatches = html.matchAll(/class="[^"]*diario_item_diario__[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g);
        
        for (const match of gazetteMatches) {
          const gazetteHtml = match[1];
          
          // Extract download URL
          const hrefMatch = gazetteHtml.match(/class="[^"]*generics_button_baixar__[^"]*"[^>]*href="([^"]+)"/);
          if (!hrefMatch) continue;
          
          const fileUrl = `https://www.administracaopublica.com.br${hrefMatch[1]}`;
          
          // Extract text content
          const textMatches = gazetteHtml.match(/>([^<]+)</g);
          if (!textMatches || textMatches.length < 3) continue;
          
          const texts = textMatches.map(t => t.replace(/>/g, '').replace(/</g, '').trim()).filter(t => t);
          
          // Parse pattern: [edition, _, power?, date, _]
          let editionText = texts[0];
          let dateText = texts[texts.length - 2];
          let powerText = texts.length >= 4 ? texts[2] : '';
          
          // Extract edition number
          const editionMatch = editionText.match(/(\d+)[-\/]/);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;
          
          // Parse date
          const dateMatch = dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) continue;
          
          const [_, day, month, year] = dateMatch;
          const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
          
          // Determine power
          let power: 'executive' | 'legislative' | 'executive_legislative' = 'executive_legislative';
          if (powerText === 'EXECUTIVO') {
            power = 'executive';
          } else if (powerText === 'LEGISLATIVO') {
            power = 'legislative';
          }
          
          // Check if extra edition
          const isExtraEdition = powerText === 'EXTRA';
          
          gazettes.push({
            date,
            editionNumber,
            fileUrl,
            territoryId: this.config.territoryId,
            isExtraEdition,
            power,
            scrapedAt: new Date().toISOString(),
          });
        }
        
        // Add delay between requests
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from AdministracaoPublica`);
    } catch (error) {
      logger.error(`Error crawling AdministracaoPublica: ${error}`);
      throw error;
    }

    return gazettes;
  }

  /**
   * Generate weekly windows
   */
  private generateWeeklyWindows(): Array<{ start: string; end: string }> {
    const windows: Array<{ start: string; end: string }> = [];
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
      
      windows.push({
        start: weekStart.toISOString().split('T')[0],
        end: weekEnd.toISOString().split('T')[0],
      });
      
      current.setDate(current.getDate() + 7);
    }
    
    return windows;
  }
}
