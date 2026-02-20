import puppeteer from '@cloudflare/puppeteer';
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
 * Uses Cloudflare Browser Rendering (Puppeteer) to handle JavaScript-rendered content.
 * 
 * Crawls Mogi das Cruzes's official gazette website which organizes gazettes
 * by year and category (executivo, legislativo, autarquias).
 * 
 * The spider:
 * 1. Generates years from date range
 * 2. For each year, iterates through categories
 * 3. Constructs URL: {baseUrl}?year={year}&category={category}
 * 4. Uses Puppeteer to render JavaScript and extract PDF links
 * 5. Extracts dates from link text (DD/MM/YYYY format)
 * 6. Extracts edition numbers and detects extra editions
 * 7. Filters gazettes to match the requested date range
 */
export class PrefeituraMogiDasCruzesSpider extends BaseSpider {
  protected mogiDasCruzesConfig: PrefeituraMogiDasCruzesConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.mogiDasCruzesConfig = spiderConfig.config as PrefeituraMogiDasCruzesConfig;
    
    if (!this.mogiDasCruzesConfig.baseUrl) {
      throw new Error(`PrefeituraMogiDasCruzesSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraMogiDasCruzesSpider for ${spiderConfig.name}`);
    this.browser = browser || null;
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(`PrefeituraMogiDasCruzesSpider for ${this.spiderConfig.name} requires browser binding`);
      return [];
    }

    logger.info(`Crawling ${this.mogiDasCruzesConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();

      // Generate list of years to crawl
      const years = this.generateYears();
      logger.info(`Generated ${years.length} years to crawl: ${years.join(', ')}`);

      // Crawl each year and category combination
      for (const year of years) {
        for (const category of CATEGORIES) {
          try {
            const categoryGazettes = await this.crawlCategory(page, year, category);
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
    } finally {
      // Clean up
      if (page) {
        try {
          await page.close();
        } catch {
          // Ignore close errors
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch {
          // Ignore close errors
        }
      }
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
   * Crawl all gazettes for a specific year and category using Puppeteer
   */
  private async crawlCategory(page: puppeteer.Page, year: number, category: string): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Build URL: {baseUrl}?year={year}&category={category}
      const categoryUrl = `${this.mogiDasCruzesConfig.baseUrl}?year=${year}&category=${category}`;
      logger.debug(`Fetching category page: ${categoryUrl}`);

      // Navigate to the page and wait for content to load
      await page.goto(categoryUrl, { 
        waitUntil: 'networkidle0',
        timeout: 30000 
      });

      // Wait for gazette links to appear (they're inside main content)
      try {
        await page.waitForSelector('a[href*=".pdf"]', { timeout: 10000 });
      } catch {
        logger.debug(`No PDF links found on ${categoryUrl}`);
        return gazettes;
      }

      // Extract gazette data from the page
      const gazetteData = await page.evaluate(() => {
        const results: Array<{
          pdfUrl: string;
          text: string;
        }> = [];

        // Find all PDF links
        const links = document.querySelectorAll('a[href*=".pdf"]');
        links.forEach(link => {
          const href = link.getAttribute('href');
          if (href) {
            // Get the parent container text for date/edition info
            const container = link.closest('div.flex, li, article') || link.parentElement;
            const text = container?.textContent || link.textContent || '';
            results.push({
              pdfUrl: href,
              text: text.trim()
            });
          }
        });

        return results;
      });

      logger.debug(`Found ${gazetteData.length} PDF links on year ${year}, category ${category} page`);

      // Process each gazette data
      const gazettePromises: Promise<Gazette | null>[] = [];
      
      for (const data of gazetteData) {
        try {
          // Parse date from text (format: DD/MM/YYYY)
          const gazetteDate = this.parseDate(data.text);
          
          if (!gazetteDate) {
            logger.debug(`Could not parse date from: ${data.text.substring(0, 100)}`);
            continue;
          }

          // Check if date is in our crawl range
          if (!this.isInDateRange(gazetteDate)) {
            logger.debug(`Gazette date ${toISODate(gazetteDate)} is outside crawl range`);
            continue;
          }

          // Extract edition number (pattern: "Edição {category} nº {number}" or "Edição {category} Extraordinária nº {number}")
          const editionMatch = data.text.match(/Edi[çc][ãa]o\s+(?:.+?\s+)?n[º°]\s*(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;

          // Check if it's an extra edition
          const isExtraEdition = /extraordin[áa]ria/i.test(data.text);

          // Resolve relative URL to absolute URL
          const absoluteUrl = this.resolveUrl(data.pdfUrl);

          // Map category to power type
          const power = CATEGORY_POWER_MAP[category] || 'executive_legislative';

          // Create the gazette object promise
          gazettePromises.push(
            this.createGazette(gazetteDate, absoluteUrl, {
              editionNumber,
              isExtraEdition,
              power,
              sourceText: data.text.substring(0, 200), // Limit source text length
              requiresClientRendering: true,
            })
          );

        } catch (error) {
          logger.error(`Error processing gazette data:`, error as Error);
        }
      }

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
