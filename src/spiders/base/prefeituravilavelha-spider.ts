import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraVilaVelhaConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * PrefeituraVilaVelhaSpider for Vila Velha, ES
 * 
 * Site Structure:
 * - URL: https://diariooficial.vilavelha.es.gov.br/
 * - May require browser rendering for JavaScript-heavy pages
 */
export class PrefeituraVilaVelhaSpider extends BaseSpider {
  protected vilaVelhaConfig: PrefeituraVilaVelhaConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.vilaVelhaConfig = spiderConfig.config as PrefeituraVilaVelhaConfig;
    this.browser = browser || null;
    
    if (!this.vilaVelhaConfig.baseUrl) {
      throw new Error(`PrefeituraVilaVelhaSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraVilaVelhaSpider for ${spiderConfig.name}`);
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    // Try simple fetch first if browser rendering is not required
    if (!this.vilaVelhaConfig.requiresClientRendering) {
      try {
        logger.info(`Crawling ${this.vilaVelhaConfig.baseUrl} for ${this.spiderConfig.name}...`);
        const html = await this.fetch(this.vilaVelhaConfig.baseUrl);
        // @ts-ignore
        const { parse } = await import('node-html-parser');
        const root = parse(html);
        
        // Look for PDF links
        const pdfLinks = root.querySelectorAll('a[href$=".pdf"], a[href*="pdf"]');
        
        logger.debug(`Found ${pdfLinks.length} PDF links`);
        
        for (const link of pdfLinks) {
          try {
            const pdfUrl = link.getAttribute('href');
            const linkText = link.text?.trim() || '';
            
            if (!pdfUrl) {
              continue;
            }
            
            // Make URL absolute
            const baseUrlObj = new URL(this.vilaVelhaConfig.baseUrl);
            const fullUrl = pdfUrl.startsWith('http') 
              ? pdfUrl 
              : `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
            
            // Try to extract date from link text or nearby elements
            const dateMatch = linkText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (!dateMatch) {
              logger.debug(`Could not parse date from: ${linkText}`);
              continue;
            }
            
            const [, day, month, year] = dateMatch;
            const gazetteDate = new Date(`${year}-${month}-${day}`);
            
            // Filter by date range
            if (!this.isInDateRange(gazetteDate)) {
              continue;
            }
            
            // Create gazette
            const gazette = await this.createGazette(gazetteDate, fullUrl, {
              power: 'executive_legislative',
              sourceText: linkText,
            });
            
            if (gazette) {
              gazettes.push(gazette);
            }
          } catch (error) {
            logger.error(`Error processing gazette link:`, error as Error);
          }
        }
        
        logger.info(`Found ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
        return gazettes;
      } catch (error) {
        logger.warn(`Simple fetch failed, trying browser rendering:`, error as Error);
        // Fall through to browser rendering
      }
    }
    
    // Use browser rendering if required or if simple fetch failed
    if (!this.browser) {
      logger.error(`PrefeituraVilaVelhaSpider for ${this.spiderConfig.name} requires browser binding`);
      return [];
    }

    logger.info(`Crawling ${this.vilaVelhaConfig.baseUrl} with browser for ${this.spiderConfig.name}...`);

    let browserInstance = null;
    let page = null;

    try {
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      
      logger.debug(`Navigating to: ${this.vilaVelhaConfig.baseUrl}`);
      
      try {
        await page.goto(this.vilaVelhaConfig.baseUrl, { waitUntil: 'load', timeout: 60000 });
      } catch (error) {
        logger.warn('Load timeout, trying domcontentloaded...');
        await page.goto(this.vilaVelhaConfig.baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      }
      this.requestCount++;
      
      // Wait for page to stabilize and JavaScript to load content
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Wait for gazette cards to appear (look for elements containing "Diário Oficial")
      try {
        await page.waitForFunction(
          () => {
            const text = document.body.textContent || '';
            return text.includes('Diário Oficial') && text.match(/\d{2}\/\d{2}\/\d{4}/);
          },
          { timeout: 10000 }
        );
      } catch (error) {
        logger.warn('Gazette cards not found, but continuing anyway');
      }
      
      // Additional wait to ensure dynamic content is loaded
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extract gazettes from page
      const pageGazettes = await this.extractGazettesFromPage(page);
      gazettes.push(...pageGazettes);
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from Vila Velha`);
      
    } catch (error) {
      logger.error(`Error crawling Vila Velha:`, error as Error);
      throw error;
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (e) {
          logger.warn('Error closing page', e as Error);
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (e) {
          logger.warn('Error closing browser', e as Error);
        }
      }
    }

    return gazettes;
  }

  /**
   * Extract gazettes from the current page
   * The page uses ASP.NET postbacks (__doPostBack) to download PDFs
   * We need to intercept network requests to get the actual PDF URLs
   */
  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      // Set up response interception BEFORE extracting data
      const pdfResponses: Array<{ url: string; timestamp: number }> = [];
      
      const responseHandler = (response: any) => {
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';
        
        if (url.includes('.pdf') || contentType.includes('application/pdf') || contentType.includes('application/octet-stream')) {
          pdfResponses.push({
            url,
            timestamp: Date.now()
          });
        }
      };
      
      page.on('response', responseHandler);

      // Extract all gazette information from the page
      const gazetteData = await page.evaluate(() => {
        const results: Array<{
          date: string;
          edition: string;
          linkId: string;
          linkHref: string;
          linkOnclick: string;
          linkText: string;
        }> = [];
        
        // Find all elements containing "Diário Oficial" and dates
        // Check table rows first (common in ASP.NET GridViews)
        const tableRows = document.querySelectorAll('tr');
        
        tableRows.forEach((row) => {
          const text = row.textContent || '';
          if (text.includes('Diário Oficial') && text.match(/\d{2}\/\d{2}\/\d{4}/)) {
            const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            const editionMatch = text.match(/Edição\s*n[º°o]?\s*(\d+)/i);
            
            if (dateMatch) {
              // Find ANY link or button in this row
              const links = row.querySelectorAll('a, button');
              
              for (const link of links) {
                const href = link.getAttribute('href') || '';
                const onclick = link.getAttribute('onclick') || '';
                const id = link.getAttribute('id') || '';
                const linkText = link.textContent || '';
                
                // Accept any link that might be a download (postback, download, or just any link in a row with Diário Oficial)
                // Since we're in a row with "Diário Oficial", any link is likely the download link
                if (href || onclick || id) {
                  results.push({
                    date: dateMatch[0],
                    edition: editionMatch ? editionMatch[1] : '',
                    linkId: id,
                    linkHref: href,
                    linkOnclick: onclick,
                    linkText: linkText.trim()
                  });
                  break; // Only take first link per row
                }
              }
            }
          }
        });
        
        // If no table rows found, try finding by cards/divs
        if (results.length === 0) {
          const allElements = document.querySelectorAll('div, article, section, li');
          
          allElements.forEach((el) => {
            const text = el.textContent || '';
            if (text.includes('Diário Oficial') && text.match(/\d{2}\/\d{2}\/\d{4}/)) {
              const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
              const editionMatch = text.match(/Edição\s*n[º°o]?\s*(\d+)/i);
              
              if (dateMatch) {
                // Find ANY link in this element
                const links = el.querySelectorAll('a, button');
                
                for (const link of links) {
                  const href = link.getAttribute('href') || '';
                  const onclick = link.getAttribute('onclick') || '';
                  const id = link.getAttribute('id') || '';
                  const linkText = link.textContent || '';
                  
                  if (href || onclick || id) {
                    results.push({
                      date: dateMatch[0],
                      edition: editionMatch ? editionMatch[1] : '',
                      linkId: id,
                      linkHref: href,
                      linkOnclick: onclick,
                      linkText: linkText.trim()
                    });
                    break; // Only take first link per element
                  }
                }
              }
            }
          });
        }
        
        return results;
      });

      logger.debug(`Found ${gazetteData.length} gazette entries on the page`);

      // Process each gazette entry
      for (let i = 0; i < gazetteData.length; i++) {
        try {
          const entry = gazetteData[i];
          
          // Parse date
          const dateMatch = entry.date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) {
            continue;
          }
          
          const [, day, month, year] = dateMatch;
          const gazetteDate = new Date(`${year}-${month}-${day}`);
          
          // Filter by date range
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }

          // Determine if this is a postback or direct link
          let pdfUrl: string | null = null;
          
          if (entry.linkHref.includes('__doPostBack') || entry.linkOnclick.includes('__doPostBack')) {
            pdfUrl = '__POSTBACK__';
          } else if (entry.linkHref.includes('.pdf') || entry.linkHref.includes('pdf')) {
            pdfUrl = entry.linkHref;
          } else if (entry.linkHref && !entry.linkHref.startsWith('javascript:')) {
            // Might be a relative URL that leads to PDF
            pdfUrl = entry.linkHref;
          } else {
            // Assume it's a postback if we have onclick or an ID
            if (entry.linkOnclick || entry.linkId) {
              pdfUrl = '__POSTBACK__';
            }
          }

          if (!pdfUrl) {
            logger.debug(`Could not find download link for entry ${i + 1} (${entry.date})`);
            continue;
          }

          let finalPdfUrl: string | null = null;

          // If it's a postback, click it and wait for the PDF response
          if (pdfUrl === '__POSTBACK__') {
            try {
              // Set up promise to wait for PDF response
              const pdfResponsePromise = page.waitForResponse(
                (response: any) => {
                  const url = response.url();
                  const contentType = response.headers()['content-type'] || '';
                  return (url.includes('.pdf') || 
                          contentType.includes('application/pdf') || 
                          contentType.includes('application/octet-stream')) &&
                         response.status() === 200;
                },
                { timeout: 5000 }
              ).catch(() => null);
              
              // Find and click the link using ID, href, or onclick
              await page.evaluate((linkId: string, linkHref: string, linkOnclick: string) => {
                try {
                  let link: Element | null = null;
                  
                  // Try to find by ID first
                  if (linkId) {
                    link = document.getElementById(linkId);
                  }
                  
                  // If not found by ID, try to find by href or onclick
                  if (!link) {
                    const allLinks = document.querySelectorAll('a, button');
                    for (const l of allLinks) {
                      const href = l.getAttribute('href') || '';
                      const onclick = l.getAttribute('onclick') || '';
                      const id = l.getAttribute('id') || '';
                      
                      if ((linkId && id === linkId) ||
                          (linkHref && href === linkHref) ||
                          (linkOnclick && onclick === linkOnclick) ||
                          (linkHref && href.includes('__doPostBack')) ||
                          (linkOnclick && onclick.includes('__doPostBack'))) {
                        link = l;
                        break;
                      }
                    }
                  }
                  
                  if (link) {
                    (link as HTMLElement).click();
                  }
                } catch (e) {
                  // Ignore errors
                }
              }, entry.linkId, entry.linkHref, entry.linkOnclick);
              
              // Wait for PDF response
              const pdfResponse = await pdfResponsePromise;
              if (pdfResponse) {
                finalPdfUrl = pdfResponse.url();
              }
            } catch (e) {
              logger.debug(`Error clicking postback for entry ${i + 1}: ${e}`);
            }
          } else {
            finalPdfUrl = pdfUrl;
          }

          if (!finalPdfUrl || finalPdfUrl.startsWith('javascript:')) {
            logger.debug(`Could not get valid PDF URL for entry ${i + 1} (${entry.date})`);
            continue;
          }

          // Make URL absolute
          const baseUrlObj = new URL(this.vilaVelhaConfig.baseUrl);
          const fullUrl = finalPdfUrl.startsWith('http') 
            ? finalPdfUrl 
            : `${baseUrlObj.origin}${finalPdfUrl.startsWith('/') ? '' : '/'}${finalPdfUrl}`;

          // Validate URL
          try {
            new URL(fullUrl);
          } catch (e) {
            logger.debug(`Invalid URL for entry ${i + 1}: ${fullUrl}`);
            continue;
          }

          // Create gazette
          const gazette = await this.createGazette(gazetteDate, fullUrl, {
            power: 'executive_legislative',
            sourceText: `Diário Oficial do dia ${entry.date}${entry.edition ? ` - Edição nº ${entry.edition}` : ''}`,
          });

          if (gazette) {
            gazettes.push(gazette);
            logger.debug(`Extracted gazette for ${entry.date}: ${fullUrl}`);
          }
        } catch (error) {
          logger.error(`Error processing entry ${i + 1}:`, error as Error);
        }
      }
      
      // Note: We don't remove the response handler as page will be closed anyway
      // and Cloudflare Puppeteer may not support removeListener
    } catch (error) {
      logger.error(`Error extracting gazettes from page:`, error as Error);
    }

    return gazettes;
  }
}
