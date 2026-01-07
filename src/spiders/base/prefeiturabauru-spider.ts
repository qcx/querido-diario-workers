import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraBauruConfig } from '../../types';
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
 * PrefeituraBauruSpider implementation
 * 
 * Crawls Bauru's official gazette website.
 * 
 * Site structure:
 * - Page URL: https://www2.bauru.sp.gov.br/juridico/diariooficial.aspx
 * - PDF URL: https://www2.bauru.sp.gov.br/arquivos/sist_diariooficial/{YYYY}/{MM}/do_{YYYYMMDD}_{EDITION}.pdf
 * 
 * The page is server-rendered with accordion menus showing years and months.
 * The HTML contains all gazette links organized by year/month.
 * 
 * This spider:
 * 1. Fetches the main page HTML using browser (Puppeteer) when available
 * 2. Parses all gazette links from the accordion structure
 * 3. Filters by date range
 */
export class PrefeituraBauruSpider extends BaseSpider {
  protected bauruConfig: PrefeituraBauruConfig;
  private browser?: Fetcher;
  private static readonly BASE_URL = 'https://www2.bauru.sp.gov.br';

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.bauruConfig = spiderConfig.config as PrefeituraBauruConfig;
    
    if (!this.bauruConfig.baseUrl) {
      throw new Error(`PrefeituraBauruSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraBauruSpider for ${spiderConfig.name}`);
  }

  /**
   * Set the browser instance for web scraping
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.bauruConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Fetch the main page and parse all gazette links
      const allLinks = await this.fetchAndParseGazetteLinks();
      
      if (allLinks.length === 0) {
        logger.warn(`No gazette links found on page for ${this.spiderConfig.name}`);
        return gazettes;
      }
      
      logger.info(`Found ${allLinks.length} total gazette links, filtering by date range...`);
      
      // Filter by date range using string comparison (YYYY-MM-DD format)
      // This avoids timezone issues with Date objects
      const startDateStr = toISODate(this.startDate); // Convert to YYYY-MM-DD
      const endDateStr = toISODate(this.endDate);     // Convert to YYYY-MM-DD
      
      const filteredLinks = allLinks.filter(link => {
        const linkDateStr = toISODate(link.date); // Convert to YYYY-MM-DD
        return linkDateStr >= startDateStr && linkDateStr <= endDateStr;
      });
      
      logger.info(`${filteredLinks.length} gazettes match the date range`, {
        startDate: startDateStr,
        endDate: endDateStr,
      });
      
      // Create gazette objects for each link
      // Note: We create gazettes directly without URL resolution since Bauru URLs are direct PDF links
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
            sourceText: `Diário Oficial de Bauru - ${link.isSpecial ? `Especial ${link.edition}` : `Edição ${link.edition}`} - ${this.formatDateBrazilian(link.date)}`,
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
   * Fetch the main page and parse all gazette links from the HTML
   */
  private async fetchAndParseGazetteLinks(): Promise<GazetteLink[]> {
    const links: GazetteLink[] = [];
    
    try {
      let html: string;
      
      // Try to use browser (Puppeteer) first if available - needed for Cloudflare Workers environment
      if (this.browser) {
        html = await this.fetchWithBrowser();
      } else {
        // Fallback to direct fetch (works in production with outbound fetch enabled)
        const response = await fetch(this.bauruConfig.baseUrl, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
          },
        });
        
        if (!response.ok) {
          logger.error(`Failed to fetch page: ${response.status} ${response.statusText}`);
          return links;
        }
        
        html = await response.text();
      }
      
      // Parse all gazette links from the HTML
      // Pattern matches links like: href="/arquivos/sist_diariooficial/2025/12/do_20251230_4076.pdf"
      // Also matches special editions: href="/arquivos/sist_diariooficial/2025/12/especial_31.pdf"
      
      // Regular editions: do_YYYYMMDD_EDITION.pdf
      const regularPattern = /href=["']([^"']*\/arquivos\/sist_diariooficial\/(\d{4})\/(\d{2})\/do_(\d{8})_(\d+)\.pdf)["']/gi;
      let match;
      
      while ((match = regularPattern.exec(html)) !== null) {
        const [, fullPath, , , dateStr, edition] = match;
        
        // Parse the date from YYYYMMDD format - use UTC to avoid timezone issues
        const dateYear = parseInt(dateStr.substring(0, 4));
        const dateMonth = parseInt(dateStr.substring(4, 6)) - 1; // 0-indexed
        const dateDay = parseInt(dateStr.substring(6, 8));
        
        const date = new Date(Date.UTC(dateYear, dateMonth, dateDay));
        
        // Build absolute URL
        let pdfUrl = fullPath;
        if (pdfUrl.startsWith('/')) {
          pdfUrl = `${PrefeituraBauruSpider.BASE_URL}${pdfUrl}`;
        }
        
        links.push({
          date,
          pdfUrl,
          edition,
          isSpecial: false,
        });
      }
      
      // Special editions: especial_NUMBER.pdf or other variations
      // The page shows "Especial 31", "Especial 30", etc.
      // These also have dates in the link text like "30/12/2025 : Especial 31"
      
      // Parse special edition links using the text pattern
      // Look for patterns like: >DD/MM/YYYY : Especial N< ... href="...especial...pdf"
      const specialPattern = /(\d{2})\/(\d{2})\/(\d{4})\s*:\s*[EeÉé]\s*pecial\s*(\d+)[^<]*<[^>]*href=["']([^"']*\.pdf)["']/gi;
      
      while ((match = specialPattern.exec(html)) !== null) {
        const [, day, month, year, specialNum, pdfPath] = match;
        
        const date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));
        
        // Build absolute URL
        let pdfUrl = pdfPath;
        if (pdfUrl.startsWith('/')) {
          pdfUrl = `${PrefeituraBauruSpider.BASE_URL}${pdfUrl}`;
        }
        
        links.push({
          date,
          pdfUrl,
          edition: specialNum,
          isSpecial: true,
        });
      }
      
      // Also try alternative pattern for special editions where the link comes before the text
      // <a href="...pdf">DD/MM/YYYY : Especial N</a>
      const specialPattern2 = /href=["']([^"']*especial[^"']*\.pdf)["'][^>]*>\s*(\d{2})\/(\d{2})\/(\d{4})\s*:\s*[EeÉé]\s*pecial\s*(\d+)/gi;
      
      while ((match = specialPattern2.exec(html)) !== null) {
        const [, pdfPath, day, month, year, specialNum] = match;
        
        const date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));
        
        // Build absolute URL
        let pdfUrl = pdfPath;
        if (pdfUrl.startsWith('/')) {
          pdfUrl = `${PrefeituraBauruSpider.BASE_URL}${pdfUrl}`;
        }
        
        // Avoid duplicates
        const isDuplicate = links.some(l => l.pdfUrl === pdfUrl);
        if (!isDuplicate) {
          links.push({
            date,
            pdfUrl,
            edition: specialNum,
            isSpecial: true,
          });
        }
      }
      
      logger.debug(`Parsed ${links.length} gazette links from HTML`);
      
    } catch (error) {
      logger.error(`Error fetching/parsing gazette links: ${(error as Error).message}`);
    }
    
    return links;
  }

  /**
   * Fetch page HTML using Cloudflare Puppeteer browser
   */
  private async fetchWithBrowser(): Promise<string> {
    if (!this.browser) {
      throw new Error('Browser not available');
    }
    
    let browserInstance = null;
    let page = null;
    
    try {
      logger.info('Launching browser to fetch Bauru gazette page');
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      
      // Navigate to the page
      await page.goto(this.bauruConfig.baseUrl, {
        waitUntil: 'networkidle0',
        timeout: 30000,
      });
      
      // Get the full HTML
      const html = await page.content();
      
      logger.info('Successfully fetched page HTML with browser', {
        htmlLength: html.length,
      });
      
      return html;
    } catch (error) {
      logger.error('Failed to fetch page with browser', error as Error);
      throw error;
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
  }

  /**
   * Format date in Brazilian format: DD de MMMM de YYYY
   */
  private formatDateBrazilian(date: Date): string {
    const months = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    
    const day = date.getDate().toString().padStart(2, '0');
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    
    return `${day} de ${month} de ${year}`;
  }
}


