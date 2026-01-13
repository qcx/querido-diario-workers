import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeiturauberabaConfig } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for Prefeitura de Uberaba - MG - Jornal Porta-Voz (Diário Oficial)
 * 
 * Site Structure:
 * - Base URL: http://www.uberaba.mg.gov.br/portal/conteudo,112
 * - The page contains links to yearly folders with PDFs
 * - PDFs are organized in year/month folders
 * - File names typically include edition numbers
 * 
 * Uberaba does NOT publish in AMM-MG. The municipality has its own 
 * official gazette called "Porta-Voz" published daily since July 2023.
 * 
 * Site uses JavaScript for dynamic content loading (Getz Framework).
 * Requires browser rendering.
 */
export class PrefeiturauberabaSpider extends BaseSpider {
  protected uberabaConfig: PrefeiturauberabaConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.uberabaConfig = spiderConfig.config as PrefeiturauberabaConfig;
    this.browser = browser || null;
    
    if (!this.uberabaConfig.baseUrl) {
      throw new Error(`PrefeiturauberabaSpider requires a baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeiturauberabaSpider for ${spiderConfig.name} with URL: ${this.uberabaConfig.baseUrl}`, {
      hasBrowser: !!this.browser,
    });
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.uberabaConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error('PrefeiturauberabaSpider requires browser rendering');
    }
    
    return this.crawlWithBrowser();
  }

  /**
   * Browser-based crawling for Uberaba Porta-Voz
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Set user agent
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      // Navigate to the diário oficial page
      logger.debug(`Navigating to: ${this.uberabaConfig.baseUrl}`);
      await page.goto(this.uberabaConfig.baseUrl, { waitUntil: 'networkidle0', timeout: 60000 });
      this.requestCount++;
      
      // Wait for page to stabilize
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Accept cookies if prompted
      try {
        const cookieButton = await page.$('button:has-text("Aceitar")');
        if (cookieButton) {
          await cookieButton.click();
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (e) {
        // Cookie button not found or already accepted
      }
      
      // Get year folders to navigate - we want to crawl years in the date range
      const startYear = this.startDate.getFullYear();
      const endYear = this.endDate.getFullYear();
      
      for (let year = endYear; year >= startYear; year--) {
        logger.debug(`Crawling year: ${year}`);
        
        try {
          // Navigate to year folder
          const yearUrl = `${this.uberabaConfig.baseUrl}/${year}`;
          await page.goto(yearUrl, { waitUntil: 'networkidle0', timeout: 45000 });
          this.requestCount++;
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Extract PDF links from this year
          const yearGazettes = await this.extractGazettesFromPage(page, year);
          
          for (const gazette of yearGazettes) {
            if (gazette && this.isInDateRange(new Date(gazette.date))) {
              gazettes.push(gazette);
            }
          }
          
          logger.debug(`Found ${yearGazettes.length} gazettes in ${year}`);
        } catch (error) {
          logger.warn(`Error crawling year ${year}:`, { error: error instanceof Error ? error.message : String(error) });
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from browser`);
      
    } catch (error) {
      logger.error(`Error crawling with browser:`, error as Error);
      throw error;
    } finally {
      // Clean up
      if (page) {
        try {
          await page.close();
        } catch (e) {
          logger.warn('Error closing page', { error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (e) {
          logger.warn('Error closing browser', { error: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    return gazettes;
  }

  /**
   * Extract gazettes from the current browser page
   */
  private async extractGazettesFromPage(page: any, year: number): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Wait for content to load (the site uses JavaScript heavily)
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Accept cookies if there's a dialog
      try {
        const cookieButton = await page.$('button[id*="cookie"], button:has-text("Aceitar"), button:has-text("OK")');
        if (cookieButton) {
          await cookieButton.click();
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (e) {
        // Ignore cookie dialog errors
      }
      
      // Extract PDF links from the page
      // The page typically shows a list of PDFs with their names containing dates
      const pdfData = await page.evaluate(() => {
        const data: any[] = [];
        
        // Strategy 1: Look for PDF links directly
        const pdfLinks = document.querySelectorAll('a[href*=".pdf"]');
        for (const link of Array.from(pdfLinks)) {
          const href = link.getAttribute('href');
          const text = link.textContent?.trim() || '';
          if (href) {
            data.push({ url: href, text: text });
          }
        }
        
        // Strategy 2: Look for any links with "portavoz" or file-related paths
        if (data.length === 0) {
          const allLinks = document.querySelectorAll('a[href*="arquivo"], a[href*="portavoz"], a[href*="download"]');
          for (const link of Array.from(allLinks)) {
            const href = link.getAttribute('href');
            const text = link.textContent?.trim() || '';
            if (href && (href.includes('.pdf') || href.includes('download') || href.includes('arquivo'))) {
              data.push({ url: href, text: text });
            }
          }
        }
        
        // Strategy 3: Look for any clickable elements that might be file links
        if (data.length === 0) {
          const fileElements = document.querySelectorAll('[data-file], [data-pdf], .file-link, .arquivo');
          for (const el of Array.from(fileElements)) {
            const href = el.getAttribute('href') || el.getAttribute('data-file') || el.getAttribute('data-pdf');
            const text = el.textContent?.trim() || '';
            if (href) {
              data.push({ url: href, text: text });
            }
          }
        }
        
        return data;
      });
      
      logger.debug(`Found ${pdfData.length} PDF links on page for year ${year}`);
      
      // Process each PDF link
      for (const item of pdfData) {
        try {
          // Extract date from filename or text
          // Common patterns:
          // - portavoz_YYYY_MM_DD.pdf
          // - YYYYMMDD.pdf
          // - DD-MM-YYYY.pdf
          // - Edition_XXXX_YYYY-MM-DD.pdf
          const dateInfo = this.extractDateFromFilename(item.url, item.text, year);
          
          if (!dateInfo) {
            logger.debug(`Could not extract date from: ${item.url}`);
            continue;
          }
          
          // Construct full PDF URL if relative
          let pdfUrl = item.url;
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.uberabaConfig.baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }
          
          // Create gazette
          const gazette = await this.createGazette(dateInfo.date, pdfUrl, {
            editionNumber: dateInfo.editionNumber || undefined,
            isExtraEdition: dateInfo.isExtra,
            power: 'executive_legislative',
            sourceText: item.text || `Porta-Voz ${dateInfo.editionNumber ? `Ed. ${dateInfo.editionNumber}` : ''} - ${dateInfo.date.toISOString().split('T')[0]}`,
          });
          
          if (gazette) {
            gazettes.push(gazette);
          }
          
        } catch (error) {
          logger.error(`Error processing PDF item:`, error as Error);
        }
      }
      
    } catch (error) {
      logger.error(`Error extracting gazettes from page:`, error as Error);
    }
    
    return gazettes;
  }

  /**
   * Extract date and edition info from filename or text
   */
  private extractDateFromFilename(url: string, text: string, _defaultYear: number): { date: Date; editionNumber?: string; isExtra: boolean } | null {
    const combined = `${url} ${text}`;
    
    // Pattern 1: YYYY-MM-DD or YYYY_MM_DD
    const pattern1 = combined.match(/(\d{4})[-_](\d{2})[-_](\d{2})/);
    if (pattern1) {
      const [, year, month, day] = pattern1;
      const date = new Date(`${year}-${month}-${day}`);
      if (!isNaN(date.getTime())) {
        const editionMatch = combined.match(/[eE]di[çc][aã]o?\s*[nN]?[°º]?\s*(\d+)/);
        return {
          date,
          editionNumber: editionMatch ? editionMatch[1] : undefined,
          isExtra: /extra|suplemento/i.test(combined),
        };
      }
    }
    
    // Pattern 2: DD-MM-YYYY or DD_MM_YYYY
    const pattern2 = combined.match(/(\d{2})[-_](\d{2})[-_](\d{4})/);
    if (pattern2) {
      const [, day, month, year] = pattern2;
      const date = new Date(`${year}-${month}-${day}`);
      if (!isNaN(date.getTime())) {
        const editionMatch = combined.match(/[eE]di[çc][aã]o?\s*[nN]?[°º]?\s*(\d+)/);
        return {
          date,
          editionNumber: editionMatch ? editionMatch[1] : undefined,
          isExtra: /extra|suplemento/i.test(combined),
        };
      }
    }
    
    // Pattern 3: DDMMYYYY or YYYYMMDD (8 consecutive digits)
    const pattern3 = combined.match(/(\d{8})/);
    if (pattern3) {
      const digits = pattern3[1];
      // Try YYYYMMDD first
      let date = new Date(`${digits.substring(0, 4)}-${digits.substring(4, 6)}-${digits.substring(6, 8)}`);
      if (isNaN(date.getTime())) {
        // Try DDMMYYYY
        date = new Date(`${digits.substring(4, 8)}-${digits.substring(2, 4)}-${digits.substring(0, 2)}`);
      }
      if (!isNaN(date.getTime())) {
        const editionMatch = combined.match(/[eE]di[çc][aã]o?\s*[nN]?[°º]?\s*(\d+)/);
        return {
          date,
          editionNumber: editionMatch ? editionMatch[1] : undefined,
          isExtra: /extra|suplemento/i.test(combined),
        };
      }
    }
    
    // Pattern 4: Portuguese date format - DD de Mês de YYYY
    const months: Record<string, string> = {
      'janeiro': '01', 'fevereiro': '02', 'março': '03', 'marco': '03',
      'abril': '04', 'maio': '05', 'junho': '06',
      'julho': '07', 'agosto': '08', 'setembro': '09',
      'outubro': '10', 'novembro': '11', 'dezembro': '12'
    };
    
    const pattern4 = combined.match(/(\d{1,2})\s*de\s*(\w+)\s*de\s*(\d{4})/i);
    if (pattern4) {
      const [, day, monthName, year] = pattern4;
      const monthNum = months[monthName.toLowerCase()];
      if (monthNum) {
        const date = new Date(`${year}-${monthNum}-${day.padStart(2, '0')}`);
        if (!isNaN(date.getTime())) {
          const editionMatch = combined.match(/[eE]di[çc][aã]o?\s*[nN]?[°º]?\s*(\d+)/);
          return {
            date,
            editionNumber: editionMatch ? editionMatch[1] : undefined,
            isExtra: /extra|suplemento/i.test(combined),
          };
        }
      }
    }
    
    return null;
  }
}

