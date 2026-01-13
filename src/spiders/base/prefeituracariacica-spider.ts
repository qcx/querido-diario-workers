import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraCariacicaConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * PrefeituraCariacicaSpider for Cariacica, ES Next.js-based gazette site
 * 
 * Site Structure:
 * - Next.js SPA that requires browser rendering
 * - URL: https://diariooficial.cariacica.es.gov.br
 * - Content is loaded via JavaScript
 */
export class PrefeituraCariacicaSpider extends BaseSpider {
  protected cariacicaConfig: PrefeituraCariacicaConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.cariacicaConfig = spiderConfig.config as PrefeituraCariacicaConfig;
    this.browser = browser || null;
    
    if (!this.cariacicaConfig.baseUrl) {
      throw new Error(`PrefeituraCariacicaSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraCariacicaSpider for ${spiderConfig.name}`);
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(`PrefeituraCariacicaSpider for ${this.spiderConfig.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling ${this.cariacicaConfig.baseUrl} for ${this.spiderConfig.name}...`);

    let browserInstance = null;
    let page = null;

    try {
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      
      logger.debug(`Navigating to: ${this.cariacicaConfig.baseUrl}`);
      
      // Use 'load' instead of 'networkidle0' for faster loading
      // networkidle0 can timeout on Next.js sites with continuous network activity
      try {
        await page.goto(this.cariacicaConfig.baseUrl, { waitUntil: 'load', timeout: 60000 });
      } catch (error) {
        // If load fails, try domcontentloaded as fallback
        logger.warn('Load timeout, trying domcontentloaded...');
        await page.goto(this.cariacicaConfig.baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      }
      this.requestCount++;
      
      // Wait for page to stabilize and JavaScript to load the gazettes
      // Next.js apps need time to render client-side content
      await new Promise(resolve => setTimeout(resolve, 8000));
      
      // Wait for loading indicator to disappear (if present)
      try {
        await page.waitForFunction(
          () => {
            const loadingIndicators = document.querySelectorAll('[role="img"][name="Loading"], .loading, [class*="Loading"]');
            return loadingIndicators.length === 0 || Array.from(loadingIndicators).every(el => {
              const style = window.getComputedStyle(el);
              return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
            });
          },
          { timeout: 15000 }
        ).catch(() => {
          logger.debug('Loading indicator still present, continuing anyway');
        });
      } catch (error) {
        logger.debug('Could not wait for loading indicator to disappear');
      }
      
      // Try to wait for content that indicates the page has loaded
      // Look for buttons, links, or any content elements
      try {
        await page.waitForSelector('button, a, [role="button"], [role="generic"]', { timeout: 15000 });
      } catch (error) {
        logger.warn('Content selectors not found, continuing anyway', error);
      }
      
      // Additional wait to ensure dynamic content is loaded
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Try to wait specifically for PDF buttons (optional)
      try {
        await page.waitForSelector('button[name="PDF"], button', { timeout: 5000 });
      } catch (error) {
        logger.debug('PDF buttons selector not found, but continuing anyway');
      }
      
      // Wait a bit more for any dynamic content
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Set up request interception to capture PDF URLs
      const pdfUrls: string[] = [];
      const responseHandler = (response: any) => {
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';
        if (url.includes('.pdf') || contentType.includes('application/pdf')) {
          pdfUrls.push(url);
          logger.debug(`Intercepted PDF response: ${url}`);
        }
      };
      page.on('response', responseHandler);
      
      // Try to extract data from page's JavaScript/state (Next.js apps often store data in __NEXT_DATA__)
      let nextData: any = null;
      try {
        nextData = await page.evaluate(() => {
          const script = document.querySelector('script#__NEXT_DATA__');
          if (script) {
            return JSON.parse(script.textContent || '{}');
          }
          return null;
        });
        if (nextData) {
          logger.debug('Found Next.js data, may contain gazette information');
        }
      } catch (error) {
        logger.debug('Could not extract Next.js data:', error);
      }
      
      // Extract gazettes from page
      const pageGazettes = await this.extractGazettesFromPage(page, pdfUrls, nextData);
      gazettes.push(...pageGazettes);
      
      // Clean up
      page.off('response', responseHandler);
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from Cariacica`);
      
    } catch (error) {
      logger.error(`Error crawling Cariacica:`, error as Error);
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
   */
  private async extractGazettesFromPage(page: any, interceptedPdfUrls: string[] = [], nextData: any = null): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      // Extract gazette links and dates from the page
      const gazetteData = await page.evaluate((interceptedUrls: string[], nextJsData: any) => {
        const results: Array<{ pdfUrl: string; date: string; title: string; edition?: string }> = [];
        
        // Find PDF buttons - try multiple strategies
        // Strategy 1: Buttons with name="PDF"
        const buttonsWithName = Array.from(document.querySelectorAll('button[name="PDF"]')) as HTMLElement[];
        
        // Strategy 2: All buttons and filter by text/content
        const allButtons = Array.from(document.querySelectorAll('button, [role="button"]')) as HTMLElement[];
        const buttonsWithPdfText = allButtons.filter((btn: HTMLElement) => {
          const text = btn.textContent?.toUpperCase() || '';
          const ariaLabel = btn.getAttribute('aria-label')?.toUpperCase() || '';
          const title = btn.getAttribute('title')?.toUpperCase() || '';
          return text.includes('PDF') || ariaLabel.includes('PDF') || title.includes('PDF');
        });
        
        // Combine both strategies and remove duplicates
        const allPdfButtonsSet = new Set([...buttonsWithName, ...buttonsWithPdfText]);
        const allPdfButtons = Array.from(allPdfButtonsSet);
        
        // Filter buttons that are likely from diários oficiais (not other PDFs)
        const pdfButtons = allPdfButtons.filter((button: HTMLElement) => {
          // Find the container that likely contains the gazette info
          let container: HTMLElement | null = button.closest('[role="generic"]') || button.parentElement;
          let depth = 0;
          let isDiarioOficial = false;
          let isExcluded = false;
          
          while (container && depth < 6) {
            const containerText = container.textContent || '';
            const upperText = containerText.toUpperCase();
            
            // Check if this container is for a diário oficial (not other documents)
            if (upperText.includes('DIÁRIO OFICIAL') || 
                upperText.includes('DIARIO OFICIAL')) {
              isDiarioOficial = true;
              break;
            }
            
            // Also accept if it has a date in DD/MM/YYYY format and mentions "edição" or "edicao"
            if (containerText.match(/\d{2}\/\d{2}\/\d{4}/) && 
                (upperText.includes('EDIÇÃO') || upperText.includes('EDICAO') || upperText.includes('EDICAO'))) {
              isDiarioOficial = true;
              break;
            }
            
            // Skip if it's clearly not a diário oficial (like "Código de Ética", "Manual", etc.)
            if (upperText.includes('CÓDIGO DE ÉTICA') || 
                upperText.includes('CODIGO DE ETICA') ||
                upperText.includes('ÉTICA E INTEGRIDADE') ||
                upperText.includes('ETICA E INTEGRIDADE') ||
                (upperText.includes('MANUAL') && !upperText.includes('DIÁRIO')) ||
                (upperText.includes('REGULAMENTO') && !upperText.includes('DIÁRIO'))) {
              isExcluded = true;
              break;
            }
            
            container = container.parentElement;
            depth++;
          }
          
          // If we found a date in the container, it's likely a diário oficial
          if (!isDiarioOficial && !isExcluded) {
            container = button.closest('[role="generic"]') || button.parentElement;
            depth = 0;
            while (container && depth < 4) {
              const containerText = container.textContent || '';
              if (containerText.match(/\d{2}\/\d{2}\/\d{4}/)) {
                // Has a date, likely a diário oficial
                isDiarioOficial = true;
                break;
              }
              container = container.parentElement;
              depth++;
            }
          }
          
          return isDiarioOficial && !isExcluded;
        });
        
        pdfButtons.forEach((button: HTMLElement) => {
          // Try to find the PDF URL from various sources
          let pdfUrl: string | null = null;
          
          // Check for onclick handler
          const onclick = button.getAttribute('onclick');
          if (onclick) {
            const urlMatch = onclick.match(/['"]([^'"]*\.pdf[^'"]*)['"]/);
            if (urlMatch) {
              pdfUrl = urlMatch[1];
            }
          }
          
          // Check for data attributes
          if (!pdfUrl) {
            pdfUrl = button.getAttribute('data-url') || 
                     button.getAttribute('data-pdf') || 
                     button.getAttribute('data-href') ||
                     button.getAttribute('data-src');
          }
          
          // Check for href in parent or child links
          if (!pdfUrl) {
            const parentLink = button.closest('a');
            if (parentLink) {
              pdfUrl = parentLink.getAttribute('href');
            }
          }
          
          // Check for nearby link elements
          if (!pdfUrl) {
            const container = button.closest('[role="generic"]') || button.parentElement;
            if (container) {
              const link = container.querySelector('a[href*=".pdf"], a[href*="pdf"]');
              if (link) {
                pdfUrl = link.getAttribute('href');
              }
            }
          }
          
          // If still no URL, try to find it by traversing up the DOM
          if (!pdfUrl) {
            let element: HTMLElement | null = button.parentElement;
            let depth = 0;
            while (element && depth < 5) {
              const allLinks = element.querySelectorAll('a');
              for (const link of Array.from(allLinks)) {
                const href = link.getAttribute('href');
                if (href && (href.includes('.pdf') || href.includes('pdf'))) {
                  pdfUrl = href;
                  break;
                }
              }
              if (pdfUrl) break;
              element = element.parentElement;
              depth++;
            }
          }
          
          // Try to extract from onclick handler that might call a function
          if (!pdfUrl && onclick) {
            // Look for patterns like: window.open('url'), location.href='url', fetch('url')
            const patterns = [
              /window\.open\(['"]([^'"]+)['"]/,
              /location\.href\s*=\s*['"]([^'"]+)['"]/,
              /fetch\(['"]([^'"]+)['"]/,
              /['"]([^'"]*\/[^'"]*\.pdf[^'"]*)['"]/,
            ];
            
            for (const pattern of patterns) {
              const match = onclick.match(pattern);
              if (match && match[1]) {
                pdfUrl = match[1];
                break;
              }
            }
          }
          
          // Check if button has a data attribute that might contain the ID or URL
          if (!pdfUrl) {
            const dataId = button.getAttribute('data-id') || 
                          button.getAttribute('id') ||
                          button.getAttribute('data-edition') ||
                          button.getAttribute('data-numero');
            
            // Also check parent elements for data attributes
            let parent = button.parentElement;
            let parentDepth = 0;
            while (parent && !dataId && parentDepth < 3) {
              const parentDataId = parent.getAttribute('data-id') || 
                                  parent.getAttribute('data-edition') ||
                                  parent.getAttribute('data-numero');
              if (parentDataId) {
                // Try to construct URL from data-id (common pattern)
                pdfUrl = `/api/pdf/${parentDataId}`;
                break;
              }
              parent = parent.parentElement;
              parentDepth++;
            }
            
            if (!pdfUrl && dataId) {
              // Try common URL patterns
              const baseUrl = window.location.origin;
              const possibleUrls = [
                `${baseUrl}/api/pdf/${dataId}`,
                `${baseUrl}/api/diario/${dataId}`,
                `${baseUrl}/api/diario-oficial/${dataId}`,
                `${baseUrl}/diario-oficial/${dataId}`,
                `${baseUrl}/pdf/${dataId}`,
              ];
              // We'll try these later if needed
            }
          }
          
          // Try to find URL in nearby elements (like hidden inputs or data attributes)
          if (!pdfUrl) {
            const container = button.closest('[role="generic"]') || button.parentElement;
            if (container) {
              // Look for hidden inputs or data attributes
              const hiddenInputs = container.querySelectorAll('input[type="hidden"]');
              for (const input of Array.from(hiddenInputs)) {
                const value = (input as HTMLInputElement).value;
                if (value && (value.includes('.pdf') || value.includes('pdf'))) {
                  pdfUrl = value;
                  break;
                }
              }
              
              // Look for data attributes in container
              if (!pdfUrl) {
                const containerDataUrl = container.getAttribute('data-pdf-url') ||
                                        container.getAttribute('data-url') ||
                                        container.getAttribute('data-href');
                if (containerDataUrl) {
                  pdfUrl = containerDataUrl;
                }
              }
            }
          }
          
          // Try to match with intercepted URLs (if any)
          if (!pdfUrl && interceptedUrls.length > 0) {
            // Try to find a matching URL based on button position or data
            const allButtons = Array.from(document.querySelectorAll('button[name="PDF"]'));
            const buttonIndex = allButtons.indexOf(button);
            if (buttonIndex >= 0 && buttonIndex < interceptedUrls.length) {
              pdfUrl = interceptedUrls[buttonIndex];
            } else if (interceptedUrls.length === 1) {
              // If only one URL intercepted, use it
              pdfUrl = interceptedUrls[0];
            }
          }
          
          // Last resort: if we have date and edition, try to construct URL
          // But we'll do this after we extract date/edition
          // For now, if we still don't have a URL, we'll skip this button
          // and try to find it later
          
          if (!pdfUrl) {
            // Don't skip yet - we'll try to find URL after extracting date/edition
            // Set a placeholder that we'll replace later
            pdfUrl = 'PLACEHOLDER_TO_FIND';
          }
          
          // Find date and edition info in the container - search more thoroughly
          let container: HTMLElement | null = button.closest('[role="generic"]') || button.parentElement?.parentElement;
          let date = '';
          let title = '';
          let edition = '';
          
          // Search up the DOM tree to find the container with date/edition info
          let searchDepth = 0;
          while (container && searchDepth < 6) {
            const containerText = container.textContent || '';
            
            // Extract date (DD/MM/YYYY format) - look for the first date found
            if (!date) {
              const dateMatch = containerText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
              if (dateMatch) {
                date = dateMatch[0];
              }
            }
            
            // Extract edition number
            if (!edition) {
              const editionMatch = containerText.match(/[Ee]di[çc][ãa]o\s*N[°ºo]?\s*(\d+)/i);
              if (editionMatch) {
                edition = editionMatch[1];
              }
            }
            
            // Try to find title/heading
            if (!title) {
              const heading = container.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
              if (heading) {
                const headingText = heading.textContent?.trim();
                if (headingText && (headingText.includes('Diário') || headingText.includes('Oficial'))) {
                  title = headingText;
                }
              }
            }
            
            // If we found date and it's in a container with "Diário Oficial", we're good
            if (date && containerText.toUpperCase().includes('DIÁRIO OFICIAL')) {
              break;
            }
            
            container = container.parentElement;
            searchDepth++;
          }
          
          // Build title if not found
          if (!title) {
            title = `Diário Oficial${edition ? ` - Edição ${edition}` : ''}${date ? ` - ${date}` : ''}`;
          }
          
          // If still no date, try one more search in siblings and nearby elements
          if (!date) {
            let searchElement: HTMLElement | null = button.parentElement;
            let searchDepth2 = 0;
            while (searchElement && searchDepth2 < 4) {
              // Check siblings
              if (searchElement.parentElement) {
                const siblings = Array.from(searchElement.parentElement.children);
                for (const sibling of siblings) {
                  const text = sibling.textContent || '';
                  const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                  if (dateMatch) {
                    date = dateMatch[0];
                    break;
                  }
                }
                if (date) break;
              }
              
              const text = searchElement.textContent || '';
              const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
              if (dateMatch) {
                date = dateMatch[0];
                break;
              }
              searchElement = searchElement.parentElement;
              searchDepth2++;
            }
          }
          
          // Build title if not found
          if (!title) {
            title = `Diário Oficial${edition ? ` - Edição ${edition}` : ''}${date ? ` - ${date}` : ''}`;
          }
          
          // If we still don't have a URL, try to construct it from date/edition
          if (pdfUrl === 'PLACEHOLDER_TO_FIND') {
            const baseUrl = window.location.origin;
            if (edition) {
              // Try common patterns with edition number
              pdfUrl = `${baseUrl}/api/diario/${edition}`;
            } else if (date) {
              // Try patterns with date
              const dateParts = date.split('/');
              if (dateParts.length === 3) {
                const [day, month, year] = dateParts;
                pdfUrl = `${baseUrl}/api/diario/${year}-${month}-${day}`;
              }
            }
            
            // If still no URL, skip this entry
            if (pdfUrl === 'PLACEHOLDER_TO_FIND') {
              return; // Skip if we can't find or construct URL
            }
          }
          
          // Only add if we have a date (required)
          if (date) {
            results.push({
              pdfUrl,
              date,
              title,
              edition,
            });
          }
        });
        
        // Also check for direct PDF links as fallback
        const directLinks = document.querySelectorAll('a[href$=".pdf"], a[href*=".pdf?"]');
        directLinks.forEach((link: HTMLAnchorElement) => {
          const href = link.getAttribute('href');
          if (href && !results.some(r => r.pdfUrl === href)) {
            // Check if this link is in a container with "Diário Oficial"
            let container: HTMLElement | null = link.parentElement;
            let isDiario = false;
            let date = '';
            
            while (container && container !== document.body) {
              const text = container.textContent || '';
              const upperText = text.toUpperCase();
              
              if (upperText.includes('DIÁRIO OFICIAL') || upperText.includes('DIARIO OFICIAL')) {
                isDiario = true;
                const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                if (dateMatch) {
                  date = dateMatch[0];
                }
                break;
              }
              
              container = container.parentElement;
            }
            
            // Only add if it's a diário oficial
            if (isDiario) {
              const text = link.textContent?.trim() || '';
              if (!date) {
                const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                if (dateMatch) {
                  date = dateMatch[0];
                }
              }
              
              results.push({
                pdfUrl: href,
                date,
                title: text || 'Diário Oficial',
              });
            }
          }
        });
        
        // Alternative approach: find all elements with dates and look for nearby PDF buttons/links
        if (results.length === 0) {
          const allElements = document.querySelectorAll('*');
          allElements.forEach((element: Element) => {
            const text = element.textContent || '';
            const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            
            if (dateMatch && text.toUpperCase().includes('DIÁRIO')) {
              // Found a date in a diário context, look for PDF button/link nearby
              const container = element.closest('[role="generic"]') || element.parentElement;
              if (container) {
                const pdfButton = container.querySelector('button[name="PDF"]');
                const pdfLink = container.querySelector('a[href*="pdf"]');
                
                if (pdfButton || pdfLink) {
                  let pdfUrl = '';
                  if (pdfLink) {
                    pdfUrl = (pdfLink as HTMLAnchorElement).getAttribute('href') || '';
                  }
                  
                  if (pdfUrl && !results.some(r => r.pdfUrl === pdfUrl)) {
                    results.push({
                      pdfUrl,
                      date: dateMatch[0],
                      title: `Diário Oficial - ${dateMatch[0]}`,
                    });
                  }
                }
              }
            }
          });
        }
        
        // Try to extract from Next.js data if available
        if (nextJsData && nextJsData.props && nextJsData.props.pageProps) {
          const pageProps = nextJsData.props.pageProps;
          // Common patterns in Next.js apps
          const gazettesData = pageProps.gazettes || pageProps.data || pageProps.items || pageProps.diarios || [];
          
          if (Array.isArray(gazettesData) && gazettesData.length > 0) {
            gazettesData.forEach((item: any) => {
              if (item.pdfUrl || item.url || item.link) {
                const pdfUrl = item.pdfUrl || item.url || item.link;
                const date = item.date || item.data || item.publicationDate || '';
                const title = item.title || item.name || `Diário Oficial${date ? ` - ${date}` : ''}`;
                
                if (!results.some(r => r.pdfUrl === pdfUrl)) {
                  results.push({
                    pdfUrl,
                    date: typeof date === 'string' ? date : '',
                    title,
                    edition: item.edition || item.numero || '',
                  });
                }
              }
            });
          }
        }
        
        return results;
      }, interceptedPdfUrls, nextData);

      // Log detailed info about what was found
      const buttonInfo = await page.evaluate(() => {
        const buttonsWithName = document.querySelectorAll('button[name="PDF"]').length;
        const allButtons = document.querySelectorAll('button, [role="button"]').length;
        const buttonsWithPdfText = Array.from(document.querySelectorAll('button, [role="button"]'))
          .filter((btn: Element) => {
            const text = btn.textContent?.toUpperCase() || '';
            const ariaLabel = btn.getAttribute('aria-label')?.toUpperCase() || '';
            return text.includes('PDF') || ariaLabel.includes('PDF');
          }).length;
        return { buttonsWithName, allButtons, buttonsWithPdfText };
      });
      logger.debug(`Found ${buttonInfo.buttonsWithName} buttons with name="PDF", ${buttonInfo.buttonsWithPdfText} buttons with PDF text, ${buttonInfo.allButtons} total buttons. Extracted ${gazetteData.length} potential gazette items on page`);
      
      if (gazetteData.length === 0 && buttonInfo.buttonsWithPdfText > 0) {
        logger.warn(`Found ${buttonInfo.buttonsWithPdfText} PDF buttons but couldn't extract any gazettes. This may indicate a filtering or extraction issue.`);
      }
      
      for (const item of gazetteData) {
        try {
          // Parse date
          let gazetteDate: Date | null = null;
          if (item.date) {
            const dateMatch = item.date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (dateMatch) {
              const [, day, month, year] = dateMatch;
              gazetteDate = new Date(`${year}-${month}-${day}`);
              
              // Validate date
              if (isNaN(gazetteDate.getTime())) {
                logger.debug(`Invalid date parsed: ${item.date} -> ${gazetteDate}`);
                gazetteDate = null;
              }
            }
          }
          
          if (!gazetteDate || isNaN(gazetteDate.getTime())) {
            logger.debug(`Could not parse date from: "${item.date}" for PDF: ${item.pdfUrl.substring(0, 100)}`);
            // Try to extract date from URL or title as fallback
            const urlDateMatch = item.pdfUrl.match(/(\d{4})[_-](\d{2})[_-](\d{2})/);
            if (urlDateMatch) {
              const [, year, month, day] = urlDateMatch;
              gazetteDate = new Date(`${year}-${month}-${day}`);
              logger.debug(`Extracted date from URL: ${gazetteDate.toISOString()}`);
            }
            
            if (!gazetteDate || isNaN(gazetteDate.getTime())) {
              logger.debug(`Skipping gazette without valid date: ${item.pdfUrl}`);
              continue;
            }
          }

          // Filter by date range
          if (!this.isInDateRange(gazetteDate)) {
            logger.debug(`Gazette date ${gazetteDate.toISOString()} is outside date range`);
            continue;
          }

          // Make URL absolute
          const baseUrlObj = new URL(this.cariacicaConfig.baseUrl);
          let pdfUrl = item.pdfUrl;
          
          // Handle relative URLs
          if (!pdfUrl.startsWith('http')) {
            if (pdfUrl.startsWith('/')) {
              pdfUrl = `${baseUrlObj.origin}${pdfUrl}`;
            } else {
              pdfUrl = `${baseUrlObj.origin}/${pdfUrl}`;
            }
          }
          
          // Clean up URL (remove query params that might interfere)
          try {
            const urlObj = new URL(pdfUrl);
            pdfUrl = urlObj.origin + urlObj.pathname;
          } catch (e) {
            // If URL parsing fails, use as is
            logger.debug(`Could not parse URL: ${pdfUrl}`);
          }

          logger.debug(`Creating gazette: date=${gazetteDate.toISOString()}, url=${pdfUrl.substring(0, 100)}`);

          // Create gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            power: 'executive_legislative',
            sourceText: item.title || `Diário Oficial${item.edition ? ` - Edição ${item.edition}` : ''}`,
          });

          if (gazette) {
            gazettes.push(gazette);
            logger.debug(`Successfully created gazette: ${gazette.url}`);
          } else {
            logger.debug(`Failed to create gazette for: ${pdfUrl}`);
          }
        } catch (error) {
          logger.error(`Error processing gazette:`, error as Error);
        }
      }
    } catch (error) {
      logger.error(`Error extracting gazettes from page:`, error as Error);
    }

    return gazettes;
  }
}
