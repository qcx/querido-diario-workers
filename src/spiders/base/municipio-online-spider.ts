import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, MunicipioOnlineConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for MunicipioOnline platform (municipioonline.com.br)
 * Used by 26 cities in Sergipe (SE)
 * 
 * Characteristics:
 * - Form-based submission with ASP.NET ViewState
 * - Date filter with DD/MM/YYYY format
 * - Maximum interval of 1 year per request (yearly windows)
 * - Pagination via POST
 * - Direct PDF downloads
 */
export class MunicipioOnlineSpider extends BaseSpider {
  private urlUf: string;
  private urlCity: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as MunicipioOnlineConfig;
    this.urlUf = platformConfig.urlUf;
    this.urlCity = platformConfig.urlCity;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling MunicipioOnline for ${this.config.name}...`);

    try {
      const baseUrl = `https://www.municipioonline.com.br/${this.urlUf}/prefeitura/${this.urlCity}/cidadao/diariooficial`;
      
      // Fetch initial page to get ViewState
      logger.debug(`Fetching initial page: ${baseUrl}`);
      const initialResponse = await fetch(baseUrl);
      const initialHtml = await initialResponse.text();
      
      // Extract ASP.NET ViewState and other form fields
      const viewState = this.extractFormField(initialHtml, '__VIEWSTATE');
      const viewStateGenerator = this.extractFormField(initialHtml, '__VIEWSTATEGENERATOR');
      const eventValidation = this.extractFormField(initialHtml, '__EVENTVALIDATION');
      
      if (!viewState) {
        logger.warn('Could not extract ViewState from initial page');
        return gazettes;
      }
      
      // Generate yearly windows to avoid timeout
      const windows = this.generateYearlyWindows();
      logger.debug(`Generated ${windows.length} yearly windows`);
      
      for (const window of windows) {
        logger.debug(`Processing window: ${window.start} to ${window.end}`);
        
        // Build form data
        const formData = new URLSearchParams();
        formData.append('__EVENTTARGET', 'ctl00$body$btnBuscaPalavrachave');
        formData.append('__VIEWSTATE', viewState);
        if (viewStateGenerator) {
          formData.append('__VIEWSTATEGENERATOR', viewStateGenerator);
        }
        if (eventValidation) {
          formData.append('__EVENTVALIDATION', eventValidation);
        }
        formData.append('ctl00$body$txtDtPeriodo', `${window.start}-${window.end}`);
        
        // Submit form
        const response = await fetch(baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: formData.toString(),
        });
        
        if (!response.ok) {
          logger.warn(`Failed to fetch window ${window.start}-${window.end}: ${response.status}`);
          continue;
        }
        
        const html = await response.text();
        
        // Parse gazette list
        const $ = this.loadHTML(html);
        const editions = $('div.panel');
        
        logger.debug(`Found ${editions.length} editions in this window`);
        
        editions.each((_, element) => {
          const $edition = $(element);
          const metadata = $edition.find('div.panel-title').text();
          
          // Extract edition number (e.g., "123/2024")
          const editionMatch = metadata.match(/(\d+)\//);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;
          
          // Extract date (DD/MM/YYYY)
          const dateMatch = metadata.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) return;
          
          const day = dateMatch[1];
          const month = dateMatch[2];
          const year = dateMatch[3];
          const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
          
          // Check if date is in range
          if (!this.isInDateRange(date)) return;
          
          // Extract PDF URL
          const onclickAttr = $edition.find('a[onclick]').attr('onclick');
          if (!onclickAttr) return;
          
          const urlMatch = onclickAttr.match(/l=(.+)'/);
          if (!urlMatch) return;
          
          const urlPath = urlMatch[1];
          const gazetteUrl = `https://www.municipioonline.com.br/${this.urlUf}/prefeitura/${this.urlCity}/cidadao/diariooficial/diario?n=diario.pdf&l=${urlPath}`;
          
          gazettes.push(this.createGazette(date, gazetteUrl, {
            editionNumber,
            isExtraEdition: false,
            power: 'executive',
          }));
        });
        
        // Add delay between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from MunicipioOnline`);
    } catch (error) {
      logger.error(`Error crawling MunicipioOnline: ${error}`);
      throw error;
    }

    return gazettes;
  }

  /**
   * Extract form field value from HTML
   */
  private extractFormField(html: string, fieldName: string): string | null {
    const regex = new RegExp(`<input[^>]*name="${fieldName}"[^>]*value="([^"]*)"`, 'i');
    const match = html.match(regex);
    return match ? match[1] : null;
  }

  /**
   * Generate yearly windows in DD/MM/YYYY format
   * Maximum interval is 1 year to avoid server timeout
   */
  private generateYearlyWindows(): Array<{ start: string; end: string }> {
    const windows: Array<{ start: string; end: string }> = [];
    
    let currentStart = new Date(this.startDate);
    const endDate = new Date(this.endDate);
    
    while (currentStart < endDate) {
      const currentEnd = new Date(currentStart);
      currentEnd.setFullYear(currentEnd.getFullYear() + 1);
      currentEnd.setDate(currentEnd.getDate() - 1);
      
      // Don't exceed end date
      if (currentEnd > endDate) {
        currentEnd.setTime(endDate.getTime());
      }
      
      windows.push({
        start: this.formatDateBR(currentStart),
        end: this.formatDateBR(currentEnd),
      });
      
      // Move to next year
      currentStart.setFullYear(currentStart.getFullYear() + 1);
    }
    
    return windows;
  }

  /**
   * Format date as DD/MM/YYYY
   */
  private formatDateBR(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }
}
