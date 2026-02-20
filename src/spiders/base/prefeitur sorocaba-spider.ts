import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraSorocabaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for Prefeitura de Sorocaba - Diário Oficial
 * 
 * Site Structure:
 * - URL: https://noticias.sorocaba.sp.gov.br/jornal/
 * - Contains a list of PDF links with class "link-jornal"
 * - PDF URL pattern: /wp-content/uploads/{YYYY}/{MM}/noticias.sorocaba.sp.gov.br-{EDITION}-{DD}-de-{MONTH}-de-{YYYY}.pdf
 * - Date is embedded in the filename: "DD-de-{MONTH}-de-YYYY"
 * - Can filter by year using query parameter: ?ano={YYYY}
 * 
 * The page lists all available gazettes with direct PDF links.
 * Each link contains the date in the filename.
 */
export class PrefeituraSorocabaSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const sorocabaConfig = config.config as PrefeituraSorocabaConfig;
    this.baseUrl = sorocabaConfig.baseUrl || 'https://noticias.sorocaba.sp.gov.br/jornal/';
    this.browser = browser || null;
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  /**
   * Parse Portuguese date string from filename to Date object
   * Format: "DD-de-MMMM-de-YYYY" (e.g., "29-de-dezembro-de-2025")
   */
  private parsePortugueseDate(dateStr: string): Date | null {
    const monthMap: Record<string, number> = {
      'janeiro': 0, 'fevereiro': 1, 'março': 2, 'marco': 2,
      'abril': 3, 'maio': 4, 'junho': 5,
      'julho': 6, 'agosto': 7, 'setembro': 8,
      'outubro': 9, 'novembro': 10, 'dezembro': 11
    };

    // Match pattern: "DD-de-MMMM-de-YYYY"
    const match = dateStr.match(/(\d{1,2})-de-(\w+)-de-(\d{4})/i);
    if (!match) {
      return null;
    }

    const [, day, monthName, year] = match;
    const month = monthMap[monthName.toLowerCase()];
    
    if (month === undefined) {
      return null;
    }

    return new Date(parseInt(year, 10), month, parseInt(day, 10));
  }

  /**
   * Extract date from PDF URL filename
   * Pattern: noticias.sorocaba.sp.gov.br-{EDITION}-{DD}-de-{MONTH}-de-{YYYY}.pdf
   */
  private extractDateFromUrl(url: string): Date | null {
    // Extract filename from URL
    const filename = url.split('/').pop() || '';
    
    // Match the date pattern in filename
    // Pattern: noticias.sorocaba.sp.gov.br-{EDITION}-{DD}-de-{MONTH}-de-{YYYY}.pdf
    const dateMatch = filename.match(/\d{1,2}-de-\w+-de-\d{4}/i);
    if (!dateMatch) {
      return null;
    }

    return this.parsePortugueseDate(dateMatch[0]);
  }

  /**
   * Extract edition number from PDF URL filename
   * Pattern: noticias.sorocaba.sp.gov.br-{EDITION}-{DD}-de-{MONTH}-de-{YYYY}.pdf
   */
  private extractEditionFromUrl(url: string): string | undefined {
    const filename = url.split('/').pop() || '';
    const match = filename.match(/noticias\.sorocaba\.sp\.gov\.br-(\d+)-/i);
    return match ? match[1] : undefined;
  }

  /**
   * Normalize URL - convert HTTP to HTTPS when possible
   */
  private normalizeUrl(url: string): string {
    // Convert HTTP to HTTPS for the same domain
    if (url.startsWith('http://noticias.sorocaba.sp.gov.br/')) {
      return url.replace('http://', 'https://');
    }
    return url;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling Sorocaba gazettes from ${this.baseUrl}...`);

    // If browser is available and required, use browser rendering
    if (this.browser && this.config.config?.requiresClientRendering) {
      return await this.crawlWithBrowser();
    }

    // Otherwise, use standard fetch-based crawling
    return await this.crawlWithFetch();
  }

  /**
   * Crawl using standard fetch-based method
   */
  private async crawlWithFetch(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      // Determine which years to crawl based on date range
      const startYear = new Date(this.startDate).getFullYear();
      const endYear = new Date(this.endDate).getFullYear();
      
      // Try each year in the range
      for (let year = startYear; year <= endYear; year++) {
        const yearUrl = `${this.baseUrl}?ano=${year}`;
        logger.debug(`Crawling year ${year}: ${yearUrl}`);
        
        const yearGazettes = await this.crawlYear(yearUrl);
        gazettes.push(...yearGazettes);
      }

      // If no year-specific results, try the base URL
      if (gazettes.length === 0) {
        logger.debug('No results from year-specific URLs, trying base URL');
        const baseGazettes = await this.crawlYear(this.baseUrl);
        gazettes.push(...baseGazettes);
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`);
      return gazettes;
    } catch (error) {
      logger.error(`Error crawling Sorocaba gazettes:`, error as Error);
      return gazettes;
    }
  }

  /**
   * Crawl a specific year URL
   */
  private async crawlYear(url: string): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      const html = await this.fetch(url);
      const $ = this.loadHTML(html);

      // Find all links with class "link-jornal"
      const links = $('a.link-jornal');
      logger.debug(`Found ${links.length} gazette links on page`);

      links.each((_, element) => {
        try {
          const link = $(element);
          const pdfUrl = link.attr('href');
          
          if (!pdfUrl) {
            return;
          }

          // Make URL absolute if relative
          let absoluteUrl = pdfUrl.startsWith('http') 
            ? pdfUrl 
            : new URL(pdfUrl, this.baseUrl).toString();
          
          // Normalize URL (HTTP to HTTPS)
          absoluteUrl = this.normalizeUrl(absoluteUrl);

          // Extract date from URL
          const gazetteDate = this.extractDateFromUrl(absoluteUrl);
          if (!gazetteDate) {
            logger.debug(`Could not extract date from URL: ${absoluteUrl}`);
            return;
          }

          // Filter by date range
          if (!this.isInDateRange(gazetteDate)) {
            return;
          }

          // Extract edition number
          const editionNumber = this.extractEditionFromUrl(absoluteUrl);

          // Create gazette
          const gazette = {
            date: gazetteDate.toISOString().split('T')[0],
            fileUrl: absoluteUrl,
            territoryId: this.config.territoryId,
            scrapedAt: new Date().toISOString(),
            power: 'executive_legislative' as const,
            sourceText: editionNumber 
              ? `Edição ${editionNumber} - ${gazetteDate.toLocaleDateString('pt-BR')}`
              : `Diário Oficial - ${gazetteDate.toLocaleDateString('pt-BR')}`,
          };

          gazettes.push(gazette);
        } catch (error) {
          logger.debug(`Error processing link: ${error instanceof Error ? error.message : String(error)}`);
        }
      });

    } catch (error) {
      logger.error(`Error crawling year URL ${url}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Crawl using browser rendering (if required)
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(`PrefeituraSorocabaSpider for ${this.config.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling Sorocaba gazettes with browser from ${this.baseUrl}...`);

    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      
      // Determine which years to crawl based on date range
      const startYear = new Date(this.startDate).getFullYear();
      const endYear = new Date(this.endDate).getFullYear();
      
      // Try each year in the range
      for (let year = startYear; year <= endYear; year++) {
        try {
          const yearUrl = `${this.baseUrl}?ano=${year}`;
          logger.debug(`Crawling year ${year}: ${yearUrl}`);
          
          await page.goto(yearUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          this.requestCount++;
          
          // Wait for page to be fully interactive and JavaScript to execute
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          // Wait for links to load
          try {
            await page.waitForSelector('a.link-jornal', { timeout: 15000 });
            logger.debug('Gazette links found');
          } catch (error) {
            logger.debug('Gazette links not found, continuing anyway');
          }
          
          // Extract gazettes from the page
          const yearGazettes = await this.extractGazettesFromPage(page);
          gazettes.push(...yearGazettes);
          
          logger.info(`Found ${yearGazettes.length} gazettes for year ${year}`);
        } catch (error) {
          logger.error(`Error crawling year ${year}:`, error as Error);
        }
      }

      // If no year-specific results, try the base URL
      if (gazettes.length === 0) {
        logger.debug('No results from year-specific URLs, trying base URL');
        try {
          await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          this.requestCount++;
          
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          try {
            await page.waitForSelector('a.link-jornal', { timeout: 15000 });
          } catch (error) {
            logger.debug('Gazette links not found on base URL');
          }
          
          const baseGazettes = await this.extractGazettesFromPage(page);
          gazettes.push(...baseGazettes);
        } catch (error) {
          logger.error(`Error crawling base URL:`, error as Error);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`);
      
    } catch (error) {
      logger.error(`Error crawling Sorocaba gazettes with browser:`, error as Error);
      throw error;
    } finally {
      // Clean up
      if (page) {
        try {
          await page.close();
        } catch (e) {
          logger.warn('Error closing page', { error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (e) {
          logger.warn('Error closing browser', { error: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    return gazettes;
  }

  /**
   * Extract gazettes from the current page using browser
   */
  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      const links = await page.evaluate(() => {
        const linkElements = document.querySelectorAll('a.link-jornal');
        const links: Array<{ href: string }> = [];
        
        linkElements.forEach((link: HTMLAnchorElement) => {
          const href = link.getAttribute('href');
          if (href) {
            links.push({ href });
          }
        });
        
        return links;
      });

      logger.debug(`Found ${links.length} gazette links on page`);

      for (const link of links) {
        try {
          const pdfUrl = link.href;
          
          if (!pdfUrl) {
            continue;
          }

          // Make URL absolute if relative
          let absoluteUrl = pdfUrl.startsWith('http') 
            ? pdfUrl 
            : new URL(pdfUrl, this.baseUrl).toString();
          
          // Normalize URL (HTTP to HTTPS)
          absoluteUrl = this.normalizeUrl(absoluteUrl);

          // Extract date from URL
          const gazetteDate = this.extractDateFromUrl(absoluteUrl);
          if (!gazetteDate) {
            logger.debug(`Could not extract date from URL: ${absoluteUrl}`);
            continue;
          }

          // Filter by date range
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }

          // Extract edition number
          const editionNumber = this.extractEditionFromUrl(absoluteUrl);

          // Create gazette
          const gazette = {
            date: gazetteDate.toISOString().split('T')[0],
            fileUrl: absoluteUrl,
            territoryId: this.config.territoryId,
            scrapedAt: new Date().toISOString(),
            power: 'executive_legislative' as const,
            sourceText: editionNumber 
              ? `Edição ${editionNumber} - ${gazetteDate.toLocaleDateString('pt-BR')}`
              : `Diário Oficial - ${gazetteDate.toLocaleDateString('pt-BR')}`,
          };

          gazettes.push(gazette);
        } catch (error) {
          logger.debug(`Error processing link: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

    } catch (error) {
      logger.error(`Error extracting gazettes from page:`, error as Error);
    }

    return gazettes;
  }
}
