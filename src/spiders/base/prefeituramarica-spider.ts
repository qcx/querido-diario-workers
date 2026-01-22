import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraMaricaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';
// @ts-ignore
import { parse } from 'node-html-parser';

/**
 * Spider for Prefeitura de Maricá official gazette (JOM - Jornal Oficial de Maricá)
 * 
 * Site Structure:
 * - WordPress-based site with custom post type for gazettes
 * - Listing page: https://www.marica.rj.gov.br/jornal-oficial-marica/
 * - Editions listed as "ED. {number} {DD/MM/YYYY}" format
 * - Each edition links to a detail page with PDF download
 * - Pagination available with "Ver Anteriores >" link
 * 
 * Requires browser rendering for JavaScript-rendered content
 */
export class PrefeituraMaricaSpider extends BaseSpider {
  private _baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraMaricaConfig;
    this._baseUrl = platformConfig.baseUrl || 'https://www.marica.rj.gov.br/jom/';
    this.browser = browser || null;
    
    // Ensure base URL ends with /
    if (!this._baseUrl.endsWith('/')) {
      this._baseUrl += '/';
    }
    
    logger.info(`Initializing PrefeituraMaricaSpider for ${config.name} with URL: ${this._baseUrl}`);
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(`PrefeituraMaricaSpider for ${this.config.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura Maricá for ${this.config.name}... (${this._baseUrl})`);
    
    return this.crawlWithBrowser();
  }

  /**
   * Crawl using browser for JavaScript-rendered content
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Navigate to the gazette listing page
      const listingUrl = this._baseUrl;
      logger.debug(`Navigating to: ${listingUrl}`);
      
      try {
        await page.goto(listingUrl, { waitUntil: 'load', timeout: 30000 });
      } catch (error) {
        logger.warn('Page load timeout, trying with domcontentloaded');
        try {
          await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        } catch (retryError) {
          logger.error('Failed to load page even with domcontentloaded');
          throw retryError;
        }
      }
      this.requestCount++;
      
      // Wait for page to stabilize and JavaScript to execute
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Wait for content to load
      try {
        await page.waitForSelector('a[href*="ed"], li a', { timeout: 10000 });
      } catch (error) {
        logger.warn('Content selector not found, but continuing anyway');
      }
      
      let hasMorePages = true;
      let pageNum = 0;
      const maxPages = 50; // Safety limit
      
      while (hasMorePages && pageNum < maxPages) {
        logger.debug(`Extracting gazettes from page ${pageNum + 1}`);
        
        // Get page HTML
        const html = await page.content();
        const root = parse(html);
        
        // Find all edition links
        // Pattern: "ED. {number} {DD/MM/YYYY}" in link text
        const editionLinks = root.querySelectorAll('a');
        let foundInRange = false;
        
        for (const link of editionLinks) {
          try {
            const linkText = link.text?.trim() || '';
            
            // Match pattern: "ED. 1830 16/01/2026" or "ED. 1829 14/01/2026"
            const editionMatch = linkText.match(/ED\.\s*(\d+)\s+(\d{2})\/(\d{2})\/(\d{4})/i);
            if (!editionMatch) {
              continue;
            }
            
            const [, editionNumber, day, month, year] = editionMatch;
            const gazetteDate = new Date(`${year}-${month}-${day}`);
            
            // Check date range
            if (gazetteDate < new Date(this.dateRange.start)) {
              // Found older than range, but continue to check current page
              continue;
            }
            
            if (gazetteDate > new Date(this.dateRange.end)) {
              continue; // Skip future dates
            }
            
            foundInRange = true;
            
            // Get detail page URL
            let detailUrl = link.getAttribute('href');
            if (!detailUrl) {
              continue;
            }
            
            // Make absolute URL if relative
            if (!detailUrl.startsWith('http')) {
              const baseUrlObj = new URL(listingUrl);
              detailUrl = `${baseUrlObj.origin}${detailUrl.startsWith('/') ? '' : '/'}${detailUrl}`;
            }
            
            // Navigate to detail page to get PDF URL
            const pdfUrl = await this.getPdfUrlFromDetailPage(page, detailUrl);
            
            if (!pdfUrl) {
              logger.warn(`No PDF URL found for edition ${editionNumber} (${day}/${month}/${year})`);
              continue;
            }
            
            // Check if it's an extra edition
            const isExtraEdition = linkText.toLowerCase().includes('extra');
            
            // Create gazette
            const gazette = await this.createGazette(gazetteDate, pdfUrl, {
              editionNumber,
              isExtraEdition,
              power: 'executive_legislative',
              sourceText: linkText,
            });
            
            if (gazette) {
              gazettes.push(gazette);
            }
            
          } catch (error) {
            logger.error(`Error processing edition link:`, error as Error);
          }
        }
        
        // Check for pagination - look for "Ver Anteriores" or next page link
        const verAnterioresLink = Array.from(editionLinks).find(link => {
          const text = link.text?.toLowerCase() || '';
          return text.includes('anteriores') || text.includes('próximo') || text.includes('next');
        });
        
        // Also check for pagination links with page numbers
        const pageLinks = root.querySelectorAll('a[href*="page"]');
        const nextPageLink = Array.from(pageLinks).find(link => {
          const href = link.getAttribute('href') || '';
          const text = link.text?.toLowerCase() || '';
          return href.includes(`page/${pageNum + 2}`) || text.includes('próximo') || text.includes('next');
        });
        
        const paginationLink = verAnterioresLink || nextPageLink;
        
        if (!paginationLink && !foundInRange) {
          logger.debug('No more pages found and no items in range, stopping');
          hasMorePages = false;
          break;
        }
        
        if (paginationLink) {
          const nextUrl = paginationLink.getAttribute('href');
          if (nextUrl) {
            let fullNextUrl = nextUrl;
            if (!nextUrl.startsWith('http')) {
              const baseUrlObj = new URL(listingUrl);
              fullNextUrl = `${baseUrlObj.origin}${nextUrl.startsWith('/') ? '' : '/'}${nextUrl}`;
            }
            
            logger.debug(`Navigating to next page: ${fullNextUrl}`);
            try {
              await page.goto(fullNextUrl, { waitUntil: 'load', timeout: 30000 });
            } catch (error) {
              logger.warn('Next page load timeout, trying with domcontentloaded');
              await page.goto(fullNextUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
            }
            this.requestCount++;
            await page.waitForSelector('a[href*="ed"], li a', { timeout: 10000 });
            pageNum++;
          } else {
            hasMorePages = false;
          }
        } else {
          hasMorePages = false;
        }
        
        // If no items found in range on this page, stop
        if (!foundInRange && pageNum > 0) {
          logger.debug('No items in range found on this page, stopping');
          hasMorePages = false;
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.config.name}:`, error as Error);
    } finally {
      if (page) {
        await page.close();
      }
      if (browserInstance) {
        await browserInstance.close();
      }
    }
    
    return gazettes;
  }

  /**
   * Navigate to detail page and extract PDF URL
   */
  private async getPdfUrlFromDetailPage(page: any, detailUrl: string): Promise<string | null> {
    try {
      logger.debug(`Fetching detail page: ${detailUrl}`);
      
      try {
        await page.goto(detailUrl, { waitUntil: 'load', timeout: 30000 });
      } catch (error) {
        logger.warn('Detail page load timeout, trying with domcontentloaded');
        await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      }
      this.requestCount++;
      
      // Wait a bit for any dynamic content
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Get page HTML
      const html = await page.content();
      const root = parse(html);
      
      // Look for PDF download link
      // Try multiple selectors in order of specificity
      const pdfSelectors = [
        'a[href$=".pdf"]',
        'a[title*="download" i]',
        'a[title*="Download"]',
        '.wp-block-file a',
        '.entry-content a[href*="uploads"]',
        'a[href*=".pdf"]',
        'iframe[src*=".pdf"]',
      ];
      
      for (const selector of pdfSelectors) {
        const pdfLink = root.querySelector(selector);
        if (pdfLink) {
          let pdfUrl = pdfLink.getAttribute('href') || pdfLink.getAttribute('src');
          if (pdfUrl) {
            // Make absolute URL if relative
            if (!pdfUrl.startsWith('http')) {
              const baseUrlObj = new URL(detailUrl);
              pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
            }
            return pdfUrl;
          }
        }
      }
      
      logger.debug(`No PDF link found on detail page: ${detailUrl}`);
      return null;
      
    } catch (error) {
      logger.warn(`Error getting PDF URL from ${detailUrl}`, error as Error);
      return null;
    }
  }
}
