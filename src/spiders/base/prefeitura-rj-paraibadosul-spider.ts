import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Configuration interface for Paraíba do Sul spider
 */
interface PrefeituraRjParaibaDoSulConfig {
  type: 'prefeiturarjparaibadosulv2';
  baseUrl: string;
  googleDriveFolderId?: string;
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
 * Spider for Paraíba do Sul - RJ
 * 
 * This city hosts their gazette PDFs on a Google Drive folder.
 * The folder URL is: https://drive.google.com/drive/folders/1qF6YNZLr9SL_fFcsWdhCku7gEp2IJOvr
 * 
 * The folder structure is:
 * - Root folder (Diário Oficial)
 *   - Year subfolders (2017, 2018, ..., 2025, 2026)
 *     - PDF files with names like "Diário Oficial - DD de Mês de YYYY - Edição XXXX.pdf"
 * 
 * We use Puppeteer to navigate to the folder, identify year subfolders,
 * navigate into them, and extract file information.
 */
export class PrefeituraRjParaibaDoSulV2Spider extends BaseSpider {
  protected config: PrefeituraRjParaibaDoSulConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeituraRjParaibaDoSulConfig;
    this.browser = browser || null;
    
    if (!this.config.baseUrl) {
      throw new Error(`PrefeituraRjParaibaDoSulV2Spider requires baseUrl in config`);
    }
    
    logger.info(`Initializing PrefeituraRjParaibaDoSulV2Spider for ${spiderConfig.name}`);
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
      throw new Error(`PrefeituraRjParaibaDoSulV2Spider requires browser binding`);
    }
    
    return this.crawlPrefeituraPage();
  }

  /**
   * Crawl the prefeitura page to extract gazette links
   */
  private async crawlPrefeituraPage(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Set viewport
      await page.setViewport({ width: 1280, height: 800 });
      
      // Navigate to the prefeitura page
      logger.debug(`Navigating to prefeitura page: ${this.config.baseUrl}`);
      await page.goto(this.config.baseUrl, { waitUntil: 'networkidle0', timeout: 60000 });
      this.requestCount++;
      
      // Wait for page to stabilize - Next.js apps need more time to render
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      // Wait for the gazette content to appear
      try {
        await page.waitForFunction(
          () => document.body.innerText.includes('Diário Oficial'),
          { timeout: 15000 }
        );
        logger.debug('Found "Diário Oficial" content on page');
      } catch (e) {
        logger.debug('Timeout waiting for "Diário Oficial" content');
        
        // Try scrolling to trigger lazy loading
        await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      // Extract gazette links from the page
      const gazetteLinks = await this.extractGazetteLinksFromPrefeitura(page);
      logger.info(`Found ${gazetteLinks.length} gazette links on prefeitura page`);
      
      // Process each gazette link
      for (const linkInfo of gazetteLinks) {
        try {
          const gazetteDate = this.parsePortugueseDate(linkInfo.date);
          
          if (!gazetteDate || isNaN(gazetteDate.getTime())) {
            logger.debug(`Invalid date: ${linkInfo.date}`);
            continue;
          }
          
          // Filter by date range
          if (!this.isInDateRange(gazetteDate)) {
            logger.debug(`Date ${toISODate(gazetteDate)} out of range, skipping`);
            continue;
          }
          
          // Click on the link to get the Google Drive URL
          const googleDriveUrl = await this.clickLinkAndGetGoogleDriveUrl(browserInstance, page, linkInfo.linkIndex);
          
          if (!googleDriveUrl) {
            logger.warn(`Could not get Google Drive URL for ${linkInfo.text}`);
            continue;
          }
          
          // Convert Google Drive URL to direct download URL
          const pdfUrl = this.convertGoogleDriveUrl(googleDriveUrl);
          if (!pdfUrl) {
            logger.warn(`Could not convert Google Drive URL: ${googleDriveUrl}`);
            continue;
          }
          
          // Create gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            power: 'executive_legislative',
            isExtraEdition: linkInfo.isExtra,
          });
          
          if (gazette) {
            gazettes.push(gazette);
            logger.info(`Found gazette for ${toISODate(gazetteDate)}: ${pdfUrl}`);
          }
        } catch (error) {
          logger.error(`Error processing gazette link:`, error as Error);
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
   * Extract gazette links from the prefeitura page
   */
  private async extractGazetteLinksFromPrefeitura(page: any): Promise<Array<{
    text: string;
    date: string;
    linkIndex: number;
    isExtra: boolean;
  }>> {
    // Log the page content for debugging
    const pageContent = await page.content();
    logger.debug(`Page content length: ${pageContent.length}`);
    
    // Log a snippet of the page content for debugging
    const snippet = pageContent.substring(0, 2000);
    logger.debug(`Page content snippet: ${snippet}`);
    
    // Check if the page has the expected content
    const hasContent = pageContent.includes('Diário Oficial');
    logger.debug(`Page has 'Diário Oficial' content: ${hasContent}`);
    
    // Also check for common Next.js loading indicators
    const hasNextData = pageContent.includes('__NEXT_DATA__');
    logger.debug(`Page has __NEXT_DATA__: ${hasNextData}`);
    
    return page.evaluate(() => {
      const results: Array<{
        text: string;
        date: string;
        linkIndex: number;
        isExtra: boolean;
      }> = [];
      
      // Log all link texts for debugging
      const allLinks = document.querySelectorAll('a');
      console.log(`Total links found: ${allLinks.length}`);
      
      let linkIndex = 0;
      
      for (const link of allLinks) {
        const text = link.textContent?.trim() || '';
        
        // Log links that contain "diário" for debugging
        if (text.toLowerCase().includes('diário')) {
          console.log(`Found link with 'diário': ${text}`);
        }
        
        // Check if this is a "Diário Oficial Dia X" link
        // The text format is "Diário Oficial Dia 21 de Janeiro de 2026"
        if (!text.toLowerCase().includes('diário oficial dia')) {
          linkIndex++;
          continue;
        }
        
        // Extract date from text like "Diário Oficial Dia 21 de Janeiro de 2026"
        const dateMatch = text.match(/dia\s+(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
        if (!dateMatch) {
          linkIndex++;
          continue;
        }
        
        const date = `${dateMatch[1]} de ${dateMatch[2]} de ${dateMatch[3]}`;
        
        results.push({
          text,
          date,
          linkIndex,
          isExtra: text.toLowerCase().includes('extra') || text.toLowerCase().includes('suplemento'),
        });
        
        linkIndex++;
      }
      
      return results;
    });
  }

  /**
   * Click on a gazette link and capture the Google Drive URL from the new tab
   */
  private async clickLinkAndGetGoogleDriveUrl(browserInstance: any, page: any, linkIndex: number): Promise<string | null> {
    try {
      // Get the number of pages before clicking
      const pagesBefore = await browserInstance.pages();
      const pagesCountBefore = pagesBefore.length;
      
      // Click on the link
      await page.evaluate((idx: number) => {
        const links = document.querySelectorAll('a');
        if (links[idx]) {
          (links[idx] as HTMLElement).click();
        }
      }, linkIndex);
      
      // Wait for new tab to open
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Get all pages after clicking
      const pagesAfter = await browserInstance.pages();
      
      // Find the new page
      if (pagesAfter.length > pagesCountBefore) {
        const newPage = pagesAfter[pagesAfter.length - 1];
        
        // Wait for the page to load
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const url = newPage.url();
        
        // Close the new tab
        try {
          await newPage.close();
        } catch (e) {
          // Ignore close errors
        }
        
        // Check if it's a Google Drive URL
        if (url.includes('drive.google.com') || url.includes('docs.google.com')) {
          return url;
        }
      }
      
      return null;
    } catch (error) {
      logger.debug(`Error clicking link: ${error}`);
      return null;
    }
  }

  /**
   * Convert Google Drive view URL to direct download URL
   * 
   * Input formats:
   * - https://drive.google.com/file/d/FILE_ID/view?usp=drive_link
   * - https://drive.google.com/file/d/FILE_ID/view
   * - https://drive.google.com/open?id=FILE_ID
   * 
   * Output:
   * - https://drive.google.com/uc?export=download&id=FILE_ID
   */
  private convertGoogleDriveUrl(url: string): string | null {
    if (!url) return null;
    
    // Extract file ID from various Google Drive URL formats
    let fileId: string | null = null;
    
    // Format: /file/d/FILE_ID/
    const fileMatch = url.match(/\/file\/d\/([^\/\?]+)/);
    if (fileMatch) {
      fileId = fileMatch[1];
    }
    
    // Format: ?id=FILE_ID or &id=FILE_ID
    if (!fileId) {
      const idMatch = url.match(/[?&]id=([^&]+)/);
      if (idMatch) {
        fileId = idMatch[1];
      }
    }
    
    if (!fileId) {
      logger.warn(`Could not extract file ID from Google Drive URL: ${url}`);
      return null;
    }
    
    // Return direct download URL
    return `https://drive.google.com/uc?export=download&id=${fileId}`;
  }

  /**
   * Parse a Portuguese date string like "21 de Janeiro de 2026"
   */
  private parsePortugueseDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    
    // Try "DD de Mês de YYYY"
    const ptMatch = dateStr.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
    if (ptMatch) {
      const [, day, monthName, year] = ptMatch;
      const month = MONTH_NAMES[monthName.toLowerCase()];
      if (month) {
        return new Date(`${year}-${month.toString().padStart(2, '0')}-${day.padStart(2, '0')}`);
      }
    }
    
    // Try DD/MM/YYYY
    const slashMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (slashMatch) {
      const [, day, month, year] = slashMatch;
      return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    }
    
    return null;
  }
}
