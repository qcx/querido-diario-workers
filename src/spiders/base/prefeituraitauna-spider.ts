import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraItaunaConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * PrefeituraItaunaSpider implementation
 * 
 * Crawls Itaúna's Diário Oficial from the official website
 * which requires JavaScript rendering to load content.
 * 
 * Site structure:
 * - Base URL: https://www.itauna.mg.gov.br/portal/diario-oficial
 * - HTML page with JavaScript-rendered content
 * - Diário Oficial listings with edition numbers, dates, and PDF download links
 * - Structure: "Edição nº XXXX" with "Baixar" button and "Postagem: DD/MM/YYYY"
 * 
 * The spider:
 * 1. Navigates to diário oficial page
 * 2. Waits for JavaScript to load content
 * 3. Extracts gazettes from the loaded content
 * 4. Filters gazettes to match the requested date range
 */
export class PrefeituraItaunaSpider extends BaseSpider {
  protected itaunaConfig: PrefeituraItaunaConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.itaunaConfig = spiderConfig.config as PrefeituraItaunaConfig;
    this.browser = browser || null;
    
    if (!this.itaunaConfig.baseUrl) {
      throw new Error(`PrefeituraItaunaSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraItaunaSpider for ${spiderConfig.name}`, {
      hasBrowser: !!this.browser,
    });
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  /**
   * Parse date from various formats:
   * - "Postagem: DD/MM/YYYY"
   * - "DD/MM/YYYY"
   */
  private parseDate(dateText: string): Date | null {
    // Try "Postagem: DD/MM/YYYY" format
    const postagemMatch = dateText.match(/Postagem:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    if (postagemMatch) {
      const [, day, month, year] = postagemMatch;
      return new Date(`${year}-${month}-${day}`);
    }

    // Try DD/MM/YYYY format
    const slashMatch = dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (slashMatch) {
      const [, day, month, year] = slashMatch;
      return new Date(`${year}-${month}-${day}`);
    }

    return null;
  }

  /**
   * Extract edition number from text
   */
  private extractEditionNumber(text: string): string | undefined {
    // Try pattern: "Edição nº XXXX" or "Edição extra Edição nº XXXX"
    const edicaoMatch = text.match(/Edi[çc][ãa]o\s+(?:extra\s+)?[Nn]?[°º]?\s*(\d+)/i);
    if (edicaoMatch) {
      return edicaoMatch[1];
    }

    return undefined;
  }

  /**
   * Check if edition is extra
   */
  private isExtraEdition(text: string): boolean {
    return /Edi[çc][ãa]o\s+extra/i.test(text);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.itaunaConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error('PrefeituraItaunaSpider requires browser rendering');
    }
    
    return this.crawlWithBrowser();
  }

  /**
   * Browser-based crawling for Itaúna diário oficial page
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Navigate to diário oficial page
      logger.debug(`Navigating to: ${this.itaunaConfig.baseUrl}`);
      await page.goto(this.itaunaConfig.baseUrl, { waitUntil: 'networkidle0', timeout: 45000 });
      this.requestCount++;
      
      // Wait for JavaScript to load content
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Wait for content to load - look for edition listings
      try {
        await page.waitForSelector('a, article, .list-item, .gazette, table, [class*="edicao"], [class*="edição"]', { timeout: 15000 });
      } catch (error) {
        logger.warn('Content selectors not found, continuing anyway', error as Error);
      }

      // Additional wait for dynamic content
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Extract gazettes from the page
      const pageGazettes = await this.extractGazettesFromPage(page);
      
      // Filter by date range
      for (const gazette of pageGazettes) {
        if (gazette && this.isInDateRange(new Date(gazette.date))) {
          gazettes.push(gazette);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
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
   * Extract gazettes from the current page
   */
  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const processedUrls = new Set<string>();

    try {
      // Extract gazette data from the page
      // Structure: Edition blocks with "Edição nº XXXX", "Baixar" button, and "Postagem: DD/MM/YYYY"
      const gazetteData = await page.evaluate(() => {
        const data: Array<{
          editionNumber?: string;
          dateText: string;
          pdfUrl: string;
          isExtra: boolean;
          fullText: string;
        }> = [];
        
        // Find all elements that might contain gazette information
        // Look for patterns like "Edição nº XXXX" followed by "Baixar" button and date
        const allElements = document.querySelectorAll('article, .entry, .post, [class*="edicao"], [class*="edição"], div, section');
        
        for (const element of Array.from(allElements)) {
          const text = element.textContent || '';
          
          // Check if this element contains edition information
          if (!text.includes('Edição') && !text.includes('edição')) {
            continue;
          }
          
          // Extract edition number
          const editionMatch = text.match(/Edi[çc][ãa]o\s+(?:extra\s+)?[Nn]?[°º]?\s*(\d+)/i);
          if (!editionMatch) {
            continue;
          }
          
          const editionNumber = editionMatch[1];
          const isExtra = /Edi[çc][ãa]o\s+extra/i.test(text);
          
          // Extract date from "Postagem: DD/MM/YYYY"
          const dateMatch = text.match(/Postagem:\s*(\d{2}\/\d{2}\/\d{4})/i);
          if (!dateMatch) {
            continue;
          }
          
          const dateText = dateMatch[1];
          
          // Find PDF link - look for "Baixar" button/link
          let pdfUrl = '';
          const links = element.querySelectorAll('a');
          for (const link of links) {
            const linkText = link.textContent?.toLowerCase() || '';
            const href = (link as HTMLAnchorElement).href || '';
            
            if (linkText.includes('baixar') || linkText.includes('download') || href.includes('.pdf')) {
              pdfUrl = href;
              break;
            }
          }
          
          // If no direct link found, look for any PDF link in the element
          if (!pdfUrl) {
            const pdfLinks = element.querySelectorAll('a[href*=".pdf"]');
            if (pdfLinks.length > 0) {
              pdfUrl = (pdfLinks[0] as HTMLAnchorElement).href;
            }
          }
          
          if (pdfUrl && dateText) {
            data.push({
              editionNumber,
              dateText,
              pdfUrl,
              isExtra,
              fullText: text.substring(0, 500)
            });
          }
        }
        
        return data;
      });

      logger.debug(`Found ${gazetteData.length} gazette entries on page`);
      
      for (const item of gazetteData) {
        try {
          // Make URL absolute if needed
          let pdfUrl = item.pdfUrl;
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.itaunaConfig.baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }

          // Skip if already processed
          if (processedUrls.has(pdfUrl)) {
            continue;
          }

          // Parse date
          const gazetteDate = this.parseDate(item.dateText);

          if (!gazetteDate || isNaN(gazetteDate.getTime())) {
            logger.debug(`Could not parse date from: ${item.dateText}`);
            continue;
          }

          // Mark URL as processed
          processedUrls.add(pdfUrl);

          // Create the gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber: item.editionNumber,
            isExtraEdition: item.isExtra,
            power: 'executive',
            sourceText: item.fullText,
          });

          if (gazette) {
            gazettes.push(gazette);
            logger.debug(`Added gazette: Edição ${item.editionNumber} - ${toISODate(gazetteDate)}`);
          }

        } catch (error) {
          logger.error(`Error processing gazette item:`, error as Error);
        }
      }

    } catch (error) {
      logger.error(`Error extracting gazettes from page:`, error as Error);
    }

    return gazettes;
  }
}

