import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituracamacariConfig } from '../../types';
import { logger } from '../../utils/logger';
import { getCurrentTimestamp } from '../../utils/date-utils';

/**
 * PrefeituracamacariSpider implementation
 * 
 * Crawls the official gazette from Camaçari, BA
 * Site: https://www.camacari.ba.gov.br/arquivos/diario-oficial/
 * 
 * The site uses a custom WordPress REST API that is protected by WAF:
 * API: /wp-json/camacari/v1/arquivos?paged=1&categoria=diario-oficial
 * 
 * The API returns JSON with gazette data. Since the API is blocked for
 * direct HTTP requests, we use browser rendering to access the page
 * and extract the data from the rendered HTML.
 * 
 * PDF URL pattern: /wp-content/uploads/{year}/{month}/diario-{number}-certificado.pdf
 * 
 * Page structure after JavaScript rendering:
 * - Date element: div with text "Data: DD/MM/YYYY"
 * - Link element: a tag with "DIÁRIO OFICIAL N° XXXX/YYYY DE DD DE MONTH DE YYYY"
 */
export class PrefeituracamacariSpider extends BaseSpider {
  protected camacariConfig: PrefeituracamacariConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.camacariConfig = spiderConfig.config as PrefeituracamacariConfig;
    this.browser = browser || null;
    
    if (!this.camacariConfig.baseUrl) {
      throw new Error(`PrefeituracamacariSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituracamacariSpider for ${spiderConfig.name}`);
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.camacariConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    // Check if browser is available for client rendering
    if (this.camacariConfig.requiresClientRendering && this.browser) {
      return await this.crawlWithBrowser();
    }

    // Fallback to HTTP-based crawling (may not work due to WAF)
    try {
      const listUrl = `${this.camacariConfig.baseUrl}/arquivos/diario-oficial/`;
      logger.info(`Fetching gazette list from: ${listUrl}`);
      
      const html = await this.fetch(listUrl);
      const $ = this.loadHTML(html);

      // Find all PDF links in the page
      const pdfLinks = $('a[href*=".pdf"]').toArray();
      
      logger.info(`Found ${pdfLinks.length} PDF links in page`);

      for (const link of pdfLinks) {
        try {
          const $link = $(link);
          const href = $link.attr('href');
          const title = $link.text().trim();
          
          // Skip if not a diário oficial link
          if (!title.match(/DI[ÁA]RIO OFICIAL/i) || !href) {
            continue;
          }

          const gazette = this.parseGazette(href, title);
          if (gazette && this.isInDateRange(new Date(gazette.date))) {
            gazettes.push(gazette);
            logger.info(`Found gazette: ${gazette.date} - ${title}`);
          }
        } catch (error) {
          logger.warn(`Error processing gazette item:`, { error: (error as Error).message });
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Crawl using browser rendering (required for Camaçari due to WAF)
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(`PrefeituracamacariSpider for ${this.config.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      
      // Set viewport
      await page.setViewport({ width: 1280, height: 800 });
      
      // Navigate to the gazette listing page
      const listUrl = `${this.camacariConfig.baseUrl}/arquivos/diario-oficial/`;
      logger.info(`Navigating to gazette list with browser: ${listUrl}`);
      
      await page.goto(listUrl, { 
        waitUntil: 'networkidle0', 
        timeout: 30000 
      });
      this.requestCount++;
      
      // Wait for the gazette list to load (via AJAX)
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Extract gazette data from the rendered page
      const gazetteData = await page.evaluate(() => {
        const results: Array<{
          title: string;
          url: string;
          dateText: string;
        }> = [];
        
        // Find all gazette entries
        // Structure: Each entry has a date element and a link element
        // The link contains "DIÁRIO OFICIAL" in its text
        const allLinks = document.querySelectorAll('a');
        
        for (const link of Array.from(allLinks)) {
          const text = link.textContent?.trim() || '';
          const href = link.getAttribute('href') || '';
          
          // Match DIÁRIO OFICIAL links
          if (text.match(/DI[ÁA]RIO OFICIAL/i) && href.includes('.pdf')) {
            // Try to find the date from the parent container
            const parent = link.closest('div');
            let dateText = '';
            
            if (parent) {
              // Look for "Data: DD/MM/YYYY" pattern in siblings
              const siblings = parent.parentElement?.querySelectorAll('div') || [];
              for (const sibling of Array.from(siblings)) {
                const sibText = sibling.textContent || '';
                const dateMatch = sibText.match(/Data:\s*(\d{2}\/\d{2}\/\d{4})/);
                if (dateMatch) {
                  dateText = dateMatch[1];
                  break;
                }
              }
            }
            
            results.push({
              title: text,
              url: href,
              dateText
            });
          }
        }
        
        return results;
      });

      logger.info(`Found ${gazetteData.length} gazette entries via browser`);

      // Process each gazette
      for (const data of gazetteData) {
        try {
          const gazette = this.parseGazette(data.url, data.title, data.dateText);
          if (gazette && this.isInDateRange(new Date(gazette.date))) {
            gazettes.push(gazette);
            logger.info(`Found gazette: ${gazette.date} - ${data.title.substring(0, 50)}...`);
          }
        } catch (error) {
          logger.warn(`Error parsing gazette:`, { error: (error as Error).message });
        }
      }

      // If no gazettes found, try loading more pages
      if (gazetteData.length === 0) {
        logger.warn('No gazettes found on first page, site structure may have changed');
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name} with browser:`, error as Error);
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
      if (browserInstance) {
        await browserInstance.close().catch(() => {});
      }
    }

    return gazettes;
  }

  private parseGazette(pdfUrl: string, title: string, dateText?: string): Gazette | null {
    try {
      let date: string;
      let editionNumber: string | undefined;

      // Try to extract date from provided dateText (DD/MM/YYYY format)
      if (dateText) {
        const parts = dateText.split('/');
        if (parts.length === 3) {
          date = `${parts[2]}-${parts[1]}-${parts[0]}`;
        } else {
          date = this.extractDateFromTitle(title);
        }
      } else {
        date = this.extractDateFromTitle(title);
      }

      if (!date) {
        // Try to extract date from PDF URL
        const urlDateMatch = pdfUrl.match(/\/(\d{4})\/(\d{2})\//);
        if (urlDateMatch) {
          const [, year, month] = urlDateMatch;
          date = `${year}-${month}-01`;
        } else {
          logger.debug(`Could not extract date from URL or title: ${pdfUrl}`);
          return null;
        }
      }

      // Extract edition number from title
      const titleEditionMatch = title.match(/N[°º]?\s*(\d+)/i);
      if (titleEditionMatch) {
        editionNumber = titleEditionMatch[1];
      } else {
        // Try from URL
        const urlEditionMatch = pdfUrl.match(/diario-(\d+)/i);
        if (urlEditionMatch) {
          editionNumber = urlEditionMatch[1];
        }
      }

      // Ensure URL is absolute
      const fileUrl = pdfUrl.startsWith('http') 
        ? pdfUrl 
        : `${this.camacariConfig.baseUrl}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;

      // Check if it's an extra edition (caderno)
      const isExtraEdition = title.toLowerCase().includes('caderno') || 
                            title.toLowerCase().includes('suplemento') ||
                            title.toLowerCase().includes('extra') ||
                            title.match(/\d+[°º]?\s*CADERNO/i) !== null;

      return {
        date,
        fileUrl,
        territoryId: this.spiderConfig.territoryId,
        scrapedAt: getCurrentTimestamp(),
        isExtraEdition,
        power: 'executive_legislative',
        editionNumber,
        sourceText: title,
      };
    } catch (error) {
      logger.warn(`Error parsing gazette:`, { error: (error as Error).message, pdfUrl, title });
      return null;
    }
  }

  private extractDateFromTitle(title: string): string {
    // Format: "DIÁRIO OFICIAL N° 2793/2026 DE 21 DE JANEIRO DE 2026"
    const dateMatch = title.match(/(\d{1,2})\s+DE\s+(\w+)\s+DE\s+(\d{4})/i);
    
    if (dateMatch) {
      const [, day, monthName, year] = dateMatch;
      const month = this.getMonthNumber(monthName);
      if (month) {
        return `${year}-${month}-${day.padStart(2, '0')}`;
      }
    }
    
    return '';
  }

  private getMonthNumber(monthName: string): string | null {
    const months: Record<string, string> = {
      'janeiro': '01',
      'fevereiro': '02',
      'março': '03',
      'marco': '03',
      'abril': '04',
      'maio': '05',
      'junho': '06',
      'julho': '07',
      'agosto': '08',
      'setembro': '09',
      'outubro': '10',
      'novembro': '11',
      'dezembro': '12',
    };
    
    return months[monthName.toLowerCase()] || null;
  }
}
