import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraItuiutabaConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * PrefeituraItuiutabaSpider implementation
 * 
 * Crawls Ituiutaba's Diário Oficial from the official website
 * which requires JavaScript rendering to load content.
 * 
 * Site structure:
 * - Base URL: https://www.ituiutaba.mg.gov.br
 * - HTML page with JavaScript-rendered content
 * - Diário Oficial listings with edition numbers, dates, and PDF download links
 * 
 * The spider:
 * 1. Navigates to diário oficial page
 * 2. Waits for JavaScript to load content
 * 3. Extracts gazettes from the loaded content
 * 4. Filters gazettes to match the requested date range
 */
export class PrefeituraItuiutabaSpider extends BaseSpider {
  protected ituiutabaConfig: PrefeituraItuiutabaConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.ituiutabaConfig = spiderConfig.config as PrefeituraItuiutabaConfig;
    this.browser = browser || null;
    
    if (!this.ituiutabaConfig.baseUrl) {
      throw new Error(`PrefeituraItuiutabaSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraItuiutabaSpider for ${spiderConfig.name}`, {
      hasBrowser: !!this.browser,
    });
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  /**
   * Parse date from various formats
   */
  private parseDate(dateText: string): Date | null {
    // Try DD/MM/YYYY format
    const slashMatch = dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (slashMatch) {
      const [, day, month, year] = slashMatch;
      return new Date(`${year}-${month}-${day}`);
    }

    return null;
  }

  /**
   * Extract edition number from text
   */
  private extractEditionNumber(text: string): string | undefined {
    // Try pattern: "Nº XXXX" or "Edição nº XXXX"
    const edicaoMatch = text.match(/(?:N[°º]|Edi[çc][ãa]o\s+n[°º]?)\s*(\d+)/i);
    if (edicaoMatch) {
      return edicaoMatch[1];
    }

    // Try pattern: "Diário Oficial XX-YYYY" or "Diário Oficial XX/YYYY" (e.g., "09-2026" or "07/2026")
    const formatoAnoMatch = text.match(/Di[áa]rio\s+Oficial\s+(\d+)[-\/]\d{4}/i);
    if (formatoAnoMatch) {
      return formatoAnoMatch[1];
    }

    // Try pattern: "Edição: XX-YYYY" or "Edição: XX/YYYY"
    const edicaoFormatoMatch = text.match(/Edi[çc][ãa]o:\s*(\d+)[-\/]\d{4}/i);
    if (edicaoFormatoMatch) {
      return edicaoFormatoMatch[1];
    }

    return undefined;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.ituiutabaConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error('PrefeituraItuiutabaSpider requires browser rendering');
    }
    
    return this.crawlWithBrowser();
  }

  /**
   * Browser-based crawling for Ituiutaba diário oficial page
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Navigate to diário oficial page
      logger.debug(`Navigating to: ${this.ituiutabaConfig.baseUrl}`);
      await page.goto(this.ituiutabaConfig.baseUrl, { waitUntil: 'networkidle0', timeout: 45000 });
      this.requestCount++;
      
      // Wait for JavaScript to load content
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Wait for content to load
      try {
        await page.waitForSelector('a, article, .list-item, .gazette, table, [class*="newspaper"], [class*="edicao"], [class*="edição"], [class*="diario"]', { timeout: 15000 });
      } catch (error) {
        logger.warn('Content selectors not found, continuing anyway', error as Error);
      }

      // Additional wait for dynamic content
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Extract gazette data first (without PDF URLs)
      const gazetteData = await this.extractGazetteData(page);
      
      // For each gazette, try to get the real PDF URL by clicking the detail link
      for (const item of gazetteData) {
        if (!this.isInDateRange(this.parseDate(item.dateText) || new Date())) {
          continue;
        }
        
        // Try to get PDF URL by clicking the detail link
        const pdfUrl = await this.getPdfUrlFromDetailLink(page, item);
        
        if (!pdfUrl) {
          logger.warn(`Could not get PDF URL for edition ${item.editionNumber}`);
          continue;
        }
        
        // Parse date
        const gazetteDate = this.parseDate(item.dateText);
        if (!gazetteDate || isNaN(gazetteDate.getTime())) {
          continue;
        }
        
        // Create gazette
        const gazette = await this.createGazette(gazetteDate, pdfUrl, {
          editionNumber: item.editionNumber,
          power: 'executive',
          sourceText: item.fullText,
        });
        
        if (gazette) {
          gazettes.push(gazette);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
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
   * Extract gazette data from the page (without PDF URLs)
   */
  private async extractGazetteData(page: any): Promise<Array<{
    editionNumber?: string;
    dateText: string;
    fullText: string;
    detailLinkText?: string;
  }>> {
    return await page.evaluate(() => {
      const data: Array<{
        editionNumber?: string;
        dateText: string;
        fullText: string;
        detailLinkText?: string;
      }> = [];
      
      // Find all elements that contain "Diário Oficial" in their text
      const allElements = document.querySelectorAll('a, div, article, section, li');
      
      for (const element of Array.from(allElements)) {
        const elementText = (element as HTMLElement).textContent?.trim() || '';
        
        // Check if this element contains "Diário Oficial" pattern
        const diarioMatch = elementText.match(/Di[áa]rio\s+Oficial\s+(\d+)[-\/](\d{4})/i);
        if (!diarioMatch) continue;
        
        const editionNumber = diarioMatch[1];
        
        // Extract date from element text (format: "Data: DD/MM/YYYY")
        const dateMatch = elementText.match(/Data:\s*(\d{2}\/\d{2}\/\d{4})/i);
        if (!dateMatch) continue;
        
        const dateText = dateMatch[1];
        
        // Find the "Clique aqui para saber mais detalhes" link nearby
        let detailLink: HTMLAnchorElement | null = null;
        let currentElement: HTMLElement | null = element.parentElement;
        
        for (let i = 0; i < 10 && currentElement && !detailLink; i++) {
          const links = currentElement.querySelectorAll('a');
          for (const link of Array.from(links)) {
            const linkText = (link as HTMLElement).textContent?.trim() || '';
            if (linkText.toLowerCase().includes('clique aqui') || 
                linkText.toLowerCase().includes('saber mais') ||
                linkText.toLowerCase().includes('detalhe')) {
              detailLink = link as HTMLAnchorElement;
              break;
            }
          }
          currentElement = currentElement.parentElement;
        }
        
        data.push({
          editionNumber,
          dateText,
          fullText: elementText.substring(0, 500),
          detailLinkText: detailLink ? detailLink.href : undefined
        });
      }
      
      return data;
    });
  }

  /**
   * Get PDF URL by clicking the detail link or finding it in the page
   */
  private async getPdfUrlFromDetailLink(page: any, item: {
    editionNumber?: string;
    dateText: string;
    detailLinkText?: string;
  }): Promise<string | null> {
    try {
      // If we have a detail link, try to navigate to it
      if (item.detailLinkText) {
        const detailUrl = item.detailLinkText.startsWith('http') 
          ? item.detailLinkText 
          : new URL(item.detailLinkText, this.ituiutabaConfig.baseUrl).href;
        
        logger.debug(`Navigating to detail page: ${detailUrl}`);
        
        // Navigate to detail page
        await page.goto(detailUrl, { waitUntil: 'networkidle0', timeout: 15000 });
        this.requestCount++;
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Try to find PDF link on detail page
        const pdfUrl = await page.evaluate(() => {
          // Look for PDF links
          const pdfLinks = document.querySelectorAll('a[href*=".pdf"], a[href*="download"], object[data*=".pdf"], embed[src*=".pdf"]');
          for (const link of Array.from(pdfLinks)) {
            if (link instanceof HTMLAnchorElement) {
              return link.href;
            } else if (link instanceof HTMLObjectElement || link instanceof HTMLEmbedElement) {
              return (link as any).data || (link as any).src;
            }
          }
          return null;
        });
        
        // Go back to main page
        await page.goBack();
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        if (pdfUrl) {
          return pdfUrl.startsWith('http') ? pdfUrl : new URL(pdfUrl, this.ituiutabaConfig.baseUrl).href;
        }
      }
      
      // Fallback: try to construct URL from filename pattern
      // Extract year from date
      const dateMatch = item.dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const year = dateMatch ? dateMatch[3] : new Date().getFullYear().toString();
      const yearShort = year.substring(2);
      
      // Construct filename based on patterns we've seen
      const editionPadded = item.editionNumber?.padStart(2, '0') || '01';
      const filename = `arquivo_${editionPadded}-${yearShort}.pdf`;
      
      const baseUrlObj = new URL(this.ituiutabaConfig.baseUrl);
      
      // Try different URL patterns
      const urlPatterns = [
        `${baseUrlObj.origin}/diariooficial/${filename}`,
        `${baseUrlObj.origin}/diariooficial/download/${filename}`,
        `${baseUrlObj.origin}/download/${filename}`
      ];
      
      // Return first pattern (createGazette will validate it)
      return urlPatterns[0];
      
    } catch (error) {
      logger.error(`Error getting PDF URL for edition ${item.editionNumber}:`, error as Error);
      return null;
    }
  }

  /**
   * Extract gazettes from the current page (DEPRECATED - use extractGazetteData + getPdfUrlFromDetailLink)
   */
  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const processedUrls = new Set<string>();

    try {
      // Extract gazette data from the page
      const gazetteData = await page.evaluate(() => {
        const data: Array<{
          editionNumber?: string;
          dateText: string;
          pdfUrl: string;
          fullText: string;
        }> = [];
        
        // Find all elements that contain "Diário Oficial" in their text (not just links)
        const allElements = document.querySelectorAll('a, div, article, section, li');
        
        for (const element of Array.from(allElements)) {
          const elementText = (element as HTMLElement).textContent?.trim() || '';
          
          // Check if this element contains "Diário Oficial" pattern
          const diarioMatch = elementText.match(/Di[áa]rio\s+Oficial\s+(\d+)[-\/](\d{4})/i);
          if (!diarioMatch) continue;
          
          const editionNumber = diarioMatch[1];
          const year = diarioMatch[2];
          
          // Extract date from element text (format: "Data: DD/MM/YYYY")
          const dateMatch = elementText.match(/Data:\s*(\d{2}\/\d{2}\/\d{4})/i);
          if (!dateMatch) continue;
          
          const dateText = dateMatch[1];
          
          // Find the form or input field nearby that contains the PDF filename
          let pdfFilename: string | null = null;
          let pdfUrl: string | null = null;
          
          // Look for form with filename in nearby elements (search in parent containers)
          let currentElement: HTMLElement | null = element.parentElement;
          let foundForm = false;
          
          for (let i = 0; i < 10 && currentElement && !foundForm; i++) {
            // Check for form with input fields
            const forms = currentElement.querySelectorAll('form');
            for (const form of Array.from(forms)) {
              // Look for input fields with filename
              const inputs = form.querySelectorAll('input[type="text"], input[type="hidden"], input[name]');
              for (const input of Array.from(inputs)) {
                const value = (input as HTMLInputElement).value || '';
                const name = (input as HTMLInputElement).name || '';
                
                // Check if it looks like a PDF filename (e.g., "arquivo_09-2026.pdf" or "arquivo_07_2026.pdf")
                if (value.match(/arquivo[_-].*\.pdf/i) || (value.match(/\.pdf$/i) && value.length > 5 && !value.includes('false'))) {
                  pdfFilename = value;
                  foundForm = true;
                  
                  // Try to get the form action or construct URL
                  const formAction = form.getAttribute('action') || '';
                  if (formAction && formAction.includes('http')) {
                    pdfUrl = formAction;
                  }
                  break;
                }
              }
              if (foundForm) break;
            }
            
            // Also check for direct PDF links in the same container
            if (!pdfUrl) {
              const pdfLinks = currentElement.querySelectorAll('a[href*=".pdf"], a[href*="download"]');
              for (const pdfLink of Array.from(pdfLinks)) {
                const href = (pdfLink as HTMLAnchorElement).href;
                if (href && (href.includes('.pdf') || href.includes('download'))) {
                  pdfUrl = href;
                  break;
                }
              }
            }
            
            currentElement = currentElement.parentElement;
          }
          
          // Construct PDF URL if we found a filename but no URL
          if (!pdfUrl && pdfFilename) {
            // Try common download patterns
            const baseUrl = window.location.origin;
            // Try different URL patterns
            const urlPatterns = [
              `${baseUrl}/diariooficial/download/${pdfFilename}`,
              `${baseUrl}/diariooficial/${pdfFilename}`,
              `${baseUrl}/download/${pdfFilename}`
            ];
            pdfUrl = urlPatterns[0]; // Use first pattern as default
          }
          
          // If we have date and some URL/filename, add it
          if (dateText && (pdfUrl || pdfFilename)) {
            data.push({
              editionNumber,
              dateText,
              pdfUrl: pdfUrl || (pdfFilename ? `https://www.ituiutaba.mg.gov.br/diariooficial/${pdfFilename}` : ''),
              fullText: elementText.substring(0, 500)
            });
          }
        }
        
        return data;
      });

      logger.debug(`Found ${gazetteData.length} gazette entries on page`);
      
      for (const item of gazetteData) {
        try {
          // Make URL absolute if needed
          let pdfUrl = item.pdfUrl;
          
          // If URL is empty or just a filename, try to construct it
          if (!pdfUrl || (!pdfUrl.startsWith('http') && !pdfUrl.startsWith('/'))) {
            const baseUrlObj = new URL(this.ituiutabaConfig.baseUrl);
            // Try common download patterns
            if (pdfUrl.includes('.pdf')) {
              pdfUrl = `${baseUrlObj.origin}/diariooficial/${pdfUrl.startsWith('/') ? pdfUrl.substring(1) : pdfUrl}`;
            } else {
              // If we have a filename from the form, construct URL
              const filenameMatch = item.fullText.match(/arquivo[_-]([\d\-_]+\.pdf)/i);
              if (filenameMatch) {
                pdfUrl = `${baseUrlObj.origin}/diariooficial/download/${filenameMatch[1]}`;
              } else {
                logger.debug(`Could not construct PDF URL for: ${item.fullText}`);
                continue;
              }
            }
          } else if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.ituiutabaConfig.baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }

          // Skip if already processed
          if (processedUrls.has(pdfUrl)) {
            continue;
          }
          
          logger.debug(`Processing gazette: ${item.editionNumber || 'N/A'} - ${item.dateText} - ${pdfUrl}`);

          // Parse date
          const gazetteDate = this.parseDate(item.dateText);

          if (!gazetteDate || isNaN(gazetteDate.getTime())) {
            logger.debug(`Could not parse date from: ${item.dateText}`);
            continue;
          }

          // Mark URL as processed
          processedUrls.add(pdfUrl);

          // Create the gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber: item.editionNumber,
            power: 'executive',
            sourceText: item.fullText,
          });

          if (gazette) {
            gazettes.push(gazette);
            logger.debug(`Added gazette: Edição ${item.editionNumber || 'N/A'} - ${toISODate(gazetteDate)}`);
          }

        } catch (error) {
          logger.error(`Error processing gazette item:`, error as Error);
        }
      }

    } catch (error) {
      logger.error(`Error extracting gazettes from page:`, error as Error);
    }

    return gazettes;
  }
}


