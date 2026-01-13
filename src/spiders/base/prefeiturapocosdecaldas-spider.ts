import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraPocosdecaldasConfig } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for Prefeitura de Poços de Caldas - MG - Diário Oficial Eletrônico
 * 
 * Site Structure:
 * - Portal do Cidadão: https://sistemas.pocosdecaldas.mg.gov.br/portalcidadao/
 * - Uses GWT (Google Web Toolkit) with hash-based routing
 * - Diário Oficial search page accessible via specific hash in URL
 * - Search interface with: Edição, Data (from/to), Texto, Verificador
 * 
 * The site requires browser rendering due to GWT framework complexity.
 * PDFs are retrieved from the Portal do Cidadão system.
 */
export class PrefeiturapocosdecaldasSpider extends BaseSpider {
  protected pocosdecaldasConfig: PrefeituraPocosdecaldasConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.pocosdecaldasConfig = spiderConfig.config as PrefeituraPocosdecaldasConfig;
    this.browser = browser || null;
    
    if (!this.pocosdecaldasConfig.baseUrl) {
      throw new Error(`PrefeiturapocosdecaldasSpider requires a baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeiturapocosdecaldasSpider for ${spiderConfig.name} with URL: ${this.pocosdecaldasConfig.baseUrl}`, {
      hasBrowser: !!this.browser,
    });
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.pocosdecaldasConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error('PrefeiturapocosdecaldasSpider requires browser rendering');
    }
    
    return this.crawlWithBrowser();
  }

  /**
   * Browser-based crawling for Poços de Caldas Diário Oficial
   * 
   * Navigation flow:
   * 1. Go to Prefeitura main site
   * 2. Click on "Diário Oficial Eletrônico do Município" link
   * 3. This navigates to Portal do Cidadão with the correct GWT hash
   * 4. Click "Buscar" to load results
   * 5. Extract gazette list with PDF links
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Set viewport to ensure all elements are visible
      await page.setViewport({ width: 1366, height: 768 });
      
      // Set user agent
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      // First, navigate to the main Prefeitura site to find the Diário Oficial link
      const mainSiteUrl = 'https://pocosdecaldas.mg.gov.br/';
      logger.debug(`Navigating to main Prefeitura site: ${mainSiteUrl}`);
      await page.goto(mainSiteUrl, { waitUntil: 'networkidle0', timeout: 60000 });
      this.requestCount++;
      
      // Wait for the page to fully load
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Look for "Diário Oficial" link and click it
      const clicked = await this.clickDiarioOficialLink(page);
      
      if (clicked) {
        // Wait for navigation to Portal do Cidadão with correct hash
        // The GWT application needs extra time to load
        await new Promise(resolve => setTimeout(resolve, 10000));
        logger.debug('Successfully navigated to Diário Oficial page');
        
        // Wait for the page to be fully loaded by checking for form elements
        try {
          await page.waitForFunction(() => {
            const buttons = document.querySelectorAll('button');
            for (const btn of Array.from(buttons)) {
              const text = btn.textContent?.replace(/\s+/g, '').toLowerCase() || '';
              if (text.includes('buscar')) return true;
            }
            return false;
          }, { timeout: 15000 });
          logger.debug('Found Buscar button, page is ready');
        } catch (e) {
          logger.debug('Timeout waiting for Buscar button, continuing anyway...');
        }
      } else {
        // Fallback: try navigating directly to the Portal do Cidadão URL
        logger.debug('Diário Oficial link not found on main site, trying direct URL...');
        await page.goto(this.pocosdecaldasConfig.baseUrl, { waitUntil: 'networkidle0', timeout: 60000 });
        this.requestCount++;
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
      
      // Now we should be on the Diário Oficial search page
      // Fill in date filters if possible, then click Buscar
      const searchSuccess = await this.performSearch(page);
      
      if (searchSuccess) {
        // Wait for results to load
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Extract gazettes from search results
        const extractedGazettes = await this.extractGazettesFromPage(page);
        gazettes.push(...extractedGazettes);
      } else {
        // Try extracting without search (page might already have results)
        logger.debug('Search button not found, trying to extract from current page...');
        const extractedGazettes = await this.extractGazettesFromPage(page);
        gazettes.push(...extractedGazettes);
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
   * Click on "Diário Oficial Eletrônico do Município" link in the page
   */
  private async clickDiarioOficialLink(page: any): Promise<boolean> {
    try {
      // Use JavaScript to find and click the link by text content
      const clicked = await page.evaluate(() => {
        const allLinks = document.querySelectorAll('a');
        
        // Priority 1: Look for the full "Diário Oficial Eletrônico do Município" text
        for (const link of Array.from(allLinks)) {
          const text = link.textContent?.trim() || '';
          if (text === 'Diário Oficial Eletrônico do Município') {
            (link as HTMLElement).click();
            return 'full';
          }
        }
        
        // Priority 2: Look for links containing "Diário Oficial Eletrônico"
        for (const link of Array.from(allLinks)) {
          const text = link.textContent?.trim() || '';
          if (text.includes('Diário Oficial Eletrônico')) {
            (link as HTMLElement).click();
            return 'eletrônico';
          }
        }
        
        // Priority 3: Look for links in nav/menu that contain "Diário Oficial"
        const menuLinks = document.querySelectorAll('nav a, .menu a, ul.menu a, header a');
        for (const link of Array.from(menuLinks)) {
          const text = link.textContent?.trim() || '';
          if (text.includes('Diário Oficial')) {
            (link as HTMLElement).click();
            return 'menu';
          }
        }
        
        // Priority 4: Look for any link containing "Diário Oficial"
        for (const link of Array.from(allLinks)) {
          const text = link.textContent?.trim() || '';
          if (text.includes('Diário Oficial') && !text.includes('DOM')) {
            (link as HTMLElement).click();
            return 'any';
          }
        }
        
        return false;
      });
      
      if (clicked) {
        this.requestCount++;
        logger.debug(`Clicked on Diário Oficial link (match type: ${clicked})`);
        return true;
      }
      
      return false;
    } catch (error) {
      logger.warn('Error clicking Diário Oficial link', { error: (error as Error).message });
      return false;
    }
  }

  /**
   * Perform search on the Diário Oficial page
   */
  private async performSearch(page: any): Promise<boolean> {
    try {
      // Format dates for the search form (DD/MM/YYYY format)
      const formatDate = (date: Date): string => {
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
      };
      
      const startDateStr = formatDate(this.startDate);
      const endDateStr = formatDate(this.endDate);
      
      logger.debug(`Searching for gazettes from ${startDateStr} to ${endDateStr}`);
      
      // Note: We skip filling date filters because GWT may not properly detect
      // programmatic changes. Instead, we search with empty filters to get
      // recent results (default is 10 results).
      
      // Click the "Buscar" button using Puppeteer's native click
      // GWT may not respond well to JavaScript click events
      let clicked = false;
      
      // First, find the button element reference
      const buttonInfo = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        for (let i = 0; i < buttons.length; i++) {
          const button = buttons[i];
          const text = button.textContent?.replace(/\s+/g, '').toLowerCase() || '';
          if (text.includes('buscar')) {
            // Return info about the button for native Puppeteer click
            const rect = button.getBoundingClientRect();
            return {
              found: true,
              index: i,
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2,
              text: button.textContent,
            };
          }
        }
        return { found: false };
      });
      
      if (buttonInfo.found) {
        // Scroll the button into view first
        await page.evaluate((idx: number) => {
          const buttons = document.querySelectorAll('button');
          if (buttons[idx]) {
            buttons[idx].scrollIntoView({ behavior: 'instant', block: 'center' });
          }
        }, buttonInfo.index);
        
        // Wait a bit after scrolling
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Get updated coordinates after scroll
        const updatedButtonInfo = await page.evaluate((idx: number) => {
          const buttons = document.querySelectorAll('button');
          if (buttons[idx]) {
            const rect = buttons[idx].getBoundingClientRect();
            return {
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2,
            };
          }
          return null;
        }, buttonInfo.index);
        
        if (updatedButtonInfo) {
          // Use Puppeteer's native click which better simulates real user interaction
          try {
            // Move mouse to button first (simulates hover)
            await page.mouse.move(updatedButtonInfo.x, updatedButtonInfo.y);
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // Click at the center of the button
            await page.mouse.click(updatedButtonInfo.x, updatedButtonInfo.y);
            clicked = true;
            logger.debug(`Clicked Buscar button via native click at (${updatedButtonInfo.x}, ${updatedButtonInfo.y}), text: "${buttonInfo.text}"`);
          } catch (e) {
            logger.debug(`Native click error: ${(e as Error).message}`);
          }
        }
        
        // If native click didn't work, try keyboard Enter after focusing
        if (!clicked) {
          logger.debug('Native click may have failed, trying focus + Enter...');
          await page.evaluate((idx: number) => {
            const buttons = document.querySelectorAll('button');
            if (buttons[idx]) {
              (buttons[idx] as HTMLButtonElement).focus();
            }
          }, buttonInfo.index);
          await page.keyboard.press('Enter');
          clicked = true;
          logger.debug('Pressed Enter after focusing Buscar button');
        }
      }
      
      if (clicked) {
        logger.debug('Clicked Buscar button');
        this.requestCount++;
        
        // Wait for search results to load - look for download links specifically
        try {
          await page.waitForFunction(() => {
            // Look for any links containing "Baixar" text (case-insensitive)
            const links = Array.from(document.querySelectorAll('a'));
            for (const link of links) {
              const text = link.textContent?.toLowerCase().replace(/\s+/g, '') || '';
              if (text.includes('baixar')) {
                return true;
              }
            }
            return false;
          }, { timeout: 20000 });
          logger.debug('Search results loaded - found Baixar links');
        } catch (e) {
          logger.debug('Timeout waiting for Baixar links after 20s, checking for any results...');
          
          // Check if there might be an error message or no results
          const pageState = await page.evaluate(() => {
            const bodyText = document.body?.innerText || '';
            const hasNoResults = bodyText.includes('Nenhum resultado') || bodyText.includes('não encontrado');
            const hasError = bodyText.includes('erro') || bodyText.includes('Erro');
            const links = document.querySelectorAll('a');
            const linkTexts = Array.from(links).map(l => l.textContent?.trim()).filter(t => t).slice(0, 10);
            return { hasNoResults, hasError, linkCount: links.length, linkTexts };
          });
          logger.debug(`Page state after search: ${JSON.stringify(pageState)}`);
        }
        
        // Additional wait to ensure results are fully rendered
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        return true;
      } else {
        logger.warn('Could not find Buscar button');
        return false;
      }
      
    } catch (error) {
      logger.error('Error performing search:', error as Error);
      return false;
    }
  }

  /**
   * Extract gazettes from the current browser page
   */
  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Extract data from the page using multiple strategies
      const gazetteData = await page.evaluate(() => {
        const data: { editionNumber: string; dateStr: string; title: string; downloadUrl: string; verificador: string }[] = [];
        
        // Find all download links first
        const allLinks = document.querySelectorAll('a');
        const downloadLinks: { href: string; text: string; rect: DOMRect | null }[] = [];
        
        for (const link of Array.from(allLinks)) {
          const href = (link as HTMLAnchorElement).href || '';
          const text = link.textContent?.trim() || '';
          
          // Look for download/baixar links or PDF links
          if (text.toLowerCase().includes('baixar') || 
              text.toLowerCase().includes('download') || 
              href.includes('.pdf') ||
              href.includes('download') ||
              href.includes('arquivo')) {
            try {
              downloadLinks.push({
                href,
                text,
                rect: link.getBoundingClientRect(),
              });
            } catch (e) {
              downloadLinks.push({ href, text, rect: null });
            }
          }
        }
        
        // Strategy 1: Find elements with "Edição" text and extract info
        const allDivs = document.querySelectorAll('div, td, span, p');
        const editionMap = new Map<string, { dateStr: string; downloadUrl: string }>();
        
        for (const elem of Array.from(allDivs)) {
          const text = elem.textContent || '';
          
          // Look for "Edição XXXX" or "ção: XXXX" patterns
          const editionMatch = text.match(/(?:Edição|ção)[:\s]*(\d{3,5})/i);
          if (editionMatch && !editionMap.has(editionMatch[1])) {
            const editionNumber = editionMatch[1];
            
            // Look for date near this element (DD-MM-YYYY or DD/MM/YYYY)
            const dateMatch = text.match(/(\d{2})[-/](\d{2})[-/](\d{2,4})/);
            let dateStr = '';
            if (dateMatch) {
              const day = dateMatch[1];
              const month = dateMatch[2];
              let year = dateMatch[3];
              if (year.length === 2) {
                year = '20' + year;
              }
              dateStr = `${day}/${month}/${year}`;
            }
            
            // If no date found in this element, check parent/siblings
            if (!dateStr) {
              const parent = elem.parentElement;
              if (parent) {
                const parentText = parent.textContent || '';
                const parentDateMatch = parentText.match(/(\d{2})[-/](\d{2})[-/](\d{2,4})/);
                if (parentDateMatch) {
                  const day = parentDateMatch[1];
                  const month = parentDateMatch[2];
                  let year = parentDateMatch[3];
                  if (year.length === 2) {
                    year = '20' + year;
                  }
                  dateStr = `${day}/${month}/${year}`;
                }
              }
            }
            
            // Find the closest download link
            let closestDownloadUrl = '';
            const elemRect = elem.getBoundingClientRect();
            let minDistance = Infinity;
            
            for (const downloadLink of downloadLinks) {
              if (downloadLink.rect) {
                // Calculate distance between elements
                const dx = downloadLink.rect.left - elemRect.right;
                const dy = Math.abs(downloadLink.rect.top - elemRect.top);
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                // Prefer links that are to the right and on the same row
                if (dy < 100 && distance < minDistance) {
                  minDistance = distance;
                  closestDownloadUrl = downloadLink.href;
                }
              }
            }
            
            // If no close link found, use the first available download link
            if (!closestDownloadUrl && downloadLinks.length > 0) {
              // Try to match by checking if the link container also contains this edition
              for (const downloadLink of downloadLinks) {
                const linkParent = document.querySelector(`a[href="${downloadLink.href}"]`)?.closest('div, tr, td');
                if (linkParent && linkParent.textContent?.includes(editionNumber)) {
                  closestDownloadUrl = downloadLink.href;
                  break;
                }
              }
            }
            
            if (closestDownloadUrl) {
              editionMap.set(editionNumber, { dateStr, downloadUrl: closestDownloadUrl });
            }
          }
        }
        
        // Convert map to array
        for (const [editionNumber, info] of Array.from(editionMap.entries())) {
          data.push({
            editionNumber,
            dateStr: info.dateStr,
            title: `Diário Oficial Eletrônico do Município de Poços de Caldas - Edição ${editionNumber}`,
            downloadUrl: info.downloadUrl,
            verificador: '',
          });
        }
        
        // Strategy 2: If no results, look for table structure
        if (data.length === 0) {
          const tables = document.querySelectorAll('table');
          for (const table of Array.from(tables)) {
            const rows = table.querySelectorAll('tr');
            for (const row of Array.from(rows)) {
              const rowText = row.textContent || '';
              const editionMatch = rowText.match(/(?:Edição|ção)[:\s]*(\d{3,5})/i);
              
              if (editionMatch) {
                const editionNumber = editionMatch[1];
                const dateMatch = rowText.match(/(\d{2})[-/](\d{2})[-/](\d{2,4})/);
                let dateStr = '';
                if (dateMatch) {
                  dateStr = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3].length === 2 ? '20' + dateMatch[3] : dateMatch[3]}`;
                }
                
                // Look for download link in the row
                const links = row.querySelectorAll('a');
                let downloadUrl = '';
                for (const link of Array.from(links)) {
                  const href = (link as HTMLAnchorElement).href || '';
                  const linkText = link.textContent?.toLowerCase() || '';
                  if (linkText.includes('baixar') || href.includes('.pdf')) {
                    downloadUrl = href;
                    break;
                  }
                }
                
                if (downloadUrl) {
                  const exists = data.some(d => d.editionNumber === editionNumber);
                  if (!exists) {
                    data.push({
                      editionNumber,
                      dateStr,
                      title: `Diário Oficial - Edição ${editionNumber}`,
                      downloadUrl,
                      verificador: '',
                    });
                  }
                }
              }
            }
          }
        }
        
        // Strategy 3: Fallback - just get all PDF links with context
        if (data.length === 0 && downloadLinks.length > 0) {
          for (const downloadLink of downloadLinks) {
            // Try to find edition number near the link
            const linkElement = document.querySelector(`a[href="${downloadLink.href}"]`);
            if (linkElement) {
              const container = linkElement.closest('div, tr, section') || linkElement.parentElement;
              if (container) {
                const containerText = container.textContent || '';
                const editionMatch = containerText.match(/(?:Edição|ção)[:\s]*(\d{3,5})/i);
                const dateMatch = containerText.match(/(\d{2})[-/](\d{2})[-/](\d{2,4})/);
                
                if (editionMatch) {
                  const editionNumber = editionMatch[1];
                  let dateStr = '';
                  if (dateMatch) {
                    dateStr = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3].length === 2 ? '20' + dateMatch[3] : dateMatch[3]}`;
                  }
                  
                  const exists = data.some(d => d.editionNumber === editionNumber);
                  if (!exists) {
                    data.push({
                      editionNumber,
                      dateStr,
                      title: `Diário Oficial - Edição ${editionNumber}`,
                      downloadUrl: downloadLink.href,
                      verificador: '',
                    });
                  }
                }
              }
            }
          }
        }
        
        return data;
      });
      
      // Log debug info about what was found
      const pageInfo = await page.evaluate(() => {
        const downloadLinks = Array.from(document.querySelectorAll('a'))
          .filter(a => {
            const text = a.textContent?.toLowerCase() || '';
            const href = a.href || '';
            return text.includes('baixar') || href.includes('.pdf') || href.includes('download');
          })
          .map(a => ({ text: a.textContent?.trim().slice(0, 50), href: a.href?.slice(0, 100) }));
        
        const bodyText = document.body?.innerText?.slice(0, 2000) || '';
        const hasEdition = bodyText.includes('Edição') || bodyText.includes('ção');
        
        return {
          downloadLinksCount: downloadLinks.length,
          downloadLinks: downloadLinks.slice(0, 5),
          hasEditionText: hasEdition,
          bodyTextPreview: bodyText.slice(0, 500),
        };
      });
      
      logger.debug(`Page info: downloadLinks=${pageInfo.downloadLinksCount}, hasEdition=${pageInfo.hasEditionText}`);
      if (pageInfo.downloadLinksCount > 0) {
        logger.debug(`Download links found: ${JSON.stringify(pageInfo.downloadLinks)}`);
      }
      if (pageInfo.hasEditionText) {
        logger.debug(`Body text preview: ${pageInfo.bodyTextPreview.replace(/\n/g, ' ').slice(0, 200)}`);
      }
      
      logger.debug(`Found ${gazetteData.length} gazette items on page`);
      
      // Process each gazette item
      for (const item of gazetteData) {
        try {
          // Parse date from the extracted string
          let date: Date | null = null;
          
          if (item.dateStr) {
            const parts = item.dateStr.split('/');
            if (parts.length === 3) {
              const [day, month, year] = parts.map(Number);
              date = new Date(year, month - 1, day);
              if (isNaN(date.getTime())) {
                date = null;
              }
            }
          }
          
          // If no date found, use today as fallback
          if (!date) {
            date = new Date();
            logger.debug(`No date found for edition ${item.editionNumber}, using today`);
          }
          
          // Check if date is in range
          if (!this.isInDateRange(date)) {
            logger.debug(`Edition ${item.editionNumber} (${item.dateStr}) is outside date range`);
            continue;
          }
          
          // Construct full PDF URL if relative
          let pdfUrl = item.downloadUrl;
          if (!pdfUrl.startsWith('http')) {
            pdfUrl = new URL(pdfUrl, this.pocosdecaldasConfig.baseUrl).href;
          }
          
          // Create gazette
          const gazette = await this.createGazette(date, pdfUrl, {
            editionNumber: item.editionNumber || undefined,
            isExtraEdition: /extra|suplemento|extraordin/i.test(item.title),
            power: 'executive_legislative',
            sourceText: item.title,
          });
          
          if (gazette) {
            gazettes.push(gazette);
            logger.debug(`Added gazette: Edition ${item.editionNumber}, Date: ${date.toISOString().split('T')[0]}`);
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
