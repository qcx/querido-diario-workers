import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraJanaubaConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Spider for Prefeitura de Janaúba diário oficial
 * 
 * Site Structure:
 * - URL: https://www.janauba.mg.leg.br/diario-oficial
 * - Uses JavaScript to load gazette listings
 * - Requires browser rendering
 */
export class PrefeituraJanaubaSpider extends BaseSpider {
  protected janaubaConfig: PrefeituraJanaubaConfig;
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.janaubaConfig = spiderConfig.config as PrefeituraJanaubaConfig;
    this.baseUrl = this.janaubaConfig.baseUrl || 'https://www.janauba.mg.leg.br/diario-oficial';
    this.browser = browser || null;
    
    logger.info(`Initializing PrefeituraJanaubaSpider for ${spiderConfig.name} with URL: ${this.baseUrl}`, {
      hasBrowser: !!this.browser,
    });
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.baseUrl} for ${this.spiderConfig.name}...`);

    if (!this.browser) {
      logger.warn(`No browser available for PrefeituraJanaubaSpider, trying fetch-based approach`);
      return this.crawlWithFetch();
    }

    return this.crawlWithBrowser();
  }

  private async crawlWithFetch(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      const response = await fetch(this.baseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        }
      });

      if (!response.ok) {
        logger.error(`Failed to fetch ${this.baseUrl}: ${response.status}`);
        return gazettes;
      }

      this.requestCount++;
      logger.warn(`PrefeituraJanaubaSpider: Fetch-based approach may not work, browser rendering recommended`);
    } catch (error) {
      logger.error(`Error in fetch-based crawl:`, error as Error);
    }

    return gazettes;
  }

  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();

      logger.debug(`Navigating to: ${this.baseUrl}`);
      await page.goto(this.baseUrl, { waitUntil: 'load', timeout: 30000 });
      this.requestCount++;

      // Wait for page to stabilize and JavaScript to execute
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Check if page has login form (may indicate public access is restricted)
      const pageCheck = await page.evaluate(() => {
        const hasPasswordField = !!document.querySelector('input[type="password"]');
        const hasLoginButton = !!Array.from(document.querySelectorAll('button, a')).find(el => {
          const text = (el.textContent || '').toLowerCase();
          return text.includes('login') || text.includes('entrar') || text.includes('acessar');
        });
        const bodyText = document.body?.textContent || '';
        const hasLoginText = bodyText.toLowerCase().includes('login') || bodyText.toLowerCase().includes('acessar');
        
        return {
          hasLoginForm: hasPasswordField || hasLoginButton,
          hasPasswordField,
          hasLoginButton,
          hasLoginText,
          bodyTextLength: bodyText.length,
          bodyTextPreview: bodyText.substring(0, 300)
        };
      });

      if (pageCheck.hasLoginForm) {
        logger.warn('Page appears to require login', {
          hasPasswordField: pageCheck.hasPasswordField,
          hasLoginButton: pageCheck.hasLoginButton,
          bodyTextLength: pageCheck.bodyTextLength
        });
      }
      
      logger.debug('Page check result:', pageCheck);

      // Try multiple strategies to find gazette content
      // Strategy 1: Wait for any content containers
      try {
        await page.waitForSelector('body', { timeout: 5000 });
      } catch (error) {
        logger.warn('Body not found');
      }

      // Wait for dynamic content to load (AJAX, etc)
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Try to wait for specific gazette selectors
      try {
        await page.waitForSelector('a[href*="pdf"], a[href*="download"], a[href*="visualizar"], table, .card, article, [class*="diario"], [class*="gazette"], [class*="edicao"]', { timeout: 5000 });
      } catch (error) {
        logger.debug('Specific gazette selectors not found - will try broader extraction');
      }

      // Additional wait to ensure all dynamic content is loaded
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Debug: Log page title and URL to verify we're on the right page
      const pageInfo = await page.evaluate(() => ({
        title: document.title,
        url: window.location.href,
        bodyText: document.body?.textContent?.substring(0, 500) || '',
      }));
      logger.debug('Page info:', pageInfo);

      const pageGazettes = await this.extractGazettesFromPage(page);

      for (const gazette of pageGazettes) {
        if (gazette) {
          const gazetteDate = new Date(gazette.date);
          if (this.isInDateRange(gazetteDate)) {
            gazettes.push(gazette);
          }
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from browser`);

    } catch (error) {
      logger.error(`Error crawling with browser:`, error as Error);
    } finally {
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

  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      const gazetteData = await page.evaluate(() => {
        const results: Array<{
          date: string;
          pdfUrl: string;
          edition?: string;
          title?: string;
        }> = [];

        // Debug: Log page structure
        const debugInfo: any = {
          totalLinks: 0,
          pdfLinks: 0,
          tables: 0,
          cards: 0,
          bodyText: document.body?.textContent?.substring(0, 500) || '',
        };

        // Collect all links for debugging
        const allLinks = Array.from(document.querySelectorAll('a'));
        debugInfo.totalLinks = allLinks.length;
        debugInfo.pdfLinks = allLinks.filter(l => {
          const href = l.getAttribute('href') || '';
          return href.includes('.pdf') || href.includes('download') || href.includes('diario') || href.includes('edicao');
        }).length;

        console.log('[Janauba Debug]', JSON.stringify(debugInfo, null, 2));

        // Strategy 1: Look for any links that might lead to gazettes
        const potentialGazetteLinks = allLinks.filter(link => {
          const href = (link.getAttribute('href') || '').toLowerCase();
          const text = (link.textContent || '').toLowerCase();
          return href.includes('diario') || href.includes('edicao') || href.includes('edição') ||
                 text.includes('diário') || text.includes('diario') || text.includes('edição') ||
                 text.includes('edicao') || href.includes('.pdf') || href.includes('download');
        });

        console.log('[Janauba Debug] Found', potentialGazetteLinks.length, 'potential gazette links');

        // Strategy 2: Look for table rows with gazette information
        const tableRows = document.querySelectorAll('table tbody tr, .gazette-item, .publication-item, .list-group-item');
        debugInfo.tables = tableRows.length;
        
        tableRows.forEach((row: Element) => {
          const dateEl = row.querySelector('[data-date], .date, .data, time, td:first-child, .card-subtitle');
          const linkEl = row.querySelector('a[href*=".pdf"], a[href*="download"], a[href*="visualizar"], a.download-btn, a');
          
          if (linkEl) {
            const href = linkEl.getAttribute('href') || '';
            const dateText = dateEl?.textContent?.trim() || '';
            const rowText = row.textContent || '';
            const title = row.querySelector('.title, .titulo, td:nth-child(2), .card-title, h3, h4')?.textContent?.trim();
            
            // Try to extract date from row text if not found in dateEl
            const dateMatch = dateText ? null : rowText.match(/(\d{2}\/\d{2}\/\d{4})/);
            const finalDateText = dateText || (dateMatch ? dateMatch[1] : '');
            
            const editionMatch = (finalDateText + ' ' + rowText + ' ' + (title || '')).match(/(?:edi[çc][ãa]o|ed\.?|n[úu]mero|n[°º]?\.?)\s*[°º]?\s*(\d+)/i);
            
            // Accept if we have either a date or a PDF link
            if (href && (finalDateText || href.includes('.pdf') || href.includes('download'))) {
              results.push({
                date: finalDateText,
                pdfUrl: href,
                edition: editionMatch ? editionMatch[1] : undefined,
                title: title || rowText.substring(0, 100).trim()
              });
            }
          }
        });

        // Strategy 3: Look for cards or grid items
        if (results.length === 0) {
          const cards = document.querySelectorAll('.card, .publication, article, [class*="gazette"], [class*="diario"], [class*="edicao"], [class*="ediçao"], div[class*="item"], li');
          debugInfo.cards = cards.length;
          
          cards.forEach((card: Element) => {
            const dateEl = card.querySelector('.date, .data, time, .card-subtitle, [class*="date"], [class*="data"]');
            const linkEl = card.querySelector('a[href*=".pdf"], a[href*="download"], a[href*="visualizar"], a[href*="diario"], a[href*="edicao"], a');
            const titleEl = card.querySelector('.title, .titulo, .card-title, h3, h4, h5, h6');
            const cardText = card.textContent || '';
            
            if (linkEl) {
              const href = linkEl.getAttribute('href') || '';
              const dateText = dateEl?.textContent?.trim() || '';
              const title = titleEl?.textContent?.trim();
              
              // Try to extract date from card text
              const dateMatch = dateText ? null : cardText.match(/(\d{2}\/\d{2}\/\d{4})/);
              const finalDateText = dateText || (dateMatch ? dateMatch[1] : '');
              
              const editionMatch = (finalDateText + ' ' + cardText + ' ' + (title || '')).match(/(?:edi[çc][ãa]o|ed\.?|n[úu]mero|n[°º]?\.?)\s*[°º]?\s*(\d+)/i);
              
              // Accept if we have either a date or a meaningful link
              if (href && (finalDateText || href.includes('.pdf') || href.includes('download') || href.includes('diario'))) {
                results.push({
                  date: finalDateText,
                  pdfUrl: href,
                  edition: editionMatch ? editionMatch[1] : undefined,
                  title: title || cardText.substring(0, 100).trim()
                });
              }
            }
          });
        }

        // Strategy 4: Look for any PDF links with dates nearby
        if (results.length === 0) {
          const pdfLinks = Array.from(document.querySelectorAll('a[href*=".pdf"], a[href*="download"], a[href*="diario"], a[href*="edicao"]'));
          pdfLinks.forEach((link: Element) => {
            const href = link.getAttribute('href') || '';
            // Find date in parent or nearby elements
            let parent = link.parentElement;
            let dateText = '';
            let title = '';
            
            for (let i = 0; i < 10 && parent; i++) {
              const text = parent.textContent || '';
              const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{4})/);
              if (dateMatch) {
                dateText = dateMatch[1];
                title = text.substring(0, 200).trim();
                break;
              }
              parent = parent.parentElement;
            }
            
            // Also check sibling elements
            if (!dateText && link.parentElement) {
              const siblings = Array.from(link.parentElement.children);
              for (const sibling of siblings) {
                const text = sibling.textContent || '';
                const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{4})/);
                if (dateMatch) {
                  dateText = dateMatch[1];
                  title = text.substring(0, 200).trim();
                  break;
                }
              }
            }
            
            if (href) {
              const editionMatch = (dateText + ' ' + title).match(/(?:edi[çc][ãa]o|ed\.?|n[úu]mero|n[°º]?\.?)\s*[°º]?\s*(\d+)/i);
              results.push({
                date: dateText,
                pdfUrl: href,
                edition: editionMatch ? editionMatch[1] : undefined,
                title: title || undefined
              });
            }
          });
        }

        // Strategy 5: Look for any text containing dates and "diário" or "edição"
        if (results.length === 0) {
          const allText = document.body?.textContent || '';
          const dateMatches = Array.from(allText.matchAll(/(\d{2}\/\d{2}\/\d{4})/g));
          console.log('[Janauba Debug] Found', dateMatches.length, 'dates in page text');
          
          // For each date, try to find nearby links
          dateMatches.slice(0, 20).forEach(match => {
            const dateText = match[1];
            // Look for links near this date in the DOM
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            let node;
            while (node = walker.nextNode()) {
              if (node.textContent?.includes(dateText)) {
                let parent = node.parentElement;
                for (let i = 0; i < 5 && parent; i++) {
                  const link = parent.querySelector('a[href]');
                  if (link) {
                    const href = link.getAttribute('href') || '';
                    if (href && !results.some(r => r.pdfUrl === href)) {
                      results.push({
                        date: dateText,
                        pdfUrl: href,
                        title: parent.textContent?.substring(0, 100).trim()
                      });
                      break;
                    }
                  }
                  parent = parent.parentElement;
                }
                break;
              }
            }
          });
        }

        console.log('[Janauba Debug] Extraction results:', results.length, 'items found');
        return { results, debugInfo };
      });

      const extractedResults = Array.isArray(gazetteData) ? gazetteData : gazetteData.results || [];
      const debugInfo = Array.isArray(gazetteData) ? null : gazetteData.debugInfo;

      if (debugInfo) {
        logger.debug('Extraction debug info:', debugInfo);
      }

      logger.info(`Extracted ${extractedResults.length} potential gazette items from page`);

      // Process gazette data
      for (const item of extractedResults) {
        const parsedDate = this.parseBrazilianDate(item.date);
        if (!parsedDate) {
          logger.debug(`Could not parse date: ${item.date}`);
          continue;
        }

        // Check if date is in range
        if (!this.isInDateRange(parsedDate)) {
          continue;
        }

        // Resolve relative URLs
        let pdfUrl = item.pdfUrl;
        if (pdfUrl.startsWith('/')) {
          const baseUrlObj = new URL(this.baseUrl);
          pdfUrl = `${baseUrlObj.protocol}//${baseUrlObj.host}${pdfUrl}`;
        } else if (!pdfUrl.startsWith('http')) {
          pdfUrl = new URL(pdfUrl, this.baseUrl).href;
        }

        const gazette: Gazette = {
          date: toISODate(parsedDate),
          fileUrl: pdfUrl,
          territoryId: this.spiderConfig.territoryId,
          scrapedAt: new Date().toISOString(),
          power: 'executive',
          isExtraEdition: false,
        };

        if (item.edition) {
          gazette.editionNumber = item.edition;
        }

        gazettes.push(gazette);
      }

    } catch (error) {
      logger.error(`Error extracting gazettes from page:`, error as Error);
    }

    return gazettes;
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
}

