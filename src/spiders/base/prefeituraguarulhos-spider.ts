import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraGuarulhosConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Spider for Prefeitura de Guarulhos official gazette
 * 
 * Uses Cloudflare Browser Rendering (Puppeteer) to handle:
 * - Calendar interface with jQuery show/hide divs
 * - Month/year-based URL filtering: ?mes=MM&ano=YYYY
 * - JavaScript-driven calendar interaction
 * - Clicking dates to reveal PDF links in hidden divs
 * - Multiple PDFs per date (e.g., "Legal" and "Legal - 2ª Edição")
 * 
 * The site structure:
 * 1. Navigate to month/year page: {baseUrl}?mes=MM&ano=YYYY
 * 2. Calendar table shows dates with gazettes marked with class "bold trigger open" and id attribute
 * 3. Clicking a date triggers jQuery to show div#diario-{id} with PDF links
 * 4. Extract date from h3 header: "Diário da data: DD/MM/YYYY"
 * 5. Extract all PDF URLs from a[href*="../uploads/pdf/"] within the div
 */
export class PrefeituraGuarulhosSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraGuarulhosConfig;
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
      logger.error(`PrefeituraGuarulhosSpider for ${this.config.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura Guarulhos for ${this.config.name}...`);

    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      
      // Generate month/year URLs from date range
      const monthUrls = this.generateMonthUrls();
      logger.info(`Generated ${monthUrls.length} month URLs to crawl`);

      // Process each month
      for (const { url, year, month } of monthUrls) {
        try {
          logger.info(`Processing month: ${month}/${year}`);
          const monthGazettes = await this.crawlMonth(page, url, year, month);
          gazettes.push(...monthGazettes);
          logger.info(`Found ${monthGazettes.length} gazette(s) for ${month}/${year}`);
        } catch (error) {
          logger.error(`Error crawling month ${month}/${year}:`, error as Error);
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from Prefeitura Guarulhos`);
      
    } catch (error) {
      logger.error(`Error crawling Prefeitura Guarulhos:`, error as Error);
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
   * Generate list of month/year URLs from start date to end date
   */
  private generateMonthUrls(): Array<{ url: string; year: number; month: number }> {
    const urls: Array<{ url: string; year: number; month: number }> = [];
    const current = new Date(this.startDate.getFullYear(), this.startDate.getMonth(), 1);
    const end = new Date(this.endDate.getFullYear(), this.endDate.getMonth(), 1);

    while (current <= end) {
      const year = current.getFullYear();
      const month = current.getMonth() + 1; // JavaScript months are 0-indexed
      const url = `${this.baseUrl}?mes=${month}&ano=${year}`;
      urls.push({ url, year, month });
      
      // Move to next month
      current.setMonth(current.getMonth() + 1);
    }

    return urls;
  }

  /**
   * Crawl all gazettes for a specific month
   */
  private async crawlMonth(page: any, monthUrl: string, year: number, month: number): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Navigate to the month/year page
      logger.debug(`Navigating to: ${monthUrl}`);
      await page.goto(monthUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Wait for page to stabilize and jQuery to load
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Wait for calendar table to be present
      try {
        await page.waitForSelector('table.tabelaDiario', { timeout: 10000 });
      } catch (error) {
        logger.error('Calendar table not found');
        const html = await page.content();
        logger.debug(`Page HTML snippet: ${html.substring(0, 1000)}`);
        return gazettes;
      }
      
      // Find all dates with gazettes (a.trigger.open)
      const dateLinks = await page.$$eval(
        'a.trigger.open',
        (links: any[]) => {
          return links.map((link: any) => ({
            id: link.getAttribute('id'),
            dayText: link.textContent.trim(),
          })).filter((item: any) => item.id); // Only return items with id
        }
      );
      
      logger.debug(`Found ${dateLinks.length} dates with gazettes in calendar`);
      
      if (dateLinks.length === 0) {
        return gazettes;
      }
      
      // Process each date
      for (const dateLink of dateLinks) {
        try {
          const dateId = dateLink.id;
          // Use attribute selector since IDs can start with numbers (e.g., "3346")
          const dateSelector = `a.trigger.open[id="${dateId}"]`;
          const diarioSelector = `#diario-${dateId}`;
          
          // Find and click the date link
          const dateElement = await page.$(dateSelector);
          
          if (!dateElement) {
            logger.warn(`Could not find date element with id ${dateId}`);
            continue;
          }
          
          // Click the date link to trigger jQuery show/hide
          logger.debug(`Clicking date with id: ${dateId}`);
          await dateElement.click();
          
          // Wait for the diario div to become visible
          try {
            await page.waitForSelector(diarioSelector, { visible: true, timeout: 5000 });
            await new Promise(resolve => setTimeout(resolve, 500)); // Additional wait for jQuery animation
          } catch (error) {
            logger.warn(`#diario-${dateId} div did not become visible after clicking`);
            continue;
          }
          
          // Extract date from h3 header and PDF links from the div
          const dateAndPdfLinks = await page.evaluate((selector: string) => {
            const div = document.querySelector(selector) as HTMLElement;
            if (!div) return null;
            
            // Extract date from h3 header: "Diário da data: DD/MM/YYYY"
            const h3 = div.querySelector('h3');
            let dateText = '';
            if (h3) {
              const match = h3.textContent?.match(/Diário da data:\s*(\d{2}\/\d{2}\/\d{4})/i);
              if (match) {
                dateText = match[1];
              }
            }
            
            // Extract all PDF links
            const pdfLinks: Array<{ url: string; text: string }> = [];
            const links = div.querySelectorAll('a[href*="../uploads/pdf/"]');
            links.forEach((link: any) => {
              const href = link.getAttribute('href');
              const text = link.textContent?.trim() || '';
              if (href) {
                pdfLinks.push({ url: href, text });
              }
            });
            
            return { dateText, pdfLinks };
          }, diarioSelector);
          
          if (!dateAndPdfLinks || !dateAndPdfLinks.dateText) {
            logger.warn(`Could not extract date from div#diario-${dateId}`);
            continue;
          }
          
          // Parse date from "DD/MM/YYYY" format
          const [day, monthStr, yearStr] = dateAndPdfLinks.dateText.split('/');
          const gazetteDate = new Date(
            parseInt(yearStr, 10),
            parseInt(monthStr, 10) - 1, // JavaScript months are 0-indexed
            parseInt(day, 10)
          );
          
          // Check if date is in our crawl range
          if (!this.isInDateRange(gazetteDate)) {
            logger.debug(`Gazette date ${toISODate(gazetteDate)} is outside crawl range`);
            continue;
          }
          
          // Process each PDF link for this date
          for (const pdfLink of dateAndPdfLinks.pdfLinks) {
            try {
              // Make URL absolute if relative
              let absolutePdfUrl: string;
              if (pdfLink.url.startsWith('http')) {
                absolutePdfUrl = pdfLink.url;
              } else {
                // Resolve relative URL using URL constructor
                // baseUrl: "https://diariooficial.guarulhos.sp.gov.br/index.php"
                // pdfLink.url: "../uploads/pdf/1450364281.pdf"
                // Result: "https://diariooficial.guarulhos.sp.gov.br/uploads/pdf/1450364281.pdf"
                absolutePdfUrl = new URL(pdfLink.url, this.baseUrl).href;
              }
              
              // Extract edition number from link text if possible (e.g., "2ª Edição" -> "2")
              let editionNumber: string | undefined;
              const editionMatch = pdfLink.text.match(/(\d+)\s*ª?\s*edi[çc][ãa]o/i);
              if (editionMatch) {
                editionNumber = editionMatch[1];
              }
              
              // Check if it's an extra edition
              const isExtraEdition = /extra|supl|2ª|segunda/i.test(pdfLink.text);
              
              // Create the gazette object
              const gazette = await this.createGazette(gazetteDate, absolutePdfUrl, {
                editionNumber,
                isExtraEdition,
                power: 'executive_legislative',
                sourceText: pdfLink.text || `Diário Oficial - ${dateAndPdfLinks.dateText}`,
              });
              
              if (gazette) {
                gazettes.push(gazette);
              }
              
            } catch (error) {
              logger.error(`Error processing PDF link ${pdfLink.url}:`, error as Error);
            }
          }
          
          // Add small delay between dates
          await new Promise(resolve => setTimeout(resolve, 300));
          
        } catch (error) {
          logger.error(`Error processing date ${dateLink.id}:`, error as Error);
        }
      }
      
    } catch (error) {
      logger.error(`Error crawling month ${month}/${year}:`, error as Error);
    }
    
    return gazettes;
  }
}

