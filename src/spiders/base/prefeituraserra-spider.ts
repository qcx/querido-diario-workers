import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraSerraConfig } from '../../types';
import { logger } from '../../utils/logger';
import { formatBrazilianDate, toISODate } from '../../utils/date-utils';
// @ts-ignore
import { parse } from 'node-html-parser';

/**
 * Spider para Prefeitura de Serra - ES
 * 
 * Site Structure:
 * - URL: https://ioes.dio.es.gov.br/diariodaserra
 * - Uses ioes.dio.es.gov.br platform (same infrastructure as AMUNES)
 * - Search form with date picker (DD/MM/YYYY format)
 * - May use same API as AMUNES with city-specific filtering
 * 
 * This spider attempts to use the API first (similar to AMUNES),
 * and falls back to browser-based navigation if needed.
 */
export class PrefeituraSerraSpider extends BaseSpider {
  protected serraConfig: PrefeituraSerraConfig;
  private readonly API_BASE_URL = 'https://ioes.dio.es.gov.br/apifront/portal/edicoes/edicoes_from_data';
  private readonly DOWNLOAD_BASE_URL = 'https://ioes.dio.es.gov.br/portal/edicoes/download';
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.serraConfig = spiderConfig.config as PrefeituraSerraConfig;
    this.browser = browser || null;
    
    if (!this.serraConfig.baseUrl) {
      throw new Error(`PrefeituraSerraSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraSerraSpider for ${spiderConfig.name} with URL: ${this.serraConfig.baseUrl}`);
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.serraConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    // Try API first (faster and more reliable)
    const apiGazettes = await this.crawlWithAPI();
    
    if (apiGazettes.length > 0) {
      logger.info(`Found ${apiGazettes.length} gazettes using API method`);
      return apiGazettes;
    }
    
    // Fallback to browser if API didn't work and browser is available
    if (this.browser && this.serraConfig.requiresClientRendering !== false) {
      logger.info('API method returned no results, trying browser-based method...');
      return this.crawlWithBrowser();
    }
    
    logger.warn('No gazettes found and browser not available for fallback');
    return [];
  }

  /**
   * Attempt to crawl using the API (similar to AMUNES)
   */
  private async crawlWithAPI(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Iterate through each date in the range
      const currentDate = new Date(this.startDate);
      const endDate = new Date(this.endDate);
      
      while (currentDate <= endDate) {
        const dateStr = this.formatDate(currentDate);
        const dayGazettes = await this.getGazettesForDate(dateStr);
        gazettes.push(...dayGazettes);
        
        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      return gazettes;
      
    } catch (error) {
      logger.error(`Error in API crawl for ${this.spiderConfig.name}:`, error);
      return [];
    }
  }

  /**
   * Get gazettes for a specific date using API
   */
  private async getGazettesForDate(dateStr: string): Promise<Gazette[]> {
    // Try multiple API endpoints to find Serra-specific editions
    // The API might return different results based on the endpoint used
    const urls = [
      `${this.API_BASE_URL}/${dateStr}.json?&subtheme=dom`,
      `${this.API_BASE_URL}/${dateStr}.json`
    ];
    
    const allItems: any[] = [];
    
    for (const url of urls) {
      try {
        logger.debug(`Fetching API data for ${dateStr}: ${url}`);
        
        const response = await this.fetch(url);
        const data = JSON.parse(response);
        
        if (data.erro) {
          if (data.msg !== "Edição não existente!") {
            logger.debug(`API returned error for ${dateStr}: ${data.msg}`);
          }
          continue;
        }
        
        if (data.itens && Array.isArray(data.itens)) {
          logger.debug(`Found ${data.itens.length} items from ${url}`);
          allItems.push(...data.itens);
        }
      } catch (error) {
        logger.debug(`Error fetching from ${url}:`, error);
        continue;
      }
    }
    
    // Remove duplicates based on ID
    const uniqueItems = Array.from(
      new Map(allItems.map(item => [item.id, item])).values()
    );
    
    logger.debug(`Total unique items found: ${uniqueItems.length}`);
    
    const gazettes: Gazette[] = [];
    
    for (const item of uniqueItems) {
      // Log item details for debugging
      logger.debug(`Checking item ${item.id}: tipo_edicao_nome="${item.tipo_edicao_nome}", municipio="${item.municipio || 'N/A'}"`);
      
      // Filter for Serra-specific editions
      if (this.isValidSerraEdition(item)) {
        logger.debug(`Item ${item.id} is valid for Serra`);
        const gazette = await this.createGazetteFromItem(item, dateStr);
        if (gazette) {
          gazettes.push(gazette);
        }
      } else {
        logger.debug(`Item ${item.id} excluded - not a Serra edition`);
      }
    }
    
    if (gazettes.length > 0) {
      logger.info(`Found ${gazettes.length} Serra gazettes for ${dateStr} (from ${uniqueItems.length} total items)`);
    } else {
      logger.debug(`No Serra gazettes found for ${dateStr} (checked ${uniqueItems.length} items)`);
    }
    
    return gazettes;
  }

  /**
   * Check if an edition item is valid for Serra
   * 
   * Strategy:
   * 1. Include all DOM - AMUNES editions that mention Serra in municipio field
   * 2. Include all editions that explicitly mention "Serra" anywhere
   * 3. Include DOM editions that don't have "AMUNES" (city-specific editions)
   * 4. Be permissive - if in doubt, include it (better to have extra than miss valid ones)
   */
  private isValidSerraEdition(item: any): boolean {
    if (!item || !item.id) {
      return false;
    }
    
    const tipoEdicaoNome = (item.tipo_edicao_nome || '').toLowerCase();
    const municipio = (item.municipio || '').toLowerCase();
    const itemStr = JSON.stringify(item).toLowerCase();
    
    // Check if it's a DOM edition (any type)
    const isDom = tipoEdicaoNome.includes('dom');
    
    // Check if it explicitly mentions Serra
    const mentionsSerra = itemStr.includes('serra') || municipio.includes('serra');
    
    // If it mentions Serra explicitly, always include
    if (mentionsSerra) {
      logger.debug(`Including edition ${item.id} - explicitly mentions Serra`);
      return true;
    }
    
    // If it's a DOM edition but NOT AMUNES, it's likely city-specific
    if (isDom && !tipoEdicaoNome.includes('amunes')) {
      logger.debug(`Including edition ${item.id} - DOM without AMUNES (city-specific)`);
      return true;
    }
    
    // For AMUNES editions, check if municipio field exists and matches Serra
    // If municipio is empty or doesn't exist, we can't filter reliably
    if (isDom && tipoEdicaoNome.includes('amunes')) {
      // If municipio field exists and doesn't mention Serra, exclude
      if (municipio && municipio.length > 0 && !municipio.includes('serra')) {
        logger.debug(`Excluding AMUNES edition ${item.id} - municipio="${municipio}" doesn't match Serra`);
        return false;
      }
      // If municipio is empty or mentions Serra, include
      // This handles cases where AMUNES editions might not have municipio field populated
      logger.debug(`Including AMUNES edition ${item.id} - municipio="${municipio || 'empty'}"`);
      return true;
    }
    
    // If it's not a DOM edition at all, exclude
    if (!isDom) {
      logger.debug(`Excluding edition ${item.id} - not a DOM edition`);
      return false;
    }
    
    // Default: include if it's a DOM edition (be permissive)
    logger.debug(`Including edition ${item.id} - DOM edition (default)`);
    return true;
  }

  /**
   * Create a Gazette object from API item
   */
  private async createGazetteFromItem(item: any, dateStr: string): Promise<Gazette | null> {
    try {
      const downloadUrl = `${this.DOWNLOAD_BASE_URL}/${item.id}`;
      const date = this.parseDate(item.data || dateStr);
      
      if (!date) {
        logger.error(`Could not parse date for item ${item.id}`);
        return null;
      }
      
      return await this.createGazette(date, downloadUrl, {
        editionNumber: item.numero?.toString(),
        power: 'executive_legislative',
        sourceText: `${item.tipo_edicao_nome || 'DOM'} - ${item.paginas || 'N/A'} páginas`
      });
      
    } catch (error) {
      logger.error(`Error creating gazette from item ${item.id}:`, error);
      return null;
    }
  }

  /**
   * Browser-based crawling for Serra
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Navigate to the base URL
      logger.debug(`Navigating to: ${this.serraConfig.baseUrl}`);
      await page.goto(this.serraConfig.baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Wait for page to stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Iterate through each date in the range
      const currentDate = new Date(this.startDate);
      const endDate = new Date(this.endDate);
      
      while (currentDate <= endDate) {
        const dayGazettes = await this.crawlDayWithBrowser(page, currentDate);
        gazettes.push(...dayGazettes);
        
        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      logger.info(`Found ${gazettes.length} gazettes using browser method`);
      return gazettes;
      
    } catch (error) {
      logger.error(`Error in browser crawl for ${this.spiderConfig.name}:`, error);
      return [];
    } finally {
      if (page) {
        await page.close();
      }
      if (browserInstance) {
        await browserInstance.close();
      }
    }
  }

  /**
   * Crawl a specific day using browser
   */
  private async crawlDayWithBrowser(page: any, date: Date): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Format date for the form (DD/MM/YYYY)
      const formattedDate = formatBrazilianDate(date);
      logger.debug(`Searching for date: ${formattedDate}`);
      
      // Navigate to the base URL if not already there
      if (page.url() !== this.serraConfig.baseUrl) {
        await page.goto(this.serraConfig.baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
        this.requestCount++;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Wait for the date input field (searching for "Busca por Edição" form)
      try {
        await page.waitForSelector('input[name*="data"], input[type="text"][placeholder*="DD/MM"], input#data', { timeout: 10000 });
      } catch (error) {
        logger.warn(`Date input field not found for ${formattedDate}`);
        return gazettes;
      }
      
      // Fill the date input
      await page.evaluate((dateValue: string) => {
        // Try multiple selectors
        const selectors = [
          'input[name*="data"]',
          'input[type="text"][placeholder*="DD/MM"]',
          'input#data',
          'input[type="text"]'
        ];
        
        for (const selector of selectors) {
          const input = document.querySelector(selector) as HTMLInputElement;
          if (input && input.placeholder && input.placeholder.includes('DD/MM')) {
            input.value = dateValue;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
      }, formattedDate);
      
      // Wait a bit for any JavaScript to process
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Click the OK button
      const okButton = await page.$('button:has-text("OK"), input[type="button"][value*="OK"], button[type="submit"]');
      if (okButton) {
        await okButton.click();
        await new Promise(resolve => setTimeout(resolve, 2000));
        this.requestCount++;
      } else {
        // Try to submit the form directly
        await page.evaluate(() => {
          const form = document.querySelector('form');
          if (form) {
            form.submit();
          }
        });
        await new Promise(resolve => setTimeout(resolve, 2000));
        this.requestCount++;
      }
      
      // Extract PDF links from the results
      const pdfLinks = await page.evaluate(() => {
        const links: string[] = [];
        const allLinks = document.querySelectorAll('a[href*=".pdf"], a[href*="download"], a[href*="edicoes"]');
        
        for (const link of allLinks) {
          const href = (link as HTMLAnchorElement).href;
          if (href && (href.includes('.pdf') || href.includes('download'))) {
            links.push(href);
          }
        }
        
        return links;
      });
      
      // Create gazette objects
      for (const pdfUrl of pdfLinks) {
        const gazette = await this.createGazette(date, pdfUrl, {
          power: 'executive_legislative'
        });
        if (gazette) {
          gazettes.push(gazette);
        }
      }
      
      return gazettes;
      
    } catch (error) {
      logger.error(`Error crawling day ${formatBrazilianDate(date)}:`, error);
      return gazettes;
    }
  }

  /**
   * Format date for API call (YYYY-MM-DD)
   */
  private formatDate(date: Date): string {
    return toISODate(date);
  }

  /**
   * Parse date from Brazilian format (DD/MM/YYYY) or ISO format
   */
  private parseDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    
    // Try Brazilian format first (DD/MM/YYYY)
    const brMatch = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (brMatch) {
      const [, day, month, year] = brMatch;
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }
    
    // Try ISO format (YYYY-MM-DD)
    const isoMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      const [, year, month, day] = isoMatch;
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }
    
    return null;
  }
}
