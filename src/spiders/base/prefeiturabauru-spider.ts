import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraBauruConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * PrefeituraBauruSpider implementation
 * 
 * Crawls Bauru's official gazette website.
 * 
 * Site structure:
 * - Page URL: https://www2.bauru.sp.gov.br/juridico/diariooficial.aspx
 * - PDF URL: https://www2.bauru.sp.gov.br/arquivos/sist_diariooficial/{YYYY}/{MM}/do_{YYYYMMDD}_{EDITION}.pdf
 * 
 * The site uses ASP.NET with JavaScript-rendered accordion menus showing years and months.
 * Since we cannot easily predict edition numbers, this spider:
 * 1. Uses browser automation to navigate the page
 * 2. Expands year/month sections to find gazette links
 * 3. Extracts PDF URLs from the link hrefs
 * 4. Filters by date range
 */
export class PrefeituraBauruSpider extends BaseSpider {
  protected bauruConfig: PrefeituraBauruConfig;
  private browser?: Fetcher;
  private static readonly PDF_BASE_URL = 'https://www2.bauru.sp.gov.br/arquivos/sist_diariooficial';

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.bauruConfig = spiderConfig.config as PrefeituraBauruConfig;
    
    if (!this.bauruConfig.baseUrl) {
      throw new Error(`PrefeituraBauruSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraBauruSpider for ${spiderConfig.name}`);
  }

  /**
   * Set the browser instance for web scraping
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.bauruConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Get the years we need to check based on date range
      const startYear = new Date(this.startDate).getFullYear();
      const endYear = new Date(this.endDate).getFullYear();
      
      logger.info(`Checking years ${startYear} to ${endYear}`);

      // For each year/month combination in our range, try to find gazettes
      const currentDate = new Date(this.startDate);
      const endDate = new Date(this.endDate);
      
      // Group dates by year/month to minimize requests
      const yearMonths = new Set<string>();
      while (currentDate <= endDate) {
        const year = currentDate.getFullYear();
        const month = (currentDate.getMonth() + 1).toString().padStart(2, '0');
        yearMonths.add(`${year}/${month}`);
        currentDate.setMonth(currentDate.getMonth() + 1);
      }
      
      // Also add the specific start and end months
      const startMonth = (new Date(this.startDate).getMonth() + 1).toString().padStart(2, '0');
      const endMonth = (new Date(this.endDate).getMonth() + 1).toString().padStart(2, '0');
      yearMonths.add(`${startYear}/${startMonth}`);
      yearMonths.add(`${endYear}/${endMonth}`);

      // Try to fetch gazette page and parse links
      // Since the page requires JavaScript, we'll try a different approach:
      // Construct URLs based on known patterns and check if they exist
      
      // Alternative approach: iterate through dates and check if PDF exists
      const dates = this.generateDateRange();
      logger.info(`Generated ${dates.length} dates to check`);

      for (const date of dates) {
        try {
          // Try to find gazette for this date
          // We'll try common edition number patterns (the edition number increases sequentially)
          // Based on the site, recent editions are around 4000+
          
          const pdfUrl = await this.findGazetteForDate(date);
          
          if (!pdfUrl) {
            logger.debug(`No gazette found for date ${toISODate(date)}`);
            continue;
          }

          // Create the gazette object
          const gazette = await this.createGazette(date, pdfUrl, {
            power: 'executive_legislative',
            sourceText: `Diário Oficial de Bauru - ${this.formatDateBrazilian(date)}`,
          });

          if (gazette) {
            gazettes.push(gazette);
            logger.info(`Found gazette for ${toISODate(date)}: ${pdfUrl}`);
          }

          // Add small delay between requests to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 200));

        } catch (error) {
          logger.error(`Error processing date ${toISODate(date)}:`, error as Error);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Find gazette PDF URL for a given date
   * Since edition numbers aren't predictable, we try to scrape the page or
   * use a range of likely edition numbers
   */
  private async findGazetteForDate(date: Date): Promise<string | null> {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const dateStr = `${year}${month}${day}`;
    
    // Try to find by scraping the main page if browser is available
    if (this.browser) {
      const pdfUrl = await this.findGazetteFromPage(date);
      if (pdfUrl) {
        return pdfUrl;
      }
    }
    
    // Fallback: try common edition patterns
    // Based on the site, editions are numbered sequentially
    // As of Dec 2025, editions are around 4070
    // We'll estimate based on date distance from a known reference point
    
    // Reference: 2025-12-11 = edition 4070
    const referenceDate = new Date('2025-12-11');
    const referenceEdition = 4070;
    
    // Bauru publishes roughly 2-3 times per week
    // Approximate: ~0.4 editions per day on average
    const daysDiff = Math.floor((date.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24));
    const estimatedEdition = Math.round(referenceEdition + (daysDiff * 0.4));
    
    // Try a range around the estimated edition
    const editionsToTry = [];
    for (let i = -10; i <= 10; i++) {
      editionsToTry.push(estimatedEdition + i);
    }
    
    for (const edition of editionsToTry) {
      if (edition <= 0) continue;
      
      const pdfUrl = `${PrefeituraBauruSpider.PDF_BASE_URL}/${year}/${month}/do_${dateStr}_${edition}.pdf`;
      
      const exists = await this.checkPdfExists(pdfUrl);
      if (exists) {
        return pdfUrl;
      }
    }
    
    return null;
  }

  /**
   * Try to find gazette URL by scraping the main page
   * This requires browser automation due to JavaScript rendering
   */
  private async findGazetteFromPage(date: Date): Promise<string | null> {
    try {
      if (!this.browser) {
        return null;
      }
      
      // Fetch the main page
      const response = await this.browser.fetch(this.bauruConfig.baseUrl, {
        method: 'GET',
      });
      
      if (!response.ok) {
        return null;
      }
      
      const html = await response.text();
      
      // Look for links matching the date pattern
      const day = date.getDate().toString().padStart(2, '0');
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const year = date.getFullYear();
      const dateStr = `${day}/${month}/${year}`;
      
      // Pattern: href="/arquivos/sist_diariooficial/2025/12/do_20251211_4070.pdf"
      const pattern = new RegExp(
        `href=["']([^"']*arquivos/sist_diariooficial/${year}/${month}/do_${year}${month}${day}_\\d+\\.pdf)["']`,
        'i'
      );
      
      const match = html.match(pattern);
      if (match) {
        let pdfUrl = match[1];
        // Make absolute URL if relative
        if (pdfUrl.startsWith('/')) {
          pdfUrl = `https://www2.bauru.sp.gov.br${pdfUrl}`;
        }
        return pdfUrl;
      }
      
      return null;
    } catch (error) {
      logger.debug(`Error fetching page for date ${toISODate(date)}: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Check if PDF exists by making a HEAD request
   */
  private async checkPdfExists(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(10000),
      });
      
      return response.ok;
    } catch (error) {
      logger.debug(`Error checking PDF ${url}: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Generate array of dates to check (daily intervals)
   */
  private generateDateRange(): Date[] {
    const dates: Date[] = [];
    const currentDate = new Date(this.startDate);
    const endDate = new Date(this.endDate);

    while (currentDate <= endDate) {
      dates.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return dates;
  }

  /**
   * Format date in Brazilian format: DD de MMMM de YYYY
   */
  private formatDateBrazilian(date: Date): string {
    const months = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    
    const day = date.getDate().toString().padStart(2, '0');
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    
    return `${day} de ${month} de ${year}`;
  }
}


