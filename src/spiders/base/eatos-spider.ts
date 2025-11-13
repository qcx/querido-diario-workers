import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, EatosConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Spider for EATOS (e-Atos) platform
 * 
 * Uses Cloudflare Browser Rendering (Puppeteer) to handle:
 * - Nuxt.js application with client-side rendering
 * - Calendar interface showing dates with publications
 * - List of gazettes with API links
 * - Pagination support
 * 
 * The site structure:
 * 1. Navigate to baseUrl (e.g., "https://publicacoesmunicipais.com.br/eatos/ilhacomprida")
 * 2. Calendar shows dates with gazettes marked with class "has-publication"
 * 3. List shows gazette items with links to API: /api/v1/acts/{municipality}/{edition}
 * 4. Extract date from item description: "DD/MM/YYYY"
 * 5. Extract edition number from item description: "Edição {number}"
 * 6. PDF URL is accessed via API endpoint
 */
export class EatosSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as EatosConfig;
    this.baseUrl = platformConfig.baseUrl;
    this.browser = browser || null;
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  /**
   * Get month abbreviation in Portuguese (first 3 letters)
   */
  private getMonthAbbreviation(month: number): string {
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return months[month - 1];
  }

  /**
   * Generate list of month/year combinations from date range
   */
  private generateMonthYearCombinations(): Array<{ year: number; month: number }> {
    const combinations: Array<{ year: number; month: number }> = [];
    const current = new Date(this.startDate.getFullYear(), this.startDate.getMonth(), 1);
    const end = new Date(this.endDate.getFullYear(), this.endDate.getMonth(), 1);

    while (current <= end) {
      const year = current.getFullYear();
      const month = current.getMonth() + 1; // JavaScript months are 0-indexed
      combinations.push({ year, month });
      
      // Move to next month
      current.setMonth(current.getMonth() + 1);
    }

    return combinations;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(`EatosSpider for ${this.config.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling EATOS for ${this.config.name}...`);

    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      
      // Navigate to the base URL
      logger.debug(`Navigating to: ${this.baseUrl}`);
      await page.goto(this.baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++; 
      
      // Wait for page to stabilize and Nuxt.js to render
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Wait for calendar to be present
      try {
        await page.waitForSelector('.ant-picker-calendar', { timeout: 10000 });
      } catch (error) {
        logger.error('Calendar not found');
        const html = await page.content();
        logger.debug(`Page HTML snippet: ${html.substring(0, 1000)}`);
        return gazettes;
      }
      
      // Generate month/year combinations from date range
      const monthYearCombos = this.generateMonthYearCombinations();
      logger.info(`Generated ${monthYearCombos.length} month/year combinations to crawl`);
      
      // Process each month/year combination
      for (const { year, month } of monthYearCombos) {
        try {
          logger.info(`Processing month: ${month}/${year}`);
          
          // Select month and year in calendar
          await this.selectMonthAndYear(page, month, year);
          
          // Wait for calendar to update
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Find all dates with publications in this month
          const datesWithPublications = await page.$$eval(
            'table.ant-picker-content td.ant-picker-cell .ant-fullcalendar-value.has-publication',
            (elements: any[]) => {
              return elements.map((el: any) => {
                const td = el.closest('td.ant-picker-cell');
                return td ? td.getAttribute('title') : null;
              }).filter((title: string | null) => title !== null);
            }
          );
          
          logger.debug(`Found ${datesWithPublications.length} dates with publications in ${month}/${year}`);
          
          // Process each date with publications
          for (const dateTitle of datesWithPublications) {
            try {
              // Parse date from title (format: "YYYY-MM-DD")
              const dateMatch = dateTitle.match(/(\d{4})-(\d{2})-(\d{2})/);
              if (!dateMatch) {
                logger.warn(`Could not parse date from title: ${dateTitle}`);
                continue;
              }
              
              const [, yearStr, monthStr, dayStr] = dateMatch;
              const gazetteDate = new Date(
                parseInt(yearStr, 10),
                parseInt(monthStr, 10) - 1,
                parseInt(dayStr, 10)
              );
              
              // Check if date is in our crawl range
              if (!this.isInDateRange(gazetteDate)) {
                logger.debug(`Date ${dateTitle} is outside crawl range`);
                continue;
              }
              
              // Click on the date
              const dateSelector = `td.ant-picker-cell[title="${dateTitle}"] .ant-fullcalendar-value.has-publication`;
              const dateElement = await page.$(dateSelector);
              
              if (!dateElement) {
                logger.warn(`Could not find date element for ${dateTitle}`);
                continue;
              }
              
              logger.debug(`Clicking date: ${dateTitle}`);
              await dateElement.click();
              
              // Wait for act-list to load
              await new Promise(resolve => setTimeout(resolve, 1500));
              
              // Extract gazettes from act-list
              const dateGazettes = await this.extractGazettesFromActList(page, gazetteDate);
              gazettes.push(...dateGazettes);
              
              logger.debug(`Found ${dateGazettes.length} gazettes for date ${dateTitle}`);
              
            } catch (error) {
              logger.error(`Error processing date ${dateTitle}:`, error as Error);
            }
          }
          
        } catch (error) {
          logger.error(`Error crawling month ${month}/${year}:`, error as Error);
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from EATOS`);
      
    } catch (error) {
      logger.error(`Error crawling EATOS:`, error as Error);
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
   * Select month and year in the calendar picker
   */
  private async selectMonthAndYear(page: any, month: number, year: number): Promise<void> {
    const monthAbbr = this.getMonthAbbreviation(month);
    
    // Check current selected values first
    const currentValues = await page.evaluate(() => {
      const monthSelect = document.querySelector('.ant-select:not(.my-year-select) .ant-select-selection-item');
      const yearSelect = document.querySelector('.ant-select.my-year-select .ant-select-selection-item');
      return {
        month: monthSelect?.textContent?.trim() || '',
        year: yearSelect?.textContent?.trim() || '',
      };
    });
    
    logger.debug(`Current selection - Month: ${currentValues.month}, Year: ${currentValues.year}`);
    
    // Select month if needed
    if (currentValues.month !== monthAbbr) {
      logger.debug(`Selecting month: ${monthAbbr} (current: ${currentValues.month})`);
      const monthSelector = await page.$('.ant-select:not(.my-year-select) .ant-select-selector');
      if (!monthSelector) {
        throw new Error('Month selector not found');
      }
      
      await monthSelector.click();
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for dropdown to fully render
      
      // Wait for dropdown to appear
      try {
        await page.waitForSelector('.rc-virtual-list-holder-inner', { timeout: 3000 });
      } catch (error) {
        logger.warn('Month dropdown did not appear');
        return;
      }
      
      // Find and click the month option using page.evaluate for better reliability
      const monthClicked = await page.evaluate((monthText: string) => {
        const holder = document.querySelector('.rc-virtual-list-holder-inner');
        if (!holder) return false;
        
        const options = holder.querySelectorAll('[role="option"]');
        for (const option of Array.from(options) as HTMLElement[]) {
          const text = option.textContent?.trim();
          if (text === monthText) {
            option.click();
            return true;
          }
        }
        return false;
      }, monthAbbr);
      
      if (!monthClicked) {
        logger.warn(`Month option ${monthAbbr} not found in dropdown`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for selection to apply
    } else {
      logger.debug(`Month ${monthAbbr} already selected, skipping`);
    }
    
    // Select year if needed
    if (currentValues.year !== year.toString()) {
      logger.debug(`Selecting year: ${year} (current: ${currentValues.year})`);
      const yearSelector = await page.$('.ant-select.my-year-select .ant-select-selector');
      if (!yearSelector) {
        throw new Error('Year selector not found');
      }
      
      await yearSelector.click();
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for dropdown to fully render
      
      // Wait for dropdown to appear
      try {
        await page.waitForSelector('.rc-virtual-list-holder-inner', { timeout: 3000 });
      } catch (error) {
        logger.warn('Year dropdown did not appear');
        return;
      }
      
      // Find and click the year option using page.evaluate for better reliability
      const yearClicked = await page.evaluate((yearText: string) => {
        const holder = document.querySelector('.rc-virtual-list-holder-inner');
        if (!holder) return false;
        
        const options = holder.querySelectorAll('[role="option"]');
        for (const option of Array.from(options) as HTMLElement[]) {
          const text = option.textContent?.trim();
          if (text === yearText) {
            option.click();
            return true;
          }
        }
        return false;
      }, year.toString());
      
      if (!yearClicked) {
        logger.warn(`Year option ${year} not found in dropdown`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for selection to apply
    } else {
      logger.debug(`Year ${year} already selected, skipping`);
    }
  }

  /**
   * Extract gazettes from the act-list after clicking a date
   */
  private async extractGazettesFromActList(page: any, gazetteDate: Date): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Wait for act-list to be present
      await page.waitForSelector('.ant-list-item', { timeout: 5000 }).catch(() => {
        logger.debug('Act-list not found, may be no gazettes for this date');
      });
      
      // Extract all gazettes from current page and paginate
      let hasMorePages = true;
      let currentPage = 1;
      
      while (hasMorePages) {
        logger.debug(`Extracting gazettes from act-list page ${currentPage} for date ${toISODate(gazetteDate)}`);
        
        const gazetteItems = await page.$$eval(
          '.ant-list-item a[href*="/api/v1/acts/"]',
          (links: any[]) => {
            return links.map((link: any) => {
              const href = link.getAttribute('href');
              const descriptionDiv = link.querySelector('.item-description');
              let editionNumber: string | undefined;
              
              if (descriptionDiv) {
                const paragraphs = descriptionDiv.querySelectorAll('p');
                paragraphs.forEach((p: any) => {
                  const text = p.textContent?.trim() || '';
                  // Extract edition number: "Edição 1906"
                  const editionMatch = text.match(/Edi[çc][ãa]o\s+(\d+)/i);
                  if (editionMatch) {
                    editionNumber = editionMatch[1];
                  }
                });
              }
              
              return {
                href,
                editionNumber,
              };
            }).filter((item: any) => item.href);
          }
        );
        
        logger.debug(`Found ${gazetteItems.length} gazette items on act-list page ${currentPage}`);
        
        // Process each gazette item
        for (const item of gazetteItems) {
          try {
            // Construct full API endpoint URL
            let apiUrl: string;
            if (item.href.startsWith('http')) {
              apiUrl = item.href;
            } else {
              // Relative URL - construct absolute URL
              const baseUrlObj = new URL(this.baseUrl);
              const baseDomain = `${baseUrlObj.protocol}//${baseUrlObj.host}`;
              apiUrl = `${baseDomain}${item.href}`;
            }
            
            // Remove /pdf suffix if it exists
            if (apiUrl.endsWith('/pdf')) {
              apiUrl = apiUrl.slice(0, -4);
            }
            
            // Replace v1 with v2 in the API URL for PDF endpoint
            const apiUrlV2 = apiUrl.replace('/api/v1/', '/api/v2/');
            
            // Try to get PDF URL from API endpoint
            // First try /pdf suffix, if that fails, try fetching the API to get the PDF URL
            let pdfUrl = `${apiUrlV2}`;
            
            logger.debug(`Attempting to resolve PDF URL: ${pdfUrl} from API: ${apiUrl}`);
            
            // Create the gazette object
            // The createGazette method will try to resolve the URL
            // If it fails, we'll try fetching the API endpoint to get the actual PDF URL
            let gazette = await this.createGazette(gazetteDate, pdfUrl, {
              editionNumber: item.editionNumber,
              isExtraEdition: false,
              power: 'executive',
              sourceText: `Edição ${item.editionNumber || 'N/A'} - ${toISODate(gazetteDate)}`,
            });
            
            // If URL resolution failed, try fetching the API endpoint to get PDF URL
            if (!gazette) {
              logger.debug(`PDF URL resolution failed, trying to fetch API endpoint: ${apiUrlV2}`);
              try {
                const apiResponse = await fetch(apiUrlV2, {
                  headers: {
                    'Accept': 'application/json',
                  },
                  signal: AbortSignal.timeout(10000),
                });
                
                if (apiResponse.ok) {
                  const apiData = await apiResponse.json() as Record<string, any>;
                  // Try common PDF URL fields
                  const possiblePdfUrl = apiData.pdfUrl || apiData.pdf_url || apiData.fileUrl || apiData.file_url || apiData.url;
                  
                  if (possiblePdfUrl && typeof possiblePdfUrl === 'string') {
                    logger.debug(`Found PDF URL from API: ${possiblePdfUrl}`);
                    pdfUrl = possiblePdfUrl;
                    gazette = await this.createGazette(gazetteDate, pdfUrl, {
                      editionNumber: item.editionNumber,
                      isExtraEdition: false,
                      power: 'executive',
                      sourceText: `Edição ${item.editionNumber || 'N/A'} - ${toISODate(gazetteDate)}`,
                    });
                  } else {
                    logger.warn(`API response did not contain PDF URL field`, {
                      apiUrl: apiUrlV2,
                      responseKeys: Object.keys(apiData).join(', '),
                    });
                  }
                }
              } catch (apiError) {
                logger.warn(`Failed to fetch API endpoint`, {
                  apiUrl: apiUrlV2,
                  error: apiError instanceof Error ? apiError.message : String(apiError),
                });
              }
            }
            
            if (gazette) {
              gazettes.push(gazette);
              logger.debug(`Successfully created gazette for edition ${item.editionNumber}`);
            } else {
              logger.warn(`Failed to create gazette for URL: ${pdfUrl}, API: ${apiUrlV2}, href: ${item.href}`);
            }
            
          } catch (error) {
            logger.error(`Error processing gazette item ${item.href}:`, error as Error);
          }
        }
        
        // Check if there's a next page in the act-list pagination
        const nextPageButton = await page.$('.ant-list-pagination .ant-pagination-next:not(.ant-pagination-disabled)');
        if (nextPageButton) {
          logger.debug(`Clicking next page button in act-list`);
          await nextPageButton.click();
          await new Promise(resolve => setTimeout(resolve, 1500)); // Wait for page to load
          currentPage++;
        } else {
          hasMorePages = false;
        }
      }
      
    } catch (error) {
      logger.error(`Error extracting gazettes from act-list:`, error as Error);
    }
    
    return gazettes;
  }
}

