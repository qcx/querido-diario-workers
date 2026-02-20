import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PortalComunicacaoConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * PortalComunicacaoSpider implementation for Cloudflare Workers
 * 
 * The Portal Comunicação platform is used by municipalities like Santana de Parnaíba.
 * 
 * Site Structure:
 * - Base URL: https://prefeitura.santanadeparnaiba.sp.gov.br/PortalComunicacao/imprensa-oficial
 * - Year filter dropdown (select element)
 * - Grid of cards, each containing:
 *   - Edition title (e.g., "Edição 625", "Edição Especial 625-A")
 *   - Date range (e.g., "De 23 a 29 de dez de 2025")
 *   - Download link to /PortalComunicacao/arquivo/download/{hash}
 * 
 * The site is protected by Cloudflare, so browser rendering is required.
 */
export class PortalComunicacaoSpider extends BaseSpider {
  protected portalConfig: PortalComunicacaoConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.portalConfig = spiderConfig.config as PortalComunicacaoConfig;
    this.browser = browser || null;
    
    if (!this.portalConfig.baseUrl) {
      throw new Error(`PortalComunicacaoSpider requires a baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PortalComunicacaoSpider for ${spiderConfig.name} with URL: ${this.portalConfig.baseUrl}`, {
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
    logger.info(`Crawling ${this.portalConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      logger.error(`PortalComunicacaoSpider for ${this.spiderConfig.name} requires browser binding (Cloudflare protected)`);
      return [];
    }
    
    return this.crawlWithBrowser();
  }

  /**
   * Browser-based crawling for Portal Comunicação sites
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    // @ts-ignore
    const browser = await puppeteer.launch(this.browser);
    
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      
      // Navigate to the main page
      logger.debug(`Navigating to: ${this.portalConfig.baseUrl}`);
      await page.goto(this.portalConfig.baseUrl, { 
        waitUntil: 'networkidle0',
        timeout: 30000 
      });
      this.requestCount++;
      
      // Wait for the page to fully load
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Get the years we need to crawl based on date range
      const startYear = new Date(this.dateRange.start).getFullYear();
      const endYear = new Date(this.dateRange.end).getFullYear();
      const yearsToCheck: number[] = [];
      for (let year = endYear; year >= startYear; year--) {
        yearsToCheck.push(year);
      }
      
      logger.debug(`Years to check: ${yearsToCheck.join(', ')}`);
      
      // Get the currently selected year from the page
      const currentYear = await this.getCurrentYear(page);
      logger.debug(`Current year on page: ${currentYear}`);
      
      // First, extract from current page (usually shows current/most recent year)
      if (currentYear && yearsToCheck.includes(currentYear)) {
        const pageGazettes = await this.extractGazettesFromPage(page);
        logger.info(`Found ${pageGazettes.length} gazettes for current year ${currentYear}`);
        
        for (const gazette of pageGazettes) {
          if (this.isInDateRange(new Date(gazette.date))) {
            gazettes.push(gazette);
          }
        }
        
        // Remove current year from years to check
        const currentYearIndex = yearsToCheck.indexOf(currentYear);
        if (currentYearIndex > -1) {
          yearsToCheck.splice(currentYearIndex, 1);
        }
      }
      
      // Process remaining years by clicking on combobox options
      for (const year of yearsToCheck) {
        try {
          const yearSelected = await this.selectYearByClick(page, year);
          if (!yearSelected) {
            logger.debug(`Year ${year} not available in dropdown`);
            continue;
          }
          
          // Wait for content to update after selection
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Extract gazettes from the current page
          const pageGazettes = await this.extractGazettesFromPage(page);
          logger.info(`Found ${pageGazettes.length} gazettes for year ${year}`);
          
          for (const gazette of pageGazettes) {
            if (this.isInDateRange(new Date(gazette.date))) {
              gazettes.push(gazette);
            }
          }
        } catch (error) {
          logger.warn(`Error processing year ${year}:`, error as Error);
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from browser`);
      
    } catch (error) {
      logger.error(`Error during browser crawling:`, error as Error);
      throw error;
    } finally {
      await browser.close();
    }
    
    return gazettes;
  }
  
  /**
   * Get the currently selected year from the page
   */
  private async getCurrentYear(page: any): Promise<number | null> {
    try {
      const year = await page.evaluate(() => {
        // Look for combobox with "Ano:" label
        const comboboxes = document.querySelectorAll('[role="combobox"]');
        for (const cb of Array.from(comboboxes)) {
          // Check if it's the year combobox by looking at the label
          const parent = cb.closest('div');
          if (parent?.textContent?.includes('Ano:')) {
            // Get the selected option text
            const selectedOption = cb.querySelector('[aria-selected="true"]') || 
                                   cb.querySelector('.selected') ||
                                   cb;
            const text = selectedOption?.textContent?.trim();
            const yearMatch = text?.match(/\d{4}/);
            if (yearMatch) {
              return parseInt(yearMatch[0]);
            }
          }
        }
        
        // Fallback: look for select elements
        const selects = document.querySelectorAll('select');
        for (const select of Array.from(selects)) {
          const selectedOption = select.options[select.selectedIndex];
          const yearMatch = selectedOption?.textContent?.match(/\d{4}/);
          if (yearMatch) {
            return parseInt(yearMatch[0]);
          }
        }
        
        return null;
      });
      
      return year;
    } catch (error) {
      logger.warn('Error getting current year:', error as Error);
      return null;
    }
  }
  
  /**
   * Select a year by clicking on the combobox option
   */
  private async selectYearByClick(page: any, year: number): Promise<boolean> {
    try {
      // Click on the combobox to open the dropdown
      const comboboxClicked = await page.evaluate(() => {
        const comboboxes = document.querySelectorAll('[role="combobox"]');
        for (const cb of Array.from(comboboxes)) {
          const parent = cb.closest('div');
          if (parent?.textContent?.includes('Ano:')) {
            (cb as HTMLElement).click();
            return true;
          }
        }
        return false;
      });
      
      if (!comboboxClicked) {
        // Try clicking on a select element instead
        const selectFound = await page.evaluate((targetYear: number) => {
          const selects = document.querySelectorAll('select');
          for (const select of Array.from(selects)) {
            for (const option of Array.from(select.options)) {
              if (option.value === String(targetYear) || option.textContent?.trim() === String(targetYear)) {
                select.value = option.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
              }
            }
          }
          return false;
        }, year);
        
        return selectFound;
      }
      
      // Wait for dropdown to open
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Click on the year option
      const yearClicked = await page.evaluate((targetYear: number) => {
        // Look for option elements with the year
        const options = document.querySelectorAll('[role="option"]');
        for (const option of Array.from(options)) {
          if (option.textContent?.trim() === String(targetYear)) {
            (option as HTMLElement).click();
            return true;
          }
        }
        
        // Also try looking for listbox items
        const listItems = document.querySelectorAll('li, [role="listitem"]');
        for (const item of Array.from(listItems)) {
          if (item.textContent?.trim() === String(targetYear)) {
            (item as HTMLElement).click();
            return true;
          }
        }
        
        return false;
      }, year);
      
      if (yearClicked) {
        logger.debug(`Selected year ${year} by clicking`);
      }
      
      return yearClicked;
    } catch (error) {
      logger.warn(`Error selecting year ${year} by click:`, error as Error);
      return false;
    }
  }

  /**
   * Extract gazettes from the current page
   */
  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Extract all gazette card elements
      const cardData = await page.evaluate(() => {
        const results: Array<{
          title: string;
          dateText: string;
          downloadUrl: string | null;
        }> = [];
        
        // Find all links that look like edition downloads
        // The structure seems to be nested divs with edition info
        const allLinks = document.querySelectorAll('a');
        
        for (const link of Array.from(allLinks)) {
          const href = link.getAttribute('href');
          
          // Skip if no href or not a download link
          if (!href) continue;
          
          // Look for download links (could be /arquivo/download/ or direct PDF)
          const isDownloadLink = href.includes('/arquivo/download/') || 
                                 href.includes('/download/') ||
                                 href.endsWith('.pdf');
          
          if (!isDownloadLink) continue;
          
          // Get the link text as the title
          const title = link.textContent?.trim() || '';
          
          // Look for date text in parent elements
          let dateText = '';
          let parentElement: Element | null = link.parentElement;
          let depth = 0;
          
          while (parentElement && depth < 5) {
            // Look for elements with date pattern "De X a Y de mês de YYYY"
            const allDivs = parentElement.querySelectorAll('div, span, p');
            for (const div of Array.from(allDivs)) {
              const text = div.textContent?.trim() || '';
              if (text.match(/De\s+\d+\s+a\s+\d+\s+de\s+\w+\s+de\s+\d{4}/i)) {
                dateText = text;
                break;
              }
              // Also look for DD/MM/YYYY pattern
              if (text.match(/\d{2}\/\d{2}\/\d{4}/)) {
                dateText = text;
                break;
              }
            }
            if (dateText) break;
            parentElement = parentElement.parentElement;
            depth++;
          }
          
          // Also try looking in siblings
          if (!dateText && link.parentElement) {
            const siblings = link.parentElement.parentElement?.querySelectorAll('div, span, p');
            if (siblings) {
              for (const sibling of Array.from(siblings)) {
                const text = sibling.textContent?.trim() || '';
                if (text.match(/De\s+\d+\s+a\s+\d+\s+de\s+\w+\s+de\s+\d{4}/i)) {
                  dateText = text;
                  break;
                }
              }
            }
          }
          
          if (title.match(/[Ee]di[çc][ãa]o/i) || isDownloadLink) {
            results.push({
              title,
              dateText,
              downloadUrl: href,
            });
          }
        }
        
        return results;
      });
      
      logger.debug(`Found ${cardData.length} potential gazette elements on page`);
      
      // Process each card
      for (const card of cardData) {
        try {
          // Parse the date from the dateText
          let gazetteDate = this.parseDateFromText(card.dateText);
          
          if (!gazetteDate) {
            // Try to extract date from title if present
            gazetteDate = this.parseDateFromText(card.title);
          }
          
          if (!gazetteDate) {
            // Use current date as fallback (edition may be recent)
            logger.debug(`Could not parse date from: ${card.dateText} or ${card.title}, skipping`);
            continue;
          }
          
          // Get the download URL
          if (!card.downloadUrl) {
            logger.warn(`No download URL found for gazette: ${card.title}`);
            continue;
          }
          
          // Construct full URL
          let pdfUrl = card.downloadUrl;
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.portalConfig.baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }
          
          // Extract edition number
          const editionMatch = card.title.match(/[Ee]di[çc][ãa]o\s*(?:[Ee]special\s*)?[nN]?[°º]?\s*(\d+(?:-?[A-Z])?)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;
          
          // Check if it's an extra/special edition
          const isExtraEdition = card.title.toLowerCase().includes('especial') || 
                                  card.title.toLowerCase().includes('extra') ||
                                  (editionNumber && /-[A-Z]$/.test(editionNumber));
          
          // Create gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber,
            isExtraEdition,
            power: 'executive_legislative',
            sourceText: card.title || `Gazette ${toISODate(gazetteDate)}`,
          });
          
          if (gazette) {
            gazettes.push(gazette);
            logger.debug(`Added gazette: ${card.title}, date: ${toISODate(gazetteDate)}, edition: ${editionNumber}`);
          }
          
        } catch (error) {
          logger.error(`Error processing gazette card:`, error as Error);
        }
      }
      
    } catch (error) {
      logger.error(`Error extracting gazettes from page:`, error as Error);
    }
    
    return gazettes;
  }

  /**
   * Parse a date from Portuguese text
   * Handles formats like:
   * - "De 23 a 29 de dez de 2025"
   * - "De 30 a 30 de dez de 2025"
   * - "DD/MM/YYYY"
   */
  private parseDateFromText(text: string): Date | null {
    if (!text) return null;
    
    // Try DD/MM/YYYY format first
    const slashMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (slashMatch) {
      const [, day, month, year] = slashMatch;
      return new Date(`${year}-${month}-${day}`);
    }
    
    // Portuguese month abbreviations mapping
    const monthMap: Record<string, string> = {
      'jan': '01', 'janeiro': '01',
      'fev': '02', 'fevereiro': '02',
      'mar': '03', 'março': '03', 'marco': '03',
      'abr': '04', 'abril': '04',
      'mai': '05', 'maio': '05',
      'jun': '06', 'junho': '06',
      'jul': '07', 'julho': '07',
      'ago': '08', 'agosto': '08',
      'set': '09', 'setembro': '09',
      'out': '10', 'outubro': '10',
      'nov': '11', 'novembro': '11',
      'dez': '12', 'dezembro': '12',
    };
    
    // Try "De X a Y de month de YYYY" format
    // We use the end date (Y) as the gazette date
    const rangeMatch = text.match(/[Dd]e\s+\d+\s+a\s+(\d+)\s+de\s+(\w+)\s+de\s+(\d{4})/i);
    if (rangeMatch) {
      const [, day, monthStr, year] = rangeMatch;
      const month = monthMap[monthStr.toLowerCase()];
      if (month) {
        const paddedDay = day.padStart(2, '0');
        return new Date(`${year}-${month}-${paddedDay}`);
      }
    }
    
    // Try "DD de Month de YYYY" format
    const dateMatch = text.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
    if (dateMatch) {
      const [, day, monthStr, year] = dateMatch;
      const month = monthMap[monthStr.toLowerCase()];
      if (month) {
        const paddedDay = day.padStart(2, '0');
        return new Date(`${year}-${month}-${paddedDay}`);
      }
    }
    
    return null;
  }
}

