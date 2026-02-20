import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituracubataoConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp } from '../../utils/date-utils';

/**
 * Spider for Prefeitura de Cubatão official gazette (DSJ Soluções Digitais platform)
 * 
 * Site structure:
 * - Main page: https://diariooficial.cubatao.sp.gov.br/ - shows current edition
 * - Edition page: https://diariooficial.cubatao.sp.gov.br/search_sres.php?id={base64_edition_number}
 * 
 * Strategy:
 * - Get the current edition number from the main page
 * - Iterate backwards through edition numbers
 * - Extract date from each edition page
 * - Stop when date is before the start of the date range
 * 
 * Note: The search by date feature on the site is buggy and returns incorrect results.
 * Iterating by edition number is the reliable approach.
 */
export class PrefeituracubataoSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituracubataoConfig;
    this.baseUrl = platformConfig.baseUrl || 'https://diariooficial.cubatao.sp.gov.br';
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura Cubatão for ${this.config.name}...`);

    try {
      // Get the current edition number from the main page
      const currentEdition = await this.getCurrentEditionNumber();
      
      if (!currentEdition) {
        logger.error('Could not determine current edition number');
        return [];
      }
      
      logger.info(`Current edition: ${currentEdition}`);
      
      // Iterate backwards through editions until we hit a date before our start date
      // Limit to 100 iterations to prevent infinite loops
      const maxIterations = 100;
      let consecutiveOutOfRange = 0;
      const maxConsecutiveOutOfRange = 5; // Stop after 5 consecutive editions outside range
      
      for (let i = 0; i < maxIterations; i++) {
        const editionNumber = currentEdition - i;
        
        if (editionNumber <= 0) {
          break;
        }
        
        try {
          const gazette = await this.processEdition(editionNumber);
          
          if (gazette) {
            // Check if this gazette is within our date range
            if (gazette.date >= this.dateRange.start && gazette.date <= this.dateRange.end) {
              gazettes.push(gazette);
              logger.debug(`Added gazette: Edition ${gazette.editionNumber} - ${gazette.date}`);
              consecutiveOutOfRange = 0;
            } else if (gazette.date < this.dateRange.start) {
              // Date is before our start date - stop iterating
              consecutiveOutOfRange++;
              logger.debug(`Edition ${editionNumber} date ${gazette.date} is before start date ${this.dateRange.start}`);
              
              if (consecutiveOutOfRange >= maxConsecutiveOutOfRange) {
                logger.debug(`Stopping after ${maxConsecutiveOutOfRange} consecutive editions before start date`);
                break;
              }
            } else if (gazette.date > this.dateRange.end) {
              // Date is after our end date - keep going (might find dates in range)
              consecutiveOutOfRange = 0;
            }
          }
        } catch (error) {
          logger.error(`Error processing edition ${editionNumber}:`, error as Error);
        }
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from Prefeitura Cubatão`);
      
    } catch (error) {
      logger.error(`Error crawling Prefeitura Cubatão:`, error as Error);
      throw error;
    }

    return gazettes;
  }

  /**
   * Get the current edition number from the main page
   */
  private async getCurrentEditionNumber(): Promise<number | null> {
    try {
      const response = await fetch(this.baseUrl, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml',
          'User-Agent': 'Mozilla/5.0 (compatible; GoodFellowBot/1.0)',
        },
        signal: AbortSignal.timeout(30000),
      });
      this.requestCount++;
      
      if (!response.ok) {
        logger.error(`Failed to fetch main page: ${response.status}`);
        return null;
      }
      
      const html = await response.text();
      
      // Look for "Nº XXXX" pattern
      const editionPattern = /Nº\s*(\d+)/;
      const match = html.match(editionPattern);
      
      if (match) {
        return parseInt(match[1], 10);
      }
      
      return null;
    } catch (error) {
      logger.error('Error getting current edition number:', error as Error);
      return null;
    }
  }

  /**
   * Process a single edition by number
   */
  private async processEdition(editionNumber: number): Promise<Gazette | null> {
    try {
      // Encode edition number to base64
      const base64Id = btoa(editionNumber.toString());
      const editionUrl = `${this.baseUrl}/search_sres.php?id=${base64Id}`;
      
      const response = await fetch(editionUrl, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml',
          'User-Agent': 'Mozilla/5.0 (compatible; GoodFellowBot/1.0)',
        },
        signal: AbortSignal.timeout(30000),
      });
      this.requestCount++;
      
      if (!response.ok) {
        logger.warn(`Failed to fetch edition ${editionNumber}: ${response.status}`);
        return null;
      }
      
      const html = await response.text();
      
      // Extract date from the page
      // Pattern: "Cubatão, segunda, 05 de janeiro de 2026"
      const datePattern = /(\d{1,2})\s+de\s+(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})/i;
      const dateMatch = html.match(datePattern);
      
      let gazetteDate: Date | null = null;
      
      if (dateMatch) {
        const day = parseInt(dateMatch[1], 10);
        const monthName = dateMatch[2].toLowerCase();
        const year = parseInt(dateMatch[3], 10);
        
        const monthNames: { [key: string]: number } = {
          'janeiro': 0, 'fevereiro': 1, 'março': 2, 'abril': 3,
          'maio': 4, 'junho': 5, 'julho': 6, 'agosto': 7,
          'setembro': 8, 'outubro': 9, 'novembro': 10, 'dezembro': 11,
        };
        
        const month = monthNames[monthName];
        if (month !== undefined) {
          gazetteDate = new Date(year, month, day);
        }
      }
      
      if (!gazetteDate) {
        // Try DD/MM/YYYY pattern as fallback
        const simplePattern = /(\d{2})\/(\d{2})\/(\d{4})/;
        const simpleMatch = html.match(simplePattern);
        if (simpleMatch) {
          gazetteDate = new Date(
            parseInt(simpleMatch[3], 10),
            parseInt(simpleMatch[2], 10) - 1,
            parseInt(simpleMatch[1], 10)
          );
        }
      }
      
      if (!gazetteDate) {
        logger.warn(`Could not extract date from edition ${editionNumber}`);
        return null;
      }
      
      const isoDate = toISODate(gazetteDate);
      
      // The DSJ platform doesn't have PDFs - the edition page IS the gazette
      // Use the edition page URL as the fileUrl
      const pdfUrl = editionUrl;
      
      // Check for extra edition indicators
      const isExtraEdition = /extra|suplemento|especial/i.test(html);
      
      return {
        date: isoDate,
        fileUrl: pdfUrl,
        territoryId: this.config.territoryId,
        scrapedAt: getCurrentTimestamp(),
        editionNumber: editionNumber.toString(),
        isExtraEdition,
        power: 'executive',
        sourceText: `Diário Oficial de Cubatão - Edição ${editionNumber}`,
      };
      
    } catch (error) {
      logger.error(`Error processing edition ${editionNumber}:`, error as Error);
      return null;
    }
  }
}
