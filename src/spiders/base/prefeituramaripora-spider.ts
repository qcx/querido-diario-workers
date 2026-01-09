import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraMairiporaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for Prefeitura de Mairiporã official gazette
 * 
 * Uses Cloudflare Browser Rendering (Puppeteer) to handle:
 * - JavaScript-rendered gazette listings
 * - Year-based URL structure: /imprensa-oficial/imprensa-oficial-{YEAR}/
 * - Elementor-based page structure
 * 
 * The site structure:
 * 1. Navigate to URL: /imprensa-oficial/imprensa-oficial-{YEAR}/
 * 2. Gazettes are displayed in elementor-column elements (.elementor-col-25 or .elementor-col-100)
 * 3. Each column contains:
 *    - .elementor-image-box widget with:
 *      - Title: .elementor-image-box-title (e.g., "Imprensa Oficial Mairiporã Edição 1515")
 *      - Date: .elementor-image-box-description (e.g., "12 de Novembro de 2025")
 *    - .elementor-button widget with:
 *      - PDF link: <a> tag with href pointing to PDF (e.g., "/wp-content/uploads/2025/11/...")
 * 4. All gazettes are loaded on the page (no infinite scroll)
 */
export class PrefeituraMairiporaSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraMairiporaConfig;
    this.baseUrl = platformConfig.url;
    this.browser = browser || null;
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  /**
   * Build URL for a specific year
   */
  private buildYearUrl(year: number): string {
    // URL pattern: /imprensa-oficial/imprensa-oficial-{YEAR}/
    const url = this.baseUrl.endsWith('/') ? this.baseUrl.slice(0, -1) : this.baseUrl;
    return `${url}/imprensa-oficial/imprensa-oficial-${year}/`;
  }

  /**
   * Parse Portuguese date string to Date object
   * Format: "28 de Dezembro de 2024"
   */
  private parsePortugueseDate(dateStr: string): Date | null {
    const monthMap: Record<string, number> = {
      'janeiro': 0, 'fevereiro': 1, 'março': 2, 'marco': 2,
      'abril': 3, 'maio': 4, 'junho': 5,
      'julho': 6, 'agosto': 7, 'setembro': 8,
      'outubro': 9, 'novembro': 10, 'dezembro': 11
    };

    // Match pattern: "DD de MMMM de YYYY"
    const match = dateStr.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
    if (!match) {
      return null;
    }

    const [, day, monthName, year] = match;
    const month = monthMap[monthName.toLowerCase()];
    
    if (month === undefined) {
      return null;
    }

    return new Date(parseInt(year, 10), month, parseInt(day, 10));
  }


  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(`PrefeituraMairiporaSpider for ${this.config.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura Mairiporã for ${this.config.name}...`);

    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      
      // Determine which years to crawl based on date range
      const startYear = new Date(this.startDate).getFullYear();
      const endYear = new Date(this.endDate).getFullYear();
      
      // Crawl each year
      for (let year = startYear; year <= endYear; year++) {
        try {
          const yearUrl = this.buildYearUrl(year);
          logger.info(`Crawling year ${year}: ${yearUrl}`);
          
          await page.goto(yearUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          this.requestCount++;
          
          // Wait for page to be fully interactive and JavaScript to execute
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          // Wait for preloader to disappear (if present)
          // The preloader has id="preloader" and when ready, its display is set to "none"
          try {
            await page.waitForFunction(
              () => {
                const preloader = document.querySelector('#preloader') as HTMLElement | null;
                if (!preloader) return true; // No preloader means content is loaded
                const style = window.getComputedStyle(preloader);
                // Page is ready when preloader display is "none"
                return style.display === 'none';
              },
              { timeout: 15000 }
            );
            logger.debug('Preloader disappeared (display: none)');
          } catch (error) {
            logger.debug('No preloader found or timeout waiting for preloader');
          }
          
          // Wait for content to load - wait for actual gazette elements with titles
          // Use waitForFunction to ensure content is actually rendered
          try {
            await page.waitForFunction(
              () => {
                const titles = document.querySelectorAll('.elementor-image-box-title');
                return titles.length > 0;
              },
              { timeout: 20000 }
            );
            logger.debug('Gazette titles found');
            
            // Also wait for buttons to ensure they're loaded
            // The button link itself has the class "elementor-button", not a child element
            await page.waitForFunction(
              () => {
                const buttons = document.querySelectorAll('a.elementor-button[href]');
                return buttons.length > 0;
              },
              { timeout: 15000 }
            );
            logger.debug('Gazette buttons found');
          } catch (error) {
            logger.warn('Gazette elements not found, trying alternative selectors');
            // Try waiting for columns instead
            await page.waitForSelector('.elementor-column', { timeout: 10000 });
          }
          
          // Additional wait for lazy-loaded images and animations to complete
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          // Verify we can actually find gazettes before proceeding
          const initialCount = await page.evaluate(() => {
            return document.querySelectorAll('.elementor-image-box-title').length;
          });
          logger.debug(`Found ${initialCount} gazette titles on page`);
          
          if (initialCount === 0) {
            logger.warn(`No gazette titles found on page ${yearUrl}, skipping extraction`);
            // Log page title for debugging
            const pageTitle = await page.title();
            logger.debug(`Page title: ${pageTitle}`);
            continue;
          }
          
          // Extract gazettes from the page (extracts all, filtering happens inside)
          const yearGazettes = await this.extractGazettesFromPage(page, year);
          
          // Add all extracted gazettes (they're already filtered by date in extractGazettesFromPage)
          for (const gazette of yearGazettes) {
            if (gazette) {
              gazettes.push(gazette);
            }
          }
          
          logger.info(`Found ${yearGazettes.length} gazettes for year ${year} (already filtered by date range)`);
          
        } catch (error) {
          logger.error(`Error crawling year ${year}:`, error as Error);
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from Prefeitura Mairiporã`);
      
    } catch (error) {
      logger.error(`Error crawling Prefeitura Mairiporã:`, error as Error);
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
   * Extract gazettes from the current page
   */
  private async extractGazettesFromPage(page: any, year: number): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      logger.debug(`Starting extraction for year ${year}`);
      
      // Extract all gazette items from elementor columns
      const gazetteItems = await page.evaluate(() => {
        try {
          const items: any[] = [];
          const debugInfo: any = {
            totalColumns: 0,
            columnsWithImageBox: 0,
            columnsWithTitle: 0,
            columnsWithDate: 0,
            columnsWithButton: 0,
            finalItems: 0,
            errors: [] as string[],
          };
          
          // Find all elementor columns that contain image-box widgets
          const columns = document.querySelectorAll('.elementor-column');
          debugInfo.totalColumns = columns.length;
          
          for (const column of Array.from(columns)) {
            try {
              // Find image-box widget in this column - try multiple selectors
              // The structure is: .elementor-widget-image-box or .elementor-image-box-wrapper
              let imageBoxWrapper = column.querySelector('.elementor-image-box-wrapper');
              if (!imageBoxWrapper) {
                // Try finding via widget
                const imageBoxWidget = column.querySelector('.elementor-widget-image-box');
                if (imageBoxWidget) {
                  imageBoxWrapper = imageBoxWidget.querySelector('.elementor-image-box-wrapper');
                }
              }
              
              if (!imageBoxWrapper) {
                continue;
              }
              debugInfo.columnsWithImageBox++;
              
              // Extract title
              const titleElement = imageBoxWrapper.querySelector('.elementor-image-box-title');
              const titleText = titleElement ? titleElement.textContent?.trim() : '';
              
              if (!titleText) {
                continue;
              }
              debugInfo.columnsWithTitle++;
              
              // Extract edition number from title (e.g., "Imprensa Oficial Mairiporã Edição 1515")
              const editionMatch = titleText.match(/[Ee]di[çc][ãa]o\s+(\d+)/i);
              const editionNumber = editionMatch ? editionMatch[1] : undefined;
              
              // Extract date
              const dateElement = imageBoxWrapper.querySelector('.elementor-image-box-description');
              const dateText = dateElement ? dateElement.textContent?.trim() : '';
              
              if (!dateText) {
                debugInfo.errors.push(`No date found for: ${titleText}`);
                continue;
              }
              debugInfo.columnsWithDate++;
              
              // Find the button with PDF link in the same column
              // Try multiple selectors to find the button
              let buttonLink = column.querySelector('a.elementor-button[href]') as HTMLAnchorElement | null;
              
              // If not found, try searching within widget-wrap
              if (!buttonLink) {
                const widgetWrap = column.querySelector('.elementor-widget-wrap');
                if (widgetWrap) {
                  buttonLink = widgetWrap.querySelector('a.elementor-button[href]') as HTMLAnchorElement | null;
                }
              }
              
              // If still not found, try finding any link with "ver edição completa" text in the column
              if (!buttonLink) {
                const allLinks = column.querySelectorAll('a[href]');
                for (const link of Array.from(allLinks)) {
                  const linkText = link.textContent?.trim().toLowerCase();
                  if (linkText && linkText.includes('ver edição completa')) {
                    buttonLink = link as HTMLAnchorElement;
                    break;
                  }
                }
              }
              
              let pdfHref = null;
              if (buttonLink) {
                pdfHref = buttonLink.getAttribute('href');
                debugInfo.columnsWithButton++;
              }
              
              if (!pdfHref) {
                const allLinks = column.querySelectorAll('a[href]');
                debugInfo.errors.push(`No PDF link found for: ${titleText} (found ${allLinks.length} links in column)`);
                continue;
              }
              
              items.push({
                titleText,
                editionNumber,
                dateText,
                pdfHref,
              });
              debugInfo.finalItems++;
            } catch (error) {
              debugInfo.errors.push(`Error processing column: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
          
          return { items, debugInfo };
        } catch (error) {
          return {
            items: [],
            debugInfo: {
              error: error instanceof Error ? error.message : String(error),
            },
          };
        }
      });
      
      const extractionResult = gazetteItems as { items: any[], debugInfo: any };
      const items = extractionResult.items || [];
      const debugInfo = extractionResult.debugInfo;
      
      if (debugInfo) {
        logger.debug(`Extraction debug for year ${year}:`, {
          totalColumns: debugInfo.totalColumns,
          columnsWithImageBox: debugInfo.columnsWithImageBox,
          columnsWithTitle: debugInfo.columnsWithTitle,
          columnsWithDate: debugInfo.columnsWithDate,
          columnsWithButton: debugInfo.columnsWithButton,
          finalItems: debugInfo.finalItems,
          errors: debugInfo.errors || [],
          error: debugInfo.error,
        });
        
        // Log errors if any
        if (debugInfo.errors && debugInfo.errors.length > 0) {
          logger.debug(`Extraction errors (first 5):`, debugInfo.errors.slice(0, 5));
        }
      }
      
      logger.debug(`Found ${items.length} gazette items on page for year ${year}`);
      
      // Process each item
      for (const item of items) {
        try {
          // Parse date from Portuguese format: "12 de Novembro de 2025"
          const gazetteDate = this.parsePortugueseDate(item.dateText);
          
          if (!gazetteDate) {
            logger.warn(`Could not parse date from: ${item.dateText}`);
            continue;
          }
          
          // Log parsed date for debugging
          const dateISO = gazetteDate.toISOString().split('T')[0];
          logger.debug(`Parsed date: ${item.dateText} -> ${dateISO}`);
          
          // Check if date is in range
          if (!this.isInDateRange(gazetteDate)) {
            logger.debug(`Date ${dateISO} is outside range ${this.dateRange.start} to ${this.dateRange.end}, skipping`);
            continue;
          }
          
          // Construct full PDF URL if relative
          let pdfUrl = item.pdfHref;
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }
          
          // Create gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber: item.editionNumber,
            power: 'executive_legislative',
            sourceText: item.titleText || `Edição ${item.editionNumber || 'N/A'} - ${item.dateText}`,
          });
          
          if (gazette) {
            gazettes.push(gazette);
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

