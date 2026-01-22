import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraRjResendeConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp } from '../../utils/date-utils';
import * as puppeteer from '@cloudflare/puppeteer';

interface GazetteLink {
  date: Date;
  pdfUrl: string;
  edition: string;
  isSpecial: boolean;
}

/**
 * PrefeituraResendeSpider implementation
 * 
 * Crawls Resende's official gazette website at Portal da Transparência.
 * 
 * Site structure:
 * - Page URL: https://resende.rj.gov.br/blogtransparencia/page/boletim_oficial.asp
 * - Uses two dropdowns: year and bulletin selection
 * - When year is selected, bulletins are loaded via AJAX into second dropdown
 * - Download button triggers PDF download
 * - PDF URL pattern: https://resende.rj.gov.br/blogtransparencia/file/boletim_oficial/{YEAR}/Boletim_{NUM}.pdf
 * 
 * This spider:
 * 1. Uses browser (Puppeteer) to navigate and interact with dropdowns
 * 2. For each year in date range, selects the year and waits for bulletins to load
 * 3. Parses bulletins from dropdown options (format: "Boletim Oficial Nº XXX - DD/MM")
 * 4. Constructs PDF URLs based on year and bulletin number
 */
export class PrefeituraRjResendeSpider extends BaseSpider {
  protected resendeConfig: PrefeituraRjResendeConfig;
  private browser?: Fetcher;
  private static readonly BASE_URL = 'https://resende.rj.gov.br';
  private static readonly PDF_BASE_URL = 'https://resende.rj.gov.br/blogtransparencia/file/boletim_oficial';

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.resendeConfig = spiderConfig.config as PrefeituraRjResendeConfig;
    this.browser = browser;
    
    if (!this.resendeConfig.baseUrl) {
      throw new Error(`PrefeituraResendeSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraResendeSpider for ${spiderConfig.name}`);
  }

  /**
   * Set the browser instance for web scraping
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.resendeConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    if (!this.browser) {
      logger.error('Browser not available for PrefeituraResendeSpider');
      return gazettes;
    }

    try {
      // Get all gazette links using browser interaction
      const allLinks = await this.fetchGazetteLinksWithBrowser();
      
      if (allLinks.length === 0) {
        logger.warn(`No gazette links found for ${this.spiderConfig.name}`);
        return gazettes;
      }
      
      logger.info(`Found ${allLinks.length} total gazette links, filtering by date range...`);
      
      // Filter by date range
      const startDateStr = toISODate(this.startDate);
      const endDateStr = toISODate(this.endDate);
      
      const filteredLinks = allLinks.filter(link => {
        const linkDateStr = toISODate(link.date);
        return linkDateStr >= startDateStr && linkDateStr <= endDateStr;
      });
      
      logger.info(`${filteredLinks.length} gazettes match the date range`, {
        startDate: startDateStr,
        endDate: endDateStr,
      });
      
      // Create gazette objects
      for (const link of filteredLinks) {
        try {
          const gazette: Gazette = {
            date: toISODate(link.date),
            fileUrl: link.pdfUrl,
            territoryId: this.spiderConfig.territoryId,
            scrapedAt: getCurrentTimestamp(),
            editionNumber: link.edition,
            isExtraEdition: link.isSpecial,
            power: 'executive_legislative',
            sourceText: `Boletim Oficial de Resende - Edição ${link.edition} - ${this.formatDateBrazilian(link.date)}`,
          };

          gazettes.push(gazette);
          logger.info(`Found gazette for ${toISODate(link.date)}: ${link.pdfUrl}`);
        } catch (error) {
          logger.error(`Error creating gazette for ${toISODate(link.date)}:`, error as Error);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Fetch gazette links using browser interaction with dropdowns
   */
  private async fetchGazetteLinksWithBrowser(): Promise<GazetteLink[]> {
    const links: GazetteLink[] = [];
    let browserInstance = null;
    let page = null;

    try {
      logger.info('Launching browser to fetch Resende gazette page');
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Set viewport
      await page.setViewport({ width: 1280, height: 800 });
      
      // Navigate to the page
      await page.goto(this.resendeConfig.baseUrl, {
        waitUntil: 'networkidle0',
        timeout: 30000,
      });
      this.requestCount++;
      
      // Wait for page to stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Wait for year dropdown to be populated (JavaScript fills options)
      await page.waitForFunction(
        () => {
          const select = document.querySelector('select[name="selecioneano"]') as HTMLSelectElement | null;
          return select && select.options.length > 1;
        },
        { timeout: 10000 }
      ).catch(() => {
        logger.warn('Year dropdown may not have been populated');
      });
      
      // Get the years we need to check based on date range
      const startYear = this.startDate.getFullYear();
      const endYear = this.endDate.getFullYear();
      
      logger.info(`Checking years ${startYear} to ${endYear}`);
      
      // Process each year
      for (let year = startYear; year <= endYear; year++) {
        try {
          // Get available years from dropdown
          const availableYears = await page.evaluate(() => {
            const yearSelect = document.querySelector('select[name="selecioneano"]') as HTMLSelectElement | null;
            if (!yearSelect) return [];
            return Array.from(yearSelect.options)
              .map(opt => opt.value)
              .filter(v => v && !isNaN(parseInt(v)));
          });
          
          if (!availableYears.includes(year.toString())) {
            logger.debug(`Year ${year} not available in dropdown, skipping`);
            continue;
          }
          
          // Select the year
          await page.select('select[name="selecioneano"]', year.toString());
          logger.debug(`Selected year ${year}`);
          
          // Wait for AJAX to load bulletins
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Get bulletins from the second dropdown
          const bulletins = await page.evaluate(() => {
            const bulletinSelect = document.querySelector('select[name="selecioneboletim"]') as HTMLSelectElement | null;
            if (!bulletinSelect) return [];
            
            return Array.from(bulletinSelect.options)
              .filter(opt => opt.value && opt.value !== 'Selecione o Boletim')
              .map(opt => ({
                value: opt.value,
                text: opt.textContent?.trim() || '',
              }));
          });
          
          logger.info(`Found ${bulletins.length} bulletins for year ${year}`);
          
          // Parse each bulletin
          for (const bulletin of bulletins) {
            try {
              const parsed = this.parseBulletinText(bulletin.text, year);
              if (parsed) {
                links.push(parsed);
              }
            } catch (error) {
              logger.warn(`Error parsing bulletin "${bulletin.text}": ${(error as Error).message}`);
            }
          }
          
        } catch (error) {
          logger.error(`Error processing year ${year}:`, error as Error);
        }
      }
      
    } catch (error) {
      logger.error('Failed to fetch gazette links with browser', error as Error);
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (e) {
          logger.warn(`Error closing page: ${(e as Error).message}`);
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (e) {
          logger.warn(`Error closing browser: ${(e as Error).message}`);
        }
      }
    }
    
    return links;
  }

  /**
   * Parse bulletin text to extract date, edition, and construct PDF URL
   * Format: "Boletim Oficial Nº XXX - DD/MM"
   */
  private parseBulletinText(text: string, year: number): GazetteLink | null {
    // Pattern: "Boletim Oficial Nº 106 - 31/12"
    const match = text.match(/Boletim\s+Oficial\s+N[ºo°]?\s*(\d+)\s*-\s*(\d{1,2})\/(\d{1,2})/i);
    
    if (!match) {
      logger.debug(`Could not parse bulletin text: "${text}"`);
      return null;
    }
    
    const [, editionNum, day, month] = match;
    
    // Build date with the given year
    const date = new Date(Date.UTC(year, parseInt(month) - 1, parseInt(day)));
    
    // Build PDF URL
    // Pattern observed: boletim_oficial/{YEAR}/Boletim_{NUM}.pdf
    // Pad edition number with zeros if needed
    const paddedEdition = editionNum.padStart(3, '0');
    const pdfUrl = `${PrefeituraRjResendeSpider.PDF_BASE_URL}/${year}/Boletim_${paddedEdition}.pdf`;
    
    return {
      date,
      pdfUrl,
      edition: editionNum,
      isSpecial: false,
    };
  }

  /**
   * Format date in Brazilian format: DD de MMMM de YYYY
   */
  private formatDateBrazilian(date: Date): string {
    const months = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    
    const day = date.getUTCDate().toString().padStart(2, '0');
    const month = months[date.getUTCMonth()];
    const year = date.getUTCFullYear();
    
    return `${day} de ${month} de ${year}`;
  }
}
