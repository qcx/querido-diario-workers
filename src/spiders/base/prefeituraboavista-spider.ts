import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraBoaVistaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Portuguese month names mapped to zero-indexed month numbers
 */
const PORTUGUESE_MONTHS: { [key: string]: number } = {
  'janeiro': 0,
  'fevereiro': 1,
  'março': 2,
  'marco': 2,
  'abril': 3,
  'maio': 4,
  'junho': 5,
  'julho': 6,
  'agosto': 7,
  'setembro': 8,
  'outubro': 9,
  'novembro': 10,
  'dezembro': 11,
};

/**
 * Interface for the API response
 */
interface BoaVistaApiResponse {
  data: Array<{
    id_str: string;
    edicao: string;
    data: string; // e.g., "sexta, 30 de janeiro de 2026"
    media: {
      id_str: string;
      name: string;
      url: string; // e.g., "/storage/9231/48781c0098796b29ac6f8b2f0cb37a5e.pdf"
      mime: string;
    };
    meta: {
      size: string;
      pages: string;
    };
  }>;
  links: {
    first: string;
    last: string;
    prev: string | null;
    next: string | null;
  };
  meta: {
    current_page: number;
    from: number;
    last_page: number;
    path: string;
    per_page: number;
    to: number;
    total: number;
  };
}

/**
 * Spider for Prefeitura de Boa Vista - RR official gazette
 * 
 * Uses HTTP-only mode via the public API:
 * - GET /api/v1/diarios?ano={year}&mes={month}&page={page}
 * - Returns JSON with gazette list including PDF URLs
 * - PDFs available at {baseUrl}{media.url} or {baseUrl}/ler/diario/{id}
 * 
 * This is an HTTP-only spider that doesn't require browser rendering.
 */
export class PrefeituraBoaVistaSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraBoaVistaConfig;
    // Normalize base URL (remove trailing slash)
    this.baseUrl = platformConfig.baseUrl.replace(/\/$/, '');
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura Boa Vista for ${this.config.name}...`);

    try {
      // Generate year/month combinations for the date range
      const monthsToFetch = this.getMonthsInRange();
      logger.info(`Will fetch ${monthsToFetch.length} month(s) of data`);

      for (const { year, month } of monthsToFetch) {
        try {
          const monthGazettes = await this.crawlMonth(year, month);
          gazettes.push(...monthGazettes);
          
          if (monthGazettes.length > 0) {
            logger.info(`Found ${monthGazettes.length} gazette(s) for ${year}/${month}`);
          }
        } catch (error) {
          logger.error(`Error crawling month ${year}/${month}:`, error as Error);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from Prefeitura Boa Vista`);
      
    } catch (error) {
      logger.error(`Error crawling Prefeitura Boa Vista:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Get list of year/month pairs within the date range
   */
  private getMonthsInRange(): Array<{ year: number; month: number }> {
    const months: Array<{ year: number; month: number }> = [];
    const current = new Date(this.startDate.getFullYear(), this.startDate.getMonth(), 1);
    const end = new Date(this.endDate.getFullYear(), this.endDate.getMonth(), 1);

    while (current <= end) {
      months.push({
        year: current.getFullYear(),
        month: current.getMonth() + 1, // API uses 1-12
      });
      current.setMonth(current.getMonth() + 1);
    }

    return months;
  }

/**
 * Crawl all gazettes for a specific month (with pagination support)
 * Stops pagination when all items on a page are outside the date range
 */
private async crawlMonth(year: number, month: number): Promise<Gazette[]> {
  const gazettes: Gazette[] = [];
  let page = 1;
  let hasMorePages = true;

  while (hasMorePages) {
    const url = `${this.baseUrl}/api/v1/diarios?ano=${year}&mes=${month}&page=${page}`;
    logger.debug(`Fetching: ${url}`);

    try {
      const response = await this.fetch(url);
      const data: BoaVistaApiResponse = JSON.parse(response);

      if (!data.data || data.data.length === 0) {
        logger.debug(`No data on page ${page} for ${year}/${month}`);
        break;
      }

      let foundInRange = false;
      let allBeforeRange = true;

      for (const item of data.data) {
        try {
          const gazetteDate = this.parsePortugueseDate(item.data);
          
          if (gazetteDate) {
            // Check if date is after our end date (data is sorted newest first)
            if (gazetteDate > this.endDate) {
              allBeforeRange = false;
              continue;
            }
            
            // Check if date is before our start date - stop pagination
            if (gazetteDate < this.startDate) {
              // All remaining items will be even older, stop here
              logger.debug(`Found date ${toISODate(gazetteDate)} before start date, stopping pagination`);
              hasMorePages = false;
              break;
            }
            
            // Date is in range
            foundInRange = true;
            allBeforeRange = false;
            
            const gazette = await this.processItem(item);
            if (gazette) {
              gazettes.push(gazette);
            }
          }
        } catch (error) {
          logger.error(`Error processing item ${item.edicao}:`, error as Error);
        }
      }

      // If we didn't break early, check if there are more pages
      if (hasMorePages && data.links.next && page < data.meta.last_page) {
        page++;
      } else {
        hasMorePages = false;
      }

    } catch (error) {
      logger.error(`Error fetching page ${page} for ${year}/${month}:`, error as Error);
      hasMorePages = false;
    }
  }

  return gazettes;
}

/**
 * Process a single API item into a Gazette
 * Note: Date validation is done in crawlMonth, so we assume the item is valid here
 */
private async processItem(item: BoaVistaApiResponse['data'][0]): Promise<Gazette | null> {
  try {
    // Parse date from Portuguese format (e.g., "sexta, 30 de janeiro de 2026")
    const gazetteDate = this.parsePortugueseDate(item.data);
    
    if (!gazetteDate) {
      logger.warn(`Could not parse date from: ${item.data}`);
      return null;
    }

    // Build PDF URL - use the direct ler/diario endpoint which returns PDF
    const pdfUrl = `${this.baseUrl}/ler/diario/${item.edicao}`;
    
    logger.debug(`Processing gazette: edition ${item.edicao}, date ${toISODate(gazetteDate)}`);

    const gazette = await this.createGazette(gazetteDate, pdfUrl, {
      power: 'executive_legislative',
      requiresClientRendering: false,
      editionNumber: item.edicao,
      isExtraEdition: false,
      sourceText: `DOM nº ${item.edicao} - ${item.data}`,
    });

    return gazette;

  } catch (error) {
    logger.error(`Error processing gazette item:`, error as Error);
    return null;
  }
}

  /**
   * Parse Portuguese date format from API
   * Example: "sexta, 30 de janeiro de 2026" -> Date
   */
  private parsePortugueseDate(dateText: string): Date | null {
    try {
      // Match pattern: DD de MMMM de YYYY (ignore day of week prefix)
      const match = dateText.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
      
      if (!match) {
        return null;
      }

      const day = parseInt(match[1], 10);
      const monthName = match[2].toLowerCase();
      const year = parseInt(match[3], 10);

      const month = PORTUGUESE_MONTHS[monthName];
      
      if (month === undefined) {
        logger.warn(`Unknown Portuguese month: ${monthName} in text: ${dateText}`);
        return null;
      }

      return new Date(year, month, day);

    } catch (error) {
      logger.error(`Error parsing Portuguese date "${dateText}":`, error as Error);
      return null;
    }
  }
}
