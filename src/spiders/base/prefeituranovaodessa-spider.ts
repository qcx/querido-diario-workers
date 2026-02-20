import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraNovaOdessaConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Portuguese month names mapped to zero-indexed month numbers
 */
const PORTUGUESE_MONTHS: { [key: string]: number } = {
  'janeiro': 0,
  'fevereiro': 1,
  'março': 2,
  'marco': 2, // Handle without accent
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
 * PrefeituraNovaOdessaSpider implementation
 * 
 * Crawls Nova Odessa's official gazette website which displays all gazettes
 * for a year on a single page with no date filter.
 * 
 * The spider:
 * 1. Determines which years to crawl based on date range
 * 2. For each year, fetches {baseUrl}/{year} (e.g., /servicos/diario/2025)
 * 3. Parses HTML to find all PDF links
 * 4. Extracts dates from link text/title (Portuguese format: "DD de Mês de YYYY")
 * 5. Extracts edition numbers and detects extra editions
 * 6. Filters gazettes to match the requested date range
 */
export class PrefeituraNovaOdessaSpider extends BaseSpider {
  protected novaOdessaConfig: PrefeituraNovaOdessaConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.novaOdessaConfig = spiderConfig.config as PrefeituraNovaOdessaConfig;
    
    if (!this.novaOdessaConfig.baseUrl) {
      throw new Error(`PrefeituraNovaOdessaSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraNovaOdessaSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.novaOdessaConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Generate list of years to crawl
      const years = this.generateYears();
      logger.info(`Generated ${years.length} years to crawl: ${years.join(', ')}`);

      // Crawl each year
      for (const year of years) {
        try {
          const yearGazettes = await this.crawlYear(year);
          gazettes.push(...yearGazettes);
          logger.info(`Crawled ${yearGazettes.length} gazettes from year ${year}`);
        } catch (error) {
          logger.error(`Error crawling year ${year}:`, error as Error);
          // Continue with next year even if one fails
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Generate list of years from start date to end date
   */
  private generateYears(): number[] {
    const years: number[] = [];
    const startYear = this.startDate.getFullYear();
    const endYear = this.endDate.getFullYear();

    for (let year = startYear; year <= endYear; year++) {
      years.push(year);
    }

    return years;
  }

  /**
   * Crawl all gazettes for a specific year
   */
  private async crawlYear(year: number): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Build year URL: {baseUrl}/{year}
      const yearUrl = `${this.novaOdessaConfig.baseUrl}/${year}`;
      logger.debug(`Fetching year page: ${yearUrl}`);

      const pageHtml = await this.fetch(yearUrl);
      const $ = this.loadHTML(pageHtml);

      // Find all PDF links
      const pdfLinks = $('a[href*=".pdf"]');
      logger.debug(`Found ${pdfLinks.length} PDF links on year ${year} page`);

      // Process each PDF link - collect promises
      const gazettePromises: Promise<Gazette | null>[] = [];
      
      pdfLinks.each((_, element) => {
        try {
          const $link = $(element);
          const pdfUrl = $link.attr('href');
          const title = $link.attr('title') || $link.text().trim();
          
          if (!pdfUrl || !title) {
            logger.debug('Skipping link without URL or title');
            return;
          }

          // Parse date from title/link text
          const gazetteDate = this.parsePortugueseDate(title);
          
          if (!gazetteDate) {
            logger.warn(`Could not parse date from: ${title}`);
            return;
          }

          // Check if date is in our crawl range
          if (!this.isInDateRange(gazetteDate)) {
            logger.debug(`Gazette date ${toISODate(gazetteDate)} is outside crawl range`);
            return;
          }

          // Extract edition number (pattern: "nº NNNN" or "n.º NNNN")
          const editionMatch = title.match(/(?:nº|n\.º)\s*(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;

          // Check if it's an extra edition
          const isExtraEdition = /extra|extraordinário/i.test(title);

          // Create the gazette object promise
          gazettePromises.push(
            this.createGazette(gazetteDate, pdfUrl, {
              editionNumber,
              isExtraEdition,
              power: 'executive_legislative',
              sourceText: title,
            })
          );

        } catch (error) {
          logger.error(`Error processing PDF link:`, error as Error);
        }
      });

      // Await all gazette creation promises
      const results = await Promise.all(gazettePromises);
      
      // Filter out null results and add to gazettes array
      for (const gazette of results) {
        if (gazette) {
          gazettes.push(gazette);
        }
      }

    } catch (error) {
      logger.error(`Error fetching year ${year}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Parse Portuguese date format: "DD de MMMM de YYYY"
   * Example: "10 de Novembro de 2025" or "10 de novembro de 2025"
   */
  private parsePortugueseDate(dateText: string): Date | null {
    try {
      // Match pattern: DD de MMMM de YYYY
      // Handle variations: "10 de Novembro de 2025", "10 de novembro de 2025"
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

