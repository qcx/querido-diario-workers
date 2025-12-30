import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, LegislacaoDigitalConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * LegislacaoDigitalSpider implementation for Legislação Digital platform
 * 
 * Used by municipalities like Arujá that use the legislacaodigital.com.br platform
 * URL pattern: https://www.legislacaodigital.com.br/{City}-{State}/
 * 
 * This spider requires browser rendering as the platform uses JavaScript
 * to load gazette listings dynamically.
 */
export class LegislacaoDigitalSpider extends BaseSpider {
  private legislacaoConfig: LegislacaoDigitalConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.legislacaoConfig = spiderConfig.config as LegislacaoDigitalConfig;
    this.browser = browser || null;

    if (!this.legislacaoConfig.baseUrl) {
      throw new Error(`LegislacaoDigitalSpider requires a baseUrl in config for ${spiderConfig.name}`);
    }
    logger.info(`Initializing LegislacaoDigitalSpider for ${spiderConfig.name} with URL: ${this.legislacaoConfig.baseUrl}`, {
      hasBrowser: !!this.browser,
    });
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.legislacaoConfig.baseUrl} for ${this.spiderConfig.name}...`);

    if (!this.browser) {
      logger.warn(`No browser available for LegislacaoDigitalSpider, skipping ${this.spiderConfig.name}`);
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

      // Navigate to the diário oficial section
      const diarioUrl = this.legislacaoConfig.baseUrl.includes('/diario-oficial') 
        ? this.legislacaoConfig.baseUrl 
        : `${this.legislacaoConfig.baseUrl.replace(/\/$/, '')}/diario-oficial`;

      await page.goto(diarioUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;

      // Wait for content to load
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Parse the page to find gazette entries
      const gazetteData = await page.evaluate(() => {
        const results: Array<{ date: string; pdfUrl: string; edition?: string; title?: string }> = [];
        
        // Legislação Digital typically uses a list or table structure
        // Look for gazette entries with dates and PDF links
        const entries = document.querySelectorAll(
          '.diario-item, .publicacao-item, tr, .list-group-item, article, .card'
        );
        
        entries.forEach((entry) => {
          // Find date - could be in various formats
          const dateEl = entry.querySelector('.date, .data, time, [datetime], td:first-child, .text-muted');
          const linkEl = entry.querySelector('a[href*=".pdf"], a[href*="download"], a[href*="arquivo"]');
          const titleEl = entry.querySelector('.title, .titulo, h3, h4, h5, td:nth-child(2), strong');
          
          if (linkEl) {
            const href = linkEl.getAttribute('href') || '';
            if (href) {
              results.push({
                date: dateEl?.textContent?.trim() || dateEl?.getAttribute('datetime') || '',
                pdfUrl: href,
                title: titleEl?.textContent?.trim() || linkEl.textContent?.trim()
              });
            }
          }
        });

        // Try alternate structure - direct PDF links
        if (results.length === 0) {
          const pdfLinks = document.querySelectorAll('a[href*=".pdf"]');
          pdfLinks.forEach((link) => {
            const href = link.getAttribute('href') || '';
            const parent = link.closest('tr, li, .item, article, div');
            const dateText = parent?.textContent || '';
            
            results.push({
              date: dateText,
              pdfUrl: href,
              title: link.textContent?.trim()
            });
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
          pdfUrl = `https://www.legislacaodigital.com.br${pdfUrl}`;
        } else if (!pdfUrl.startsWith('http')) {
          pdfUrl = new URL(pdfUrl, this.legislacaoConfig.baseUrl).href;
        }

        const gazette: Gazette = {
          id: this.generateGazetteId(parsedDate, item.title || ''),
          territoryId: this.spiderConfig.territoryId,
          territoryName: this.spiderConfig.name.replace(' - SP', ''),
          stateCode: 'SP',
          date: toISODate(parsedDate),
          source: this.legislacaoConfig.baseUrl,
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

