import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, IperoConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * IperoSpider implementation for Cloudflare Workers
 * 
 * Specific spider for Iperó and similar municipalities that use a year-based
 * navigation structure with ecrie.com.br PDFs.
 * 
 * Site Structure:
 * - Main URL: {cidade}.sp.gov.br/jornal-oficial lists years (2026, 2025, etc.)
 * - Year pages: {cidade}.sp.gov.br/jornal-oficial/jornal-oficial-YYYY
 * - PDFs are on ecrie.com.br with format: a_XXX_X_X_DDMMYYYYHHMMSS.pdf
 * - Table structure with edition links organized by month
 * 
 * This spider requires browser rendering due to JavaScript-rendered content.
 */
export class IperoSpider extends BaseSpider {
  protected iperoConfig: IperoConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.iperoConfig = spiderConfig.config as IperoConfig;
    this.browser = browser || null;
    
    if (!this.iperoConfig.baseUrl) {
      throw new Error(`IperoSpider requires a baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing IperoSpider for ${spiderConfig.name} with URL: ${this.iperoConfig.baseUrl}`, {
      hasBrowser: !!this.browser,
    });
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.iperoConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error('IperoSpider requires a browser instance for crawling');
    }
    
    return this.crawlWithBrowser();
  }

  /**
   * Browser-based crawling for Iperó-style sites
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Navigate to the main gazette page
      logger.debug(`Navigating to: ${this.iperoConfig.baseUrl}`);
      await page.goto(this.iperoConfig.baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Wait for page to stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Navigate to the current year page
      await this.navigateToYearPage(page);
      
      // Wait for page to load
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extract gazettes from the year page
      const pageGazettes = await this.extractGazettesFromPage(page);
      
      // Filter by date range
      for (const gazette of pageGazettes) {
        if (gazette) {
          const gazetteDate = new Date(gazette.date);
          if (this.isInDateRange(gazetteDate)) {
            gazettes.push(gazette);
          }
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from browser`);
      
    } catch (error) {
      logger.error(`Error crawling with browser:`, error as Error);
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
   * Navigate to the appropriate year page based on dateRange
   */
  private async navigateToYearPage(page: any): Promise<void> {
    try {
      // Check if page has year links (e.g., "Jornal Oficial 2026")
      const yearLinks = await page.evaluate(() => {
        const links: { text: string; year: number; href: string }[] = [];
        const currentYear = new Date().getFullYear();
        
        // Look for links containing "20XX" that look like year navigation
        const allLinks = document.querySelectorAll('a');
        for (const link of Array.from(allLinks)) {
          const text = link.textContent?.trim() || '';
          const href = link.getAttribute('href') || '';
          
          // Match patterns like "Jornal Oficial 2026" or just "2026"
          const yearMatch = text.match(/(?:jornal\s+oficial\s+)?(\d{4})/i);
          if (yearMatch) {
            const year = parseInt(yearMatch[1]);
            // Only consider years from 2015 to current year + 1
            if (year >= 2015 && year <= currentYear + 1) {
              links.push({ text, year, href });
            }
          }
        }
        
        return links;
      });
      
      if (yearLinks.length === 0) {
        logger.debug('No year navigation links found, assuming gazettes are listed directly');
        return;
      }
      
      logger.debug(`Found ${yearLinks.length} year links on page`, { 
        years: yearLinks.map((l: { year: number }) => l.year) 
      });
      
      // Determine which year to navigate to based on dateRange
      const endDate = new Date(this.dateRange.end);
      const targetYear = endDate.getFullYear();
      
      // Find the link for the target year
      const targetYearLink = yearLinks.find((l: { year: number }) => l.year === targetYear);
      
      if (targetYearLink) {
        logger.info(`Navigating to year ${targetYear} page`);
        
        // Navigate directly using href
        if (targetYearLink.href) {
          const fullUrl = targetYearLink.href.startsWith('http') 
            ? targetYearLink.href 
            : new URL(targetYearLink.href, this.iperoConfig.baseUrl).href;
          await page.goto(fullUrl, { waitUntil: 'networkidle0', timeout: 30000 });
          logger.debug(`Navigated to year ${targetYear} URL: ${fullUrl}`);
        }
      } else {
        // If target year not found, try the most recent year available
        const sortedYears = yearLinks.sort((a: { year: number }, b: { year: number }) => b.year - a.year);
        if (sortedYears.length > 0) {
          const mostRecentYear = sortedYears[0];
          logger.info(`Target year ${targetYear} not found, navigating to most recent year ${mostRecentYear.year}`);
          
          if (mostRecentYear.href) {
            const fullUrl = mostRecentYear.href.startsWith('http') 
              ? mostRecentYear.href 
              : new URL(mostRecentYear.href, this.iperoConfig.baseUrl).href;
            await page.goto(fullUrl, { waitUntil: 'networkidle0', timeout: 30000 });
          }
        }
      }
    } catch (error) {
      logger.warn('Error navigating to year page', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Extract gazettes from the browser-rendered year page
   */
  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Get all PDF links from the page
      const gazetteElements = await page.evaluate(() => {
        const elements: { dateText: string; editionNumber: string; viewHref: string; isExtra: boolean; sourceText: string }[] = [];
        
        // Pattern: Direct ecrie.com.br PDF links
        // The date is extracted from the PDF filename: a_148_0_1_DDMMYYYYHHMMSS.pdf
        const pdfLinks = document.querySelectorAll('a[href*="ecrie.com.br"][href$=".pdf"]');
        for (const link of Array.from(pdfLinks)) {
          const href = link.getAttribute('href') || '';
          const text = link.textContent?.trim() || '';
          
          // Extract date from filename: a_X_X_X_DDMMYYYYHHMMSS.pdf
          const filenameMatch = href.match(/a_\d+_\d+_\d+_(\d{2})(\d{2})(\d{4})\d{6}\.pdf/);
          let dateText = '';
          if (filenameMatch) {
            const [, day, month, year] = filenameMatch;
            dateText = `${day}/${month}/${year}`;
          }
          
          // Extract edition number from link text (e.g., "Edição 1248")
          const editionMatch = text.match(/[Ee]di[çc][ãa]o\s*(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : '';
          
          const isExtra = text.toLowerCase().includes('extra');
          
          if (dateText && href) {
            elements.push({
              dateText,
              editionNumber,
              viewHref: href,
              isExtra,
              sourceText: text || `Gazette from ${dateText}`
            });
          }
        }
        
        return elements;
      });
      
      logger.debug(`Found ${gazetteElements.length} gazette elements on page`);
      
      // Process each element
      for (const element of gazetteElements) {
        try {
          // Parse date
          const dateMatch = element.dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) {
            logger.warn(`Could not parse date from: ${element.dateText}`);
            continue;
          }
          
          const [, day, month, year] = dateMatch;
          const gazetteDate = new Date(`${year}-${month}-${day}`);
          
          if (isNaN(gazetteDate.getTime())) {
            logger.warn(`Invalid date: ${element.dateText}`);
            continue;
          }
          
          // Create gazette
          const gazette = await this.createGazette(gazetteDate, element.viewHref, {
            editionNumber: element.editionNumber || undefined,
            isExtraEdition: element.isExtra || false,
            power: 'executive_legislative',
            sourceText: element.sourceText,
          });
          
          if (gazette) {
            gazettes.push(gazette);
          }
          
        } catch (error) {
          logger.error(`Error processing gazette element:`, error as Error);
        }
      }
      
    } catch (error) {
      logger.error(`Error extracting gazettes from page:`, error as Error);
    }
    
    return gazettes;
  }
}

