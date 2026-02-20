import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, DateRange, Gazette } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp } from '../../utils/date-utils';

interface PrefeituraNovaFriburgoConfig {
  type: 'prefeituranovafriburgo';
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/**
 * Spider for Prefeitura de Nova Friburgo official gazette
 * 
 * Site structure (Yii2 framework / DomWeb platform):
 * - List URL: {baseUrl}/diario-oficial?BuscaSearch[data_inicio]={YYYY-MM-DD}&BuscaSearch[data_fim]={YYYY-MM-DD}
 * - PDF URL: {baseUrl}/diario-oficial/versao-pdf/{id}
 * 
 * NOTE: This site blocks Cloudflare Workers IPs for direct fetch requests.
 * It requires a browser binding (Puppeteer) to work properly.
 */
export class PrefeituraNovaFriburgoSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;
  
  private static readonly MONTHS_PT: { [key: string]: number } = {
    'janeiro': 0, 'fevereiro': 1, 'março': 2, 'abril': 3,
    'maio': 4, 'junho': 5, 'julho': 6, 'agosto': 7,
    'setembro': 8, 'outubro': 9, 'novembro': 10, 'dezembro': 11,
  };

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraNovaFriburgoConfig;
    this.baseUrl = platformConfig.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.browser = browser || null;
    logger.info(`Initializing PrefeituraNovaFriburgoSpider for ${config.name}`);
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
    const platformConfig = this.config.config as PrefeituraNovaFriburgoConfig;
    
    logger.info(`Crawling Prefeitura de Nova Friburgo from ${startDateStr} to ${endDateStr}`, {
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
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Debug: Check page structure
      const pageDebug = await page.evaluate(() => {
        const allSelectors = [
          '.box-publicacao[data-key]',
          '.box-publicacao',
          '[data-key]',
          '.publicacao',
          'table tbody tr',
          '.list-group-item',
          'article',
          '[class*="diario"]',
          '[class*="publicacao"]',
          'a[href*="pdf"]',
          'a[href*="versao-pdf"]',
          'a[href*="diario"]'
        ];
        
        const selectorResults: Record<string, number> = {};
        allSelectors.forEach(sel => {
          try {
            selectorResults[sel] = document.querySelectorAll(sel).length;
          } catch (e) {
            selectorResults[sel] = -1;
          }
        });
        
        // Get all links with PDF
        const pdfLinks = Array.from(document.querySelectorAll('a')).filter(a => {
          const href = a.getAttribute('href') || '';
          return href.includes('pdf') || href.includes('diario') || href.includes('versao');
        }).slice(0, 10).map(a => ({
          text: a.textContent?.trim().substring(0, 100),
          href: a.getAttribute('href'),
          className: a.className
        }));
        
        return {
          title: document.title,
          url: window.location.href,
          selectorCounts: selectorResults,
          pdfLinks,
          bodyPreview: document.body?.textContent?.substring(0, 500) || ''
        };
      });
      
      logger.debug('Page structure debug:', JSON.stringify(pageDebug, null, 2));
      
      // Extract editions from the page using browser evaluation
      const editions = await page.evaluate(() => {
        const results: Array<{
          id: string;
          editionNumber: string;
          isExtra: boolean;
          pdfUrl: string;
          dateStr: string;
        }> = [];
        
        // Nova Friburgo structure: Look for boxes containing "EDIÇÃO Nº" and "Veiculação:"
        // Try multiple selector patterns to find edition containers
        const selectors = [
          '.box-publicacao[data-key]',
          '.box-publicacao',
          '[data-key]',
          '.publicacao',
          '[class*="edicao"]',
          '[class*="edição"]',
          '[class*="diario"]',
          'div[class*="box"]',
          'article',
        ];
        
        let boxes: Element[] = [];
        
        // Find all potential boxes
        for (const selector of selectors) {
          const elements = Array.from(document.querySelectorAll(selector));
          for (const el of elements) {
            const text = el.textContent || '';
            // Check if element contains "EDIÇÃO Nº" or "Veiculação:" - signature of Nova Friburgo edition boxes
            if (text.includes('EDIÇÃO Nº') || text.includes('EDIÇÃO N') || text.includes('Veiculação:')) {
              boxes.push(el);
            }
          }
          if (boxes.length > 0) break;
        }
        
        // If no boxes found, search all divs for those containing edition info
        if (boxes.length === 0) {
          const allDivs = document.querySelectorAll('div');
          for (const div of Array.from(allDivs)) {
            const text = div.textContent || '';
            if ((text.includes('EDIÇÃO Nº') || text.includes('Veiculação:')) && 
                text.length < 500) { // Avoid parent containers
              boxes.push(div);
            }
          }
        }
        
        console.log(`Found ${boxes.length} potential edition boxes`);
        
        // Process each box
        for (const box of boxes) {
          const boxText = box.textContent || '';
          
          // Skip if doesn't contain key identifiers
          if (!boxText.includes('EDIÇÃO') && !boxText.includes('Veiculação:')) continue;
          
          // Extract edition number: "EDIÇÃO Nº 2512/2026"
          const editionMatch = boxText.match(/EDIÇÃO\s+N[º°]?\s*(\d+\/\d+)/i);
          if (!editionMatch) continue;
          
          const editionNumber = editionMatch[1];
          const isExtra = /extra/i.test(boxText);
          
          // Extract date: "Veiculação: 16 de janeiro de 2026" or "16 de janeiro de 2026"
          let dateStr = '';
          const months: { [key: string]: string } = {
            'janeiro': '01', 'fevereiro': '02', 'março': '03', 'abril': '04',
            'maio': '05', 'junho': '06', 'julho': '07', 'agosto': '08',
            'setembro': '09', 'outubro': '10', 'novembro': '11', 'dezembro': '12',
          };
          
          // Pattern: "Veiculação: 16 de janeiro de 2026"
          const dateMatch1 = boxText.match(/Veiculação:\s*(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
          if (dateMatch1) {
            const day = dateMatch1[1].padStart(2, '0');
            const month = months[dateMatch1[2].toLowerCase()];
            const year = dateMatch1[3];
            if (month) dateStr = `${year}-${month}-${day}`;
          }
          
          // Pattern: DD/MM/YYYY
          if (!dateStr) {
            const dateMatch2 = boxText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (dateMatch2) {
              dateStr = `${dateMatch2[3]}-${dateMatch2[2]}-${dateMatch2[1]}`;
            }
          }
          
          // Find PDF link - try multiple patterns
          let pdfUrl = '';
          
          // First, try to find data-key attribute which might be used to construct PDF URL
          const dataKey = box.getAttribute('data-key') || box.querySelector('[data-key]')?.getAttribute('data-key') || '';
          
          // Look for links with href containing pdf, versao, or diario
          const allLinks = box.querySelectorAll('a[href]');
          for (const link of Array.from(allLinks)) {
            const href = link.getAttribute('href') || '';
            // Check if it's a PDF link or a link to view/download the gazette
            if (href.includes('.pdf') || href.includes('versao') || href.includes('versão') || 
                href.includes('diario') || href.includes('download') || href.includes('view') ||
                href.includes('visualizar')) {
              pdfUrl = href;
              break;
            }
          }
          
          // If we have data-key but no PDF link found, try to construct the URL
          if (!pdfUrl && dataKey) {
            // Try standard patterns for PDF URLs in DomWeb platform
            pdfUrl = `/diario-oficial/versao-pdf/${dataKey}`;
          }
          
          // If no link found in box, check for icons or buttons that might have data attributes
          if (!pdfUrl) {
            // Look for elements with data attributes that might contain URLs
            const dataElements = box.querySelectorAll('[data-href], [data-url], [data-pdf], [onclick]');
            for (const el of Array.from(dataElements)) {
              pdfUrl = el.getAttribute('data-href') || 
                      el.getAttribute('data-url') || 
                      el.getAttribute('data-pdf') || 
                      '';
              if (pdfUrl) break;
              
              // Check onclick handlers that might contain URLs
              const onclick = el.getAttribute('onclick') || '';
              const urlMatch = onclick.match(/(['"])([^'"]*(?:pdf|versao|diario)[^'"]*)\1/i);
              if (urlMatch) {
                pdfUrl = urlMatch[2];
                break;
              }
            }
          }
          
          // If still no PDF URL, look for clickable elements that might navigate to PDF
          if (!pdfUrl) {
            const clickable = box.querySelector('a, button, [onclick], [class*="download"], [class*="pdf"], [class*="icon"], [title*="PDF"], [title*="pdf"]');
            if (clickable) {
              pdfUrl = clickable.getAttribute('href') || '';
              // If it's a view link, we might need to construct PDF URL from it
              if (pdfUrl && pdfUrl.includes('/view/')) {
                const viewId = pdfUrl.match(/\/view\/(\d+)/)?.[1];
                if (viewId) {
                  pdfUrl = `/diario-oficial/versao-pdf/${viewId}`;
                }
              }
            }
          }
          
          // Use edition number as ID if we found edition info
          const id = editionNumber.replace('/', '-');
          
          if (pdfUrl) {
            results.push({
              id,
              editionNumber,
              isExtra,
              pdfUrl,
              dateStr
            });
          }
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
            sourceText: `Diário Oficial de Nova Friburgo - Edição nº ${edition.editionNumber}${edition.isExtra ? ' - EXTRA' : ''}`,
          };

          gazettes.push(gazette);
          logger.info(`Found gazette: Edition ${edition.editionNumber} - ${dateStr}`);
        } catch (e) {
          logger.warn(`Failed to process edition ${edition.editionNumber}: ${e}`);
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes with browser`);
    } catch (error) {
      logger.error(`Error crawling Nova Friburgo with browser:`, error as Error);
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
    logger.warn('Direct fetch not implemented for Nova Friburgo - requires browser');
    return [];
  }
}
