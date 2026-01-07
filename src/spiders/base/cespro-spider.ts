import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, CesproConfig } from '../../types';
import { logger } from '../../utils/logger';

/**
 * CesproSpider implementation for Cloudflare Workers
 * 
 * The CESPRO platform is used by municipalities like Ribeirão Preto and São Sebastião.
 * 
 * Site Structure:
 * - URL: https://cespro.com.br/visualizarDiarioOficial.php?cdMunicipio={code}
 * - Calendar view with month/year selectors
 * - Day links that navigate to gazette list for that day
 * - Download and "Leitura Digital" links for each edition
 * 
 * Requires browser rendering for JavaScript calendar interaction
 */
export class CesproSpider extends BaseSpider {
  private cesproConfig: CesproConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.cesproConfig = spiderConfig.config as CesproConfig;
    this.browser = browser || null;
    
    logger.info(`Initializing CesproSpider for ${spiderConfig.name}`, {
      hasBrowser: !!this.browser,
      cdMunicipio: this.cesproConfig.cdMunicipio
    });
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(`CesproSpider requires browser binding for ${this.spiderConfig.name}`);
      return [];
    }

    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      
      // Build URL
      const url = `${this.cesproConfig.baseUrl}/visualizarDiarioOficial.php?cdMunicipio=${this.cesproConfig.cdMunicipio}`;
      
      logger.info(`Navigating to CESPRO: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
      this.requestCount++;
      
      // Wait for calendar to load
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Get date range info
      const startDate = new Date(this.dateRange.start);
      const endDate = new Date(this.dateRange.end);
      
      logger.info(`Crawling CESPRO from ${startDate.toISOString()} to ${endDate.toISOString()}`);
      
      // Iterate through months in the date range
      const currentMonth = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      const endMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
      
      while (currentMonth <= endMonth) {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth() + 1; // 1-indexed for display
        
        logger.debug(`Processing ${month}/${year}`);
        
        // Select year and month
        await this.selectMonthYear(page, year, month);
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Extract gazette links for this month
        const monthGazettes = await this.extractGazettesForMonth(page, year, month);
        
        // Add all gazettes from this month (date filtering already done in extractGazettesForMonth)
        for (const gazette of monthGazettes) {
          if (gazette) {
            gazettes.push(gazette);
          }
        }
        
        logger.debug(`Found ${monthGazettes.length} gazettes for ${month}/${year}`);
        
        // Move to next month
        currentMonth.setMonth(currentMonth.getMonth() + 1);
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from CESPRO`);
      
    } catch (error) {
      logger.error(`Error crawling CESPRO:`, error as Error);
    } finally {
      if (page) await page.close().catch(() => {});
      if (browserInstance) await browserInstance.close().catch(() => {});
    }

    return gazettes;
  }

  /**
   * Select month and year in the calendar dropdowns
   */
  private async selectMonthYear(page: any, year: number, month: number): Promise<void> {
    try {
      // Month names in Portuguese
      const monthNames = [
        'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
      ];
      
      const monthName = monthNames[month - 1];
      
      // Select year
      await page.evaluate((yr: number) => {
        const yearSelect = document.querySelector('select[name*="ano"], select:has(option[value="2025"])') as unknown as HTMLSelectElement | null;
        if (yearSelect) {
          yearSelect.value = yr.toString();
          yearSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, year);
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Select month
      await page.evaluate((mon: string) => {
        const selects = document.querySelectorAll('select');
        for (const select of Array.from(selects)) {
          const options = select.querySelectorAll('option');
          for (const option of Array.from(options)) {
            if (option.textContent?.trim() === mon) {
              (select as HTMLSelectElement).value = option.value;
              select.dispatchEvent(new Event('change', { bubbles: true }));
              return;
            }
          }
        }
      }, monthName);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      logger.warn(`Error selecting month/year: ${error}`);
    }
  }

  /**
   * Extract gazette entries for the current month view
   */
  private async extractGazettesForMonth(page: any, year: number, month: number): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Get all day links in the calendar
      const dayLinks = await page.evaluate(() => {
        const links: Array<{day: number, hasGazette: boolean}> = [];
        
        // Find calendar table cells with links (days that have gazettes)
        const cells = document.querySelectorAll('table td');
        for (const cell of Array.from(cells)) {
          const link = cell.querySelector('a');
          const text = cell.textContent?.trim();
          if (link && text && /^\d{1,2}$/.test(text)) {
            links.push({
              day: parseInt(text, 10),
              hasGazette: true
            });
          }
        }
        
        return links;
      });
      
      logger.debug(`Found ${dayLinks.length} days with gazettes in ${month}/${year}`);
      
      // For each day with a gazette, click and extract
      for (const dayLink of dayLinks) {
        try {
          const day = dayLink.day;
          const dateStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
          const gazetteDate = new Date(dateStr);
          
          // Check date range before clicking
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }
          
          // Click on the day to show gazette(s)
          await page.evaluate((d: number) => {
            const cells = document.querySelectorAll('table td');
            for (const cell of Array.from(cells)) {
              const link = cell.querySelector('a');
              const text = cell.textContent?.trim();
              if (link && text === d.toString()) {
                link.click();
                return;
              }
            }
          }, day);
          
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // Extract gazette info from the expanded view
          const gazetteInfo = await page.evaluate(() => {
            const results: Array<{editionNumber: string, pdfUrl: string | null, isSupplementar: boolean}> = [];
            
            // CESPRO shows gazettes in a modal/accordion with Download links
            // The structure is: div containing edition info + Download/Leitura Digital links
            
            // First try to find all download links
            const allLinks = document.querySelectorAll('a');
            
            for (const link of Array.from(allLinks)) {
              const href = link.getAttribute('href');
              const linkText = link.textContent?.trim() || '';
              
              // Check if this is a Download link
              if (linkText.toLowerCase() === 'download' && href) {
                // Try to find edition number in the parent container
                let container = link.closest('div[class*="row"], div.modal-body, div.panel');
                if (!container) {
                  container = link.parentElement?.parentElement || null;
                }
                
                const containerText = container?.textContent || '';
                
                // Match edition number patterns like "Edição 12.311" or "Edição nº 12311"
                const editionMatch = containerText.match(/[Ee]di[çc][ãa]o\s+(?:n[º°]?\s*)?(\d+\.?\d*)(?:-?(SUPLEMENTAR|EXTRA))?/i);
                const isSupplementar = editionMatch ? 
                  (editionMatch[2]?.toUpperCase() === 'SUPLEMENTAR' || editionMatch[2]?.toUpperCase() === 'EXTRA') : 
                  containerText.toUpperCase().includes('SUPLEMENTAR') || containerText.toUpperCase().includes('EXTRA');
                
                results.push({
                  editionNumber: editionMatch ? editionMatch[1].replace('.', '') : 'N/A',
                  pdfUrl: href,
                  isSupplementar: isSupplementar,
                });
              }
            }
            
            // If no download links found, try to find any PDF links
            if (results.length === 0) {
              const pdfLinks = document.querySelectorAll('a[href*=".pdf"]');
              for (const link of Array.from(pdfLinks)) {
                const href = link.getAttribute('href');
                if (href) {
                  results.push({
                    editionNumber: 'N/A',
                    pdfUrl: href,
                    isSupplementar: false,
                  });
                }
              }
            }
            
            return results;
          });
          
          for (const info of gazetteInfo) {
            if (info.pdfUrl) {
              // Construct full URL if relative
              let pdfUrl = info.pdfUrl;
              if (!pdfUrl.startsWith('http')) {
                const baseUrlObj = new URL(this.cesproConfig.baseUrl);
                pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
              }
              
              const gazette = await this.createGazette(gazetteDate, pdfUrl, {
                editionNumber: info.editionNumber,
                isExtraEdition: info.isSupplementar,
                power: 'executive',
              });
              
              if (gazette) {
                gazettes.push(gazette);
              }
            }
          }
          
        } catch (error) {
          logger.warn(`Error processing day ${dayLink.day}: ${error}`);
        }
      }
      
    } catch (error) {
      logger.error(`Error extracting gazettes for ${month}/${year}:`, error as Error);
    }
    
    return gazettes;
  }
}

