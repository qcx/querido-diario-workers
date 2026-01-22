import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp } from '../../utils/date-utils';

/**
 * Configuration interface for Bom Jesus do Itabapoana spider
 */
interface PrefeituraRjBomJesusConfig {
  type: string;
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/**
 * API response item structure from class_diario.php
 */
interface DiarioApiItem {
  codigo: string;
  numero: string;
  ano: string;
  descricao: string;
  arquivo: string;
  data_form: string;
  data: string; // DD/MM/YYYY format
}

/**
 * Spider for Bom Jesus do Itabapoana - RJ gazette extraction
 * 
 * Website: https://www.bomjesus.rj.gov.br/site/diarios_oficiais
 * 
 * The site uses:
 * - A PHP API at /controllers/diario_oficial/class_diario.php
 * - POST request with func=5 returns all gazettes as JSON array
 * - PDFs at /arquivos/diario_oficial/{filename}
 * 
 * The site is protected by Cloudflare, so this spider supports two modes:
 * 1. Direct API call (works when not blocked by Cloudflare)
 * 2. Browser-based extraction using Puppeteer (works in Cloudflare Workers)
 */
export class PrefeituraRjBomJesusSpider extends BaseSpider {
  protected bomJesusConfig: PrefeituraRjBomJesusConfig;
  private browser: Fetcher | null = null;
  private readonly userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  private readonly baseApiUrl = 'https://www.bomjesus.rj.gov.br';
  private readonly apiEndpoint = 'https://www.bomjesus.rj.gov.br/controllers/diario_oficial/class_diario.php';
  private readonly pdfBaseUrl = 'https://www.bomjesus.rj.gov.br/arquivos/diario_oficial';

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.bomJesusConfig = spiderConfig.config as PrefeituraRjBomJesusConfig;
    this.browser = browser || null;
    
    if (!this.bomJesusConfig.baseUrl) {
      throw new Error(`PrefeituraRjBomJesusSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraRjBomJesusSpider for ${spiderConfig.name}`);
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.bomJesusConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    // Try direct API call first
    const apiResult = await this.crawlViaApi();
    if (apiResult.length > 0) {
      return apiResult;
    }
    
    // If API failed and we have browser, try browser-based extraction
    if (this.browser) {
      logger.info('API call failed, falling back to browser-based extraction');
      return this.crawlViaBrowser();
    }
    
    logger.warn('No gazettes found and no browser available for fallback');
    return [];
  }

  /**
   * Try to crawl using direct API call
   */
  private async crawlViaApi(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const processedUrls = new Set<string>();
    
    try {
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': this.userAgent,
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
          'Origin': this.baseApiUrl,
          'Referer': this.bomJesusConfig.baseUrl,
        },
        body: 'func=5',
      });
      this.requestCount++;
      
      if (!response.ok) {
        logger.error(`Failed to fetch gazettes from API: ${response.status}`);
        return gazettes;
      }
      
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        logger.debug('API response is not JSON (possibly Cloudflare challenge)');
        return gazettes;
      }
      
      const data: DiarioApiItem[] = await response.json();
      
      if (!Array.isArray(data)) {
        logger.error(`API response is not an array`);
        return gazettes;
      }
      
      logger.info(`API returned ${data.length} gazette items`);
      
      for (const item of data) {
        try {
          const gazette = this.processGazetteItem(item, processedUrls);
          if (gazette) {
            gazettes.push(gazette);
          }
        } catch (error) {
          logger.error(`Error processing gazette item:`, error as Error);
        }
      }
      
    } catch (error) {
      logger.error(`Error during API crawl:`, error as Error);
    }
    
    logger.info(`API crawl found ${gazettes.length} gazettes`);
    return gazettes;
  }

  /**
   * Crawl using browser-based extraction (Puppeteer)
   */
  private async crawlViaBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      await page.setViewport({ width: 1280, height: 800 });
      
      // Set user agent to appear more like a real browser
      await page.setUserAgent(this.userAgent);
      
      logger.debug(`Navigating to ${this.bomJesusConfig.baseUrl}`);
      await page.goto(this.bomJesusConfig.baseUrl, { waitUntil: 'networkidle0', timeout: 60000 });
      this.requestCount++;
      
      // Check page title to detect Cloudflare challenge
      const pageTitle = await page.title();
      logger.debug(`Page title: ${pageTitle}`);
      
      if (pageTitle.includes('moment') || pageTitle.includes('Just a moment') || pageTitle.includes('Checking')) {
        logger.debug('Cloudflare challenge detected, waiting for it to resolve...');
        // Wait longer for Cloudflare challenge to resolve
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        // Check title again
        const newTitle = await page.title();
        logger.debug(`Page title after waiting: ${newTitle}`);
      }
      
      // Wait for content to load
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Log page content for debugging
      const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
      logger.debug(`Page content preview: ${bodyText.substring(0, 200)}...`);
      
      // Wait for gazette items to appear with longer timeout
      try {
        await page.waitForFunction(
          () => document.body.innerText.includes('Diário Oficial Eletrônico de') || 
                document.body.innerText.includes('Edição') ||
                document.querySelectorAll('a[href*="diario_oficial"]').length > 0,
          { timeout: 30000 }
        );
      } catch {
        logger.debug('Gazette content not found on page after waiting');
        // Try to extract anyway - maybe the selectors work differently
        const linkCount = await page.evaluate(() => 
          document.querySelectorAll('a[href*=".pdf"]').length
        );
        logger.debug(`Found ${linkCount} PDF links on page`);
        if (linkCount === 0) {
          return gazettes;
        }
      }
      
      // Extract gazette data from rendered page
      const extractedData = await page.evaluate(() => {
        const results: Array<{
          date: string;
          editionNumber?: string;
          arquivo: string;
          isExtra: boolean;
        }> = [];
        
        const processedFiles = new Set<string>();
        
        // Find all gazette links
        // The site shows gazettes as cards with "Abrir Edição" links
        const links = document.querySelectorAll('a');
        
        for (const link of links) {
          const href = link.getAttribute('href') || '';
          
          // Check if this is a gazette PDF link
          if (href.includes('arquivos/diario_oficial') && href.includes('.pdf')) {
            // Extract filename from URL
            const urlParts = href.split('/');
            const arquivo = urlParts[urlParts.length - 1];
            
            if (processedFiles.has(arquivo)) continue;
            
            // Try to find date in the surrounding context
            let parent = link.parentElement;
            let depth = 0;
            let date = '';
            let editionNumber = '';
            
            while (parent && depth < 10) {
              const text = parent.textContent || '';
              
              // Look for "Diário Oficial Eletrônico de DD/MM/YYYY" pattern
              const dateMatch = text.match(/Diário Oficial Eletrônico de (\d{2}\/\d{2}\/\d{4})/);
              if (dateMatch) {
                date = dateMatch[1];
              }
              
              // Look for edition number like "Edição 186 / 26"
              const editionMatch = text.match(/Edição\s+(\d+)\s*\/\s*\d+/i);
              if (editionMatch) {
                editionNumber = editionMatch[1];
              }
              
              if (date && editionNumber) break;
              parent = parent.parentElement;
              depth++;
            }
            
            // If no date found from context, try to extract from filename
            if (!date) {
              // Filename format: 186_26_doe_186_21.01.26_-_assinado.pdf
              const filenameMatch = arquivo.match(/(\d{2})\.(\d{2})\.(\d{2})/);
              if (filenameMatch) {
                const [, day, month, year] = filenameMatch;
                const fullYear = parseInt(year) > 50 ? `19${year}` : `20${year}`;
                date = `${day}/${month}/${fullYear}`;
              }
            }
            
            if (date) {
              processedFiles.add(arquivo);
              const isExtra = /\b(extra|suplemento|extraordin[aá]ri[oa])\b/i.test(arquivo);
              
              results.push({
                date,
                editionNumber: editionNumber || undefined,
                arquivo,
                isExtra,
              });
            }
          }
        }
        
        return results;
      });
      
      logger.info(`Browser extraction found ${extractedData.length} gazette entries`);
      
      const processedUrls = new Set<string>();
      
      for (const data of extractedData) {
        try {
          const pdfUrl = `${this.pdfBaseUrl}/${encodeURIComponent(data.arquivo)}`;
          
          if (processedUrls.has(pdfUrl)) continue;
          
          const [day, month, year] = data.date.split('/');
          const gazetteDate = new Date(`${year}-${month}-${day}`);
          
          if (isNaN(gazetteDate.getTime())) {
            logger.warn(`Invalid date: ${data.date}`);
            continue;
          }
          
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }
          
          const gazette = this.createGazetteDirectly(gazetteDate, pdfUrl, {
            power: 'executive_legislative',
            editionNumber: data.editionNumber,
            isExtraEdition: data.isExtra,
          });
          
          processedUrls.add(pdfUrl);
          gazettes.push(gazette);
          logger.info(`Found gazette for ${toISODate(gazetteDate)} (edição ${data.editionNumber || 'N/A'}): ${pdfUrl}`);
        } catch (error) {
          logger.error(`Error processing browser extracted data:`, error as Error);
        }
      }
      
    } catch (error) {
      logger.error(`Error during browser crawl:`, error as Error);
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (error) {
          logger.warn(`Error closing page: ${error}`);
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (error) {
          logger.warn(`Error closing browser: ${error}`);
        }
      }
    }
    
    logger.info(`Browser crawl found ${gazettes.length} gazettes`);
    return gazettes;
  }

  /**
   * Process a single gazette item from the API response
   */
  private processGazetteItem(item: DiarioApiItem, processedUrls: Set<string>): Gazette | null {
    const { numero, arquivo, data: dateStr } = item;
    
    if (!arquivo || !dateStr) {
      logger.warn(`Missing arquivo or data in gazette item: ${JSON.stringify(item)}`);
      return null;
    }
    
    const pdfUrl = `${this.pdfBaseUrl}/${encodeURIComponent(arquivo)}`;
    
    if (processedUrls.has(pdfUrl)) {
      return null;
    }
    
    const [day, month, year] = dateStr.split('/');
    const gazetteDate = new Date(`${year}-${month}-${day}`);
    
    if (isNaN(gazetteDate.getTime())) {
      logger.warn(`Invalid date: ${dateStr}`);
      return null;
    }
    
    if (!this.isInDateRange(gazetteDate)) {
      return null;
    }
    
    const isExtra = this.isExtraEdition(numero);
    const cleanEditionNumber = numero.replace(/-.*$/, '').trim();
    
    const gazette = this.createGazetteDirectly(gazetteDate, pdfUrl, {
      power: 'executive_legislative',
      editionNumber: cleanEditionNumber,
      isExtraEdition: isExtra,
    });
    
    processedUrls.add(pdfUrl);
    logger.info(`Found gazette for ${toISODate(gazetteDate)} (edição ${numero}): ${pdfUrl}`);
    
    return gazette;
  }

  /**
   * Check if edition number indicates an extra/special edition
   */
  private isExtraEdition(numero: string): boolean {
    const lowerNumero = numero.toLowerCase();
    return (
      lowerNumero.includes('extra') ||
      lowerNumero.includes('suplementar') ||
      lowerNumero.includes('extraordin') ||
      lowerNumero.includes('republicado')
    );
  }

  /**
   * Creates a Gazette object directly without URL resolution
   */
  private createGazetteDirectly(
    date: Date,
    fileUrl: string,
    options: {
      editionNumber?: string;
      isExtraEdition?: boolean;
      power?: 'executive' | 'legislative' | 'executive_legislative';
    } = {}
  ): Gazette {
    return {
      date: toISODate(date),
      fileUrl: fileUrl,
      territoryId: this.spiderConfig.territoryId,
      scrapedAt: getCurrentTimestamp(),
      editionNumber: options.editionNumber,
      isExtraEdition: options.isExtraEdition ?? false,
      power: options.power ?? 'executive_legislative',
    };
  }
}
