import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraLemeConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Spider for Prefeitura de Leme official gazette
 * 
 * Uses Cloudflare Browser Rendering (Puppeteer) to handle:
 * - Tab-based year navigation
 * - Accordion-based month navigation
 * - PDF links with edition info in link text
 * 
 * Site structure:
 * - URL: https://www.leme.sp.gov.br/imprensa
 * - Years shown as tabs (2026, 2025, 2024, etc.)
 * - Within each year tab, months are expandable accordions (Janeiro, Fevereiro, etc.)
 * - Each month contains PDF links with text pattern: "EDIÇÃO Nº XXXX, DE DD/MM/YYYY PDF (XXX KB)"
 * - PDF URLs: https://www.leme.sp.gov.br/assets/files/imprensas/{hash}.pdf
 */
export class PrefeituraLemeSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraLemeConfig;
    this.baseUrl = platformConfig.baseUrl;
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
      logger.error(`PrefeituraLemeSpider for ${this.config.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura Leme for ${this.config.name}...`);

    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      
      // Navigate to the page
      logger.debug(`Navigating to: ${this.baseUrl}`);
      await page.goto(this.baseUrl, { waitUntil: 'networkidle0', timeout: 60000 });
      this.requestCount++;
      
      // Wait for page to load and tabs to appear
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Get years from date range
      const startYear = this.startDate.getFullYear();
      const endYear = this.endDate.getFullYear();
      
      // Process years in the date range (from most recent to oldest)
      for (let year = endYear; year >= startYear; year--) {
        try {
          logger.info(`Processing year ${year}`);
          const yearGazettes = await this.crawlYear(page, year);
          gazettes.push(...yearGazettes);
          
          if (yearGazettes.length > 0) {
            logger.info(`Found ${yearGazettes.length} gazette(s) for year ${year}`);
          }
        } catch (error) {
          logger.error(`Error crawling year ${year}:`, error as Error);
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from Prefeitura Leme`);
      
    } catch (error) {
      logger.error(`Error crawling Prefeitura Leme:`, error as Error);
      throw error;
    } finally {
      // Clean up
      if (page) {
        try {
          await page.close();
        } catch (e) {
          logger.warn('Error closing page', e as Error);
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (e) {
          logger.warn('Error closing browser', e as Error);
        }
      }
    }

    return gazettes;
  }

  /**
   * Crawl all gazettes for a specific year
   */
  private async crawlYear(page: any, year: number): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Click on the year tab
      const tabClicked = await page.evaluate((targetYear: number) => {
        // Find all tabs with year numbers
        const tabs = Array.from(document.querySelectorAll('[role="tab"], .nav-link, .tab-link, button'));
        
        for (const tab of tabs) {
          const text = (tab as HTMLElement).textContent?.trim() || '';
          if (text === String(targetYear)) {
            (tab as HTMLElement).click();
            return true;
          }
        }
        return false;
      }, year);
      
      if (!tabClicked) {
        logger.debug(`Year tab ${year} not found on page`);
        return gazettes;
      }
      
      // Wait for tab content to load
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Get months to process from date range
      const monthsToProcess = this.getMonthsForYear(year);
      
      // Extract all PDF links from the current tab content
      // The structure is: listitem with name containing "EDIÇÃO Nº XXX, DE DD/MM/YYYY" 
      // with a nested link that has the actual PDF URL
      const pdfLinks = await page.evaluate(() => {
        const links: Array<{
          text: string;
          href: string;
        }> = [];
        
        // Strategy 1: Find list items containing EDIÇÃO text and extract PDF links
        // The site structure: li > ... > a[href*=".pdf"]
        const listItems = Array.from(document.querySelectorAll('li'));
        
        for (const li of listItems) {
          const liText = li.textContent?.trim() || '';
          
          // Check if this list item contains edition info
          if (liText.includes('EDIÇÃO') && liText.includes('PDF')) {
            // Find the PDF link inside this list item
            const pdfLink = li.querySelector('a[href*=".pdf"], a[href*="imprensas"]');
            
            if (pdfLink) {
              const href = (pdfLink as HTMLAnchorElement).href;
              
              // Extract the edition text (everything before "PDF")
              // Pattern: "EDIÇÃO Nº XXXX, DE DD/MM/YYYY PDF (XXX KB)"
              const match = liText.match(/EDIÇÃO\s+N[º°]?\s*\d+[,\s]+DE\s+\d{2}\/\d{2}\/\d{4}/i);
              const editionText = match ? match[0] : liText;
              
              links.push({
                text: editionText,
                href: href,
              });
            }
          }
        }
        
        // Strategy 2: Also try to find any direct PDF links with edition info
        if (links.length === 0) {
          const allLinks = Array.from(document.querySelectorAll('a[href*=".pdf"], a[href*="imprensas"]'));
          
          for (const link of allLinks) {
            const href = (link as HTMLAnchorElement).href;
            
            // Walk up the DOM to find parent with edition text
            let parent = link.parentElement;
            let fullText = '';
            
            for (let i = 0; i < 5 && parent; i++) {
              const parentText = parent.textContent?.trim() || '';
              if (parentText.includes('EDIÇÃO') && parentText.match(/\d{2}\/\d{2}\/\d{4}/)) {
                fullText = parentText;
                break;
              }
              parent = parent.parentElement;
            }
            
            if (fullText && href) {
              links.push({
                text: fullText,
                href: href,
              });
            }
          }
        }
        
        return links;
      });
      
      logger.debug(`Found ${pdfLinks.length} PDF links for year ${year}`);
      
      // Process each PDF link
      for (const link of pdfLinks) {
        try {
          const gazette = this.processLinkText(link.text, link.href, monthsToProcess);
          if (gazette) {
            gazettes.push(gazette);
          }
        } catch (error) {
          logger.error(`Error processing link ${link.href}:`, error as Error);
        }
      }
      
    } catch (error) {
      logger.error(`Error in crawlYear for ${year}:`, error as Error);
    }
    
    return gazettes;
  }

  /**
   * Get months to process for a specific year based on date range
   */
  private getMonthsForYear(year: number): Set<number> {
    const months = new Set<number>();
    
    const startYear = this.startDate.getFullYear();
    const endYear = this.endDate.getFullYear();
    const startMonth = this.startDate.getMonth(); // 0-indexed
    const endMonth = this.endDate.getMonth(); // 0-indexed
    
    if (year < startYear || year > endYear) {
      return months;
    }
    
    let monthStart = 0;
    let monthEnd = 11;
    
    if (year === startYear) {
      monthStart = startMonth;
    }
    if (year === endYear) {
      monthEnd = endMonth;
    }
    
    for (let m = monthStart; m <= monthEnd; m++) {
      months.add(m + 1); // Convert to 1-indexed for matching with dates
    }
    
    return months;
  }

  /**
   * Process a link text to extract gazette info
   * Text pattern: "EDIÇÃO Nº 3908, DE 05/01/2026 PDF (615 KB)"
   *               "EDIÇÃO Nº 3667, DE 03/01/2025 - SUPLEMENTO PDF (548 KB)"
   */
  private processLinkText(text: string, href: string, validMonths: Set<number>): Gazette | null {
    try {
      // Extract edition number and date from text
      // Pattern: EDIÇÃO Nº XXXX, DE DD/MM/YYYY
      const match = text.match(/EDIÇÃO\s+N[º°]?\s*(\d+)[,\s]+DE\s+(\d{2})\/(\d{2})\/(\d{4})/i);
      
      if (!match) {
        logger.debug(`Could not parse gazette info from: ${text}`);
        return null;
      }
      
      const editionNumber = match[1];
      const day = parseInt(match[2], 10);
      const month = parseInt(match[3], 10);
      const year = parseInt(match[4], 10);
      
      // Check if month is in our valid range
      if (!validMonths.has(month)) {
        return null;
      }
      
      // Create date
      const gazetteDate = new Date(year, month - 1, day);
      
      // Check if date is in our crawl range
      if (gazetteDate < this.startDate || gazetteDate > this.endDate) {
        return null;
      }
      
      // Check if it's a suplemento (extra edition)
      const isExtraEdition = /SUPLEMENTO|EXTRA|EXTRAORDIN/i.test(text);
      
      // Build gazette using createGazette helper
      return this.createGazetteSync(gazetteDate, href, {
        power: 'executive_legislative',
        editionNumber,
        isExtraEdition,
        sourceText: text.slice(0, 200), // Truncate to reasonable length
      });
      
    } catch (error) {
      logger.error(`Error processing link text "${text}":`, error as Error);
      return null;
    }
  }

  /**
   * Synchronous version of createGazette for use in loops
   */
  private createGazetteSync(date: Date, pdfUrl: string, options: {
    power?: 'executive' | 'legislative' | 'executive_legislative';
    editionNumber?: string;
    isExtraEdition?: boolean;
    sourceText?: string;
  }): Gazette {
    const dateStr = toISODate(date);
    
    return {
      date: dateStr,
      fileUrl: pdfUrl,
      territoryId: this.config.territoryId,
      scrapedAt: new Date().toISOString(),
      power: options.power || 'executive_legislative',
      isExtraEdition: options.isExtraEdition || false,
      editionNumber: options.editionNumber,
      sourceText: options.sourceText,
    };
  }
}

