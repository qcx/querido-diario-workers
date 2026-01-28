import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp } from '../../utils/date-utils';

/**
 * Configuration for Recife DOME spider
 */
export interface PrefeituraRecifeConfig {
  type: "prefeiturarecife";
  /** Base URL for the DOME portal */
  baseUrl: string;
}

/**
 * PrefeituraRecifeSpider implementation
 * 
 * Crawls the DOME (Diário Oficial Municipal Eletrônico) portal for Recife - PE.
 * The portal uses a calendar-based interface with PDFs stored in a predictable pattern:
 * https://dome.recife.pe.gov.br/upload_dome/DO__XXX_DD.MM.YY-assinado.pdf
 * 
 * The site has editions since 30/04/2015.
 * 
 * Example: https://dome.recife.pe.gov.br/dome/
 */
export class PrefeituraRecifeSpider extends BaseSpider {
  private readonly domeConfig: PrefeituraRecifeConfig;
  private readonly baseUrl: string;
  private readonly uploadBaseUrl = 'https://dome.recife.pe.gov.br/upload_dome/';

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.domeConfig = spiderConfig.config as PrefeituraRecifeConfig;
    this.baseUrl = this.domeConfig.baseUrl || 'https://dome.recife.pe.gov.br/dome/';
    
    logger.info(`Initializing PrefeituraRecifeSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling DOME Recife from ${toISODate(this.startDate)} to ${toISODate(this.endDate)}...`);
    const gazettes: Gazette[] = [];

    try {
      // Fetch the main page to analyze the calendar data
      const response = await fetch(this.baseUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        },
      });

      if (!response.ok) {
        logger.error(`Failed to fetch DOME page: ${response.status} ${response.statusText}`);
        return gazettes;
      }

      const html = await response.text();
      
      // Parse the HTML to extract calendar data and PDF links
      // Look for patterns like: "DO__052_26.04.25-assinado.pdf"
      const pdfPattern = /DO__(\d+)_(\d{2})\.(\d{2})\.(\d{2})-assinado\.pdf/g;
      const matches = [...html.matchAll(pdfPattern)];
      
      logger.info(`Found ${matches.length} PDF references in the page`);
      
      // Also check for JSON data in script tags that might contain the calendar
      const jsonDataPattern = /var\s+calendarData\s*=\s*(\[[\s\S]*?\]);/;
      const jsonMatch = html.match(jsonDataPattern);
      
      if (jsonMatch) {
        try {
          const calendarData = JSON.parse(jsonMatch[1]);
          logger.info(`Found calendar data with ${calendarData.length} entries`);
        } catch (e) {
          logger.debug('Could not parse calendar JSON data');
        }
      }

      // Generate dates in the range and try to fetch each
      const currentDate = new Date(this.startDate);
      const endDateObj = new Date(this.endDate);
      
      while (currentDate <= endDateObj) {
        const day = currentDate.getDate().toString().padStart(2, '0');
        const month = (currentDate.getMonth() + 1).toString().padStart(2, '0');
        const year = currentDate.getFullYear().toString().slice(-2);
        const fullYear = currentDate.getFullYear();
        
        // Try different edition number patterns
        // The pattern seems to be: DO__XXX_DD.MM.YY-assinado.pdf
        // where XXX is an incrementing edition number
        
        // For now, we'll try to probe for PDFs by checking the date pattern
        const dateStr = `${day}.${month}.${year}`;
        
        // Try to find any PDF for this date by checking a range of edition numbers
        for (let edition = 1; edition <= 999; edition++) {
          const editionStr = edition.toString().padStart(3, '0');
          const pdfUrl = `${this.uploadBaseUrl}DO__${editionStr}_${dateStr}-assinado.pdf`;
          
          try {
            const headResponse = await fetch(pdfUrl, {
              method: 'HEAD',
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              },
            });
            
            if (headResponse.ok) {
              const gazette: Gazette = {
                date: toISODate(currentDate),
                fileUrl: pdfUrl,
                territoryId: this.spiderConfig.territoryId,
                scrapedAt: getCurrentTimestamp(),
                isExtraEdition: false,
                power: 'executive_legislative',
                sourceText: `Diário Oficial de Recife - Edição ${edition} - ${day}/${month}/${fullYear}`,
              };
              
              gazettes.push(gazette);
              logger.info(`Found gazette for ${gazette.date}: Edição ${edition}`);
              break; // Found one for this date, move to next date
            }
          } catch (error) {
            // PDF doesn't exist for this edition number, continue
          }
          
          // Only try first 10 editions per date to avoid too many requests
          if (edition >= 10) break;
        }
        
        currentDate.setDate(currentDate.getDate() + 1);
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from DOME Recife`);
      
    } catch (error) {
      logger.error(`Error crawling DOME Recife:`, error as Error);
    }

    return gazettes;
  }
}
