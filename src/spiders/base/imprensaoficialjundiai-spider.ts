import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, ImprensaOficialJundiaiConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Portuguese month names mapped to zero-indexed month numbers
 */
const PORTUGUESE_MONTHS: { [key: string]: number } = {
  'janeiro': 0,
  'fevereiro': 1,
  'março': 2,
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
 * Interface for edition information extracted from listing page
 */
interface EditionInfo {
  url: string;
  title: string;
  dateText: string;
}

/**
 * ImprensaOficialJundiaiSpider implementation
 * 
 * Crawls Jundiaí's Imprensa Oficial website (https://imprensaoficial.jundiai.sp.gov.br/)
 * using the archives dropdown to filter by month/year for efficient crawling.
 * 
 * The spider:
 * 1. Generates month URLs from the date range (e.g., /2025/11/, /2025/10/)
 * 2. For each month, fetches all edition listings (with pagination support)
 * 3. Visits each edition detail page to extract the PDF URL
 * 4. Parses Portuguese dates and handles extra editions
 */
export class ImprensaOficialJundiaiSpider extends BaseSpider {
  protected jundiaiConfig: ImprensaOficialJundiaiConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.jundiaiConfig = spiderConfig.config as ImprensaOficialJundiaiConfig;
    
    if (!this.jundiaiConfig.baseUrl) {
      throw new Error(`ImprensaOficialJundiaiSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing ImprensaOficialJundiaiSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.jundiaiConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Generate list of month URLs to crawl
      const monthUrls = this.generateMonthUrls();
      logger.info(`Generated ${monthUrls.length} month URLs to crawl`);

      // Crawl each month
      for (const monthUrl of monthUrls) {
        try {
          const monthGazettes = await this.crawlMonth(monthUrl);
          gazettes.push(...monthGazettes);
          logger.info(`Crawled ${monthGazettes.length} gazettes from ${monthUrl}`);
        } catch (error) {
          logger.error(`Error crawling month ${monthUrl}:`, error as Error);
          // Continue with next month even if one fails
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Generate list of month URLs from start date to end date
   * Format: {baseUrl}/YYYY/MM/ (e.g., https://imprensaoficial.jundiai.sp.gov.br/2025/11/)
   */
  private generateMonthUrls(): string[] {
    const urls: string[] = [];
    const current = new Date(this.startDate.getFullYear(), this.startDate.getMonth(), 1);
    const end = new Date(this.endDate.getFullYear(), this.endDate.getMonth(), 1);

    while (current <= end) {
      const year = current.getFullYear();
      const month = String(current.getMonth() + 1).padStart(2, '0');
      const url = `${this.jundiaiConfig.baseUrl}/${year}/${month}/`;
      urls.push(url);
      
      // Move to next month
      current.setMonth(current.getMonth() + 1);
    }

    return urls;
  }

  /**
   * Crawl all editions for a specific month (with pagination support)
   */
  private async crawlMonth(monthUrl: string): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let pageNumber = 1;
    let hasMorePages = true;

    while (hasMorePages) {
      try {
        // Build page URL (first page has no /page/N/ suffix)
        const pageUrl = pageNumber === 1 ? monthUrl : `${monthUrl}page/${pageNumber}/`;
        logger.debug(`Fetching page: ${pageUrl}`);

        const pageHtml = await this.fetch(pageUrl);
        const $ = this.loadHTML(pageHtml);

        // Extract edition information from the listing page
        const editions = this.parseEditionListing($);
        
        if (editions.length === 0) {
          logger.debug(`No editions found on page ${pageNumber} of ${monthUrl}`);
          hasMorePages = false;
          break;
        }

        // Process each edition
        for (const edition of editions) {
          try {
            const gazette = await this.processEdition(edition);
            if (gazette) {
              gazettes.push(gazette);
            }
          } catch (error) {
            logger.error(`Error processing edition ${edition.url}:`, error as Error);
          }
        }

        // Check if there's a next page
        const nextPageLink = $('#paginacao .nav a').filter((_, el) => {
          const href = $(el).attr('href') || '';
          return href.includes(`/page/${pageNumber + 1}/`);
        });

        hasMorePages = nextPageLink.length > 0;
        pageNumber++;

      } catch (error) {
        logger.error(`Error fetching page ${pageNumber} of ${monthUrl}:`, error as Error);
        hasMorePages = false;
      }
    }

    return gazettes;
  }

  /**
   * Parse edition listings from a page
   */
  private parseEditionListing($: any): EditionInfo[] {
    const editions: EditionInfo[] = [];
    
    $('.edicao-atual').each((_, element) => {
      const $element = $(element);
      const $link = $element.find('a').first();
      const url = $link.attr('href');
      
      if (!url) {
        return; // Skip if no URL found
      }

      const title = $element.find('.titulo-lista').text().trim();
      
      // Get the date from the second div in .data-lista
      const dateText = $element.find('.data-lista > div').eq(1).text().trim();
      
      if (title && dateText) {
        editions.push({ url, title, dateText });
      }
    });

    return editions;
  }

  /**
   * Process a single edition: fetch detail page and extract PDF URL
   */
  private async processEdition(edition: EditionInfo): Promise<Gazette | null> {
    try {
      // Parse the date from Portuguese format
      const gazetteDate = this.parsePortugueseDate(edition.dateText);
      
      if (!gazetteDate) {
        logger.warn(`Could not parse date: ${edition.dateText}`);
        return null;
      }

      // Check if date is in our crawl range
      if (!this.isInDateRange(gazetteDate)) {
        logger.debug(`Gazette date ${toISODate(gazetteDate)} is outside crawl range`);
        return null;
      }

      // Fetch the edition detail page to get PDF URL
      logger.debug(`Fetching edition detail page: ${edition.url}`);
      const detailHtml = await this.fetch(edition.url);
      const $ = this.loadHTML(detailHtml);

      // Extract PDF URL from the download section
      const pdfUrl = $('.edicao-download a.botao-pdf').attr('href');
      
      if (!pdfUrl) {
        logger.warn(`No PDF URL found for edition: ${edition.url}`);
        return null;
      }

      // Extract edition number from title (e.g., "Edição 5720" -> "5720")
      const editionMatch = edition.title.match(/Edição\s+(?:Extra\s+)?(\d+)/i);
      const editionNumber = editionMatch ? editionMatch[1] : undefined;

      // Check if it's an extra edition
      const isExtraEdition = /extra/i.test(edition.title);

      // Create the gazette object
      return await this.createGazette(gazetteDate, pdfUrl, {
        editionNumber,
        isExtraEdition,
        power: 'executive_legislative',
        sourceText: edition.title,
      });

    } catch (error) {
      logger.error(`Error processing edition ${edition.url}:`, error as Error);
      return null;
    }
  }

  /**
   * Parse Portuguese date format: "DD de MMMM de YYYY"
   * Example: "07 de novembro de 2025"
   */
  private parsePortugueseDate(dateText: string): Date | null {
    try {
      // Match pattern: DD de MMMM de YYYY
      const match = dateText.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
      
      if (!match) {
        return null;
      }

      const day = parseInt(match[1], 10);
      const monthName = match[2].toLowerCase();
      const year = parseInt(match[3], 10);

      const month = PORTUGUESE_MONTHS[monthName];
      
      if (month === undefined) {
        logger.warn(`Unknown Portuguese month: ${monthName}`);
        return null;
      }

      return new Date(year, month, day);

    } catch (error) {
      logger.error(`Error parsing Portuguese date "${dateText}":`, error as Error);
      return null;
    }
  }
}

