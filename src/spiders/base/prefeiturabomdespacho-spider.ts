import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, InstarConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Spider for Prefeitura de Bom Despacho diário oficial
 * 
 * Site Structure:
 * - URL: http://web.bomdespacho.mg.gov.br/dome/
 * - Uses a simple list structure with dates (DD/MM/YYYY) and "Download" links
 * - Each gazette has an identifier number and a publication date
 * - Requires browser rendering due to JavaScript-heavy page
 */
export class PrefeituraBomDespachoSpider extends BaseSpider {
  protected bomDespachoConfig: InstarConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.bomDespachoConfig = spiderConfig.config as InstarConfig;
    this.browser = browser || null;
    
    if (!this.bomDespachoConfig.url) {
      throw new Error(`PrefeituraBomDespachoSpider requires a url in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraBomDespachoSpider for ${spiderConfig.name} with URL: ${this.bomDespachoConfig.url}`, {
      hasBrowser: !!this.browser,
    });
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.bomDespachoConfig.url} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error('PrefeituraBomDespachoSpider requires browser rendering');
    }
    
    return this.crawlWithBrowser();
  }

  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      logger.debug(`Navigating to: ${this.bomDespachoConfig.url}`);
      
      try {
        await page.goto(this.bomDespachoConfig.url, { waitUntil: 'load', timeout: 30000 });
      } catch (error) {
        logger.warn('Page load timeout, trying with domcontentloaded');
        try {
          await page.goto(this.bomDespachoConfig.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        } catch (retryError) {
          logger.error('Failed to load page even with domcontentloaded');
          throw retryError;
        }
      }
      
      this.requestCount++;
      
      // Wait for page to stabilize and JavaScript to execute
      await new Promise(resolve => setTimeout(resolve, 4000));
      
      try {
        // Wait for download links or any links
        await page.waitForSelector('a', { timeout: 10000 });
      } catch (error) {
        logger.warn('Links not found, but continuing anyway - page may still have content');
      }
      
      // Additional wait to ensure dynamic content is loaded
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const pageGazettes = await this.extractGazettesFromPage(page);
      
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

  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Extract all container elements that might contain gazette info
      const gazetteElements = await page.evaluate(() => {
        const elements: any[] = [];
        const seenDates = new Set<string>(); // Track dates to avoid duplicates
        
        // Find all download links and their associated containers
        const allLinks = document.querySelectorAll('a');
        const linkToContainer = new Map<Element, Element>();
        
        // Build a map of links to their containers
        for (const link of Array.from(allLinks)) {
          const text = link.textContent?.trim() || '';
          const href = link.getAttribute('href') || '';
          
          // Check if this looks like a download link
          if (text.toLowerCase().includes('download') || 
              href.toLowerCase().includes('download') || 
              href.toLowerCase().includes('.pdf') ||
              href.toLowerCase().includes('dome') ||
              href.toLowerCase().includes('diario')) {
            
            // Find the parent container that likely contains the date
            let container = link.parentElement;
            let depth = 0;
            const maxDepth = 5;
            
            while (container && depth < maxDepth) {
              const containerText = container.textContent || '';
              const dateMatch = containerText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
              
              if (dateMatch) {
                linkToContainer.set(link, container);
                break;
              }
              
              container = container.parentElement;
              depth++;
            }
          }
        }
        
        // Process each link-container pair
        for (const [link, container] of linkToContainer.entries()) {
          const containerText = container.textContent || '';
          const dateMatch = containerText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          
          if (!dateMatch) continue;
          
          const dateText = dateMatch[0];
          
          // Skip if we've already seen this date (avoid duplicates)
          if (seenDates.has(dateText)) continue;
          
          const href = link.getAttribute('href') || '';
          const text = link.textContent?.trim() || '';
          
          // Extract any identifier/number from the container (usually 6 digits)
          const identifierMatch = containerText.match(/\b\d{4,}\b/);
          const identifier = identifierMatch ? identifierMatch[0] : null;
          
          elements.push({
            dateText,
            downloadHref: href,
            downloadText: text,
            identifier,
            containerText: containerText.substring(0, 200), // First 200 chars for debugging
          });
          
          seenDates.add(dateText);
        }
        
        return elements;
      });
      
      logger.debug(`Found ${gazetteElements.length} gazette elements on page`);
      
      // Process each element
      for (const element of gazetteElements) {
        try {
          // Parse date
          let gazetteDate: Date | null = null;
          if (element.dateText) {
            const dateMatch = element.dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (dateMatch) {
              const [, day, month, year] = dateMatch;
              gazetteDate = new Date(`${year}-${month}-${day}`);
            }
          }
          
          if (!gazetteDate) {
            logger.debug(`Could not parse date from: ${element.dateText}`);
            continue;
          }
          
          // Check if date is in range
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }
          
          // Get PDF URL
          if (!element.downloadHref) {
            logger.warn(`No download link found for gazette: ${element.dateText}`);
            continue;
          }
          
          // Construct full PDF URL
          let pdfUrl = element.downloadHref;
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.bomDespachoConfig.url);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }
          
          // Log resolved URL
          logger.debug(`Resolved PDF URL: ${pdfUrl}`);
          
          // Extract edition number from identifier or container text
          let editionNumber: string | undefined = undefined;
          if (element.identifier) {
            editionNumber = element.identifier;
          } else {
            const editionMatch = element.containerText?.match(/[Ee]di[çc][ãa]o\s+[nN]?[°º]?\s*(\d+)/i);
            editionNumber = editionMatch ? editionMatch[1] : undefined;
          }
          
          // Check if it's an extra edition
          const isExtraEdition = element.containerText?.toLowerCase().includes('extra') || false;
          
          // Create gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber,
            isExtraEdition,
            power: 'executive_legislative',
            sourceText: `Gazette ${toISODate(gazetteDate)}${element.identifier ? ` - ${element.identifier}` : ''}`,
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
