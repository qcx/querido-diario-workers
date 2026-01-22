import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraRjGuapimirimConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp } from '../../utils/date-utils';

interface GazetteEntry {
  date: Date;
  pdfUrl: string;
  editionNumber: string;
  pageUrl: string;
}

/**
 * PrefeituraRjGuapimirimSpider implementation
 * 
 * Crawls Guapimirim's official gazette website.
 * 
 * Site structure:
 * - Main page URL: https://guapimirim.rj.gov.br/novo-diario-{YEAR}/
 * - Individual gazette page: https://guapimirim.rj.gov.br/{YEAR}/{MM}/diario-{EDITION}-{DD}-{MM}/
 * - PDF URL: https://guapimirim.rj.gov.br/wp-content/uploads/{YEAR}/{MM}/Diario-{EDITION}.pdf
 * 
 * The site is WordPress-based with Elementor. Each year has its own page listing all gazettes.
 * Each gazette entry links to an individual page where the PDF is embedded.
 * 
 * This spider:
 * 1. Determines which year pages to crawl based on date range
 * 2. Fetches each year's listing page
 * 3. Extracts gazette links and dates from the listings
 * 4. For each gazette in the date range, fetches the individual page to get the PDF URL
 */
export class PrefeituraRjGuapimirimSpider extends BaseSpider {
  protected guapimirimConfig: PrefeituraRjGuapimirimConfig;
  private browser: Fetcher | null = null;
  private static readonly BASE_URL = 'https://guapimirim.rj.gov.br';

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.guapimirimConfig = spiderConfig.config as PrefeituraRjGuapimirimConfig;
    this.browser = browser || null;
    
    if (!this.guapimirimConfig.baseUrl) {
      throw new Error(`PrefeituraRjGuapimirimSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraRjGuapimirimSpider for ${spiderConfig.name}`);
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling Guapimirim gazettes for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error(`PrefeituraRjGuapimirimSpider requires browser binding for ${this.spiderConfig.name}`);
    }
    
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      
      // Set viewport
      await page.setViewport({ width: 1280, height: 800 });
      
      // Determine which years to crawl based on date range
      const startYear = this.startDate.getFullYear();
      const endYear = this.endDate.getFullYear();
      
      logger.info(`Crawling years from ${startYear} to ${endYear}`);
      
      // Collect all gazette entries from year pages
      const allEntries: GazetteEntry[] = [];
      
      for (let year = endYear; year >= startYear; year--) {
        const yearUrl = this.getYearPageUrl(year);
        logger.info(`Fetching year page: ${yearUrl}`);
        
        try {
          await page.goto(yearUrl, { waitUntil: 'networkidle0', timeout: 30000 });
          this.requestCount++;
          
          // Wait for content to load
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Accept cookie consent if present
          try {
            const acceptButton = await page.$('button:has-text("Aceitar")');
            if (acceptButton) {
              await acceptButton.click();
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          } catch {
            // Ignore - no cookie banner
          }
          
          // Extract gazette entries from this year's page
          const entries = await this.extractGazetteEntriesFromYearPage(page, year);
          logger.info(`Found ${entries.length} gazette entries for year ${year}`);
          
          allEntries.push(...entries);
        } catch (error) {
          logger.warn(`Error fetching year ${year}: ${(error as Error).message}`);
        }
      }
      
      logger.info(`Total gazette entries found: ${allEntries.length}`);
      
      // Filter entries by date range
      const filteredEntries = allEntries.filter(entry => this.isInDateRange(entry.date));
      logger.info(`Entries in date range: ${filteredEntries.length}`);
      
      // For each entry, fetch the individual page to get the PDF URL
      for (const entry of filteredEntries) {
        try {
          // If we already have a PDF URL from the listing, use it
          if (entry.pdfUrl) {
            const gazette: Gazette = {
              date: toISODate(entry.date),
              fileUrl: entry.pdfUrl,
              territoryId: this.spiderConfig.territoryId,
              scrapedAt: getCurrentTimestamp(),
              editionNumber: entry.editionNumber,
              isExtraEdition: false,
              power: 'executive_legislative',
              sourceText: `Diário Oficial de Guapimirim - Edição ${entry.editionNumber} - ${this.formatDateBrazilian(entry.date)}`,
            };
            gazettes.push(gazette);
            logger.info(`Found gazette for ${toISODate(entry.date)}: ${entry.pdfUrl}`);
          } else if (entry.pageUrl) {
            // Fetch individual page to get PDF URL
            const pdfUrl = await this.fetchPdfUrlFromGazettePage(page, entry.pageUrl);
            if (pdfUrl) {
              const gazette: Gazette = {
                date: toISODate(entry.date),
                fileUrl: pdfUrl,
                territoryId: this.spiderConfig.territoryId,
                scrapedAt: getCurrentTimestamp(),
                editionNumber: entry.editionNumber,
                isExtraEdition: false,
                power: 'executive_legislative',
                sourceText: `Diário Oficial de Guapimirim - Edição ${entry.editionNumber} - ${this.formatDateBrazilian(entry.date)}`,
              };
              gazettes.push(gazette);
              logger.info(`Found gazette for ${toISODate(entry.date)}: ${pdfUrl}`);
            }
          }
        } catch (error) {
          logger.error(`Error processing gazette entry for ${toISODate(entry.date)}:`, error as Error);
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
   * Get the URL for a year's gazette listing page
   */
  private getYearPageUrl(year: number): string {
    // The site uses different URL patterns:
    // 2026: /novo-diario-2026/
    // 2025: /novo-diario-2025/
    // 2024: /novo-diario-2024/
    // 2023: /novo-diario/ (this is 2023)
    // 2022: /novo-diario-ano-2022/
    // 2021: /novo-diario-ano-2021/
    // 2020: /novo-diario-ano-2020/
    // 2019: /novo-diario-ano-2019/
    
    if (year >= 2024) {
      return `${PrefeituraRjGuapimirimSpider.BASE_URL}/novo-diario-${year}/`;
    } else if (year === 2023) {
      return `${PrefeituraRjGuapimirimSpider.BASE_URL}/novo-diario/`;
    } else {
      return `${PrefeituraRjGuapimirimSpider.BASE_URL}/novo-diario-ano-${year}/`;
    }
  }

  /**
   * Extract gazette entries from a year's listing page
   */
  private async extractGazetteEntriesFromYearPage(page: any, year: number): Promise<GazetteEntry[]> {
    return page.evaluate((baseUrl: string, year: number) => {
      const entries: Array<{
        date: { year: number; month: number; day: number };
        pdfUrl: string;
        editionNumber: string;
        pageUrl: string;
      }> = [];
      
      // Find all article elements (gazette entries)
      const articles = document.querySelectorAll('article.elementor-post');
      
      for (const article of articles) {
        // Find the link to the gazette page
        const link = article.querySelector('a[href*="/diario-"]');
        if (!link) continue;
        
        const pageUrl = link.getAttribute('href') || '';
        
        // Extract date and edition from the link text or URL
        // Format: "Diário 1794 – 21/01" or URL like /2026/01/diario-1794-21-01/
        const linkText = link.textContent?.trim() || '';
        
        // Try to extract edition number and date from text
        // Pattern: "Diário XXXX – DD/MM"
        const textMatch = linkText.match(/Di[aá]rio\s+(\d+)\s*[–-]\s*(\d{1,2})\/(\d{1,2})/i);
        
        let editionNumber = '';
        let day = 0;
        let month = 0;
        
        if (textMatch) {
          editionNumber = textMatch[1];
          day = parseInt(textMatch[2]);
          month = parseInt(textMatch[3]);
        } else {
          // Try to extract from URL
          // Pattern: /YYYY/MM/diario-XXXX-DD-MM/
          const urlMatch = pageUrl.match(/\/(\d{4})\/(\d{2})\/diario-(\d+)-(\d{2})-(\d{2})/);
          if (urlMatch) {
            editionNumber = urlMatch[3];
            day = parseInt(urlMatch[4]);
            month = parseInt(urlMatch[5]);
          }
        }
        
        if (day > 0 && month > 0 && editionNumber) {
          entries.push({
            date: { year, month, day },
            pdfUrl: '', // Will be fetched from individual page
            editionNumber,
            pageUrl,
          });
        }
      }
      
      // Also look for direct PDF links if available
      const pdfLinks = document.querySelectorAll('a[href*=".pdf"]');
      for (const link of pdfLinks) {
        const href = link.getAttribute('href') || '';
        if (!href.includes('Diario-') && !href.includes('diario-')) continue;
        
        // Extract edition from PDF filename
        // Pattern: Diario-XXXX.pdf
        const pdfMatch = href.match(/[Dd]iario-(\d+)\.pdf/);
        if (pdfMatch) {
          const editionNumber = pdfMatch[1];
          
          // Try to get date from URL path
          // Pattern: /wp-content/uploads/YYYY/MM/Diario-XXXX.pdf
          const pathMatch = href.match(/\/uploads\/(\d{4})\/(\d{2})\/[Dd]iario-\d+\.pdf/);
          if (pathMatch) {
            const pdfYear = parseInt(pathMatch[1]);
            const pdfMonth = parseInt(pathMatch[2]);
            
            // We don't have the exact day from the PDF URL, skip these
            // They should be captured from the article entries above
          }
        }
      }
      
      return entries;
    }, PrefeituraRjGuapimirimSpider.BASE_URL, year).then((entries: any[]) => {
      return entries.map(e => ({
        date: new Date(Date.UTC(e.date.year, e.date.month - 1, e.date.day)),
        pdfUrl: e.pdfUrl,
        editionNumber: e.editionNumber,
        pageUrl: e.pageUrl,
      }));
    });
  }

  /**
   * Fetch the PDF URL from an individual gazette page
   */
  private async fetchPdfUrlFromGazettePage(page: any, pageUrl: string): Promise<string | null> {
    try {
      await page.goto(pageUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Wait for content to load
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Extract PDF URL from the page
      const pdfUrl = await page.evaluate(() => {
        // Look for PDF embedder link
        const pdfEmbed = document.querySelector('a.pdfemb-viewer[href*=".pdf"]');
        if (pdfEmbed) {
          return pdfEmbed.getAttribute('href');
        }
        
        // Look for direct PDF download link
        const downloadLink = document.querySelector('a[href*=".pdf"]');
        if (downloadLink) {
          return downloadLink.getAttribute('href');
        }
        
        // Look for PDF in iframe
        const iframe = document.querySelector('iframe[src*=".pdf"]');
        if (iframe) {
          return iframe.getAttribute('src');
        }
        
        return null;
      });
      
      return pdfUrl;
    } catch (error) {
      logger.warn(`Error fetching PDF URL from ${pageUrl}: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Format date in Brazilian format: DD de MMMM de YYYY
   */
  private formatDateBrazilian(date: Date): string {
    const months = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    
    const day = date.getUTCDate().toString().padStart(2, '0');
    const month = months[date.getUTCMonth()];
    const year = date.getUTCFullYear();
    
    return `${day} de ${month} de ${year}`;
  }
}
