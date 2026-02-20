import puppeteer from '@cloudflare/puppeteer';
import { parse } from 'node-html-parser';
import { BaseSpider } from './base-spider';
import { Gazette, SpiderConfig, DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Configuration interface for Prefeitura Ferraz de Vasconcelos spider
 * 
 * Site structure (WordPress/Elementor/JetEngine):
 * - Page URL: https://ferrazdevasconcelos.sp.gov.br/web/home/boletins-oficiais/
 * - PDF links in: div.jet-listing-dynamic-field p.jet-listing-dynamic-field__content a
 * - Text format: "Edição Digital Nº {number}"
 * - PDF URL: https://ferrazdevasconcelos.sp.gov.br/web/wp-content/uploads/{YYYY}/{MM}/BOM_EDICAO_{number}.pdf
 * 
 * Notes:
 * - Older PDFs (pre-2024) may have malformed URLs with duplicate "web/web/" 
 * - Date is extracted from the PDF URL path (YYYY/MM)
 */
export interface PrefeituraFerrazDeVasconcelosConfig {
  type: 'prefeituraferrazdevasconcelos';
  /** Base URL for the Ferraz de Vasconcelos diário oficial page */
  baseUrl: string;
}

/**
 * Spider for Prefeitura de Ferraz de Vasconcelos
 * 
 * The website uses WordPress with Elementor and JetEngine plugins.
 * Each gazette edition is displayed in a jet-listing-dynamic-field element
 * with a direct link to the PDF.
 */
export class PrefeituraFerrazDeVasconcelosSpider extends BaseSpider {
  private ferrazConfig: PrefeituraFerrazDeVasconcelosConfig;
  private browser?: Fetcher;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.ferrazConfig = spiderConfig.config as PrefeituraFerrazDeVasconcelosConfig;
    this.browser = browser;
  }

  public setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  public requiresBrowser(): boolean {
    return true;
  }

  async crawl(): Promise<Gazette[]> {
    const allGazettes: Gazette[] = [];
    const baseUrl = this.ferrazConfig.baseUrl || 'https://ferrazdevasconcelos.sp.gov.br/web/home/boletins-oficiais/';
    
    logger.info(`[${this.spiderConfig.id}] Starting crawl for Ferraz de Vasconcelos`, {
      baseUrl,
      dateRange: this.dateRange
    });

    try {
      if (this.browser) {
        const gazettes = await this.crawlWithBrowser(baseUrl);
        allGazettes.push(...gazettes);
      } else {
        const gazettes = await this.crawlWithFetch(baseUrl);
        allGazettes.push(...gazettes);
      }
    } catch (error) {
      logger.error(`[${this.spiderConfig.id}] Error crawling`, { error: error as Error });
    }

    // Filter by date range and remove duplicates
    const filteredGazettes = this.filterByDateRange(allGazettes);
    const uniqueGazettes = this.removeDuplicates(filteredGazettes);

    logger.info(`[${this.spiderConfig.id}] Crawl complete`, {
      total: allGazettes.length,
      afterDateFilter: filteredGazettes.length,
      afterDedup: uniqueGazettes.length
    });

    return uniqueGazettes;
  }

  private async crawlWithBrowser(baseUrl: string): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    if (!this.browser) {
      logger.warn(`[${this.spiderConfig.id}] Browser not available, falling back to fetch`);
      return this.crawlWithFetch(baseUrl);
    }

    let browserInstance = null;
    let page = null;

    try {
      // Launch Puppeteer with Cloudflare Browser Rendering
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      
      logger.debug(`[${this.spiderConfig.id}] Navigating to: ${baseUrl}`);
      await page.goto(baseUrl, { waitUntil: 'networkidle0', timeout: 60000 });

      // Wait for dynamic content to load
      await page.waitForSelector('.jet-listing-dynamic-field__content', { timeout: 15000 }).catch(() => {
        logger.warn(`[${this.spiderConfig.id}] Timeout waiting for dynamic content`);
      });

      // Extract gazette data from the page
      const pageGazettes = await page.evaluate(() => {
        const items: { pdfUrl: string; editionText: string }[] = [];
        
        // Find all jet-listing dynamic field content elements
        const contentElements = document.querySelectorAll('.jet-listing-dynamic-field__content');
        
        for (const contentEl of Array.from(contentElements)) {
          const anchor = contentEl.querySelector('a');
          if (!anchor) continue;
          
          const href = anchor.getAttribute('href');
          const text = anchor.textContent?.trim() || '';
          
          // Only process PDF links
          if (href && href.includes('.pdf')) {
            items.push({
              pdfUrl: href,
              editionText: text
            });
          }
        }
        
        return items;
      });

      logger.debug(`[${this.spiderConfig.id}] Found ${pageGazettes.length} gazette links on page`);

      // Process extracted items
      for (const item of pageGazettes) {
        const gazette = this.parseGazetteFromItem(item.pdfUrl, item.editionText);
        if (gazette) {
          gazettes.push(gazette);
        }
      }
    } catch (error) {
      logger.error(`[${this.spiderConfig.id}] Browser crawl error`, { error: error as Error });
    } finally {
      // Clean up browser resources
      if (page) {
        try {
          await page.close();
        } catch (e) {
          logger.warn(`[${this.spiderConfig.id}] Error closing page: ${(e as Error).message}`);
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (e) {
          logger.warn(`[${this.spiderConfig.id}] Error closing browser: ${(e as Error).message}`);
        }
      }
    }

    return gazettes;
  }

  private async crawlWithFetch(baseUrl: string): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      const response = await fetch(baseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
        }
      });

      if (!response.ok) {
        logger.warn(`[${this.spiderConfig.id}] HTTP error: ${response.status}`);
        return gazettes;
      }

      const html = await response.text();
      const root = parse(html);

      // Find all jet-listing dynamic field content elements
      const contentElements = root.querySelectorAll('.jet-listing-dynamic-field__content');
      
      logger.debug(`[${this.spiderConfig.id}] Found ${contentElements.length} jet-listing content elements`);

      for (const contentEl of contentElements) {
        const anchor = contentEl.querySelector('a');
        if (!anchor) continue;
        
        const href = anchor.getAttribute('href');
        const text = anchor.textContent?.trim() || '';
        
        // Only process PDF links
        if (href && href.includes('.pdf')) {
          const gazette = this.parseGazetteFromItem(href, text);
          if (gazette) {
            gazettes.push(gazette);
          }
        }
      }
    } catch (error) {
      logger.error(`[${this.spiderConfig.id}] Fetch crawl error`, { error: error as Error });
    }

    return gazettes;
  }

  private parseGazetteFromItem(pdfUrl: string, editionText: string): Gazette | null {
    try {
      // Fix malformed URLs with duplicate "web/web/"
      let fixedUrl = pdfUrl;
      if (pdfUrl.includes('/web/web/')) {
        fixedUrl = pdfUrl.replace('/web/web/', '/web/');
        logger.debug(`[${this.spiderConfig.id}] Fixed malformed URL: ${pdfUrl} -> ${fixedUrl}`);
      }

      // Extract date from URL path (format: /YYYY/MM/)
      const dateMatch = fixedUrl.match(/\/(\d{4})\/(\d{2})\//);
      let date: string;
      
      if (dateMatch) {
        const year = dateMatch[1];
        const month = dateMatch[2];
        // Use first day of the month as the date (we don't have the exact day)
        date = `${year}-${month}-01`;
      } else {
        // If we can't extract date from URL, skip this gazette
        logger.warn(`[${this.spiderConfig.id}] Could not extract date from URL: ${fixedUrl}`);
        return null;
      }

      // Extract edition number from text (e.g., "Edição Digital Nº 1185")
      const editionMatch = editionText.match(/N[º°]?\s*(\d+)/i);
      const editionNumber = editionMatch ? editionMatch[1] : '';

      // Build gazette object
      const gazette: Gazette = {
        date,
        editionNumber: editionNumber || undefined,
        fileUrl: fixedUrl,
        isExtraEdition: false,
        power: 'executive' as const,
        territoryId: this.spiderConfig.territoryId,
        scrapedAt: new Date().toISOString()
      };

      logger.debug(`[${this.spiderConfig.id}] Parsed gazette`, { 
        date, 
        editionNumber, 
        fileUrl: fixedUrl 
      });

      return gazette;
    } catch (error) {
      logger.error(`[${this.spiderConfig.id}] Error parsing gazette`, { 
        pdfUrl, 
        editionText, 
        error: error as Error 
      });
      return null;
    }
  }

  private filterByDateRange(gazettes: Gazette[]): Gazette[] {
    const startDate = new Date(this.dateRange.start);
    const endDate = new Date(this.dateRange.end);
    
    // Set end of day for end date
    endDate.setHours(23, 59, 59, 999);

    return gazettes.filter(gazette => {
      const gazetteDate = new Date(gazette.date);
      return gazetteDate >= startDate && gazetteDate <= endDate;
    });
  }

  private removeDuplicates(gazettes: Gazette[]): Gazette[] {
    const seen = new Set<string>();
    return gazettes.filter(gazette => {
      const key = `${gazette.date}-${gazette.fileUrl}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
}

