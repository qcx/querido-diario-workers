import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, DateRange, Gazette } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp } from '../../utils/date-utils';

interface PrefeituraPresidentePrudenteConfig {
  type: 'prefeiturapresidenteprudente';
  baseUrl: string;
  requiresClientRendering?: boolean;
}

interface EditionInfo {
  id: string;
  editionNumber: string;
  isExtra: boolean;
  pdfUrl: string;
  viewUrl: string;
  dateStr?: string;
}

/**
 * Spider for Prefeitura de Presidente Prudente
 * 
 * Site structure (Yii2 framework / DomWeb platform):
 * - List URL: {baseUrl}/diario-oficial/index?page={N}
 * - PDF URL: {baseUrl}/diario-oficial/versao-pdf/{id}
 * - Search with date range: {baseUrl}/diario-oficial?BuscaSearch[data_inicio]={YYYY-MM-DD}&BuscaSearch[data_fim]={YYYY-MM-DD}
 * 
 * Each edition div has:
 * - data-key="{id}" attribute
 * - Edition info (number, date) in the box
 * - PDF link: /diario-oficial/versao-pdf/{id}
 * 
 * NOTE: This site blocks Cloudflare Workers IPs for direct fetch requests.
 * It requires a browser binding (Puppeteer) to work properly.
 * When running without browser, the spider will fail with "internal error".
 */
export class PrefeituraPresidentePrudenteSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;
  
  private static readonly MONTHS_PT: { [key: string]: number } = {
    'janeiro': 0, 'fevereiro': 1, 'março': 2, 'abril': 3,
    'maio': 4, 'junho': 5, 'julho': 6, 'agosto': 7,
    'setembro': 8, 'outubro': 9, 'novembro': 10, 'dezembro': 11,
  };

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraPresidentePrudenteConfig;
    this.baseUrl = platformConfig.baseUrl;
    logger.info(`Initializing PrefeituraPresidentePrudenteSpider for ${config.name}`);
  }
  
  /**
   * Set browser instance (for queue consumer context with browser binding)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const startDateStr = toISODate(this.startDate);
    const endDateStr = toISODate(this.endDate);
    const platformConfig = this.config.config as PrefeituraPresidentePrudenteConfig;
    
    logger.info(`Crawling Prefeitura de Presidente Prudente from ${startDateStr} to ${endDateStr}`, {
      hasBrowser: !!this.browser,
      requiresClientRendering: platformConfig.requiresClientRendering,
    });

    // This site blocks Cloudflare Workers IPs - requires browser binding
    // Use browser if available and requiresClientRendering is true
    if (this.browser && platformConfig.requiresClientRendering === true) {
      logger.debug('Using browser-based crawling for site that blocks datacenter IPs');
      return this.crawlWithBrowser(startDateStr, endDateStr);
    }
    
    if (platformConfig.requiresClientRendering === true && !this.browser) {
      logger.error('Browser binding required but not available - cannot crawl site that blocks datacenter IPs. Make sure BROWSER binding is configured in wrangler.jsonc and available in your environment.');
      return [];
    }
    
    // Fallback to direct fetch (will likely fail due to IP blocking)
    logger.warn('No browser binding available - direct fetch may fail due to IP blocking');
    return this.crawlWithFetch(startDateStr, endDateStr);
  }
  
  /**
   * Crawl using Puppeteer browser (for sites that block datacenter IPs)
   */
  private async crawlWithBrowser(startDateStr: string, endDateStr: string): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;
    
    try {
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Build URL with date filters
      const listUrl = `${this.baseUrl}/diario-oficial?BuscaSearch%5Bdata_inicio%5D=${startDateStr}&BuscaSearch%5Bdata_fim%5D=${endDateStr}&per-page=100`;
      
      logger.debug(`Fetching gazette list with browser: ${listUrl}`);
      
      await page.goto(listUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Wait for content to load
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extract editions from the page using browser evaluation
      const editions = await page.evaluate(() => {
        const results: Array<{
          id: string;
          editionNumber: string;
          isExtra: boolean;
          pdfUrl: string;
          dateStr: string;
        }> = [];
        
        const boxes = document.querySelectorAll('.box-publicacao[data-key]');
        
        for (const box of Array.from(boxes)) {
          const id = box.getAttribute('data-key') || '';
          if (!id) continue;
          
          // Get edition number from h4
          const h4 = box.querySelector('h4');
          const h4Text = h4?.textContent || '';
          const editionMatch = h4Text.match(/Edição\s+n[º°]\s*([\d\/\-A-Z]+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : id;
          
          const isExtra = /extra/i.test(h4Text);
          
          // Get PDF link
          const pdfLink = box.querySelector('a[href*="versao-pdf"]');
          const pdfUrl = pdfLink?.getAttribute('href') || '';
          
          if (!pdfUrl) continue;
          
          // Try to find date in parent/surrounding content
          const parentText = box.closest('.publicacao')?.textContent || box.textContent || '';
          const dateMatch = parentText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          const dateStr = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : '';
          
          results.push({ id, editionNumber, isExtra, pdfUrl, dateStr });
        }
        
        return results;
      });
      
      if (editions.length === 0) {
        logger.info(`No gazettes found for date range ${startDateStr} to ${endDateStr}`);
        return gazettes;
      }
      
      logger.info(`Found ${editions.length} editions using browser`);
      
      // Process each edition
      for (const edition of editions) {
        try {
          let dateStr = edition.dateStr;
          
          // If no date found, fetch the view page
          if (!dateStr) {
            const viewUrl = `${this.baseUrl}/diario-oficial/view/${edition.id}`;
            await page.goto(viewUrl, { waitUntil: 'networkidle0', timeout: 15000 });
            this.requestCount++;
            
            // Extract date from view page
            dateStr = await page.evaluate(() => {
              const text = document.body.textContent || '';
              
              // Pattern 1: "02 de janeiro de 2026"
              const months: { [key: string]: string } = {
                'janeiro': '01', 'fevereiro': '02', 'março': '03', 'abril': '04',
                'maio': '05', 'junho': '06', 'julho': '07', 'agosto': '08',
                'setembro': '09', 'outubro': '10', 'novembro': '11', 'dezembro': '12',
              };
              
              const match = text.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
              if (match) {
                const day = match[1].padStart(2, '0');
                const month = months[match[2].toLowerCase()];
                const year = match[3];
                if (month) return `${year}-${month}-${day}`;
              }
              
              // Pattern 2: DD/MM/YYYY
              const match2 = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
              if (match2) {
                return `${match2[3]}-${match2[2]}-${match2[1]}`;
              }
              
              return '';
            });
          }
          
          if (!dateStr) {
            logger.warn(`Could not extract date for edition ${edition.editionNumber}`);
            continue;
          }
          
          // Create full PDF URL
          const fullPdfUrl = edition.pdfUrl.startsWith('http') 
            ? edition.pdfUrl 
            : `${this.baseUrl}${edition.pdfUrl}`;
          
          const gazette: Gazette = {
            date: dateStr,
            fileUrl: fullPdfUrl,
            territoryId: this.config.territoryId,
            scrapedAt: getCurrentTimestamp(),
            editionNumber: edition.editionNumber,
            isExtraEdition: edition.isExtra,
            power: 'executive',
            sourceText: `Diário Oficial de Presidente Prudente - Edição nº ${edition.editionNumber}${edition.isExtra ? ' - EXTRA' : ''}`,
          };

          gazettes.push(gazette);
          logger.info(`Found gazette: Edition ${edition.editionNumber} - ${dateStr}`);
        } catch (e) {
          logger.warn(`Failed to process edition ${edition.editionNumber}: ${e}`);
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes with browser`);
                } catch (error) {
      logger.error(`Error crawling Presidente Prudente with browser:`, error as Error);
    } finally {
      if (page) {
        try { await page.close(); } catch (e) { /* ignore */ }
      }
      if (browserInstance) {
        try { await browserInstance.close(); } catch (e) { /* ignore */ }
      }
    }

    return gazettes;
  }
  
  /**
   * Crawl using direct fetch (fallback, may fail due to IP blocking)
   */
  private async crawlWithFetch(startDateStr: string, endDateStr: string): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      // Build URL with properly URL-encoded date filters
      const listUrl = `${this.baseUrl}/diario-oficial?BuscaSearch%5Bdata_inicio%5D=${startDateStr}&BuscaSearch%5Bdata_fim%5D=${endDateStr}&per-page=100`;
      
      logger.debug(`Fetching gazette list: ${listUrl}`);
      
      const response = await fetch(listUrl, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        },
      });
      
      if (!response.ok) {
        logger.error(`Failed to fetch ${listUrl}: ${response.status}`);
        return gazettes;
      }
      
      const html = await response.text();
      
      const editions = this.parseEditionList(html);
      
      if (editions.length === 0) {
        logger.info(`No gazettes found for date range ${startDateStr} to ${endDateStr}`);
        return gazettes;
      }
      
      logger.info(`Found ${editions.length} editions in the listing, fetching dates...`);
      
      for (const edition of editions) {
        try {
          const date = await this.fetchEditionDate(edition.viewUrl);
          
          if (!date) {
            logger.warn(`Could not extract date for edition ${edition.editionNumber}, skipping`);
            continue;
          }
          
          const fullPdfUrl = edition.pdfUrl.startsWith('http') 
            ? edition.pdfUrl 
            : `${this.baseUrl}${edition.pdfUrl}`;
          
          const gazette: Gazette = {
            date: toISODate(date),
            fileUrl: fullPdfUrl,
            territoryId: this.config.territoryId,
            scrapedAt: getCurrentTimestamp(),
            editionNumber: edition.editionNumber,
            isExtraEdition: edition.isExtra,
            power: 'executive',
            sourceText: `Diário Oficial de Presidente Prudente - Edição nº ${edition.editionNumber}${edition.isExtra ? ' - EXTRA' : ''}`,
          };

          gazettes.push(gazette);
          logger.info(`Found gazette: Edition ${edition.editionNumber} - ${toISODate(date)}`);
        } catch (e) {
          logger.warn(`Failed to process edition ${edition.editionNumber}: ${e}`);
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`);
    } catch (error) {
      logger.error(`Error crawling Presidente Prudente:`, error as Error);
    }

    return gazettes;
  }
  
  /**
   * Parse edition list from the main listing page HTML
   */
  private parseEditionList(html: string): EditionInfo[] {
    const editions: EditionInfo[] = [];
    const seenIds = new Set<string>();
    
    // Pattern: <div class="box-publicacao" data-key="1234">
    //          <h4>Edição nº 1945/IX</h4> or <h4>Edição nº 1944/VIII Extra</h4>
    //          ...
    //          <a ... href="/diario-oficial/versao-pdf/1234" ...>PDF ASSINADO</a>
    
    // Match each box-publicacao block
    const blockPattern = /<div class="box-publicacao" data-key="(\d+)">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
    
    let blockMatch;
    while ((blockMatch = blockPattern.exec(html)) !== null) {
      const id = blockMatch[1];
      const content = blockMatch[2];
      
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      
      // Extract edition title - handles formats like:
      // "Edição nº 1945/IX" or "Edição nº 1944/VIII Extra"
      const titleMatch = content.match(/<h4>Edição\s+n[º°]\s*([\d\/\-A-Z]+)(?:\s*Extra)?/i);
      if (!titleMatch) continue;
      
      const editionNumber = titleMatch[1];
      const isExtra = /extra/i.test(content);
      
      // Extract PDF URL - look for versao-pdf link
      const pdfMatch = content.match(/href="([^"]*versao-pdf[^"]*)"/i);
      if (!pdfMatch) continue;
      
      const pdfUrl = pdfMatch[1];
      const viewUrl = `${this.baseUrl}/diario-oficial/view/${id}`;
      
      editions.push({
        id,
        editionNumber,
        isExtra,
        pdfUrl,
        viewUrl,
      });
    }
    
    // Fallback: simpler pattern matching if block pattern fails
    if (editions.length === 0) {
      logger.debug('Block pattern failed, trying simpler pattern matching');
      
      // Try to find data-key and corresponding PDF links
      const dataKeyPattern = /data-key="(\d+)"/g;
      let dataKeyMatch;
      
      while ((dataKeyMatch = dataKeyPattern.exec(html)) !== null) {
        const id = dataKeyMatch[1];
        
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        
        // Look for versao-pdf link with this ID
        const pdfPattern = new RegExp(`href="([^"]*versao-pdf/${id}[^"]*)"`, 'i');
        const pdfMatch = html.match(pdfPattern);
        
        if (!pdfMatch) continue;
        
        // Try to find edition number near this data-key
        const contextStart = Math.max(0, dataKeyMatch.index - 200);
        const contextEnd = Math.min(html.length, dataKeyMatch.index + 500);
        const context = html.substring(contextStart, contextEnd);
        
        const editionMatch = context.match(/Edição\s+n[º°]\s*([\d\/\-A-Z]+)/i);
        const editionNumber = editionMatch ? editionMatch[1] : id;
        const isExtra = /extra/i.test(context);
        
        editions.push({
          id,
          editionNumber,
          isExtra,
          pdfUrl: pdfMatch[1],
          viewUrl: `${this.baseUrl}/diario-oficial/view/${id}`,
        });
      }
    }
    
    logger.debug(`Parsed ${editions.length} editions from listing page`);
    return editions;
  }
  
  /**
   * Fetch the edition detail page to extract the publication date
   */
  private async fetchEditionDate(viewUrl: string): Promise<Date | null> {
    try {
      const response = await fetch(viewUrl, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        },
      });
      
      if (!response.ok) {
        logger.warn(`Failed to fetch ${viewUrl}: ${response.status}`);
        return null;
      }
      
      const html = await response.text();
      
      // Pattern 1: "02 de janeiro de 2026"
      const datePattern = /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i;
      const match = html.match(datePattern);
      
      if (match) {
        const day = parseInt(match[1], 10);
        const monthName = match[2].toLowerCase();
        const year = parseInt(match[3], 10);
        
        const month = PrefeituraPresidentePrudenteSpider.MONTHS_PT[monthName];
        if (month !== undefined) {
          return new Date(Date.UTC(year, month, day));
        }
      }
      
      // Pattern 2: DD/MM/YYYY
      const dateMatch2 = html.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (dateMatch2) {
        const [, day, month, year] = dateMatch2;
        return new Date(Date.UTC(
          parseInt(year, 10),
          parseInt(month, 10) - 1,
          parseInt(day, 10)
        ));
      }
      
      logger.warn(`Could not find date pattern in ${viewUrl}`);
      return null;
    } catch (error) {
      logger.error(`Error fetching edition date from ${viewUrl}: ${error}`);
      return null;
    }
  }
}

