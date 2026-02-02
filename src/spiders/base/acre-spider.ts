import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, AcreConfig } from '../../types';
import { logger } from '../../utils/logger';
import { fetchWithRetry } from '../../utils/http-client';

/**
 * Spider para o Diário Oficial do Estado do Acre (DOE/AC)
 * 
 * Este spider coleta diários oficiais do sistema centralizado do Acre que
 * mencionam o município específico configurado.
 * 
 * URL: https://www.diario.ac.gov.br/
 * Características:
 * - Sistema centralizado estadual
 * - Todas as 22 cidades do Acre publicam no mesmo diário
 * - Busca por palavra-chave (nome do município) + ano retorna diários que mencionam a cidade
 * - Documentos em formato PDF
 * - Suporta paginação (10 resultados por página)
 * 
 * IMPORTANTE: O site usa POST para busca por palavra-chave.
 * Parâmetros: palavra (nome da cidade), ano_palavra (ano), paginaIni (offset), palavraTipo (0=exato)
 */
export class AcreSpider extends BaseSpider {
  protected acreConfig: AcreConfig;
  private readonly BASE_URL = 'https://www.diario.ac.gov.br';
  private readonly RESULTS_PER_PAGE = 10;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.acreConfig = spiderConfig.config as AcreConfig;
    this.browser = browser || null;
    
    if (!this.acreConfig.cityName) {
      throw new Error(`AcreSpider requires a cityName in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing AcreSpider for ${spiderConfig.name} - city: ${this.acreConfig.cityName}`);
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling DOE/AC for ${this.spiderConfig.name} (searching for: ${this.acreConfig.cityName})...`);
    
    // Use browser-based crawling if available (required for Cloudflare Workers)
    if (this.browser && this.acreConfig.requiresClientRendering !== false) {
      return this.crawlWithBrowser();
    }
    
    // Fallback to HTTP-based crawling (works locally but not on Cloudflare Workers)
    return this.crawlWithFetch();
  }

  /**
   * HTTP-based crawling (works locally)
   * Searches by city name + year with pagination
   */
  private async crawlWithFetch(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();
    
    try {
      // Get unique years in the date range
      const startYear = this.startDate.getFullYear();
      const endYear = this.endDate.getFullYear();
      
      for (let year = startYear; year <= endYear; year++) {
        const yearGazettes = await this.searchByYear(year, seenUrls);
        gazettes.push(...yearGazettes);
      }
      
      logger.info(`Found ${gazettes.length} gazettes for ${this.spiderConfig.name} mentioning ${this.acreConfig.cityName}`);
      return gazettes;
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error);
      return [];
    }
  }

  /**
   * Search gazettes by city name for a specific year with pagination
   */
  private async searchByYear(year: number, seenUrls: Set<string>): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let page = 0;
    let hasMoreResults = true;
    
    logger.debug(`Searching DOE/AC for ${this.acreConfig.cityName} in year ${year}`);
    
    while (hasMoreResults) {
      try {
        const formData = {
          palavra: this.acreConfig.cityName,
          ano_palavra: year.toString(),
          paginaIni: (page * this.RESULTS_PER_PAGE).toString(),
          palavraTipo: '0' // 0 = exact match
        };
        
        const html = await this.fetchWithPost(this.BASE_URL, formData);
        const $ = this.loadHTML(html);
        
        // Parse results from the table
        const rows = $('.resultados_busca table tbody tr');
        let foundResults = 0;
        
        for (let index = 0; index < rows.length; index++) {
          const element = rows[index];
          const row = $(element);
          
          // Skip context rows (they show text snippets)
          const rowId = row.attr('id') || '';
          if (rowId.includes('trId2_')) continue;
          
          const cells = row.find('td');
          
          if (cells.length >= 2) {
            const dateText = cells.eq(0).text().trim();
            const descriptionCell = cells.eq(1);
            const downloadLink = descriptionCell.find('a').attr('href');
            
            if (dateText && downloadLink) {
              // Deduplicate by URL
              if (seenUrls.has(downloadLink)) continue;
              seenUrls.add(downloadLink);
              
              const date = this.parseDate(dateText);
              
              if (date && this.isInDateRange(date)) {
                const description = descriptionCell.find('a').text().trim();
                const editionNumber = this.extractEditionNumber(description);
                
                const fullUrl = downloadLink.startsWith('http') 
                  ? downloadLink 
                  : `${this.BASE_URL}/${downloadLink.replace(/^\//, '')}`;
                
                const gazette = await this.createGazette(date, fullUrl, {
                  editionNumber,
                  power: this.acreConfig.power || 'executive_legislative',
                  sourceText: `${description} - Menção: ${this.acreConfig.cityName}`,
                  skipUrlResolution: true
                });
                
                if (gazette) {
                  gazettes.push(gazette);
                  foundResults++;
                }
              }
            }
          }
        }
        
        // Check if there are more pages
        const totalResultsText = $('.resultados_busca p').text();
        const totalMatch = totalResultsText.match(/Quantidade de resultados encontrados:\s*(\d+)/);
        const totalResults = totalMatch ? parseInt(totalMatch[1]) : 0;
        const processedSoFar = (page + 1) * this.RESULTS_PER_PAGE;
        
        hasMoreResults = foundResults > 0 && processedSoFar < totalResults;
        page++;
        
        // Safety limit
        if (page > 100) {
          logger.warn(`Reached page limit for ${this.acreConfig.cityName} in ${year}`);
          break;
        }
        
      } catch (error) {
        logger.error(`Error searching DOE/AC for ${this.acreConfig.cityName} in ${year}, page ${page}:`, error);
        hasMoreResults = false;
      }
    }
    
    logger.debug(`Found ${gazettes.length} gazettes for ${this.acreConfig.cityName} in ${year}`);
    return gazettes;
  }

  /**
   * Browser-based crawling (required for Cloudflare Workers)
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();
    let browserInstance = null;
    let page = null;
    
    try {
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Get unique years in the date range
      const startYear = this.startDate.getFullYear();
      const endYear = this.endDate.getFullYear();
      
      for (let year = startYear; year <= endYear; year++) {
        const yearGazettes = await this.searchByYearWithBrowser(page, year, seenUrls);
        gazettes.push(...yearGazettes);
      }
      
      logger.info(`Found ${gazettes.length} gazettes for ${this.spiderConfig.name} mentioning ${this.acreConfig.cityName}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name} with browser:`, error);
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

  /**
   * Search gazettes by city name for a specific year using Browser
   */
  private async searchByYearWithBrowser(browserPage: any, year: number, seenUrls: Set<string>): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      logger.debug(`Searching DOE/AC for ${this.acreConfig.cityName} in ${year} with browser`);
      
      // Navigate to the main page
      await browserPage.goto(this.BASE_URL, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Fill in the keyword search form using specific selectors
      // The form has id="buscaPorPalavra", input id="palavra", select id="ano_palavra"
      await browserPage.type('#palavra', this.acreConfig.cityName);
      await browserPage.select('#ano_palavra', year.toString());
      
      // Submit the specific form by clicking its button
      await browserPage.evaluate(() => {
        const form = document.getElementById('buscaPorPalavra') as HTMLFormElement;
        if (form) {
          form.submit();
        }
      });
      
      // Wait for results to load
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Get the HTML content and parse
      const html = await browserPage.content();
      const $ = this.loadHTML(html);
      
      // Parse results from the table
      const rows = $('.resultados_busca table tbody tr');
      
      for (let index = 0; index < rows.length; index++) {
        const element = rows[index];
        const row = $(element);
        
        // Skip context rows
        const rowId = row.attr('id') || '';
        if (rowId.includes('trId2_')) continue;
        
        const cells = row.find('td');
        
        if (cells.length >= 2) {
          const dateText = cells.eq(0).text().trim();
          const descriptionCell = cells.eq(1);
          const downloadLink = descriptionCell.find('a').attr('href');
          
          if (dateText && downloadLink) {
            if (seenUrls.has(downloadLink)) continue;
            seenUrls.add(downloadLink);
            
            const date = this.parseDate(dateText);
            
            if (date && this.isInDateRange(date)) {
              const description = descriptionCell.find('a').text().trim();
              const editionNumber = this.extractEditionNumber(description);
              
              const fullUrl = downloadLink.startsWith('http') 
                ? downloadLink 
                : `${this.BASE_URL}/${downloadLink.replace(/^\//, '')}`;
              
              const gazette = await this.createGazette(date, fullUrl, {
                editionNumber,
                power: this.acreConfig.power || 'executive_legislative',
                sourceText: `${description} - Menção: ${this.acreConfig.cityName}`,
                skipUrlResolution: true
              });
              
              if (gazette) {
                gazettes.push(gazette);
              }
            }
          }
        }
      }
      
      logger.debug(`Found ${gazettes.length} gazettes for ${this.acreConfig.cityName} in ${year}`);
      
    } catch (error) {
      logger.error(`Error searching DOE/AC for ${this.acreConfig.cityName} in ${year} with browser:`, error);
    }
    
    return gazettes;
  }

  /**
   * Fetch URL with POST data using fetchWithRetry
   */
  private async fetchWithPost(url: string, data: Record<string, string>): Promise<string> {
    const formData = new URLSearchParams();
    for (const [key, value] of Object.entries(data)) {
      formData.append(key, value);
    }
    
    logger.debug(`POST request to ${url} with data: ${formData.toString()}`);
    
    return fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Origin': this.BASE_URL,
        'Referer': this.BASE_URL
      },
      body: formData.toString(),
      timeout: 60000,
      retries: 3,
      retryDelay: 2000
    });
  }

  /**
   * Parse date from Brazilian format (DD/MM/YYYY)
   */
  private parseDate(dateText: string): Date | null {
    const match = dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (match) {
      const [, day, month, year] = match;
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }
    return null;
  }

  /**
   * Extract edition number from description
   */
  private extractEditionNumber(description: string): string | undefined {
    const match = description.match(/n[º°]?\s*(\d+)/i);
    return match ? match[1] : undefined;
  }

  /**
   * Get the latest gazette mentioning the city (for testing and quick access)
   */
  async getLatestGazette(): Promise<Gazette | null> {
    try {
      const currentYear = new Date().getFullYear();
      const formData = {
        palavra: this.acreConfig.cityName,
        ano_palavra: currentYear.toString(),
        paginaIni: '0',
        palavraTipo: '0'
      };
      
      const html = await this.fetchWithPost(this.BASE_URL, formData);
      const $ = this.loadHTML(html);
      
      // Get first result
      const firstRow = $('.resultados_busca table tbody tr').first();
      const cells = firstRow.find('td');
      
      if (cells.length >= 2) {
        const dateText = cells.eq(0).text().trim();
        const descriptionCell = cells.eq(1);
        const downloadLink = descriptionCell.find('a').attr('href');
        
        if (dateText && downloadLink) {
          const date = this.parseDate(dateText);
          const description = descriptionCell.find('a').text().trim();
          const editionNumber = this.extractEditionNumber(description);
          
          const fullUrl = downloadLink.startsWith('http') 
            ? downloadLink 
            : `${this.BASE_URL}/${downloadLink.replace(/^\//, '')}`;
          
          return await this.createGazette(date || new Date(), fullUrl, {
            editionNumber,
            power: this.acreConfig.power || 'executive_legislative',
            sourceText: `${description} - Menção: ${this.acreConfig.cityName}`,
            skipUrlResolution: true
          });
        }
      }
      
    } catch (error) {
      logger.error(`Error getting latest gazette for ${this.acreConfig.cityName}:`, error);
    }
    
    return null;
  }
}
