import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraBaraoDeCocaisConfig } from '../../types';
import { logger } from '../../utils/logger';
import { parse } from 'node-html-parser';
import { toISODate } from '../../utils/date-utils';
import puppeteer from '@cloudflare/puppeteer';
import type { Fetcher } from '@cloudflare/workers-types';

/**
 * Spider for Prefeitura de Barão de Cocais downloads page
 * 
 * Site Structure:
 * - URL: https://www.baraodecocais.mg.gov.br/downloads/categoria/editais/7
 * - Downloads page with category filter for "Editais"
 * - List of publications with download links loaded via JavaScript/AJAX
 * - Pagination support
 * - Filters by date range and category
 * 
 * Requires browser rendering because data is loaded dynamically via JavaScript
 */
export class PrefeituraBaraoDeCocaisSpider extends BaseSpider {
  protected baraoDeCocaisConfig: PrefeituraBaraoDeCocaisConfig;
  private baseUrl: string;
  private browser?: Fetcher;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.baraoDeCocaisConfig = spiderConfig.config as PrefeituraBaraoDeCocaisConfig;
    this.baseUrl = this.baraoDeCocaisConfig.baseUrl || 'https://www.baraodecocais.mg.gov.br/downloads/categoria/editais/7';
    this.browser = browser;
    
    logger.info(`Initializing PrefeituraBaraoDeCocaisSpider for ${spiderConfig.name} with URL: ${this.baseUrl}`);
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(`PrefeituraBaraoDeCocaisSpider for ${this.spiderConfig.name} requires browser binding`);
      return [];
    }

    return this.crawlWithBrowser();
  }

  /**
   * Browser-based crawling for JavaScript-loaded content
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      logger.info(`Using browser-based crawling for ${this.spiderConfig.name}...`);
      
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Navigate to the base URL
      logger.debug(`Navigating to: ${this.baseUrl}`);
      await page.goto(this.baseUrl, { 
        waitUntil: 'networkidle0', 
        timeout: 30000 
      });
      this.requestCount++;
      
      // Wait for JavaScript to load the data via AjaxPro (dow_lis.GetDow)
      // The page uses AJAX to load downloads, so we need to wait for the content
      await new Promise(resolve => setTimeout(resolve, 8000));
      
      // Wait for the total records indicator or download items to appear
      try {
        // Wait for either the records count or download links
        await page.waitForFunction(
          () => {
            const bodyText = document.body.innerText || '';
            const hasRecords = bodyText.includes('Registros encontrados:') && !bodyText.includes('Registros encontrados: 0');
            const hasLinks = document.querySelectorAll('a[href*="download"], a[href*="arquivo"], a[onclick*="download"]').length > 0;
            return hasRecords || hasLinks;
          },
          { timeout: 20000 }
        );
        logger.debug('Page content loaded');
      } catch (error) {
        logger.warn('Timeout waiting for content, checking page state...');
        
        // Check if page shows "Registros encontrados: 0"
        const pageContent = await page.evaluate(() => document.body.innerText);
        if (pageContent.includes('Registros encontrados: 0') || pageContent.includes('Registros encontrados: **0**')) {
          logger.info('No records found on page');
          return gazettes;
        }
        
        // Log page state for debugging
        const pageState = await page.evaluate(() => {
          return {
            bodyText: document.body.innerText.substring(0, 500),
            linkCount: document.querySelectorAll('a').length,
            downloadLinks: Array.from(document.querySelectorAll('a[href*="download"], a[href*="arquivo"]')).slice(0, 5).map(a => ({
              href: a.getAttribute('href'),
              text: a.textContent?.trim().substring(0, 50)
            }))
          };
        });
        logger.debug(`Page state: ${JSON.stringify(pageState)}`);
      }
      
      // Additional wait to ensure all content is fully rendered
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Extract gazettes from the rendered page
      let currentPage = 1;
      let hasMorePages = true;
      let foundOlderThanRange = false;
      const maxPages = 50; // Safety limit
      
      while (hasMorePages && currentPage <= maxPages && !foundOlderThanRange) {
        logger.debug(`Extracting gazettes from page ${currentPage}`);
        
        // Extract gazettes directly from the rendered DOM using page.evaluate
        // This is more reliable for JavaScript-rendered content
        const pageGazettes = await this.extractGazettesFromPage(page);
        
        if (pageGazettes.length === 0) {
          logger.debug(`No gazettes found on page ${currentPage}`);
          hasMorePages = false;
          continue;
        }
        
        logger.debug(`Found ${pageGazettes.length} publications on page ${currentPage}`);
        
        // Filter by date range and check if we should continue
        for (const gazette of pageGazettes) {
          const gazetteDate = new Date(gazette.date);
          
          // Check if older than date range
          if (gazetteDate < new Date(this.dateRange.start)) {
            foundOlderThanRange = true;
            continue;
          }
          
          // Check if in date range
          if (this.isInDateRange(gazetteDate)) {
            gazettes.push(gazette);
          }
        }
        
        // Check for next page button
        const nextPageButton = await page.$('a[href*="page"], button:has-text("Próxima"), button:has-text("Próximo"), .pagination .next:not(.disabled)');
        
        if (nextPageButton && !foundOlderThanRange) {
          logger.debug(`Clicking next page button`);
          await nextPageButton.click();
          await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for page to load
          currentPage++;
          
          // Safety limit
          if (currentPage > maxPages) {
            logger.warn(`Reached maximum page limit (${maxPages}), stopping pagination`);
            hasMorePages = false;
          }
        } else {
          hasMorePages = false;
        }
        
        // Safety check to avoid infinite loops
        if (foundOlderThanRange) {
          logger.debug('Found publications older than date range, stopping pagination');
          hasMorePages = false;
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes with browser for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling with browser ${this.spiderConfig.name}:`, error as Error);
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (e) {
          logger.debug('Error closing page:', e as Error);
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (e) {
          logger.debug('Error closing browser:', e as Error);
        }
      }
    }

    return gazettes;
  }

  /**
   * Extract gazettes directly from the rendered page using page.evaluate
   * This is more reliable for JavaScript-rendered content
   */
  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      const pageData = await page.evaluate(() => {
        const items: Array<{
          title: string;
          date: string;
          pdfUrl: string;
          editionNumber?: string;
        }> = [];

        // Strategy 1: Look for table rows with download links
        const tableRows = document.querySelectorAll('table tbody tr, table tr');
        for (const row of Array.from(tableRows)) {
          const cells = row.querySelectorAll('td, th');
          if (cells.length >= 2) {
            const rowText = row.textContent || '';
            const dateMatch = rowText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            const link = row.querySelector('a[href]') as HTMLAnchorElement;
            
            if (dateMatch && link) {
              const href = link.getAttribute('href') || '';
              // Check if it's a download link (onclick with download or href with download/arquivo)
              const onclick = link.getAttribute('onclick') || '';
              if (href.includes('download') || href.includes('arquivo') || href.includes('.pdf') || 
                  onclick.includes('download') || onclick.includes('GetDownload')) {
                items.push({
                  title: rowText.substring(0, 200).trim(),
                  date: dateMatch[0],
                  pdfUrl: href || onclick.match(/['"]([^'"]+)['"]/)?.[1] || '',
                });
              }
            }
          }
        }

        // Strategy 2: Look for divs or containers with download links and dates
        if (items.length === 0) {
          const allDivs = document.querySelectorAll('div, li, article, section');
          for (const div of Array.from(allDivs)) {
            const text = div.textContent || '';
            const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            const link = div.querySelector('a[href*="download"], a[href*="arquivo"], a[onclick*="download"]') as HTMLAnchorElement;
            
            if (dateMatch && link) {
              const href = link.getAttribute('href') || '';
              const onclick = link.getAttribute('onclick') || '';
              const downloadUrl = href || onclick.match(/['"]([^'"]+)['"]/)?.[1] || '';
              
              if (downloadUrl) {
                items.push({
                  title: text.substring(0, 200).trim(),
                  date: dateMatch[0],
                  pdfUrl: downloadUrl,
                });
              }
            }
          }
        }

        // Strategy 3: Look for any links with onclick handlers that might trigger downloads
        if (items.length === 0) {
          const allLinks = document.querySelectorAll('a[onclick]');
          for (const link of Array.from(allLinks)) {
            const onclick = link.getAttribute('onclick') || '';
            const text = link.textContent || '';
            const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            
            // Check if onclick contains GetDownload or similar
            if ((onclick.includes('GetDownload') || onclick.includes('download')) && dateMatch) {
              // Try to extract URL from onclick
              const urlMatch = onclick.match(/['"]([^'"]+)['"]/);
              if (urlMatch) {
                items.push({
                  title: text.substring(0, 200).trim(),
                  date: dateMatch[0],
                  pdfUrl: urlMatch[1],
                });
              }
            }
          }
        }

        return items;
      });

      logger.debug(`Extracted ${pageData.length} items from page`);

      // Process each item
      for (const item of pageData) {
        try {
          const parsedDate = this.parseBrazilianDate(item.date);
          if (!parsedDate) {
            logger.debug(`Could not parse date: ${item.date}`);
            continue;
          }

          // Resolve PDF URL
          let pdfUrl = item.pdfUrl;
          if (!pdfUrl) {
            continue;
          }

          // Resolve relative URLs
          if (pdfUrl.startsWith('/')) {
            const baseUrlObj = new URL(this.baseUrl);
            pdfUrl = `${baseUrlObj.protocol}//${baseUrlObj.host}${pdfUrl}`;
          } else if (!pdfUrl.startsWith('http')) {
            pdfUrl = new URL(pdfUrl, this.baseUrl).href;
          }

          // Extract edition number if present
          let editionNumber: string | undefined;
          const editionMatch = item.title.match(/(?:edi[çc][ãa]o|ed\.?|n[úu]mero|n[°º]?\.?)\s*[°º]?\s*(\d+)/i);
          if (editionMatch) {
            editionNumber = editionMatch[1];
          }

          const gazette: Gazette = {
            date: toISODate(parsedDate),
            fileUrl: pdfUrl,
            territoryId: this.spiderConfig.territoryId,
            scrapedAt: new Date().toISOString(),
            power: 'executive',
            isExtraEdition: false,
          };

          if (editionNumber) {
            gazette.editionNumber = editionNumber;
          }

          if (item.title) {
            gazette.sourceText = item.title;
          }

          gazettes.push(gazette);
        } catch (error) {
          logger.debug(`Error parsing item:`, error as Error);
          continue;
        }
      }

    } catch (error) {
      logger.error(`Error extracting gazettes from page:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Extract gazettes from HTML (fallback method)
   * 
   * Page structure (from web search):
   * - Publications are listed in a table or list format
   * - Each publication has:
   *   - TÍTULO (title)
   *   - DATA (date)
   *   - Download link (ARQUIVO)
   */
  private extractGazettesFromHtml(root: any): Gazette[] {
    const gazettes: Gazette[] = [];

    try {
      // Strategy 1: Look for download links with dates in the same container
      // The page structure uses JavaScript to render downloads, so we look for links with download paths
      const downloadLinks = root.querySelectorAll('a[href*="download"], a[href*="arquivo"], a[href*=".pdf"], a[onclick*="download"]');
      let publicationItems: any[] = [];
      
      for (const link of downloadLinks) {
        // Find the parent container that might contain date information
        let container = link.parentElement;
        let foundContainer = false;
        
        // Walk up the DOM tree to find a container with date
        for (let i = 0; i < 5 && container; i++) {
          const containerText = container.textContent || '';
          const hasDate = /\d{2}\/\d{2}\/\d{4}/.test(containerText);
          
          if (hasDate) {
            publicationItems.push(container);
            foundContainer = true;
            break;
          }
          
          container = container.parentElement;
        }
        
        // If no container with date found, use the link itself if it has date in text
        if (!foundContainer) {
          const linkText = link.textContent || '';
          if (/\d{2}\/\d{2}\/\d{4}/.test(linkText)) {
            publicationItems.push(link);
          }
        }
      }

      // Strategy 2: Look for table rows with publication data
      if (publicationItems.length === 0) {
        const tableRows = root.querySelectorAll('table tr, tbody tr');
        
        for (const row of tableRows) {
          const cells = row.querySelectorAll('td, th');
          if (cells.length >= 2) {
            const rowText = row.textContent || '';
            const hasDate = /\d{2}\/\d{2}\/\d{4}/.test(rowText);
            const hasLink = row.querySelector('a[href]');
            
            if (hasDate && hasLink) {
              publicationItems.push(row);
            }
          }
        }
      }

      // Strategy 3: Look for divs or list items with download data
      if (publicationItems.length === 0) {
        const allDivs = root.querySelectorAll('div, li, article, section');
        publicationItems = Array.from(allDivs).filter(el => {
          const text = el.textContent || '';
          const hasDate = /\d{2}\/\d{2}\/\d{4}/.test(text);
          const hasLink = el.querySelector('a[href*="download"], a[href*="arquivo"], a[href*=".pdf"]');
          return hasDate && hasLink;
        });
      }

      logger.debug(`Found ${publicationItems.length} potential publication items`);

      for (const item of publicationItems) {
        try {
          const itemText = item.textContent || '';
          
          // Extract date - look for DD/MM/YYYY pattern
          let dateMatch = itemText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          
          if (!dateMatch) {
            // Try alternative patterns
            dateMatch = itemText.match(/(\d{2})-(\d{2})-(\d{4})/);
          }

          if (!dateMatch) {
            continue; // Skip items without dates
          }

          const [, day, month, year] = dateMatch;
          const parsedDate = this.parseBrazilianDate(`${day}/${month}/${year}`);
          
          if (!parsedDate) {
            logger.debug(`Could not parse date: ${day}/${month}/${year}`);
            continue;
          }

          // Find download link
          let pdfUrl = '';
          
          // Look for PDF links first
          const pdfLinks = item.querySelectorAll('a[href*=".pdf"], a[href*="download"], a[href*="arquivo"], a[href*="baixar"]');
          
          for (const link of pdfLinks) {
            const href = link.getAttribute('href') || '';
            const linkText = (link.textContent || '').toLowerCase().trim();
            
            // Prefer links with download-related text or PDF extension
            if (href.includes('.pdf') || linkText.includes('baixar') || 
                linkText.includes('download') || linkText.includes('arquivo') ||
                linkText.includes('pdf')) {
              pdfUrl = href;
              break;
            }
          }

          // If no PDF link found, try any link in the item
          if (!pdfUrl) {
            const anyLink = item.querySelector('a[href]');
            if (anyLink) {
              pdfUrl = anyLink.getAttribute('href') || '';
            }
          }

          if (!pdfUrl) {
            logger.debug(`No download link found for publication dated ${day}/${month}/${year}`);
            continue;
          }

          // Resolve relative URLs
          if (pdfUrl.startsWith('/')) {
            const baseUrlObj = new URL(this.baseUrl);
            pdfUrl = `${baseUrlObj.protocol}//${baseUrlObj.host}${pdfUrl}`;
          } else if (!pdfUrl.startsWith('http')) {
            pdfUrl = new URL(pdfUrl, this.baseUrl).href;
          }

          // Extract title
          let title = '';
          const titleEl = item.querySelector('h1, h2, h3, h4, h5, .title, .titulo, [class*="title"], [class*="titulo"], td:first-child, th:first-child');
          if (titleEl) {
            title = titleEl.textContent?.trim() || '';
          } else {
            // Try to extract from item text - look for text before date
            const titleMatch = itemText.match(/^(.+?)(?:\d{2}\/\d{2}\/\d{4})/);
            if (titleMatch) {
              title = titleMatch[1].trim().substring(0, 200);
            }
          }

          // Extract edition number if present
          let editionNumber: string | undefined;
          const editionMatch = itemText.match(/(?:edi[çc][ãa]o|ed\.?|n[úu]mero|n[°º]?\.?)\s*[°º]?\s*(\d+)/i);
          if (editionMatch) {
            editionNumber = editionMatch[1];
          }

          const gazette: Gazette = {
            date: toISODate(parsedDate),
            fileUrl: pdfUrl,
            territoryId: this.spiderConfig.territoryId,
            scrapedAt: new Date().toISOString(),
            power: 'executive',
            isExtraEdition: false,
          };

          if (editionNumber) {
            gazette.editionNumber = editionNumber;
          }

          if (title) {
            gazette.sourceText = title;
          }

          gazettes.push(gazette);
        } catch (error) {
          logger.debug(`Error parsing publication item:`, error as Error);
          continue;
        }
      }

    } catch (error) {
      logger.error(`Error extracting gazettes from HTML:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Parse Brazilian date format (DD/MM/YYYY) to Date object
   */
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
