import { Gazette, SpiderConfig, DateRange } from '../../types';
import { fromISODate, isDateInRange, toISODate, getCurrentTimestamp } from '../../utils/date-utils';
import { fetchHTML } from '../../utils/http-client';
import { loadHTML, CheerioAPI } from '../../utils/html-parser';
import { logger } from '../../utils/logger';

/**
 * Abstract base class for all spiders
 */
export abstract class BaseSpider {
  protected config: SpiderConfig;
  protected spiderConfig: SpiderConfig;
  protected dateRange: DateRange;
  protected startDate: Date;
  protected endDate: Date;
  protected requestCount: number = 0;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    this.config = config;
    this.spiderConfig = config;
    this.dateRange = dateRange;
    this.startDate = fromISODate(dateRange.start);
    this.endDate = fromISODate(dateRange.end);

    // Ensure startDate is not before spider's earliest available date
    const spiderStartDate = fromISODate(config.startDate);
    if (this.startDate < spiderStartDate) {
      this.startDate = spiderStartDate;
    }

    logger.setContext({
      spiderId: config.id,
      territoryId: config.territoryId,
    });
  }

  /**
   * Main crawl method - must be implemented by subclasses
   */
  abstract crawl(): Promise<Gazette[]>;

  /**
   * Fetches HTML content from a URL
   */
  protected async fetch(url: string): Promise<string> {
    logger.debug(`Fetching URL: ${url}`);
    this.requestCount++;
    return fetchHTML(url);
  }

  /**
   * Loads HTML into Cheerio
   */
  protected loadHTML(html: string): CheerioAPI {
    return loadHTML(html);
  }

  /**
   * Checks if a date is within the crawl range
   */
  protected isInDateRange(date: Date): boolean {
    return isDateInRange(date, this.startDate, this.endDate);
  }

  /**
   * Creates a Gazette object with common fields
   */
  protected createGazette(
    date: Date,
    fileUrl: string,
    options: {
      editionNumber?: string;
      isExtraEdition?: boolean;
      power?: 'executive' | 'legislative' | 'executive_legislative';
      sourceText?: string;
    } = {}
  ): Gazette {
    return {
      date: toISODate(date),
      fileUrl,
      territoryId: this.config.territoryId,
      scrapedAt: getCurrentTimestamp(),
      editionNumber: options.editionNumber,
      isExtraEdition: options.isExtraEdition ?? false,
      power: options.power ?? 'executive_legislative',
      sourceText: options.sourceText,
    };
  }

  /**
   * Gets the request count
   */
  getRequestCount(): number {
    return this.requestCount;
  }
}
