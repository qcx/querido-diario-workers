import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraCotiaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Spider for Prefeitura de Cotia official gazette
 * 
 * Uses Cloudflare Browser Rendering (Puppeteer) to handle:
 * - LeisMunicipais.com.br platform with calendar interface
 * - Month/year-based URL filtering: ?mes=MM&ano=YYYY
 * - JavaScript-driven calendar interaction
 * - Clicking dates to reveal PDF links
 * 
 * The site structure:
 * 1. Navigate to month/year page: {baseUrl}?mes=MM&ano=YYYY
 * 2. Calendar table shows dates with gazettes marked with class "tem" and diario="1"
 * 3. Clicking a date updates div#diario with PDF link
 * 4. Extract PDF URL from div.diario a.btn-link href
 */
export class PrefeituraCotiaSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraCotiaConfig;
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
      logger.error(`PrefeituraCotiaSpider for ${this.config.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura Cotia for ${this.config.name}...`);

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
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from Prefeitura Cotia`);
      
    } catch (error) {
      logger.error(`Error crawling Prefeitura Cotia:`, error as Error);
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
      
      // Wait for page to stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Handle CAPTCHA if present
      await this.handleCaptcha(page);
      
      // Wait for calendar table to be present
      try {
        await page.waitForSelector('table#calendario', { timeout: 10000 });
      } catch (error) {
        logger.error('Calendar table not found');
        const html = await page.content();
        logger.debug(`Page HTML snippet: ${html.substring(0, 1000)}`);
        return gazettes;
      }
      
      // Find all dates with gazettes (a.tem[diario="1"])
      const dateLinks = await page.$$eval(
        'table#calendario a.tem[diario="1"]',
        (links: any[]) => {
          return links.map((link: any) => ({
            dia: link.getAttribute('dia'),
            supl: link.getAttribute('supl'),
            diaSemana: link.getAttribute('dia_semana'),
          })).filter((item: any) => item.dia); // Only return items with day number
        }
      );
      
      logger.debug(`Found ${dateLinks.length} dates with gazettes in calendar`);
      
      if (dateLinks.length === 0) {
        return gazettes;
      }
      
      // Process each date
      for (const dateLink of dateLinks) {
        try {
          const day = parseInt(dateLink.dia, 10);
          const gazetteDate = new Date(year, month - 1, day); // month is 1-indexed in URL but 0-indexed in Date
          
          // Check if date is in our crawl range
          if (!this.isInDateRange(gazetteDate)) {
            logger.debug(`Gazette date ${toISODate(gazetteDate)} is outside crawl range`);
            continue;
          }
          
          // Find and click the date link
          const dateSelector = `table#calendario a.tem[diario="1"][dia="${dateLink.dia}"]`;
          const dateElement = await page.$(dateSelector);
          
          if (!dateElement) {
            logger.warn(`Could not find date element for day ${dateLink.dia}`);
            continue;
          }
          
          // Click the date link
          logger.debug(`Clicking date: ${day}/${month}/${year}`);
          await dateElement.click();
          
          // Wait for #diario div to update
          try {
            await page.waitForSelector('#diario div.diario a.btn-link', { timeout: 5000 });
            await new Promise(resolve => setTimeout(resolve, 500)); // Additional wait for JavaScript
          } catch (error) {
            logger.warn(`#diario div did not update after clicking day ${dateLink.dia}`);
            continue;
          }
          
          // Extract PDF URL from the updated div
          const pdfUrl = await page.evaluate(() => {
            const link = document.querySelector('#diario div.diario a.btn-link') as HTMLAnchorElement;
            return link ? link.getAttribute('href') : null;
          });
          
          if (!pdfUrl) {
            logger.warn(`Could not extract PDF URL for day ${dateLink.dia}`);
            continue;
          }
          
          // Make URL absolute if relative
          let absolutePdfUrl: string;
          if (pdfUrl.startsWith('http')) {
            absolutePdfUrl = pdfUrl;
          } else {
            const baseUrlObj = new URL(this.baseUrl);
            const baseDomain = `${baseUrlObj.protocol}//${baseUrlObj.host}`;
            const normalizedPath = pdfUrl.startsWith('/') ? pdfUrl : `/${pdfUrl}`;
            absolutePdfUrl = `${baseDomain}${normalizedPath}`;
          }
          
          // Extract edition number from URL if possible (pattern: dia=DD)
          // Note: Edition numbers may not be available in this format
          const editionNumber = undefined;
          
          // Check if there's a supplementary file
          const hasSupplementary = dateLink.supl === '1';
          
          // Create the gazette object
          const gazette = await this.createGazette(gazetteDate, absolutePdfUrl, {
            editionNumber,
            isExtraEdition: false, // Calendar doesn't indicate extra editions
            power: 'executive_legislative',
            sourceText: `Diário Oficial - ${day}/${month}/${year}`,
          });
          
          if (gazette) {
            gazettes.push(gazette);
          }
          
          // If there's a supplementary file, create another gazette entry
          if (hasSupplementary) {
            const suplUrl = `${absolutePdfUrl}&supl=1`;
            const suplGazette = await this.createGazette(gazetteDate, suplUrl, {
              editionNumber,
              isExtraEdition: true,
              power: 'executive_legislative',
              sourceText: `Arquivo Suplementar - ${day}/${month}/${year}`,
            });
            
            if (suplGazette) {
              gazettes.push(suplGazette);
            }
          }
          
          // Add small delay between dates
          await new Promise(resolve => setTimeout(resolve, 300));
          
        } catch (error) {
          logger.error(`Error processing date ${dateLink.dia}:`, error as Error);
        }
      }
      
    } catch (error) {
      logger.error(`Error crawling month ${month}/${year}:`, error as Error);
    }
    
    return gazettes;
  }

  /**
   * Handle CAPTCHA challenge if present on the page
   * Waits for "Confirme que você é humano realizando a ação abaixo." text
   * and clicks the checkbox that is a sibling to span containing "Confirme que é humano"
   */
  private async handleCaptcha(page: any): Promise<void> {
    try {
      // Wait for CAPTCHA text to appear
      logger.debug('Checking for CAPTCHA challenge...');
      
      // Wait for element with id "NCxXf2" containing the CAPTCHA text
      await page.waitForFunction(
        () => {
          const captchaElement = document.getElementById('NCxXf2');
          if (!captchaElement) {
            return false;
          }
          const text = captchaElement.innerText || captchaElement.textContent || '';
          return text.includes('Confirme que você é humano realizando a ação abaixo.');
        },
        { timeout: 25000 }
      ).catch(() => {
        // CAPTCHA not present, continue normally
        logger.debug('No CAPTCHA challenge detected');
        return;
      });
      
      logger.info('CAPTCHA challenge detected, attempting to solve...');
      
      // Find and click the checkbox that is a sibling to span containing "Confirme que é humano"
      const checkboxClicked = await page.evaluate(() => {
        // Find the CAPTCHA element with id "NCxXf2"
        const captchaElement = document.getElementById('NCxXf2');
        console.log('captchaElement', captchaElement);
        if (!captchaElement) {
          return false;
        }
        
        // Find all spans with text containing "Confirme que é humano" within the CAPTCHA element
        const spans = Array.from(captchaElement.querySelectorAll('span'));
        const targetSpan = spans.find(span => {
          const text = span.textContent || span.innerText || '';
          return text.includes('Confirme que é humano');
        });
        
        if (!targetSpan) {
          return false;
        }
        
        // Find the checkbox that is a sibling to this span
        // Check parent's children for checkbox input
        const parent = targetSpan.parentElement;
        if (!parent) {
          return false;
        }

        console.log('parent', parent);
        
        // Look for checkbox input in the same parent
        const checkbox = parent.querySelector('input[type="checkbox"]');
        console.log('checkbox', checkbox);
        if (checkbox) {
          (checkbox as HTMLInputElement).click();
          return true;
        }
        
        // Also check siblings
        let sibling = targetSpan.previousElementSibling;
        while (sibling) {
          if (sibling.tagName === 'INPUT' && (sibling as HTMLInputElement).type === 'checkbox') {
            (sibling as HTMLInputElement).click();
            return true;
          }
          sibling = sibling.previousElementSibling;
        }
        
        sibling = targetSpan.nextElementSibling;
        while (sibling) {
          if (sibling.tagName === 'INPUT' && (sibling as HTMLInputElement).type === 'checkbox') {
            (sibling as HTMLInputElement).click();
            return true;
          }
          sibling = sibling.nextElementSibling;
        }
        
        return false;
      });
      
      if (checkboxClicked) {
        logger.info('CAPTCHA checkbox clicked successfully');
        // Wait a bit for CAPTCHA to process
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        logger.warn('Could not find CAPTCHA checkbox to click');
      }
      
    } catch (error) {
      // If CAPTCHA handling fails, log but continue
      logger.debug('CAPTCHA handling error (may not be present)', { error: error instanceof Error ? error.message : String(error) });
    }
  }
}

