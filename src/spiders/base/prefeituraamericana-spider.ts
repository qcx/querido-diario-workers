import { BaseSpider } from './base-spider';
import { SpiderConfig, DateRange, Gazette } from '../../types';
import { logger } from '../../utils/logger';
import { loadHTML } from '../../utils/html-parser';
import { toISODate } from '../../utils/date-utils';

interface PrefeituraAmericanaConfig {
  type: 'prefeituraamericana';
  baseUrl: string;
}

/**
 * Spider for Prefeitura de Americana
 * 
 * Site structure:
 * - Calendar at: {baseUrl}/diario-oficial-edicaoAnterior.php?mes={MM}&ano={YYYY}
 * - PDF links in calendar: https://www.americana.sp.gov.br/download/diarioOficial/{hash}.pdf
 * - Extra editions: {baseUrl}/diario-oficial-edicaoExtra.php?mes={MM}&ano={YYYY}
 * 
 * The calendar shows days with publications as links with tooltips containing:
 * - Data: DD/MM/YYYY
 * - No: {edition number}
 * - Paginas: {page count}
 * - Tamanho: {file size}
 */
export class PrefeituraAmericanaSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraAmericanaConfig;
    this.baseUrl = platformConfig.baseUrl;
    logger.info(`Initializing PrefeituraAmericanaSpider for ${config.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura de Americana from ${toISODate(this.startDate)} to ${toISODate(this.endDate)}`);

    // Generate list of months to crawl
    const months = this.generateMonthYearCombinations();
    
    for (const { month, year } of months) {
      try {
        // Crawl regular editions
        await this.crawlMonth(month, year, false, gazettes);
        
        // Crawl extra editions
        await this.crawlMonth(month, year, true, gazettes);
      } catch (error) {
        logger.error(`Error crawling month ${month}/${year}:`, error as Error);
      }
    }

    logger.info(`Completed crawling Americana: found ${gazettes.length} gazettes`);
    return gazettes;
  }

  /**
   * Generate list of month/year combinations from date range
   */
  private generateMonthYearCombinations(): Array<{ year: number; month: number }> {
    const combinations: Array<{ year: number; month: number }> = [];
    const current = new Date(this.startDate.getFullYear(), this.startDate.getMonth(), 1);
    const end = new Date(this.endDate.getFullYear(), this.endDate.getMonth(), 1);

    while (current <= end) {
      combinations.push({
        year: current.getFullYear(),
        month: current.getMonth() + 1,
      });
      current.setMonth(current.getMonth() + 1);
    }

    return combinations;
  }

  /**
   * Crawl a specific month for gazettes
   */
  private async crawlMonth(
    month: number,
    year: number,
    isExtra: boolean,
    gazettes: Gazette[]
  ): Promise<void> {
    const endpoint = isExtra ? 'diario-oficial-edicaoExtra.php' : 'diario-oficial-edicaoAnterior.php';
    const url = `${this.baseUrl}/${endpoint}?mes=${month}&ano=${year}`;
    
    logger.debug(`Fetching ${isExtra ? 'extra' : 'regular'} editions for ${month}/${year}: ${url}`);
    
    try {
      const html = await this.fetch(url);
      const $ = loadHTML(html);
      
      // Find all links to PDF files
      const pdfLinks = $('a[href*="diarioOficial"][href$=".pdf"]');
      
      logger.debug(`Found ${pdfLinks.length} PDF links for ${month}/${year} (${isExtra ? 'extra' : 'regular'})`);
      
      for (const link of pdfLinks.toArray()) {
        try {
          const $link = $(link);
          const pdfUrl = $link.attr('href');
          
          if (!pdfUrl) continue;
          
          // Parse date and edition from tooltip
          const tooltip = $link.attr('data-original-title') || $link.attr('title') || '';
          const dateMatch = tooltip.match(/Data:\s*(\d{2})\/(\d{2})\/(\d{4})/);
          const editionMatch = tooltip.match(/No:\s*(\d+)/);
          
          if (!dateMatch) {
            // Try to get date from link text (day number in calendar)
            const dayText = $link.text().trim();
            const day = parseInt(dayText, 10);
            
            if (isNaN(day) || day < 1 || day > 31) {
              logger.warn(`Could not parse date for PDF: ${pdfUrl}`);
              continue;
            }
            
            const gazetteDate = new Date(year, month - 1, day);
            
            // Check if date is in range
            if (!this.isInDateRange(gazetteDate)) {
              continue;
            }
            
            const gazette = await this.createGazette(gazetteDate, pdfUrl, {
              isExtraEdition: isExtra,
              power: 'executive',
            });
            
            if (gazette) {
              gazettes.push(gazette);
            }
          } else {
            const [, dayStr, monthStr, yearStr] = dateMatch;
            const gazetteDate = new Date(
              parseInt(yearStr, 10),
              parseInt(monthStr, 10) - 1,
              parseInt(dayStr, 10)
            );
            
            // Check if date is in range
            if (!this.isInDateRange(gazetteDate)) {
              continue;
            }
            
            const gazette = await this.createGazette(gazetteDate, pdfUrl, {
              editionNumber: editionMatch ? editionMatch[1] : undefined,
              isExtraEdition: isExtra,
              power: 'executive',
              sourceText: tooltip,
            });
            
            if (gazette) {
              gazettes.push(gazette);
            }
          }
        } catch (error) {
          logger.error(`Error processing PDF link:`, error as Error);
        }
      }
    } catch (error) {
      logger.error(`Error fetching ${url}:`, error as Error);
    }
  }
}

