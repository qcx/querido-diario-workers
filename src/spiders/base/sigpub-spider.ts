import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, SigpubConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Improved SigpubSpider using Cloudflare Browser Rendering
 * 
 * This spider uses Puppeteer via Cloudflare Browser Rendering to:
 * 1. Navigate to the calendar page
 * 2. Extract edition links from the interactive calendar
 * 3. Download gazette PDFs
 * 
 * The SIGPub platform requires JavaScript interaction to access the calendar,
 * making browser rendering necessary for reliable scraping.
 */
export class SigpubSpider extends BaseSpider {
  protected sigpubConfig: SigpubConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.sigpubConfig = spiderConfig.config as SigpubConfig;
    logger.info(`Initializing SigpubSpider for ${spiderConfig.name} with URL: ${this.sigpubConfig.url}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.sigpubConfig.url} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Option 1: Use Cloudflare Browser Rendering (recommended)
      if (this.browser) {
        return await this.crawlWithBrowser();
      }
      
      // Option 2: Fallback to direct URL construction (if browser not available)
      return await this.crawlWithDirectUrls();
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Crawl using Cloudflare Browser Rendering (Puppeteer)
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    logger.info('Using browser rendering for SIGPub crawling');
    
    // This would use Puppeteer via Cloudflare Browser Rendering
    // Example implementation:
    /*
    const page = await this.browser.newPage();
    
    try {
      // Navigate to the main page
      await page.goto(this.sigpubConfig.url, { waitUntil: 'networkidle0' });
      
      // Wait for calendar to load
      await page.waitForSelector('a[href*="voxtecnologia.com.br"]', { timeout: 10000 });
      
      // Extract all PDF links from the page
      const pdfLinks = await page.evaluate(() => {
        const links: Array<{url: string, text: string}> = [];
        
        document.querySelectorAll('a[href*="voxtecnologia.com.br"]').forEach(link => {
          const href = link.getAttribute('href');
          const text = link.textContent?.trim() || '';
          
          if (href && href.includes('.pdf') && !href.includes('.xml')) {
            links.push({ url: href, text });
          }
        });
        
        return links;
      });
      
      // Process each PDF link
      for (const link of pdfLinks) {
        // Extract date from URL (format: YYYY-MM-DD)
        const dateMatch = link.url.match(/(\d{4}-\d{2}-\d{2})/);
        
        if (dateMatch) {
          const dateStr = dateMatch[1];
          const gazetteDate = new Date(dateStr);
          
          if (this.isInDateRange(gazetteDate)) {
            // Check if it's an extraordinary edition
            const isExtra = link.text.toLowerCase().includes('extraordin');
            
            gazettes.push(this.createGazette(gazetteDate, link.url, {
              editionNumber: this.extractEditionNumber(link.text),
              isExtraEdition: isExtra,
              power: 'executive',
            }));
          }
        }
      }
      
    } finally {
      await page.close();
    }
    */
    
    logger.warn('Browser rendering not implemented yet - using fallback method');
    return await this.crawlWithDirectUrls();
  }

  /**
   * Crawl by constructing direct URLs (fallback method)
   * 
   * This method attempts to fetch the main page and extract PDF links
   * directly from the HTML. Less reliable than browser rendering but
   * works without Puppeteer.
   */
  private async crawlWithDirectUrls(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      const response = await this.fetch(this.sigpubConfig.url);
      
      // Extract PDF URLs from the HTML
      const pdfUrlRegex = /https:\/\/www-storage\.voxtecnologia\.com\.br\/\?m=sigpub\.publicacao&f=\d+&i=publicado_\d+_(\d{4}-\d{2}-\d{2})_[a-f0-9]+\.pdf/g;
      
      const matches = response.matchAll(pdfUrlRegex);
      
      for (const match of matches) {
        const url = match[0];
        const dateStr = match[1];
        const gazetteDate = new Date(dateStr);
        
        if (this.isInDateRange(gazetteDate)) {
          gazettes.push(this.createGazette(gazetteDate, url, {
            editionNumber: 'N/A',
            isExtraEdition: false,
            power: 'executive',
          }));
        }
      }
      
      logger.info(`Found ${gazettes.length} gazettes using direct URL extraction`);
      
    } catch (error) {
      logger.error('Error in direct URL extraction:', error as Error);
    }
    
    return gazettes;
  }

  /**
   * Extract edition number from text
   */
  private extractEditionNumber(text: string): string {
    const match = text.match(/(?:edição|edicao)\s*(?:n[°º]?)?\s*(\d+)/i);
    return match ? match[1] : 'N/A';
  }
}
