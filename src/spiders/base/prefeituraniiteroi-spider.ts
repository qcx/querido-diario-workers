import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraNiteroiConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * PrefeituraNiteroiSpider for Niterói, RJ
 * 
 * Site Structure:
 * - URL pattern: https://diariooficial.niteroi.rj.gov.br/do/{year}/{monthNumber}_{monthAbbr}/{day}.pdf
 * - Example: https://diariooficial.niteroi.rj.gov.br/do/2025/01_Jan/19.pdf
 * - Month format: 01_Jan, 02_Fev, 03_Mar, 04_Abr, 05_Mai, 06_Jun,
 *   07_Jul, 08_Ago, 09_Set, 10_Out, 11_Nov, 12_Dez
 */
export class PrefeituraNiteroiSpider extends BaseSpider {
  protected niteroiConfig: PrefeituraNiteroiConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.niteroiConfig = spiderConfig.config as PrefeituraNiteroiConfig;
    
    if (!this.niteroiConfig.baseUrl) {
      throw new Error(`PrefeituraNiteroiSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraNiteroiSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.niteroiConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    const monthNames = [
      '01_Jan', '02_Fev', '03_Mar', '04_Abr', '05_Mai', '06_Jun',
      '07_Jul', '08_Ago', '09_Set', '10_Out', '11_Nov', '12_Dez'
    ];
    
    // Iterate through each day in the date range
    const currentDate = new Date(this.startDate);
    const endDate = new Date(this.endDate);
    
    while (currentDate <= endDate) {
      try {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth(); // 0-11
        const day = currentDate.getDate();
        const monthName = monthNames[month];
        
        // Construct PDF URL
        const pdfUrl = `${this.niteroiConfig.baseUrl}/do/${year}/${monthName}/${day}.pdf`;
        
        logger.debug(`Checking PDF URL: ${pdfUrl}`);
        
        // Check if PDF exists by making a HEAD request
        try {
          const response = await fetch(pdfUrl, {
            method: 'HEAD',
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; GoodFellowBot/1.0)',
            },
            signal: AbortSignal.timeout(10000),
          });
          this.requestCount++;
          
          if (response.ok && response.headers.get('content-type')?.includes('pdf')) {
            // PDF exists, create gazette
            const gazette = await this.createGazette(currentDate, pdfUrl, {
              power: 'executive_legislative',
            });
            
            if (gazette) {
              gazettes.push(gazette);
              logger.info(`Found gazette for ${toISODate(currentDate)}: ${pdfUrl}`);
            }
          } else {
            logger.debug(`PDF not found for ${toISODate(currentDate)}`);
          }
        } catch (error) {
          // PDF doesn't exist or error occurred, skip
          logger.debug(`Error checking PDF for ${toISODate(currentDate)}: ${error}`);
        }
      } catch (error) {
        logger.error(`Error processing date ${toISODate(currentDate)}:`, error as Error);
      }
      
      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    return gazettes;
  }
}
