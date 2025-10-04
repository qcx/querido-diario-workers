import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, ModernizacaoConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for Modernizacao platform
 * Used by 7 cities in Rio de Janeiro
 */
export class ModernizacaoSpider extends BaseSpider {
  private domain: string;
  private verSubpath: string;
  private filterEndpoint: string;
  private editionEndpoint: string;
  private power: 'executive' | 'legislative' | 'executive_legislative';

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as ModernizacaoConfig;
    
    this.domain = platformConfig.domain;
    this.verSubpath = platformConfig.verSubpath || 'ver20230623';
    this.filterEndpoint = 'diario_oficial_get';
    this.editionEndpoint = 'WEB-ObterAnexo.rule';
    this.power = platformConfig.power || 'executive_legislative';
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Modernizacao for ${this.config.name}...`);

    try {
      // Generate monthly sequence
      const months = this.generateMonthlySequence();
      
      for (const monthYear of months) {
        const baseUrl = `https://${this.domain}/${this.filterEndpoint}.php`;
        
        logger.debug(`Fetching month: ${monthYear}`);
        
        const response = await fetch(baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: `mesano=${monthYear}`,
        });

        if (!response.ok) {
          logger.warn(`Failed to fetch month ${monthYear}: ${response.status}`);
          continue;
        }

        const data = await response.json() as any[];
        
        for (const gazetteData of data) {
          const rawDate = gazetteData.Data_Formatada;
          const [day, month, year] = rawDate.split('/');
          const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
          
          // Check date range
          if (date > this.dateRange.end) continue;
          if (date < this.dateRange.start) break;
          
          const gazetteCode = gazetteData.Codigo_ANEXO;
          const fileUrl = `https://${this.domain}/${this.verSubpath}/${this.editionEndpoint}?sys=LAI&codigo=${gazetteCode}`;
          
          const rawEditionNumber = gazetteData.ANEXO;
          const editionMatch = rawEditionNumber.match(/\d+/);
          const editionNumber = editionMatch ? editionMatch[0] : undefined;
          
          const isExtraEdition = /extra|supl|ee|esp/i.test(rawEditionNumber);
          
          gazettes.push({
            date,
            editionNumber,
            fileUrl,
            territoryId: this.config.territoryId,
            isExtraEdition,
            power: this.power,
            scrapedAt: new Date().toISOString(),
          });
        }
        
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 750));
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from Modernizacao`);
    } catch (error) {
      logger.error(`Error crawling Modernizacao: ${error}`);
      throw error;
    }

    return gazettes;
  }

  /**
   * Generate monthly sequence in format "M/YYYY" (without leading zero)
   */
  private generateMonthlySequence(): string[] {
    const months: string[] = [];
    const start = new Date(this.dateRange.start);
    const end = new Date(this.dateRange.end);
    
    const current = new Date(start.getFullYear(), start.getMonth(), 1);
    
    while (current <= end) {
      const month = current.getMonth() + 1; // 1-12
      const year = current.getFullYear();
      months.push(`${month}/${year}`);
      
      current.setMonth(current.getMonth() + 1);
    }
    
    return months;
  }
}
