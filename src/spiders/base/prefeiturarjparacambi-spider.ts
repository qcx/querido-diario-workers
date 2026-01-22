import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Configuration interface for Paracambi V2 spider
 */
interface PrefeituraRjParacambiV2Config {
  type: string;
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/**
 * Spider for Paracambi RJ gazette extraction
 * 
 * The site structure:
 * - Base URL: https://paracambi.rj.gov.br/diario-oficial-eletronico-{year}/
 * - PDF links: https://paracambi.rj.gov.br/diariooficial/DOE.Paracambi.Ed{edition} {DD.MM.YYYY}.pdf
 * - Links are organized by year with month filters
 * - Each link text contains: "D.O.E. Paracambi Ed{edition} {DD.MM.YYYY}"
 * - Extra editions are marked with "– Edição Extra" or "– II Caderno"
 */
export class PrefeituraRjParacambiV2Spider extends BaseSpider {
  private paracambiConfig: PrefeituraRjParacambiV2Config;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.paracambiConfig = spiderConfig.config as PrefeituraRjParacambiV2Config;
    this.browser = browser || null;
    
    if (!this.paracambiConfig.baseUrl) {
      throw new Error(`PrefeituraRjParacambiV2Spider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraRjParacambiV2Spider for ${spiderConfig.name}`);
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.paracambiConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error(`PrefeituraRjParacambiV2Spider requires browser binding for ${this.spiderConfig.name}`);
    }
    
    return this.crawlWithBrowser();
  }

  /**
   * Build the URL for a specific year
   */
  private buildYearUrl(year: number): string {
    return `https://paracambi.rj.gov.br/diario-oficial-eletronico-${year}/`;
  }

  /**
   * Browser-based crawling to extract gazette information
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Set viewport
      await page.setViewport({ width: 1280, height: 800 });
      
      // Determine which years to crawl based on date range
      const startYear = this.startDate.getFullYear();
      const endYear = this.endDate.getFullYear();
      const yearsToCheck = [];
      
      for (let year = startYear; year <= endYear; year++) {
        yearsToCheck.push(year);
      }
      
      logger.info(`Will check years: ${yearsToCheck.join(', ')}`);
      
      const processedUrls = new Set<string>();
      
      for (const year of yearsToCheck) {
        const yearUrl = this.buildYearUrl(year);
        logger.debug(`Navigating to ${yearUrl}`);
        
        try {
          await page.goto(yearUrl, { waitUntil: 'networkidle0', timeout: 30000 });
          this.requestCount++;
          
          // Wait for page to stabilize
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Extract gazettes from the page
          const extractedData = await this.extractGazettesFromPage(page);
          
          logger.info(`Found ${extractedData.length} gazette links for year ${year}`);
          
          // Process extracted data
          for (const data of extractedData) {
            try {
              // Skip if already processed
              if (processedUrls.has(data.pdfUrl)) {
                continue;
              }
              processedUrls.add(data.pdfUrl);
              
              const gazetteDate = this.parseDate(data.date);
              
              if (!gazetteDate || isNaN(gazetteDate.getTime())) {
                logger.warn(`Invalid date: ${data.date} from ${data.pdfUrl}`);
                continue;
              }
              
              // Filter by date range
              if (!this.isInDateRange(gazetteDate)) {
                logger.debug(`Skipping gazette ${data.pdfUrl} - outside date range`);
                continue;
              }
              
              // Create gazette
              const gazette = await this.createGazette(gazetteDate, data.pdfUrl, {
                power: 'executive_legislative',
                editionNumber: data.editionNumber,
                isExtraEdition: data.isExtra,
              });
              
              if (gazette) {
                gazettes.push(gazette);
                logger.info(`Found gazette for ${toISODate(gazetteDate)} (edição ${data.editionNumber || 'N/A'}${data.isExtra ? ' - Extra' : ''}): ${data.pdfUrl}`);
              }
            } catch (error) {
              logger.error(`Error processing extracted data:`, error as Error);
            }
          }
        } catch (error) {
          logger.warn(`Error crawling year ${year}: ${error}`);
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
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
    
    return gazettes;
  }

  /**
   * Extract gazette data from the page using browser evaluation
   */
  private async extractGazettesFromPage(page: any): Promise<Array<{
    date: string;
    editionNumber?: string;
    pdfUrl: string;
    isExtra: boolean;
  }>> {
    return page.evaluate(() => {
      const results: Array<{
        date: string;
        editionNumber?: string;
        pdfUrl: string;
        isExtra: boolean;
      }> = [];
      
      // Find all links on the page
      const allLinks = document.querySelectorAll('a');
      const processedUrls = new Set<string>();
      
      for (const link of allLinks) {
        const href = link.getAttribute('href') || '';
        const text = link.textContent?.trim() || '';
        
        // Check if this is a PDF link from the diariooficial directory
        if (!href.includes('.pdf') && !href.includes('diariooficial')) {
          continue;
        }
        
        // Skip if not a gazette link (should contain DOE or Paracambi)
        if (!text.toLowerCase().includes('d.o.e') && 
            !text.toLowerCase().includes('doe') && 
            !text.toLowerCase().includes('paracambi') &&
            !href.toLowerCase().includes('doe.paracambi')) {
          continue;
        }
        
        const pdfUrl = href.startsWith('http') ? href : 
                       href.startsWith('//') ? window.location.protocol + href :
                       href.startsWith('/') ? window.location.origin + href :
                       new URL(href, window.location.href).href;
        
        if (processedUrls.has(pdfUrl)) {
          continue;
        }
        
        // Extract date from text: "D.O.E. Paracambi Ed1825 22.01.2026"
        // Pattern: DD.MM.YYYY or DD/MM/YYYY
        const dateMatch = text.match(/(\d{2})[.\/-](\d{2})[.\/-](\d{4})/);
        
        if (!dateMatch) {
          // Try to extract from URL: DOE.Paracambi.Ed1825%2022.01.2026.pdf
          const urlDecoded = decodeURIComponent(pdfUrl);
          const urlDateMatch = urlDecoded.match(/(\d{2})[.\/-](\d{2})[.\/-](\d{4})/);
          if (!urlDateMatch) {
            continue;
          }
          // Use URL date
          const [, day, month, year] = urlDateMatch;
          const date = `${day}/${month}/${year}`;
          
          // Extract edition number from URL
          const editionMatch = urlDecoded.match(/Ed(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;
          
          // Check for extra edition markers
          const isExtra = /\b(extra|suplemento|extraordin[aá]ri[oa]|caderno)\b/i.test(urlDecoded);
          
          processedUrls.add(pdfUrl);
          results.push({
            date,
            editionNumber,
            pdfUrl,
            isExtra,
          });
        } else {
          const [, day, month, year] = dateMatch;
          const date = `${day}/${month}/${year}`;
          
          // Extract edition number: Ed1825, Edição 1825, etc.
          const editionMatch = text.match(/Ed(?:i[çc][ãa]o)?\s*(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;
          
          // Check for extra edition markers
          const isExtra = /\b(extra|suplemento|extraordin[aá]ri[oa]|caderno)\b/i.test(text);
          
          processedUrls.add(pdfUrl);
          results.push({
            date,
            editionNumber,
            pdfUrl,
            isExtra,
          });
        }
      }
      
      return results;
    });
  }

  /**
   * Parse a date string in DD/MM/YYYY format
   */
  private parseDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    
    // Try DD/MM/YYYY or DD.MM.YYYY
    const match = dateStr.match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/);
    if (match) {
      const [, day, month, year] = match;
      return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    }
    
    return null;
  }
}
