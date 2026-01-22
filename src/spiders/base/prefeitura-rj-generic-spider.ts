import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Configuration interface for generic RJ city spiders
 */
interface PrefeituraRJGenericConfig {
  type: string;
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/**
 * Month name mappings for Portuguese date parsing
 */
const MONTH_NAMES: Record<string, number> = {
  'janeiro': 1, 'jan': 1,
  'fevereiro': 2, 'fev': 2,
  'março': 3, 'mar': 3, 'marco': 3,
  'abril': 4, 'abr': 4,
  'maio': 5, 'mai': 5,
  'junho': 6, 'jun': 6,
  'julho': 7, 'jul': 7,
  'agosto': 8, 'ago': 8,
  'setembro': 9, 'set': 9,
  'outubro': 10, 'out': 10,
  'novembro': 11, 'nov': 11,
  'dezembro': 12, 'dez': 12,
};

/**
 * Generic browser-based spider for RJ municipalities
 * 
 * This spider handles common patterns found in Rio de Janeiro city government websites:
 * - WordPress-based sites with gazette listings
 * - HTML pages with PDF download links
 * - Sites that require JavaScript to render content
 * 
 * The spider looks for:
 * - PDF links (direct or via download buttons)
 * - Dates in Brazilian format (DD/MM/YYYY or "DD de Mês de YYYY")
 * - Edition numbers (Edição XXXX, Nº XXXX, etc.)
 */
export class PrefeituraRJGenericSpider extends BaseSpider {
  protected config: PrefeituraRJGenericConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeituraRJGenericConfig;
    this.browser = browser || null;
    
    if (!this.config.baseUrl) {
      throw new Error(`PrefeituraRJGenericSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraRJGenericSpider for ${spiderConfig.name}`);
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.config.baseUrl} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error(`PrefeituraRJGenericSpider requires browser binding for ${this.spiderConfig.name}`);
    }
    
    return this.crawlWithBrowser();
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
      
      // Navigate to the page
      logger.debug(`Navigating to ${this.config.baseUrl}`);
      await page.goto(this.config.baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Wait for page to stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Try to accept cookie consent if present
      try {
        const acceptButton = await page.$('[class*="accept"], [class*="consent"], button:has-text("Aceitar")');
        if (acceptButton) {
          await acceptButton.click();
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch {
        // Ignore - no cookie banner
      }
      
      // Extract gazettes from the page
      const extractedData = await this.extractGazettesFromPage(page);
      
      // Process extracted data
      for (const data of extractedData) {
        try {
          const gazetteDate = this.parseDate(data.date);
          
          if (!gazetteDate || isNaN(gazetteDate.getTime())) {
            logger.warn(`Invalid date: ${data.date}`);
            continue;
          }
          
          // Filter by date range
          if (!this.isInDateRange(gazetteDate)) {
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
            logger.info(`Found gazette for ${toISODate(gazetteDate)} (edição ${data.editionNumber || 'N/A'}): ${data.pdfUrl}`);
          }
        } catch (error) {
          logger.error(`Error processing extracted data:`, error as Error);
        }
      }
      
      // Try pagination if available
      let hasMore = true;
      let pageNum = 1;
      const maxPages = 10; // Safety limit
      
      while (hasMore && pageNum < maxPages) {
        const nextPageData = await this.tryNextPage(page, pageNum + 1);
        if (nextPageData.length > 0) {
          for (const data of nextPageData) {
            try {
              const gazetteDate = this.parseDate(data.date);
              
              if (!gazetteDate || isNaN(gazetteDate.getTime())) {
                continue;
              }
              
              if (!this.isInDateRange(gazetteDate)) {
                continue;
              }
              
              const gazette = await this.createGazette(gazetteDate, data.pdfUrl, {
                power: 'executive_legislative',
                editionNumber: data.editionNumber,
                isExtraEdition: data.isExtra,
              });
              
              if (gazette) {
                gazettes.push(gazette);
                logger.info(`Found gazette for ${toISODate(gazetteDate)} (edição ${data.editionNumber || 'N/A'}): ${data.pdfUrl}`);
              }
            } catch (error) {
              logger.error(`Error processing paginated data:`, error as Error);
            }
          }
          pageNum++;
        } else {
          hasMore = false;
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
    return page.evaluate((baseUrl: string) => {
      const results: Array<{
        date: string;
        editionNumber?: string;
        pdfUrl: string;
        isExtra: boolean;
      }> = [];
      
      // Date patterns to look for
      const datePatterns = [
        /(\d{2})\/(\d{2})\/(\d{4})/,  // DD/MM/YYYY
        /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i,  // "DD de Mês de YYYY"
        /(\d{4})-(\d{2})-(\d{2})/,  // YYYY-MM-DD
      ];
      
      // Edition patterns
      const editionPatterns = [
        /[Ee]di[çc][ãa]o\s*[Nn]?[ºo]?\s*(\d+)/i,
        /[Nn][ºo°]?\s*(\d+)/,
        /[Ee]d\.?\s*(\d+)/i,
      ];
      
      // Helper to make URL absolute
      const makeAbsolute = (url: string): string => {
        if (!url) return '';
        if (url.startsWith('http')) return url;
        if (url.startsWith('//')) return window.location.protocol + url;
        if (url.startsWith('/')) return window.location.origin + url;
        return new URL(url, baseUrl).href;
      };
      
      // Find all links that might be gazette PDFs
      const allLinks = document.querySelectorAll('a');
      const processedUrls = new Set<string>();
      
      for (const link of allLinks) {
        const href = link.getAttribute('href') || '';
        const text = link.textContent?.trim() || '';
        
        // Check if this is a PDF link
        const isPdfLink = href.toLowerCase().includes('.pdf') ||
                          text.toLowerCase().includes('pdf') ||
                          text.toLowerCase().includes('baixar') ||
                          text.toLowerCase().includes('download') ||
                          link.querySelector('.fa-download, .fa-file-pdf, [class*="download"], [class*="pdf"]') !== null;
        
        if (!isPdfLink) continue;
        
        const pdfUrl = makeAbsolute(href);
        if (!pdfUrl || processedUrls.has(pdfUrl)) continue;
        
        // Look for date in the surrounding context
        let date = '';
        let editionNumber = '';
        let context = '';
        
        // Search in parent elements for date and edition info
        let element: Element | null = link;
        let depth = 0;
        
        while (element && depth < 10) {
          const elementText = element.textContent || '';
          
          // Try to find date
          for (const pattern of datePatterns) {
            const match = elementText.match(pattern);
            if (match) {
              date = match[0];
              break;
            }
          }
          
          // Try to find edition number
          for (const pattern of editionPatterns) {
            const match = elementText.match(pattern);
            if (match) {
              editionNumber = match[1];
              break;
            }
          }
          
          context = elementText;
          
          if (date) break;
          element = element.parentElement;
          depth++;
        }
        
        // Also check the link text itself
        if (!date) {
          for (const pattern of datePatterns) {
            const match = text.match(pattern);
            if (match) {
              date = match[0];
              break;
            }
          }
        }
        
        // Try to extract date from URL patterns like /2026/01/ or _20260122
        if (!date && href) {
          const urlDateMatch = href.match(/(\d{4})[\/\-_](\d{2})[\/\-_](\d{2})/);
          if (urlDateMatch) {
            date = `${urlDateMatch[3]}/${urlDateMatch[2]}/${urlDateMatch[1]}`;
          }
        }
        
        // Check for extra edition markers
        const isExtra = /\b(extra|suplemento|extraordin[aá]ri[oa])\b/i.test(context);
        
        if (date) {
          processedUrls.add(pdfUrl);
          results.push({
            date,
            editionNumber: editionNumber || undefined,
            pdfUrl,
            isExtra,
          });
        }
      }
      
      // Also look for structured data (cards, list items, tables)
      const containers = document.querySelectorAll(
        'article, .card, .post, .gazette, .diario, [class*="gazette"], [class*="diario"], ' +
        'tr, li, .item, .entry, [role="listitem"]'
      );
      
      for (const container of containers) {
        const containerText = container.textContent || '';
        let date = '';
        let editionNumber = '';
        
        // Find date
        for (const pattern of datePatterns) {
          const match = containerText.match(pattern);
          if (match) {
            date = match[0];
            break;
          }
        }
        
        if (!date) continue;
        
        // Find edition
        for (const pattern of editionPatterns) {
          const match = containerText.match(pattern);
          if (match) {
            editionNumber = match[1];
            break;
          }
        }
        
        // Find PDF link within this container
        const links = container.querySelectorAll('a');
        for (const link of links) {
          const href = link.getAttribute('href') || '';
          const linkText = link.textContent?.trim() || '';
          
          const isPdfLink = href.toLowerCase().includes('.pdf') ||
                            linkText.toLowerCase().includes('pdf') ||
                            linkText.toLowerCase().includes('baixar') ||
                            linkText.toLowerCase().includes('download');
          
          if (isPdfLink) {
            const pdfUrl = makeAbsolute(href);
            if (pdfUrl && !processedUrls.has(pdfUrl)) {
              processedUrls.add(pdfUrl);
              const isExtra = /\b(extra|suplemento|extraordin[aá]ri[oa])\b/i.test(containerText);
              results.push({
                date,
                editionNumber: editionNumber || undefined,
                pdfUrl,
                isExtra,
              });
            }
            break; // Only take the first PDF link per container
          }
        }
      }
      
      return results;
    }, this.config.baseUrl);
  }

  /**
   * Try to navigate to the next page and extract more gazettes
   */
  private async tryNextPage(page: any, pageNum: number): Promise<Array<{
    date: string;
    editionNumber?: string;
    pdfUrl: string;
    isExtra: boolean;
  }>> {
    try {
      // Try common pagination patterns
      const paginationClicked = await page.evaluate((pageNum: number) => {
        // Look for "next" button
        const nextButtons = document.querySelectorAll(
          'a[rel="next"], .next, .pagination .next, button:has-text("Próximo"), ' +
          '[class*="next"], [aria-label*="next"], [aria-label*="próximo"]'
        );
        
        for (const btn of nextButtons) {
          if (btn instanceof HTMLElement) {
            btn.click();
            return true;
          }
        }
        
        // Look for page number link
        const pageLinks = document.querySelectorAll(
          `.pagination a, .page-numbers, [class*="pagination"] a`
        );
        
        for (const link of pageLinks) {
          if (link.textContent?.trim() === pageNum.toString()) {
            (link as HTMLElement).click();
            return true;
          }
        }
        
        return false;
      }, pageNum);
      
      if (!paginationClicked) {
        return [];
      }
      
      // Wait for new content
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extract gazettes from the new page
      return this.extractGazettesFromPage(page);
    } catch (error) {
      logger.debug(`No more pages to fetch: ${error}`);
      return [];
    }
  }

  /**
   * Parse a date string in various Brazilian formats
   */
  private parseDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    
    // Try DD/MM/YYYY
    const slashMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (slashMatch) {
      const [, day, month, year] = slashMatch;
      return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    }
    
    // Try "DD de Mês de YYYY"
    const ptMatch = dateStr.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
    if (ptMatch) {
      const [, day, monthName, year] = ptMatch;
      const month = MONTH_NAMES[monthName.toLowerCase()];
      if (month) {
        return new Date(`${year}-${month.toString().padStart(2, '0')}-${day.padStart(2, '0')}`);
      }
    }
    
    // Try YYYY-MM-DD
    const isoMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return new Date(dateStr);
    }
    
    return null;
  }
}

// Export specific city spider classes that extend the generic spider
// These can be customized if needed, but start with the generic implementation

export class PrefeituraRjOdasOstrasSpider extends PrefeituraRJGenericSpider {}
export class PrefeituraNilopolisSpider extends PrefeituraRJGenericSpider {}
export class PrefeituraQueimadosSpider extends PrefeituraRJGenericSpider {}
export class PrefeituraRjAraruamaSpider extends PrefeituraRJGenericSpider {}
// PrefeituraRjResendeSpider moved to prefeituraresende-spider.ts (specific implementation)
export class PrefeituraRjItaguaiSpider extends PrefeituraRJGenericSpider {}
export class PrefeituraRjSaoPedroDaAldeiaSpider extends PrefeituraRJGenericSpider {}
// PrefeituraRjItaperunaSpider moved to prefeiturarjitaperuna-spider.ts (specific implementation)
export class PrefeituraRjJaperiSpider extends PrefeituraRJGenericSpider {}
export class PrefeituraRjBarraDoPixaiSpider extends PrefeituraRJGenericSpider {}
export class PrefeituraRjSaquaremaSpider extends PrefeituraRJGenericSpider {}
// PrefeituraRjSeropedicaSpider moved to prefeiturarjseropedica-spider.ts (specific implementation using Bubble.io API)
export class PrefeituraRjTresRiosSpider extends PrefeituraRJGenericSpider {}
// PrefeituraRjValencaSpider moved to prefeiturarjvalenca-spider.ts (specific implementation)
export class PrefeituraRjCachoeirasDeMacacuSpider extends PrefeituraRJGenericSpider {}
export class PrefeituraRjRioBonitoSpider extends PrefeituraRJGenericSpider {}
// PrefeituraRjGuapimirimSpider moved to prefeiturarjguapimirim-spider.ts (specific implementation)
export class PrefeituraRjCasimiroDeAbreuSpider extends PrefeituraRJGenericSpider {}
// PrefeituraRjParatySpider moved to prefeiturarjparaty-spider.ts (specific implementation using API)
export class PrefeituraRjSaoFranciscoDeItabapoanaSpider extends PrefeituraRJGenericSpider {}
export class PrefeituraRjParaibaDoSulSpider extends PrefeituraRJGenericSpider {}
export class PrefeituraRjParacambiSpider extends PrefeituraRJGenericSpider {}
export class PrefeituraRjSantoAntonioDePaduaSpider extends PrefeituraRJGenericSpider {}
export class PrefeituraRjMangaratibaSpider extends PrefeituraRJGenericSpider {}
export class PrefeituraRjArmacaoDosBuziosSpider extends PrefeituraRJGenericSpider {}
export class PrefeituraRjSaoFidelisSpider extends PrefeituraRJGenericSpider {}
export class PrefeituraRjSaoJoaoDaBarraSpider extends PrefeituraRJGenericSpider {}
export class PrefeituraRjBomJesusDoItabapoanaSpider extends PrefeituraRJGenericSpider {}
export class PrefeituraRjVassourasSpider extends PrefeituraRJGenericSpider {}
export class PrefeituraRjTanguaSpider extends PrefeituraRJGenericSpider {}
export class PrefeituraRjArraialDoCaboSpider extends PrefeituraRJGenericSpider {}
// PrefeituraRjItatiaiaSpider moved to prefeiturarjitatiaia-spider.ts (specific implementation)
// PrefeituraRjPatyDoAlferesSpider moved to prefeiturarjpatydoalferes-spider.ts (specific implementation)
export class PrefeituraRjBomJardimSpider extends PrefeituraRJGenericSpider {}
export class PrefeituraRjIguabaGrandeSpider extends PrefeituraRJGenericSpider {}
export class PrefeituraRjMiracemaSpider extends PrefeituraRJGenericSpider {}
export class PrefeituraRjMiguelPereiraSpider extends PrefeituraRJGenericSpider {}
export class PrefeituraRjPiraiSpider extends PrefeituraRJGenericSpider {}
