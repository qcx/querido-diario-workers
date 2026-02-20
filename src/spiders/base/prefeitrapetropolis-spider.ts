import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraPetropolisConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * PrefeituraPetropolisSpider for Petrópolis, RJ
 * 
 * Site Structure:
 * - URL: https://www.petropolis.rj.gov.br/pmp/index.php/servicos-cidadao/diario-oficial
 * - Uses jDownloads with hierarchical navigation:
 *   - Page 1: Years displayed as folders/categories (2026, 2025, 2024, etc.)
 *   - Page 2: Months displayed as folders/categories (January, February, etc.) when clicking a year
 *   - Page 3: Table with official gazettes when clicking a month
 * - Gazettes are displayed in a table with columns: Name, Description, Size, Downloads
 * - Each row has a "Download" button that links to the PDF
 * - Requires browser rendering to navigate through the hierarchy
 */
export class PrefeituraPetropolisSpider extends BaseSpider {
  protected petropolisConfig: PrefeituraPetropolisConfig;
  private browser: Fetcher | null = null;

  // Month names in English (as displayed on the site)
  private readonly monthNames: Record<string, number> = {
    'january': 1,
    'february': 2,
    'march': 3,
    'april': 4,
    'may': 5,
    'june': 6,
    'july': 7,
    'august': 8,
    'september': 9,
    'october': 10,
    'november': 11,
    'december': 12
  };

  // Month names in Portuguese (fallback)
  private readonly monthNamesPt: Record<string, number> = {
    'janeiro': 1,
    'fevereiro': 2,
    'março': 3,
    'abril': 4,
    'maio': 5,
    'junho': 6,
    'julho': 7,
    'agosto': 8,
    'setembro': 9,
    'outubro': 10,
    'novembro': 11,
    'dezembro': 12
  };

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.petropolisConfig = spiderConfig.config as PrefeituraPetropolisConfig;
    this.browser = browser || null;
    
    if (!this.petropolisConfig.url) {
      throw new Error(`PrefeituraPetropolisSpider requires url in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraPetropolisSpider for ${spiderConfig.name}`);
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.petropolisConfig.url} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error(`PrefeituraPetropolisSpider requires browser binding for ${this.spiderConfig.name}`);
    }
    
    return this.crawlWithBrowser();
  }

  /**
   * Browser-based crawling with hierarchical navigation: Year → Month → Gazettes
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Navigate to the main page
      logger.debug(`Navigating to ${this.petropolisConfig.url}`);
      await page.goto(this.petropolisConfig.url, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Wait for page to fully load
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Get all available years from the main page
      const years = await this.extractYears(page);
      logger.debug(`Found ${years.length} years on main page: ${years.map(y => y.year).join(', ')}`);
      
      // Calculate date range
      const startDate = new Date(this.dateRange.start);
      const endDate = new Date(this.dateRange.end);
      const startYear = startDate.getFullYear();
      const endYear = endDate.getFullYear();
      
      // Process each year in the date range
      for (const yearInfo of years) {
        const year = yearInfo.year;
        
        if (year < startYear || year > endYear) {
          logger.debug(`Skipping year ${year} - outside date range (${startYear}-${endYear})`);
          continue;
        }
        
        logger.info(`Processing year ${year}`);
        
        // Navigate to year page
        const navigated = await this.navigateToYear(page, yearInfo);
        if (!navigated) {
          logger.warn(`Could not navigate to year ${year}`);
          continue;
        }
        
        // Wait for page to load
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Extract months from the year page
        const months = await this.extractMonths(page);
        logger.debug(`Found ${months.length} months for year ${year}: ${months.map(m => m.name).join(', ')}`);
        
        // Get month range for this year
        const startMonth = year === startYear ? startDate.getMonth() + 1 : 1;
        const endMonth = year === endYear ? endDate.getMonth() + 1 : 12;
        
        // Process each month
        for (const monthInfo of months) {
          if (monthInfo.number < startMonth || monthInfo.number > endMonth) {
            logger.debug(`Skipping month ${monthInfo.name} - outside date range (${startMonth}-${endMonth})`);
            continue;
          }
          
          logger.info(`Processing ${monthInfo.name} ${year}`);
          
          // Navigate to month page
          const monthNavigated = await this.navigateToMonth(page, monthInfo);
          if (!monthNavigated) {
            logger.warn(`Could not navigate to month ${monthInfo.name}`);
            continue;
          }
          
          // Wait for page to load
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Extract gazettes from the month page
          const monthGazettes = await this.extractGazettesFromMonthPage(page, year, monthInfo.number);
          logger.info(`Found ${monthGazettes.length} gazettes for ${monthInfo.name} ${year}`);
          
          // Add to results (avoid duplicates)
          for (const gazette of monthGazettes) {
            const exists = gazettes.some(g => g.pdfUrl === gazette.pdfUrl);
            if (!exists) {
              gazettes.push(gazette);
            }
          }
          
          // Go back to year page
          await this.goBack(page);
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
        
        // Go back to main page
        await this.goBack(page);
        await new Promise(resolve => setTimeout(resolve, 1500));
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
   * Extract available years from the main page
   * Years are displayed as folder icons with year numbers below them (jDownloads structure)
   */
  private async extractYears(page: any): Promise<Array<{ year: number; href?: string; text: string }>> {
    return page.evaluate(() => {
      const years: Array<{ year: number; href?: string; text: string }> = [];
      const currentYear = new Date().getFullYear();
      const processedYears = new Set<number>();
      
      // Look for year links - jDownloads uses category links
      // Structure: links with year numbers (2026, 2025, etc.)
      const allLinks = Array.from(document.querySelectorAll('a'));
      
      for (const link of allLinks) {
        const text = link.textContent?.trim() || '';
        const href = link.getAttribute('href') || (link as HTMLAnchorElement).href || '';
        
        // Look for year pattern in link text - should be exactly a 4-digit year
        const yearMatch = text.match(/^\s*(20\d{2})\s*$/);
        if (yearMatch) {
          const year = parseInt(yearMatch[1], 10);
          if (year >= 2015 && year <= currentYear + 1 && !processedYears.has(year)) {
            processedYears.add(year);
            years.push({ year, href: href || undefined, text: text.trim() });
          }
        }
      }
      
      // Also try to find jDownloads category links with viewcategory parameter
      const categoryLinks = Array.from(document.querySelectorAll('a[href*="viewcategory"], a[href*="view=category"], a[href*="catid"]'));
      for (const link of categoryLinks) {
        const text = link.textContent?.trim() || '';
        const href = link.getAttribute('href') || (link as HTMLAnchorElement).href || '';
        
        // Match year pattern (4 digits) in text or nearby elements
        const yearMatch = text.match(/\b(20\d{2})\b/);
        if (yearMatch) {
          const year = parseInt(yearMatch[1], 10);
          if (year >= 2015 && year <= currentYear + 1 && !processedYears.has(year)) {
            processedYears.add(year);
            years.push({ year, href: href || undefined, text: text.trim() });
          }
        }
      }
      
      // Sort by year descending
      return years.sort((a, b) => b.year - a.year);
    });
  }

  /**
   * Navigate to a specific year page by clicking on the year link
   */
  private async navigateToYear(page: any, yearInfo: { year: number; href?: string; text: string }): Promise<boolean> {
    try {
      // First try to click using href if available
      if (yearInfo.href) {
        try {
          // Try to navigate directly using href
          const url = new URL(yearInfo.href, this.petropolisConfig.url);
          await page.goto(url.toString(), { waitUntil: 'networkidle0', timeout: 30000 });
          this.requestCount++;
          await new Promise(resolve => setTimeout(resolve, 2000));
          return true;
        } catch (error) {
          logger.debug(`Could not navigate directly to ${yearInfo.href}, trying click approach`);
        }
        
        // Try clicking on link with matching href
        const clicked = await page.evaluate((href: string) => {
          // Try exact match first
          let link = document.querySelector(`a[href="${href}"]`) as HTMLElement;
          if (!link && href.includes('?')) {
            // Try partial match
            const baseHref = href.split('?')[0];
            link = document.querySelector(`a[href*="${baseHref}"]`) as HTMLElement;
          }
          if (link) {
            link.click();
            return true;
          }
          return false;
        }, yearInfo.href);
        
        if (clicked) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          return true;
        }
      }
      
      // Fallback: click on link with exact year text match
      const clicked = await page.evaluate((yearText: string) => {
        const links = Array.from(document.querySelectorAll('a'));
        for (const link of links) {
          const text = link.textContent?.trim() || '';
          // Match exactly the year text (e.g., "2026")
          if (text === yearText || text.match(new RegExp(`^\\s*${yearText}\\s*$`))) {
            (link as HTMLElement).click();
            return true;
          }
        }
        return false;
      }, yearInfo.text);
      
      if (clicked) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return true;
      }
      
      logger.warn(`Could not navigate to year ${yearInfo.year}`);
      return false;
    } catch (error) {
      logger.warn(`Error navigating to year ${yearInfo.year}:`, error as Error);
      return false;
    }
  }

  /**
   * Extract available months from the year page
   * Months are displayed as folder icons with month names (jDownloads structure)
   */
  private async extractMonths(page: any): Promise<Array<{ name: string; number: number; href?: string }>> {
    return page.evaluate((monthNames: Record<string, number>, monthNamesPt: Record<string, number>) => {
      const months: Array<{ name: string; number: number; href?: string }> = [];
      const processedMonths = new Set<number>();
      
      // Look for month links - similar structure to years
      const allLinks = Array.from(document.querySelectorAll('a'));
      
      for (const link of allLinks) {
        const text = link.textContent?.trim() || '';
        const textLower = text.toLowerCase();
        const href = link.getAttribute('href') || (link as HTMLAnchorElement).href || '';
        
        // Check if text matches a month name exactly or contains it
        let monthNumber: number | undefined;
        
        // Try exact match first (e.g., "January")
        if (monthNames[textLower]) {
          monthNumber = monthNames[textLower];
        } else if (monthNamesPt[textLower]) {
          monthNumber = monthNamesPt[textLower];
        } else {
          // Try partial match
          for (const [monthName, num] of Object.entries(monthNames)) {
            if (textLower === monthName || textLower.includes(monthName)) {
              monthNumber = num;
              break;
            }
          }
          if (!monthNumber) {
            for (const [monthName, num] of Object.entries(monthNamesPt)) {
              if (textLower === monthName || textLower.includes(monthName)) {
                monthNumber = num;
                break;
              }
            }
          }
        }
        
        if (monthNumber && !processedMonths.has(monthNumber)) {
          processedMonths.add(monthNumber);
          months.push({ name: text, number: monthNumber, href: href || undefined });
        }
      }
      
      // Also check category links
      const categoryLinks = Array.from(document.querySelectorAll('a[href*="viewcategory"], a[href*="view=category"], a[href*="catid"]'));
      for (const link of categoryLinks) {
        const text = link.textContent?.trim() || '';
        const textLower = text.toLowerCase();
        const href = link.getAttribute('href') || (link as HTMLAnchorElement).href || '';
        
        let monthNumber: number | undefined;
        for (const [monthName, num] of Object.entries(monthNames)) {
          if (textLower === monthName || textLower.includes(monthName)) {
            monthNumber = num;
            break;
          }
        }
        if (!monthNumber) {
          for (const [monthName, num] of Object.entries(monthNamesPt)) {
            if (textLower === monthName || textLower.includes(monthName)) {
              monthNumber = num;
              break;
            }
          }
        }
        
        if (monthNumber && !processedMonths.has(monthNumber)) {
          processedMonths.add(monthNumber);
          months.push({ name: text, number: monthNumber, href: href || undefined });
        }
      }
      
      // Sort by month number
      return months.sort((a, b) => a.number - b.number);
    }, this.monthNames, this.monthNamesPt);
  }

  /**
   * Navigate to a specific month page by clicking on the month link
   */
  private async navigateToMonth(page: any, monthInfo: { name: string; number: number; href?: string }): Promise<boolean> {
    try {
      // First try to navigate using href if available
      if (monthInfo.href) {
        try {
          const url = new URL(monthInfo.href, this.petropolisConfig.url);
          await page.goto(url.toString(), { waitUntil: 'networkidle0', timeout: 30000 });
          this.requestCount++;
          await new Promise(resolve => setTimeout(resolve, 2000));
          return true;
        } catch (error) {
          logger.debug(`Could not navigate directly to ${monthInfo.href}, trying click approach`);
        }
        
        // Try clicking on link with matching href
        const clicked = await page.evaluate((href: string) => {
          let link = document.querySelector(`a[href="${href}"]`) as HTMLElement;
          if (!link && href.includes('?')) {
            const baseHref = href.split('?')[0];
            link = document.querySelector(`a[href*="${baseHref}"]`) as HTMLElement;
          }
          if (link) {
            link.click();
            return true;
          }
          return false;
        }, monthInfo.href);
        
        if (clicked) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          return true;
        }
      }
      
      // Fallback: click on link with month name
      const clicked = await page.evaluate((monthName: string) => {
        const links = Array.from(document.querySelectorAll('a'));
        const monthNameLower = monthName.toLowerCase();
        
        for (const link of links) {
          const text = link.textContent?.trim() || '';
          const textLower = text.toLowerCase();
          
          // Try exact match first
          if (textLower === monthNameLower) {
            (link as HTMLElement).click();
            return true;
          }
          
          // Try partial match (month name might be part of longer text)
          if (textLower.includes(monthNameLower) && monthNameLower.length > 3) {
            (link as HTMLElement).click();
            return true;
          }
        }
        return false;
      }, monthInfo.name);
      
      if (clicked) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return true;
      }
      
      logger.warn(`Could not navigate to month ${monthInfo.name}`);
      return false;
    } catch (error) {
      logger.warn(`Error navigating to month ${monthInfo.name}:`, error as Error);
      return false;
    }
  }

  /**
   * Extract gazettes from the month page
   * Gazettes are displayed in a table with Name, Description, Size, Downloads columns
   * Format: "7322 - Friday, January 16, 2026" or similar
   */
  private async extractGazettesFromMonthPage(page: any, year: number, month: number): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      const extractedData = await page.evaluate(() => {
        const results: Array<{
          date: string;
          editionNumber?: string;
          pdfUrl: string;
          isExtra: boolean;
        }> = [];
        
        // Find the table with gazettes
        // Look for table rows with download buttons
        const tableRows = Array.from(document.querySelectorAll('table tbody tr, table tr'));
        const processedUrls = new Set<string>();
        
        for (const row of tableRows) {
          try {
            // Get the row text to extract information
            const rowText = row.textContent?.trim() || '';
            if (!rowText) continue;
            
            // Find download button or link in this row
            const downloadButton = row.querySelector('a[href*="download"], button[onclick*="download"], .btn[href*="download"]') as HTMLAnchorElement;
            const pdfLink = row.querySelector('a[href*=".pdf"]') as HTMLAnchorElement;
            
            let href = '';
            if (downloadButton) {
              href = downloadButton.getAttribute('href') || downloadButton.href || '';
            } else if (pdfLink) {
              href = pdfLink.getAttribute('href') || pdfLink.href || '';
            }
            
            // If no href found, try to get from onclick attribute
            if (!href) {
              const onclickEl = row.querySelector('[onclick]');
              if (onclickEl) {
                const onclick = onclickEl.getAttribute('onclick') || '';
                const onclickMatch = onclick.match(/['"]([^'"]*\.pdf[^'"]*)['"]/);
                if (onclickMatch) {
                  href = onclickMatch[1];
                }
              }
            }
            
            if (!href || processedUrls.has(href)) continue;
            
            // Make URL absolute if needed
            let pdfUrl = href;
            if (!pdfUrl.startsWith('http')) {
              const baseUrl = window.location.origin;
              pdfUrl = pdfUrl.startsWith('/') 
                ? `${baseUrl}${pdfUrl}`
                : `${baseUrl}/${pdfUrl}`;
            }
            
            // Extract date and edition number from row text
            // Format examples:
            // "7322 - Friday, January 16, 2026"
            // "PETRÓPOLIS YEAR XXXIV No. 7322 16/1/2026 FRIDAY"
            
            // Try to extract date - look for patterns like "16/1/2026" or "January 16, 2026"
            let dateMatch = rowText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
            let day: string | undefined;
            let monthStr: string | undefined;
            let yearStr: string | undefined;
            
            if (dateMatch) {
              day = dateMatch[1];
              monthStr = dateMatch[2];
              yearStr = dateMatch[3];
            } else {
              // Try English date format: "January 16, 2026"
              const englishDateMatch = rowText.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})/i);
              if (englishDateMatch) {
                const monthMap: Record<string, string> = {
                  'january': '01', 'february': '02', 'march': '03', 'april': '04',
                  'may': '05', 'june': '06', 'july': '07', 'august': '08',
                  'september': '09', 'october': '10', 'november': '11', 'december': '12'
                };
                monthStr = monthMap[englishDateMatch[1].toLowerCase()];
                day = englishDateMatch[2].padStart(2, '0');
                yearStr = englishDateMatch[3];
              }
            }
            
            if (!day || !monthStr || !yearStr) {
              // Try to extract from link text in first column
              const nameLink = row.querySelector('td:first-child a, .jd_file_title a') as HTMLElement;
              if (nameLink) {
                const linkText = nameLink.textContent?.trim() || '';
                dateMatch = linkText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
                if (dateMatch) {
                  day = dateMatch[1];
                  monthStr = dateMatch[2];
                  yearStr = dateMatch[3];
                } else {
                  const englishDateMatch = linkText.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})/i);
                  if (englishDateMatch) {
                    const monthMap: Record<string, string> = {
                      'january': '01', 'february': '02', 'march': '03', 'april': '04',
                      'may': '05', 'june': '06', 'july': '07', 'august': '08',
                      'september': '09', 'october': '10', 'november': '11', 'december': '12'
                    };
                    monthStr = monthMap[englishDateMatch[1].toLowerCase()];
                    day = englishDateMatch[2].padStart(2, '0');
                    yearStr = englishDateMatch[3];
                  }
                }
              }
            }
            
            if (!day || !monthStr || !yearStr) {
              continue; // Skip if we can't extract date
            }
            
            // Extract edition number - look for "No. 7322" or "7322" at the start
            let editionNumber: string | undefined;
            const editionMatch = rowText.match(/\b(?:N[º°o]\.?\s*)?(\d{4,})\b/i);
            if (editionMatch) {
              editionNumber = editionMatch[1];
            }
            
            // Check if it's an extra edition
            const isExtra = /\b(extra|suplemento|vol)\d*\b/i.test(rowText);
            
            // Format date as DD/MM/YYYY
            const dateStr = `${day.padStart(2, '0')}/${monthStr.padStart(2, '0')}/${yearStr}`;
            
            processedUrls.add(pdfUrl);
            
            results.push({
              date: dateStr,
              editionNumber,
              pdfUrl,
              isExtra,
            });
          } catch (error) {
            console.error('Error processing row:', error);
          }
        }
        
        return results;
      });
      
      // Process extracted data
      for (const data of extractedData) {
        try {
          // Parse date
          const [day, itemMonth, itemYear] = data.date.split('/');
          const gazetteDate = new Date(`${itemYear}-${itemMonth}-${day}`);
          
          if (isNaN(gazetteDate.getTime())) {
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
          } else {
            logger.warn(`Failed to create gazette for ${toISODate(gazetteDate)} with URL: ${data.pdfUrl}`);
          }
        } catch (error) {
          logger.error(`Error processing extracted data:`, error as Error);
        }
      }
    } catch (error) {
      logger.error(`Error extracting gazettes from month page:`, error as Error);
    }
    
    return gazettes;
  }

  /**
   * Go back to the previous page
   */
  private async goBack(page: any): Promise<void> {
    try {
      // Try to find and click "To go back" or back button
      const clicked = await page.evaluate(() => {
        // Look for back link/button
        const backLinks = Array.from(document.querySelectorAll('a'));
        for (const link of backLinks) {
          const text = link.textContent?.trim().toLowerCase() || '';
          if (text.includes('voltar') || text.includes('go back') || text.includes('back')) {
            (link as HTMLElement).click();
            return true;
          }
        }
        // Try browser back
        if (window.history.length > 1) {
          window.history.back();
          return true;
        }
        return false;
      });
      
      if (!clicked) {
        // Fallback: use browser back
        await page.goBack({ waitUntil: 'networkidle0' });
        this.requestCount++;
      }
    } catch (error) {
      logger.warn(`Error going back:`, error as Error);
    }
  }
}
