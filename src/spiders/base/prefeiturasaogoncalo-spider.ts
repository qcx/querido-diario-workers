import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraSaoGoncaloConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Spider for Prefeitura de São Gonçalo - RJ official gazette
 * 
 * Uses Cloudflare Browser Rendering (Puppeteer) to search for official gazettes
 * on the site. The site requires client-side rendering to properly navigate
 * and find diários oficiais.
 * 
 * Site: https://do.pmsg.rj.gov.br
 */
export class PrefeituraSaoGoncaloSpider extends BaseSpider {
  protected config: PrefeituraSaoGoncaloConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeituraSaoGoncaloConfig;
    this.browser = browser || null;
    
    if (!this.config.url) {
      throw new Error(`PrefeituraSaoGoncaloSpider requires a url in config for ${spiderConfig.name}`);
    }
    
    if (!this.browser) {
      throw new Error(`PrefeituraSaoGoncaloSpider requires browser for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraSaoGoncaloSpider for ${spiderConfig.name} with URL: ${this.config.url}`);
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.config.url} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error('Browser is required for PrefeituraSaoGoncaloSpider');
    }
    
    return this.crawlWithBrowser();
  }

  /**
   * Browser-based crawling for São Gonçalo site
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Navigate to the base URL
      const targetUrl = this.config.url;
      logger.debug(`Navigating to: ${targetUrl}`);
      await page.goto(targetUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Wait for page to stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extract gazettes from all pages
      let hasMorePages = true;
      let currentPage = 1;
      
      while (hasMorePages) {
        logger.debug(`Extracting gazettes from page ${currentPage}`);
        
        // Wait for links to load
        try {
          await page.waitForSelector('a', { timeout: 10000 });
        } catch (error) {
          logger.warn('No links found on page, may be empty');
          break;
        }
        
        // Extract gazettes from current page
        const pageGazettes = await this.extractLinkBasedGazettes(page);
        
        // Filter by date range
        for (const gazette of pageGazettes) {
          if (gazette && this.isInDateRange(new Date(gazette.date))) {
            gazettes.push(gazette);
          }
        }
        
        logger.debug(`Found ${pageGazettes.length} gazettes on page ${currentPage}, ${gazettes.length} in date range`);
        
        // Check if we've found gazettes older than our date range - stop pagination early
        const foundOlderGazettes = pageGazettes.some(g => {
          const gazetteDate = new Date(g.date);
          const startDate = new Date(this.dateRange.start);
          return gazetteDate < startDate;
        });
        
        if (foundOlderGazettes) {
          logger.debug('Found gazettes older than date range, stopping pagination');
          hasMorePages = false;
          continue;
        }
        
        // Check for pagination - look for various pagination patterns
        const nextPageButton = await page.$('a[href*="page"], .pagination .next:not(.disabled), .pager .next:not(.disabled), button[name="Anteriores"], [class*="pagination"] button:not(:disabled)');
        if (nextPageButton && pageGazettes.length > 0) {
          logger.debug(`Clicking next page button`);
          await nextPageButton.click();
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for page to load
          currentPage++;
          
          // Safety limit to avoid infinite loops
          if (currentPage > 50) {
            logger.warn('Reached maximum page limit (50), stopping pagination');
            hasMorePages = false;
          }
        } else {
          hasMorePages = false;
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from browser`);
      
    } catch (error) {
      logger.error(`Error crawling with browser:`, error as Error);
      throw error;
    } finally {
      // Clean up
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

  /**
   * Extract gazettes from browser page using link-based format
   */
  private async extractLinkBasedGazettes(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Extract all links with "Diário Oficial" text
      const linkElements = await page.evaluate(() => {
        const elements: any[] = [];
        const links = document.querySelectorAll('a');
        
        for (const link of Array.from(links)) {
          const text = link.textContent?.trim() || '';
          if (text.toLowerCase().includes('diário oficial') || text.toLowerCase().includes('diario oficial')) {
            // Extract date from text (pattern: Data: DD/MM/YYYY)
            const dateMatch = text.match(/Data:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
            const dateText = dateMatch ? `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}` : '';
            
            // Extract edition number (pattern: Edição: NNNN or Edição NNNN)
            const editionMatch = text.match(/Edi[çc][ãa]o:?\s*(\d+)/i);
            const editionNumber = editionMatch ? editionMatch[1] : null;
            
            // Try to find PDF URL - look for form with PDF info or link href
            let pdfUrl = link.getAttribute('href') || '';
            
            // If link doesn't have PDF href, look for form in parent container
            if (!pdfUrl || (!pdfUrl.includes('.pdf') && !pdfUrl.includes('download'))) {
              // Find parent container
              let parent = link.parentElement;
              let foundForm = false;
              
              // Search up to 5 levels up
              for (let i = 0; i < 5 && parent; i++) {
                const form = parent.querySelector('form');
                if (form) {
                  // Look for input with PDF filename
                  const pdfInput = form.querySelector('input[name*="arquivo"], input[name*="pdf"], input[value*=".pdf"]');
                  if (pdfInput) {
                    const filename = pdfInput.getAttribute('name') || pdfInput.getAttribute('value') || '';
                    // Try to construct PDF URL from form action or base URL
                    const formAction = form.getAttribute('action') || '';
                    if (formAction && (formAction.includes('.pdf') || formAction.includes('download'))) {
                      pdfUrl = formAction;
                    } else {
                      // Look for a submit button or link that might trigger download
                      const submitButton = form.querySelector('button[type="submit"], input[type="submit"], a[onclick*="submit"]');
                      if (submitButton) {
                        const onclick = submitButton.getAttribute('onclick') || '';
                        // Try to extract URL from onclick handler
                        const urlMatch = onclick.match(/['"]([^'"]*\.pdf[^'"]*)['"]/) || onclick.match(/['"]([^'"]*download[^'"]*)['"]/);
                        if (urlMatch) {
                          pdfUrl = urlMatch[1];
                        }
                      }
                      // If still no URL, use filename as hint
                      if (!pdfUrl) {
                        pdfUrl = filename;
                      }
                    }
                    foundForm = true;
                    break;
                  }
                }
                parent = parent.parentElement;
              }
              
              // If still no PDF URL, try to find download link nearby
              // But validate that it looks like a diário oficial PDF
              if (!foundForm || !pdfUrl || (!pdfUrl.includes('.pdf') && !pdfUrl.includes('download'))) {
                let container = link.parentElement;
                for (let i = 0; i < 3 && container; i++) {
                  const downloadLinks = container.querySelectorAll('a[href*=".pdf"], a[href*="download"], a[onclick*=".pdf"], a[onclick*="download"]');
                  
                  // Find the best matching PDF link
                  for (const downloadLink of Array.from(downloadLinks)) {
                    let candidateUrl = downloadLink.getAttribute('href') || '';
                    // If no href, try onclick
                    if (!candidateUrl) {
                      const onclick = downloadLink.getAttribute('onclick') || '';
                      const urlMatch = onclick.match(/['"]([^'"]*\.pdf[^'"]*)['"]/) || onclick.match(/['"]([^'"]*download[^'"]*)['"]/);
                      if (urlMatch) {
                        candidateUrl = urlMatch[1];
                      }
                    }
                    
                    // Validate that this PDF looks like a diário oficial
                    const urlLower = candidateUrl.toLowerCase();
                    const hasDiarioKeywords = urlLower.includes('diario') || 
                                              urlLower.includes('diário') || 
                                              urlLower.includes('oficial') ||
                                              urlLower.includes('edicao') ||
                                              urlLower.includes('edição') ||
                                              urlLower.includes('doem') ||
                                              urlLower.includes('doe');
                    
                    // Also check if edition number is in the URL
                    const hasEditionNumber = editionNumber && candidateUrl.includes(editionNumber);
                    
                    // Reject if it looks like other document types
                    const isOtherDocument = urlLower.includes('diagnostico') ||
                                           urlLower.includes('diagnóstico') ||
                                           urlLower.includes('tecnico') ||
                                           urlLower.includes('técnico') ||
                                           urlLower.includes('participativo') ||
                                           urlLower.includes('pmsb') ||
                                           urlLower.includes('plano') ||
                                           urlLower.includes('lei') ||
                                           urlLower.includes('decreto');
                    
                    if (candidateUrl && (hasDiarioKeywords || hasEditionNumber) && !isOtherDocument) {
                      pdfUrl = candidateUrl;
                      break;
                    }
                  }
                  
                  if (pdfUrl) break;
                  container = container.parentElement;
                }
              }
            }
            
            if (dateText || editionNumber || pdfUrl) {
              elements.push({
                text,
                dateText,
                editionNumber,
                pdfUrl,
                linkHref: link.getAttribute('href') || '',
              });
            }
          }
        }
        
        return elements;
      });
      
      logger.debug(`Found ${linkElements.length} link-based gazette elements on page`);
      
      // Process each element
      for (const element of linkElements) {
        try {
          // Parse date
          let gazetteDate: Date | null = null;
          if (element.dateText) {
            const dateMatch = element.dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (dateMatch) {
              const [, day, month, year] = dateMatch;
              gazetteDate = new Date(`${year}-${month}-${day}`);
            }
          }
          
          // If no date from text, try to extract from link text
          if (!gazetteDate && element.text) {
            const dateMatch = element.text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (dateMatch) {
              const [, day, month, year] = dateMatch;
              gazetteDate = new Date(`${year}-${month}-${day}`);
            }
          }
          
          if (!gazetteDate) {
            logger.debug(`Could not parse date from link: ${element.text}`);
            continue;
          }
          
          // Check if date is in range
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }
          
          // Get PDF URL - prioritize direct PDF links, otherwise use linkHref to navigate to detail page
          let pdfUrl = '';
          
          // First, check if we have a direct PDF URL from the form or nearby links
          if (element.pdfUrl && element.pdfUrl.includes('.pdf')) {
            pdfUrl = element.pdfUrl;
          } else if (element.linkHref && element.linkHref.includes('.pdf')) {
            pdfUrl = element.linkHref;
          }
          
          // If we have a direct PDF URL, validate it
          if (pdfUrl && pdfUrl.includes('.pdf')) {
            // Validate PDF URL looks like a diário oficial before processing
            const urlLower = pdfUrl.toLowerCase();
            const isOtherDocument = urlLower.includes('diagnostico') ||
                                   urlLower.includes('diagnóstico') ||
                                   urlLower.includes('tecnico') ||
                                   urlLower.includes('técnico') ||
                                   urlLower.includes('participativo') ||
                                   urlLower.includes('pmsb') ||
                                   urlLower.includes('plano') ||
                                   urlLower.includes('lei') ||
                                   urlLower.includes('decreto');
            
            if (isOtherDocument) {
              logger.warn(`Rejected PDF URL that doesn't look like diário oficial: ${pdfUrl}`);
              pdfUrl = ''; // Clear it so we try detail page instead
            } else {
              // Construct full PDF URL if relative
              if (!pdfUrl.startsWith('http')) {
                const baseUrlObj = new URL(this.config.url);
                pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
              }
            }
          }
          
          // If we don't have a valid direct PDF URL, navigate to detail page
          if (!pdfUrl || !pdfUrl.includes('.pdf')) {
            // Use linkHref as the detail page URL
            if (!element.linkHref) {
              logger.warn(`No link href found for gazette: ${element.text}`);
              continue;
            }
            
            let detailUrl = element.linkHref;
            if (!detailUrl.startsWith('http')) {
              const baseUrlObj = new URL(this.config.url);
              detailUrl = `${baseUrlObj.origin}${detailUrl.startsWith('/') ? '' : '/'}${detailUrl}`;
            }
            
            // Navigate to detail page to find PDF
            try {
              logger.debug(`Navigating to detail page to find PDF: ${detailUrl}`);
              
              await page.goto(detailUrl, { waitUntil: 'networkidle0', timeout: 15000 });
              this.requestCount++;
              await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for page to load
              
              // Check if we got a 404 or error page
              const pageTitle = await page.title();
              const pageUrl = page.url();
              
              if (pageTitle.toLowerCase().includes('não encontrada') || 
                  pageTitle.toLowerCase().includes('not found') ||
                  pageUrl.includes('404') ||
                  pageUrl !== detailUrl) {
                logger.warn(`Detail page returned error or redirect: ${detailUrl} -> ${pageUrl}`);
                await page.goBack();
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
              }
              
              // Look for PDF link on detail page
              const pdfLinkOnPage = await page.evaluate((editionNum) => {
                // Strategy 1: Look for direct PDF links in various elements
                const pdfSelectors = [
                  'a[href*=".pdf"]',
                  'embed[src*=".pdf"]',
                  'iframe[src*=".pdf"]',
                  'object[data*=".pdf"]',
                  'source[src*=".pdf"]',
                  '[onclick*=".pdf"]',
                  'button[onclick*=".pdf"]',
                  'a[onclick*=".pdf"]'
                ];
                
                for (const selector of pdfSelectors) {
                  const elements = document.querySelectorAll(selector);
                  for (const element of Array.from(elements)) {
                    let href = '';
                    if (element instanceof HTMLAnchorElement) {
                      href = element.href || element.getAttribute('href') || '';
                    } else if (element instanceof HTMLEmbedElement || element instanceof HTMLIFrameElement) {
                      href = element.src || element.getAttribute('src') || '';
                    } else if (element instanceof HTMLObjectElement) {
                      href = element.data || element.getAttribute('data') || '';
                    } else {
                      const onclick = element.getAttribute('onclick') || '';
                      const urlMatch = onclick.match(/['"]([^'"]*\.pdf[^'"]*)['"]/);
                      if (urlMatch) {
                        href = urlMatch[1];
                      }
                    }
                    
                    if (href && href.includes('.pdf')) {
                      const urlLower = href.toLowerCase();
                      // Validate it looks like a diário oficial
                      const hasDiarioKeywords = urlLower.includes('diario') || 
                                                urlLower.includes('diário') || 
                                                urlLower.includes('oficial') ||
                                                urlLower.includes('edicao') ||
                                                urlLower.includes('edição') ||
                                                urlLower.includes('doem') ||
                                                urlLower.includes('doe');
                      const hasEditionNumber = editionNum && href.includes(editionNum);
                      const isOtherDocument = urlLower.includes('diagnostico') ||
                                             urlLower.includes('diagnóstico') ||
                                             urlLower.includes('tecnico') ||
                                             urlLower.includes('técnico') ||
                                             urlLower.includes('participativo') ||
                                             urlLower.includes('pmsb') ||
                                             urlLower.includes('plano') ||
                                             urlLower.includes('lei') ||
                                             urlLower.includes('decreto');
                      
                      // Accept if it has diário keywords or edition number, and is not another document type
                      if ((hasDiarioKeywords || hasEditionNumber) && !isOtherDocument) {
                        return href;
                      }
                    }
                  }
                }
                
                // Strategy 2: Look for download buttons/links with text
                const downloadLinks = document.querySelectorAll('a, button');
                for (const link of Array.from(downloadLinks)) {
                  const text = link.textContent?.toLowerCase() || '';
                  const href = link.getAttribute('href') || '';
                  const onclick = link.getAttribute('onclick') || '';
                  
                  // Check if it's a download link
                  if (text.includes('download') || text.includes('baixar') || text.includes('visualizar') || 
                      href.includes('download') || onclick.includes('download')) {
                    let candidateUrl = href;
                    if (!candidateUrl && onclick) {
                      const urlMatch = onclick.match(/['"]([^'"]*\.pdf[^'"]*)['"]/);
                      if (urlMatch) {
                        candidateUrl = urlMatch[1];
                      }
                    }
                    
                    if (candidateUrl && candidateUrl.includes('.pdf')) {
                      const urlLower = candidateUrl.toLowerCase();
                      const hasDiarioKeywords = urlLower.includes('diario') || 
                                                urlLower.includes('diário') || 
                                                urlLower.includes('oficial') ||
                                                urlLower.includes('edicao') ||
                                                urlLower.includes('edição') ||
                                                urlLower.includes('doem') ||
                                                urlLower.includes('doe');
                      const hasEditionNumber = editionNum && candidateUrl.includes(editionNum);
                      const isOtherDocument = urlLower.includes('diagnostico') ||
                                             urlLower.includes('diagnóstico') ||
                                             urlLower.includes('tecnico') ||
                                             urlLower.includes('técnico') ||
                                             urlLower.includes('participativo') ||
                                             urlLower.includes('pmsb') ||
                                             urlLower.includes('plano') ||
                                             urlLower.includes('lei') ||
                                             urlLower.includes('decreto');
                      
                      if ((hasDiarioKeywords || hasEditionNumber) && !isOtherDocument) {
                        return candidateUrl;
                      }
                    }
                  }
                }
                
                // Strategy 3: Look for any PDF link if we have edition number (less strict validation)
                if (editionNum) {
                  const allPdfLinks = document.querySelectorAll('a[href*=".pdf"]');
                  for (const link of Array.from(allPdfLinks)) {
                    const href = link.getAttribute('href') || '';
                    if (href.includes(editionNum)) {
                      const urlLower = href.toLowerCase();
                      const isOtherDocument = urlLower.includes('diagnostico') ||
                                             urlLower.includes('diagnóstico') ||
                                             urlLower.includes('tecnico') ||
                                             urlLower.includes('técnico') ||
                                             urlLower.includes('participativo') ||
                                             urlLower.includes('pmsb');
                      if (!isOtherDocument) {
                        return href;
                      }
                    }
                  }
                }
                
                return null;
              }, element.editionNumber || '');
              
              if (pdfLinkOnPage) {
                // Make absolute if relative
                if (!pdfLinkOnPage.startsWith('http')) {
                  const baseUrlObj = new URL(detailUrl);
                  pdfUrl = `${baseUrlObj.origin}${pdfLinkOnPage.startsWith('/') ? '' : '/'}${pdfLinkOnPage}`;
                } else {
                  pdfUrl = pdfLinkOnPage;
                }
                logger.debug(`Found PDF URL on detail page: ${pdfUrl}`);
              } else {
                logger.warn(`No PDF found on detail page: ${detailUrl}`);
                // Go back to list page before continuing
                await page.goBack();
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
              }
              
              // Go back to list page
              await page.goBack();
              await new Promise(resolve => setTimeout(resolve, 1000));
              
            } catch (error) {
              logger.warn(`Error navigating to detail page: ${error}`);
              // Try to go back if we're still on detail page
              try {
                await page.goBack();
                await new Promise(resolve => setTimeout(resolve, 1000));
              } catch (e) {
                // Ignore errors going back
              }
              continue;
            }
          }
          
          // Final check: ensure we have a valid PDF URL
          if (!pdfUrl || !pdfUrl.includes('.pdf')) {
            logger.warn(`No valid PDF URL found for gazette: ${element.text}`);
            continue;
          }
          
          // Final validation: ensure PDF URL looks like a diário oficial
          if (pdfUrl) {
            const urlLower = pdfUrl.toLowerCase();
            const isOtherDocument = urlLower.includes('diagnostico') ||
                                   urlLower.includes('diagnóstico') ||
                                   urlLower.includes('tecnico') ||
                                   urlLower.includes('técnico') ||
                                   urlLower.includes('participativo') ||
                                   urlLower.includes('pmsb') ||
                                   urlLower.includes('plano') ||
                                   urlLower.includes('lei') ||
                                   urlLower.includes('decreto');
            
            if (isOtherDocument) {
              logger.warn(`Rejected PDF URL that doesn't look like diário oficial: ${pdfUrl} for gazette: ${element.text}`);
              continue;
            }
          }
          
          // Extract edition number if not already extracted
          let editionNumber = element.editionNumber;
          if (!editionNumber && element.text) {
            const editionMatch = element.text.match(/Edi[çc][ãa]o:?\s*(\d+)/i) || 
                                element.text.match(/n[°º]?\s*(\d+)/i) ||
                                element.text.match(/(\d{4,})/); // Match 4+ digit numbers (likely edition)
            editionNumber = editionMatch ? editionMatch[1] : undefined;
          }
          
          // Check if it's an extra edition
          const isExtraEdition = element.text?.toLowerCase().includes('extra') || false;
          
          // Create gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber,
            isExtraEdition,
            power: 'executive_legislative',
            sourceText: element.text || `Gazette ${toISODate(gazetteDate)}`,
          });
          
          if (gazette) {
            gazettes.push(gazette);
          }
          
        } catch (error) {
          logger.error(`Error processing link-based gazette element:`, error as Error);
        }
      }
      
    } catch (error) {
      logger.error(`Error extracting link-based gazettes from page:`, error as Error);
    }
    
    return gazettes;
  }
}
