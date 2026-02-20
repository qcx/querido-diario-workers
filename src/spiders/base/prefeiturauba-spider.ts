import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraUbaConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * PrefeituraUbaSpider implementation
 * 
 * Crawls Ubá's Diário Oficial from the official website
 * which requires JavaScript rendering to load content.
 * 
 * Site structure:
 * - Base URL: https://www.uba.mg.gov.br/diario-eletronico
 * - Page has a "Calendário" section with cards for each gazette
 * - Each card contains:
 *   - Edition number: "N° XXXX / YYYY" (e.g., "N° 2845 / 2026")
 *   - Date: "DD/Mês/YYYY" format (e.g., "07/Janeiro/2026")
 *   - Button: "VISUALIZAR ARQUIVO" that links to the PDF
 * - Pagination is required to access all 3000+ records
 * 
 * The spider:
 * 1. Navigates to diário oficial page
 * 2. Waits for JavaScript to load content
 * 3. Extracts gazettes from cards in the "Calendário" section
 * 4. Handles pagination to load more records
 * 5. Filters gazettes to match the requested date range
 */
export class PrefeituraUbaSpider extends BaseSpider {
  protected ubaConfig: PrefeituraUbaConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.ubaConfig = spiderConfig.config as PrefeituraUbaConfig;
    this.browser = browser || null;
    
    if (!this.ubaConfig.baseUrl) {
      throw new Error(`PrefeituraUbaSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraUbaSpider for ${spiderConfig.name}`, {
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
   * Parse date from various formats
   * Supports both "DD/MM/YYYY" and "DD/Mês/YYYY" (e.g., "07/Janeiro/2026")
   */
  private parseDate(dateText: string): Date | null {
    // Try DD/MM/YYYY format first
    const slashMatch = dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (slashMatch) {
      const [, day, month, year] = slashMatch;
      return new Date(`${year}-${month}-${day}`);
    }

    // Try DD/Mês/YYYY format (Portuguese month names)
    const months: Record<string, string> = {
      'janeiro': '01', 'fevereiro': '02', 'março': '03', 'marco': '03',
      'abril': '04', 'maio': '05', 'junho': '06',
      'julho': '07', 'agosto': '08', 'setembro': '09',
      'outubro': '10', 'novembro': '11', 'dezembro': '12'
    };

    const monthMatch = dateText.match(/(\d{2})\/(\w+)\/(\d{4})/i);
    if (monthMatch) {
      const [, day, monthName, year] = monthMatch;
      const monthNum = months[monthName.toLowerCase()];
      if (monthNum) {
        return new Date(`${year}-${monthNum}-${day}`);
      }
    }

    return null;
  }

  /**
   * Extract edition number from text
   * Supports format: "N° XXXX / YYYY" (e.g., "N° 2845 / 2026")
   */
  private extractEditionNumber(text: string): string | undefined {
    // Try pattern: "N° XXXX / YYYY" or "Nº XXXX / YYYY"
    const edicaoMatch = text.match(/N[°º]\s*(\d+)\s*\/\s*\d{4}/i);
    if (edicaoMatch) {
      return edicaoMatch[1];
    }

    // Fallback: "Nº XXXX" or "Edição nº XXXX"
    const fallbackMatch = text.match(/(?:N[°º]|Edi[çc][ãa]o\s+n[°º]?)\s*(\d+)/i);
    if (fallbackMatch) {
      return fallbackMatch[1];
    }

    return undefined;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.ubaConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error('PrefeituraUbaSpider requires browser rendering');
    }
    
    return this.crawlWithBrowser();
  }

  /**
   * Browser-based crawling for Ubá diário oficial page
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
      logger.debug(`Navigating to: ${this.ubaConfig.baseUrl}`);
      await page.goto(this.ubaConfig.baseUrl, { waitUntil: 'networkidle0', timeout: 45000 });
      this.requestCount++;
      
      // Wait for JavaScript to load content
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Wait for content to load - look for buttons or cards
      try {
        await page.waitForSelector('button, [class*="card"], [class*="Calendário"]', { timeout: 15000 });
      } catch (error) {
        logger.warn('Content selectors not found, continuing anyway', error as Error);
      }

      // Additional wait for dynamic content
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Extract gazettes from all pages with pagination
      let hasMorePages = true;
      let currentPage = 1;
      const maxPages = 100; // Safety limit
      
      while (hasMorePages && currentPage <= maxPages) {
        logger.debug(`Extracting gazettes from page ${currentPage}`);
        
        // Extract gazettes from the current page
        const pageGazettes = await this.extractGazettesFromPage(page);
        
        if (pageGazettes.length === 0) {
          logger.info(`No gazettes found on page ${currentPage}, stopping pagination`);
          hasMorePages = false;
          continue;
        }
        
        // Filter by date range and add to collection
        let foundOlderThanRange = false;
        for (const gazette of pageGazettes) {
          if (gazette) {
            const gazetteDate = new Date(gazette.date);
            
            if (this.isInDateRange(gazetteDate)) {
              gazettes.push(gazette);
            }
            
            // Check if we've found gazettes older than our date range
            if (gazetteDate < new Date(this.dateRange.start)) {
              foundOlderThanRange = true;
            }
          }
        }
        
        logger.debug(`Found ${pageGazettes.length} gazettes on page ${currentPage}, ${gazettes.length} in date range`);
        
        // If we found gazettes older than the range, stop pagination
        if (foundOlderThanRange) {
          logger.debug('Found gazettes older than date range, stopping pagination');
          hasMorePages = false;
          continue;
        }
        
        // Check for pagination - scroll down and look for more content
        const hasMoreContent = await page.evaluate(() => {
          // Scroll to bottom to trigger lazy loading if any
          window.scrollTo(0, document.body.scrollHeight);
          
          // Look for pagination buttons or "carregar mais" buttons
          const paginationButtons = document.querySelectorAll('button, a');
          for (const btn of Array.from(paginationButtons)) {
            const text = btn.textContent?.toLowerCase() || '';
            if (text.includes('próximo') || text.includes('próxima') || text.includes('carregar mais') || text.includes('mais')) {
              return true;
            }
          }
          
          // Check if there are more cards visible after scrolling
          const cards = document.querySelectorAll('[class*="card"], [class*="Calendário"] > *');
          return cards.length > 0;
        });
        
        if (hasMoreContent) {
          // Try to click pagination button or scroll more
          const clicked = await page.evaluate(() => {
            const buttons = document.querySelectorAll('button, a');
            for (const btn of Array.from(buttons)) {
              const text = btn.textContent?.toLowerCase() || '';
              if (text.includes('próximo') || text.includes('próxima') || text.includes('carregar mais') || text.includes('mais')) {
                (btn as HTMLElement).click();
                return true;
              }
            }
            return false;
          });
          
          if (clicked) {
            logger.debug('Clicked pagination button');
            await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for content to load
            currentPage++;
          } else {
            // Try scrolling to load more (for infinite scroll)
            await page.evaluate(() => {
              window.scrollTo(0, document.body.scrollHeight);
            });
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Check if new content appeared
            const newContentCount = await page.evaluate(() => {
              // Count buttons with "VISUALIZAR ARQUIVO" text
              let count = 0;
              const buttons = document.querySelectorAll('button, a');
              for (const btn of Array.from(buttons)) {
                const text = btn.textContent?.trim() || '';
                if (text.includes('VISUALIZAR ARQUIVO') || text.includes('Visualizar')) {
                  count++;
                }
              }
              return count;
            });
            
            if (newContentCount > pageGazettes.length) {
              currentPage++;
            } else {
              hasMorePages = false;
            }
          }
        } else {
          hasMorePages = false;
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
   * Looks for cards in the "Calendário" section with "VISUALIZAR ARQUIVO" buttons
   */
  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const processedUrls = new Set<string>();

    try {
      // Extract gazette data from the page
      const gazetteData = await page.evaluate(() => {
        const data: Array<{
          editionNumber?: string;
          dateText: string;
          pdfUrl: string;
          fullText: string;
        }> = [];
        
        // Find all buttons with "VISUALIZAR ARQUIVO" text
        const allButtons = document.querySelectorAll('button, a');
        
        for (const button of Array.from(allButtons)) {
          const buttonText = button.textContent?.trim() || '';
          
          // Look for "VISUALIZAR ARQUIVO" button
          if (!buttonText.includes('VISUALIZAR ARQUIVO') && !buttonText.includes('Visualizar')) {
            continue;
          }
          
          // Get the href or onclick attribute to find the PDF URL
          let pdfUrl = '';
          if (button instanceof HTMLAnchorElement) {
            pdfUrl = button.href || '';
          } else {
            // Check for onclick or data attributes
            const onclick = button.getAttribute('onclick') || '';
            const hrefMatch = onclick.match(/href\s*=\s*['"]([^'"]+)['"]/);
            if (hrefMatch) {
              pdfUrl = hrefMatch[1];
            } else {
              // Check for data-href or similar
              pdfUrl = button.getAttribute('data-href') || button.getAttribute('href') || '';
            }
          }
          
          // If still no URL, try to find a link in the same card/container
          if (!pdfUrl) {
            let container: HTMLElement | null = button.parentElement;
            for (let i = 0; i < 5 && container; i++) {
              const link = container.querySelector('a[href*=".pdf"], a[href*="download"], a[href*="abrir"]');
              if (link) {
                pdfUrl = (link as HTMLAnchorElement).href || link.getAttribute('href') || '';
                break;
              }
              container = container.parentElement;
            }
          }
          
          if (!pdfUrl) {
            continue;
          }
          
          // Get the card/container context to find edition and date
          let container: HTMLElement | null = button.parentElement;
          let contextText = '';
          
          // Look for the card container (usually has class with "card" or is in Calendário section)
          for (let i = 0; i < 6 && container; i++) {
            const containerText = container.textContent?.trim() || '';
            if (containerText.length > contextText.length) {
              contextText = containerText;
            }
            container = container.parentElement;
          }
          
          // Extract edition number (format: "N° XXXX / YYYY")
          const editionMatch = contextText.match(/N[°º]\s*(\d+)\s*\/\s*\d{4}/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;
          
          // Extract date - try multiple formats
          // Format 1: "DD/Mês/YYYY" (e.g., "07/Janeiro/2026")
          let dateText = '';
          const monthDateMatch = contextText.match(/(\d{2})\/(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\/(\d{4})/i);
          if (monthDateMatch) {
            const months: Record<string, string> = {
              'janeiro': '01', 'fevereiro': '02', 'março': '03', 'marco': '03',
              'abril': '04', 'maio': '05', 'junho': '06',
              'julho': '07', 'agosto': '08', 'setembro': '09',
              'outubro': '10', 'novembro': '11', 'dezembro': '12'
            };
            const monthNum = months[monthDateMatch[2].toLowerCase()];
            if (monthNum) {
              dateText = `${monthDateMatch[1]}/${monthNum}/${monthDateMatch[3]}`;
            }
          }
          
          // Format 2: "DD/MM/YYYY" (e.g., "07/01/2026")
          if (!dateText) {
            const slashDateMatch = contextText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (slashDateMatch) {
              dateText = `${slashDateMatch[1]}/${slashDateMatch[2]}/${slashDateMatch[3]}`;
            }
          }
          
          // Also look for "Data: DD/MM/YYYY" pattern
          if (!dateText) {
            const dataMatch = contextText.match(/Data:\s*(\d{2}\/\d{2}\/\d{4})/i);
            if (dataMatch) {
              dateText = dataMatch[1];
            }
          }
          
          if (dateText && pdfUrl) {
            data.push({
              editionNumber,
              dateText,
              pdfUrl,
              fullText: contextText.substring(0, 500)
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
            const baseUrlObj = new URL(this.ubaConfig.baseUrl);
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
            power: 'executive',
            sourceText: item.fullText,
          });

          if (gazette) {
            gazettes.push(gazette);
            logger.debug(`Added gazette: Edição ${item.editionNumber || 'N/A'} - ${toISODate(gazetteDate)}`);
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

