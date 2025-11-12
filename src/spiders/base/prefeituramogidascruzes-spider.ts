import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraMogiDasCruzesConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Categories available on the Mogi das Cruzes site
 */
const CATEGORIES = ['executivo', 'legislativo', 'autarquias'] as const;

/**
 * Category to power mapping
 */
const CATEGORY_POWER_MAP: Record<string, 'executive' | 'legislative' | 'executive_legislative'> = {
  'executivo': 'executive',
  'legislativo': 'legislative',
  'autarquias': 'executive',
};

/**
 * PrefeituraMogiDasCruzesSpider implementation
 * 
 * Crawls Mogi das Cruzes's official gazette website which organizes gazettes
 * by year and category (executivo, legislativo, autarquias).
 * 
 * The spider:
 * 1. Generates years from date range
 * 2. For each year, iterates through categories
 * 3. Constructs URL: {baseUrl}?year={year}&category={category}#doe-pmmc
 * 4. Fetches HTML and parses PDF links from accordion content divs
 * 5. Extracts dates from text (DD/MM/YYYY format)
 * 6. Extracts edition numbers and detects extra editions
 * 7. Filters gazettes to match the requested date range
 */
export class PrefeituraMogiDasCruzesSpider extends BaseSpider {
  protected mogiDasCruzesConfig: PrefeituraMogiDasCruzesConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.mogiDasCruzesConfig = spiderConfig.config as PrefeituraMogiDasCruzesConfig;
    
    if (!this.mogiDasCruzesConfig.baseUrl) {
      throw new Error(`PrefeituraMogiDasCruzesSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraMogiDasCruzesSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.mogiDasCruzesConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Generate list of years to crawl
      const years = this.generateYears();
      logger.info(`Generated ${years.length} years to crawl: ${years.join(', ')}`);

      // Crawl each year and category combination
      for (const year of years) {
        for (const category of CATEGORIES) {
          try {
            const categoryGazettes = await this.crawlCategory(year, category);
            gazettes.push(...categoryGazettes);
            logger.info(`Crawled ${categoryGazettes.length} gazettes from year ${year}, category ${category}`);
          } catch (error) {
            logger.error(`Error crawling year ${year}, category ${category}:`, error as Error);
            // Continue with next category even if one fails
          }
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
   * Crawl all gazettes for a specific year and category
   */
  private async crawlCategory(year: number, category: string): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Build URL: {baseUrl}?year={year}&category={category}#doe-pmmc
      const categoryUrl = `${this.mogiDasCruzesConfig.baseUrl}?year=${year}&category=${category}#doe-pmmc`;
      logger.debug(`Fetching category page: ${categoryUrl}`);

      const pageHtml = await this.fetch(categoryUrl);
      const $ = this.loadHTML(pageHtml);

      // Find all accordion content divs (they contain PDF links even when collapsed)
      const accordionContents = $('[id^="content-"]');
      logger.debug(`Found ${accordionContents.length} accordion content divs`);

      // Extract PDF links from all accordion content divs
      const pdfLinks = accordionContents.find('a[href*=".pdf"]');
      logger.debug(`Found ${pdfLinks.length} PDF links on year ${year}, category ${category} page`);

      // Process each PDF link
      const gazettePromises: Promise<Gazette | null>[] = [];
      
      pdfLinks.each((_, element) => {
        try {
          const $link = $(element);
          const pdfUrl = $link.attr('href');
          
          if (!pdfUrl) {
            logger.debug('Skipping link without href');
            return;
          }

          // Find the parent container div to extract date and edition info
          const $container = $link.closest('.flex.p-4');
          if ($container.length === 0) {
            logger.debug('Could not find container div for PDF link');
            return;
          }

          // Extract text content from the container
          const containerText = $container.text();

          // Parse date from container text (format: DD/MM/YYYY)
          const gazetteDate = this.parseDate(containerText);
          
          if (!gazetteDate) {
            logger.warn(`Could not parse date from: ${containerText.substring(0, 100)}`);
            return;
          }

          // Check if date is in our crawl range
          if (!this.isInDateRange(gazetteDate)) {
            logger.debug(`Gazette date ${toISODate(gazetteDate)} is outside crawl range`);
            return;
          }

          // Extract edition number (pattern: "Edição {category} nº {number}" or "Edição {category} Extraordinária nº {number}")
          const editionMatch = containerText.match(/Edi[çc][ãa]o\s+(?:.+?\s+)?n[º°]\s*(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;

          // Check if it's an extra edition
          const isExtraEdition = /extraordin[áa]ria/i.test(containerText);

          // Resolve relative URL to absolute URL
          const absoluteUrl = this.resolveUrl(pdfUrl);

          // Map category to power type
          const power = CATEGORY_POWER_MAP[category] || 'executive_legislative';

          // Create the gazette object promise
          gazettePromises.push(
            this.createGazette(gazetteDate, absoluteUrl, {
              editionNumber,
              isExtraEdition,
              power,
              sourceText: containerText.substring(0, 200), // Limit source text length
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
      logger.error(`Error fetching year ${year}, category ${category}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Parse date from text content (format: DD/MM/YYYY)
   * Example: "11/11/2025" or "11-11-2025"
   */
  private parseDate(dateText: string): Date | null {
    try {
      // Match pattern: DD/MM/YYYY or DD-MM-YYYY
      const match = dateText.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
      
      if (!match) {
        return null;
      }

      const day = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1; // Month is 0-indexed in JavaScript Date
      const year = parseInt(match[3], 10);

      const date = new Date(year, month, day);
      
      // Validate date (check if date is valid)
      if (isNaN(date.getTime())) {
        logger.warn(`Invalid date parsed: ${match[0]}`);
        return null;
      }

      return date;

    } catch (error) {
      logger.error(`Error parsing date "${dateText}":`, error as Error);
      return null;
    }
  }

  /**
   * Resolve relative URL to absolute URL
   */
  private resolveUrl(url: string): string {
    // If URL is already absolute, return as-is
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }

    // Extract base URL from baseUrl config
    const baseUrlObj = new URL(this.mogiDasCruzesConfig.baseUrl);
    const baseOrigin = `${baseUrlObj.protocol}//${baseUrlObj.host}`;

    // If URL starts with /, prepend base origin
    if (url.startsWith('/')) {
      return `${baseOrigin}${url}`;
    }

    // Otherwise, resolve relative to baseUrl
    return new URL(url, this.mogiDasCruzesConfig.baseUrl).toString();
  }
}

