import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, GeosiapConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * GeosiapSpider implementation for GeoSIAP platform
 * 
 * Used by municipalities like Jacareí that use the GeoSIAP platform
 * URL pattern: https://boletinsoficiais.geosiap.net/{city}/public/publicacoes
 * 
 * This spider requires browser rendering as the platform uses JavaScript
 * to load and display gazette listings.
 */
export class GeosiapSpider extends BaseSpider {
  private geosiapConfig: GeosiapConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.geosiapConfig = spiderConfig.config as GeosiapConfig;
    this.browser = browser || null;

    if (!this.geosiapConfig.baseUrl) {
      throw new Error(`GeosiapSpider requires a baseUrl in config for ${spiderConfig.name}`);
    }
    logger.info(`Initializing GeosiapSpider for ${spiderConfig.name} with URL: ${this.geosiapConfig.baseUrl}`, {
      hasBrowser: !!this.browser,
    });
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.geosiapConfig.baseUrl} for ${this.spiderConfig.name}...`);

    if (!this.browser) {
      logger.warn(`No browser available for GeosiapSpider, skipping ${this.spiderConfig.name}`);
      return [];
    }

    return this.crawlWithBrowser();
  }

  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();

      await page.goto(this.geosiapConfig.baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;

      // Wait for content to load
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Get page content
      const content = await page.content();
      
      // Parse the page to find gazette entries
      // GeoSIAP typically uses a table or list structure with dates and PDF links
      const gazetteData = await page.evaluate(() => {
        const results: Array<{ date: string; pdfUrl: string; edition?: string; title?: string }> = [];
        
        // Try common patterns for GeoSIAP
        // Pattern 1: Table rows with date and download link
        const tableRows = document.querySelectorAll('table tbody tr, .publication-item, .gazette-item, .list-group-item');
        
        tableRows.forEach((row) => {
          const dateEl = row.querySelector('[data-date], .date, .data, time, td:first-child');
          const linkEl = row.querySelector('a[href*=".pdf"], a[href*="download"], a.download-btn');
          
          if (dateEl && linkEl) {
            const dateText = dateEl.textContent?.trim() || '';
            const href = linkEl.getAttribute('href') || '';
            const title = row.querySelector('.title, .titulo, td:nth-child(2)')?.textContent?.trim();
            
            if (href) {
              results.push({
                date: dateText,
                pdfUrl: href,
                title: title
              });
            }
          }
        });

        // Pattern 2: Cards or grid items
        if (results.length === 0) {
          const cards = document.querySelectorAll('.card, .publication, article');
          cards.forEach((card) => {
            const dateEl = card.querySelector('.date, .data, time, .card-subtitle');
            const linkEl = card.querySelector('a[href*=".pdf"], a[href*="download"]');
            const titleEl = card.querySelector('.title, .titulo, .card-title, h3, h4');
            
            if (linkEl) {
              const href = linkEl.getAttribute('href') || '';
              results.push({
                date: dateEl?.textContent?.trim() || '',
                pdfUrl: href,
                title: titleEl?.textContent?.trim()
              });
            }
          });
        }

        return results;
      });

      // Process gazette data
      for (const item of gazetteData) {
        const parsedDate = this.parseBrazilianDate(item.date);
        if (!parsedDate) {
          logger.debug(`Could not parse date: ${item.date}`);
          continue;
        }

        // Check if date is in range
        if (!this.isDateInRange(parsedDate)) {
          continue;
        }

        // Resolve relative URLs
        let pdfUrl = item.pdfUrl;
        if (pdfUrl.startsWith('/')) {
          const baseUrlObj = new URL(this.geosiapConfig.baseUrl);
          pdfUrl = `${baseUrlObj.protocol}//${baseUrlObj.host}${pdfUrl}`;
        } else if (!pdfUrl.startsWith('http')) {
          pdfUrl = new URL(pdfUrl, this.geosiapConfig.baseUrl).href;
        }

        const gazette: Gazette = {
          id: this.generateGazetteId(parsedDate, item.title || ''),
          territoryId: this.spiderConfig.territoryId,
          territoryName: this.spiderConfig.name.replace(' - SP', ''),
          stateCode: 'SP',
          date: toISODate(parsedDate),
          source: this.geosiapConfig.baseUrl,
          urls: [pdfUrl],
          power: 'executive',
          scraped_at: new Date().toISOString(),
          gazette_type: 'standard',
        };

        if (item.title) {
          gazette.edition_number = this.extractEditionNumber(item.title);
        }

        gazettes.push(gazette);
      }

      logger.info(`Found ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      return gazettes;
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, { error });
      return gazettes;
    } finally {
      if (page) await page.close().catch(() => {});
      if (browserInstance) await browserInstance.close().catch(() => {});
    }
  }

  private parseBrazilianDate(dateStr: string): Date | null {
    if (!dateStr) return null;

    // Common Brazilian date formats: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
    const patterns = [
      /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/,
      /(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/, // ISO format
    ];

    for (const pattern of patterns) {
      const match = dateStr.match(pattern);
      if (match) {
        if (pattern === patterns[1]) {
          // ISO format YYYY-MM-DD
          return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
        }
        // Brazilian format DD/MM/YYYY
        return new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
      }
    }

    return null;
  }

  private isDateInRange(date: Date): boolean {
    const start = new Date(this.dateRange.start);
    const end = new Date(this.dateRange.end);
    return date >= start && date <= end;
  }

  private generateGazetteId(date: Date, title: string): string {
    const dateStr = toISODate(date);
    const titleSlug = title.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 20);
    return `${this.spiderConfig.id}_${dateStr}_${titleSlug}`;
  }

  private extractEditionNumber(text: string): string | undefined {
    const match = text.match(/(?:edi[çc][ãa]o|ed\.?|n[úu]mero|n[°º]?\.?)\s*(\d+)/i);
    return match ? match[1] : undefined;
  }
}




