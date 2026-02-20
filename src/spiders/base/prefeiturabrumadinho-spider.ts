import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraBrumadinhoConfig } from '../../types';
import { logger } from '../../utils/logger';
// @ts-ignore
import { parse } from 'node-html-parser';

/**
 * Spider for Prefeitura de Brumadinho diário oficial
 * 
 * Site Structure:
 * - URL: https://novo.brumadinho.mg.gov.br/portal/diario-oficial/lista
 * - Uses a list of links with format: "Edição XXXX - Dia da semana, DD de mês de YYYY. Edição: XXXX Postagem: DD/MM/YYYY Visualizações: XXX"
 * - Each link goes to a detail page with the PDF
 * - Requires browser rendering due to JavaScript-heavy page
 */
export class PrefeituraBrumadinhoSpider extends BaseSpider {
  protected brumadinhoConfig: PrefeituraBrumadinhoConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.brumadinhoConfig = spiderConfig.config as PrefeituraBrumadinhoConfig;
    this.browser = browser || null;
    
    if (!this.brumadinhoConfig.url) {
      throw new Error(`PrefeituraBrumadinhoSpider requires a url in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraBrumadinhoSpider for ${spiderConfig.name} with URL: ${this.brumadinhoConfig.url}`, {
      hasBrowser: !!this.browser,
    });
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.brumadinhoConfig.url} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error('PrefeituraBrumadinhoSpider requires browser rendering');
    }
    
    return this.crawlWithBrowser();
  }

  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Navigate to the list page
      logger.debug(`Navigating to: ${this.brumadinhoConfig.url}`);
      await page.goto(this.brumadinhoConfig.url, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Wait for page to stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extract gazettes from the page
      const pageGazettes = await this.extractGazettesFromPage(page);
      
      // Filter by date range
      for (const gazette of pageGazettes) {
        if (gazette && this.isInDateRange(new Date(gazette.date))) {
          gazettes.push(gazette);
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

  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Extract all links that match gazette patterns
      const linkElements = await page.evaluate(() => {
        const elements: any[] = [];
        const allLinks = document.querySelectorAll('a[href]');
        
        for (const link of Array.from(allLinks)) {
          const linkText = (link.textContent || '').replace(/\s+/g, ' ').trim();
          const href = link.getAttribute('href') || '';
          
          // Skip if link text is too short or doesn't contain "Edição"
          if (linkText.length < 20 || !/[Ee]di[çc][ãa]o/i.test(linkText)) {
            continue;
          }
          
          // Pattern: "Edição XXXX - ... Postagem: DD/MM/YYYY" (Brumadinho format)
          // Also matches: "Edição 3150 - Sexta - feira,09 de janeiro de 2025. Edição: 3150 Postagem: 12/01/2026"
          const editionMatch = linkText.match(/[Ee]di[çc][ãa]o\s+[Nn]?[°º]?\s*(\d+)/i);
          
          // Also check for "Postagem:" pattern which indicates the publication date
          const postagemMatch = linkText.match(/[Pp]ostagem\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/);
          
          // Fallback: look for any date pattern in the text
          const dateMatch = linkText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          
          const finalDateMatch = postagemMatch || dateMatch;
          
          if (editionMatch && finalDateMatch) {
            const editionNumber = editionMatch[1];
            const dateText = postagemMatch 
              ? `${postagemMatch[1]}/${postagemMatch[2]}/${postagemMatch[3]}`
              : `${dateMatch![1]}/${dateMatch![2]}/${dateMatch![3]}`;
            
            // Check if it's an extra edition
            const isExtra = linkText.toLowerCase().includes('extra');
            
            elements.push({
              editionNumber,
              dateText,
              href,
              isExtra,
              linkText: linkText.substring(0, 200), // Store first 200 chars for debugging
            });
          }
        }
        
        return elements;
      });
      
      logger.info(`Found ${linkElements.length} gazette links on page`);
      
      if (linkElements.length === 0) {
        logger.warn('No gazette links found on page. This might indicate a problem with the page structure or selectors.');
        // Try to get some debug info
        const debugInfo = await page.evaluate(() => {
          const allLinks = document.querySelectorAll('a[href]');
          const sampleLinks: string[] = [];
          for (let i = 0; i < Math.min(10, allLinks.length); i++) {
            const text = (allLinks[i].textContent || '').substring(0, 100);
            if (text.includes('Edição') || text.includes('edi')) {
              sampleLinks.push(text);
            }
          }
          return {
            totalLinks: allLinks.length,
            sampleLinks,
          };
        });
        logger.debug(`Debug info: ${JSON.stringify(debugInfo)}`);
      }
      
      // Process each link
      for (const element of linkElements) {
        try {
          // Parse date
          const dateMatch = element.dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) {
            continue;
          }
          
          const [, day, month, year] = dateMatch;
          const gazetteDate = new Date(`${year}-${month}-${day}`);
          
          if (isNaN(gazetteDate.getTime())) {
            logger.warn(`Invalid date parsed from: ${element.dateText}`);
            continue;
          }
          
          // Check if date is in range
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }
          
          // Navigate to the link to get the PDF URL
          // For Brumadinho, the link goes to a detail page with the PDF
          let pdfUrl = element.href;
          
          // Make URL absolute if relative
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.brumadinhoConfig.url);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }
          
          // Check if the link is already a PDF
          if (pdfUrl.toLowerCase().endsWith('.pdf')) {
            // Already a PDF, use it directly
            logger.debug(`Found direct PDF link: ${pdfUrl}`);
          } else {
            // Try to get PDF URL from the detail page using browser
            try {
              // Save current URL to navigate back
              const currentUrl = page.url();
              
              logger.debug(`Navigating to detail page: ${pdfUrl}`);
              // Navigate to detail page
              await page.goto(pdfUrl, { waitUntil: 'networkidle0', timeout: 15000 });
              this.requestCount++;
              
              // Wait for page to stabilize
              await new Promise(resolve => setTimeout(resolve, 2000));
              
              const pdfInfo = await page.evaluate(() => {
                // Look for PDF links or download buttons - try multiple selectors
                const selectors = [
                  'a[href*=".pdf"]',
                  'a[href*="download"]',
                  'iframe[src*=".pdf"]',
                  'embed[src*=".pdf"]',
                  'object[data*=".pdf"]',
                  '[data-href*=".pdf"]',
                  'a[onclick*="pdf"]',
                  'a[onclick*="download"]',
                ];
                
                for (const selector of selectors) {
                  const element = document.querySelector(selector);
                  if (element) {
                    const href = element.getAttribute('href') || 
                                 element.getAttribute('src') || 
                                 element.getAttribute('data') ||
                                 element.getAttribute('data-href') || '';
                    if (href && (href.includes('.pdf') || href.includes('download'))) {
                      return href;
                    }
                  }
                }
                
                // Check if current URL is a PDF
                if (window.location.href.includes('.pdf')) {
                  return window.location.href;
                }
                
                return null;
              });
              
              // Navigate back to list page
              logger.debug(`Navigating back to list page: ${currentUrl}`);
              await page.goto(currentUrl, { waitUntil: 'networkidle0', timeout: 15000 });
              this.requestCount++;
              
              // Wait for page to stabilize
              await new Promise(resolve => setTimeout(resolve, 1000));
              
              if (pdfInfo) {
                if (pdfInfo.startsWith('http')) {
                  pdfUrl = pdfInfo;
                } else {
                  const baseUrlObj = new URL(pdfUrl);
                  pdfUrl = `${baseUrlObj.origin}${pdfInfo.startsWith('/') ? '' : '/'}${pdfInfo}`;
                }
                logger.debug(`Found PDF URL: ${pdfUrl}`);
              } else {
                logger.warn(`No PDF link found on detail page for ${pdfUrl}, skipping`);
                // Skip if we can't find the PDF URL
                continue;
              }
            } catch (error) {
              logger.warn(`Could not fetch detail page for ${pdfUrl}: ${error}`);
              // Skip if we can't get the PDF URL
              continue;
            }
          }
          
          // Create gazette
          logger.debug(`Creating gazette for edition ${element.editionNumber}, date ${element.dateText}, PDF: ${pdfUrl}`);
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber: element.editionNumber,
            isExtraEdition: element.isExtra,
            power: 'executive_legislative',
            sourceText: element.linkText,
          });
          
          if (gazette) {
            gazettes.push(gazette);
            logger.debug(`Successfully created gazette: ${gazette.id}`);
          } else {
            logger.warn(`Failed to create gazette for edition ${element.editionNumber}, date ${element.dateText}`);
          }
          
        } catch (error) {
          logger.error(`Error processing gazette element:`, error as Error);
        }
      }
      
    } catch (error) {
      logger.error(`Error extracting gazettes from page:`, error as Error);
    }
    
    return gazettes;
  }
}
