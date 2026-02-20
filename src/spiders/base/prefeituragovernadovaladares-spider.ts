import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Configuration interface for Prefeitura Governador Valadares spider
 */
export interface PrefeituraGovernadorValadaresConfig {
  type: 'prefeituragovernadovaladares';
  /** Base URL for the Prefeitura Governador Valadares diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Spider for Prefeitura de Governador Valadares diário oficial
 * 
 * Site Structure:
 * - URL: https://www.valadares.mg.gov.br/diario-eletronico/caderno/governador-valadares-mg/1
 * - Uses Portal Fácil platform with AjaxPro for loading gazettes
 * - Gazettes are loaded via JavaScript (diel_diel_lis.GetDiario)
 * - List of editions with "Visualizar arquivo" links
 * - PDF URLs: https://www.valadares.mg.gov.br/abrir_arquivo.aspx?cdLocal=12&arquivo={GUID}.pdf
 * 
 * Data Structure per gazette:
 * - Edition number (N° XXXX / YYYY)
 * - Date (DD/Mês/YYYY)
 * - Size (X.XXX MB)
 * - Link to PDF
 * 
 * Requires browser rendering due to JavaScript-heavy page
 */
export class PrefeituraGovernadorValadaresSpider extends BaseSpider {
  protected govValadaresConfig: PrefeituraGovernadorValadaresConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.govValadaresConfig = spiderConfig.config as PrefeituraGovernadorValadaresConfig;
    this.browser = browser || null;
    
    if (!this.govValadaresConfig.baseUrl) {
      throw new Error(`PrefeituraGovernadorValadaresSpider requires a baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraGovernadorValadaresSpider for ${spiderConfig.name} with URL: ${this.govValadaresConfig.baseUrl}`, {
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
    logger.info(`Crawling ${this.govValadaresConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error('PrefeituraGovernadorValadaresSpider requires browser rendering');
    }
    
    return this.crawlWithBrowser();
  }

  /**
   * Browser-based crawling for Portal Fácil sites
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Navigate to the diário oficial page
      logger.debug(`Navigating to: ${this.govValadaresConfig.baseUrl}`);
      await page.goto(this.govValadaresConfig.baseUrl, { waitUntil: 'networkidle0', timeout: 45000 });
      this.requestCount++;
      
      // Wait for page to stabilize and JavaScript to load the gazettes
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Wait for gazettes to load - look for the list container
      try {
        await page.waitForSelector('#arquivos li, .list-group-item, ul.list-group', { timeout: 15000 });
      } catch (error) {
        logger.warn('Gazette list not found, page may be empty or still loading');
      }
      
      // Additional wait for JavaScript to finish loading content
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extract gazettes from the page
      let hasMorePages = true;
      let currentPage = 1;
      const maxPages = 50;
      
      while (hasMorePages && currentPage <= maxPages) {
        logger.debug(`Extracting gazettes from page ${currentPage}`);
        
        // Extract gazette data from the current page
        const pageGazettes = await this.extractGazettesFromPage(page);
        
        if (pageGazettes.length === 0) {
          logger.info(`No gazettes found on page ${currentPage}, stopping pagination`);
          hasMorePages = false;
          continue;
        }
        
        // Filter by date range and add to collection
        let foundOlderThanRange = false;
        for (const gazette of pageGazettes) {
          if (gazette) {
            const gazetteDate = new Date(gazette.date);
            
            if (this.isInDateRange(gazetteDate)) {
              gazettes.push(gazette);
            }
            
            // Check if we've found gazettes older than our date range
            if (gazetteDate < new Date(this.dateRange.start)) {
              foundOlderThanRange = true;
            }
          }
        }
        
        logger.debug(`Found ${pageGazettes.length} gazettes on page ${currentPage}, ${gazettes.length} in date range`);
        
        // If we found gazettes older than the range, stop pagination
        if (foundOlderThanRange) {
          logger.debug('Found gazettes older than date range, stopping pagination');
          hasMorePages = false;
          continue;
        }
        
        // Check for pagination - look for "Anteriores" button or next page link
        const nextPageButton = await page.$('button:not(:disabled):has-text("Anteriores"), a.page-link:has-text("›"), a.page-link:has-text("»"), .pagination a[href*="page"]');
        
        if (nextPageButton) {
          // Check if button is disabled
          const isDisabled = await page.evaluate((btn: any) => {
            return btn.disabled || btn.classList.contains('disabled') || btn.getAttribute('aria-disabled') === 'true';
          }, nextPageButton);
          
          if (!isDisabled) {
            logger.debug('Clicking next page button');
            await nextPageButton.click();
            await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for content to load
            currentPage++;
          } else {
            hasMorePages = false;
          }
        } else {
          // Try clicking "Anteriores" button if it exists
          const anterioresButton = await page.evaluate(() => {
            const buttons = document.querySelectorAll('button');
            for (const button of buttons) {
              if (button.textContent?.includes('Anteriores') && !button.disabled) {
                return true;
              }
            }
            return false;
          });
          
          if (anterioresButton) {
            await page.evaluate(() => {
              const buttons = document.querySelectorAll('button');
              for (const button of buttons) {
                if (button.textContent?.includes('Anteriores') && !button.disabled) {
                  button.click();
                  return;
                }
              }
            });
            await new Promise(resolve => setTimeout(resolve, 3000));
            currentPage++;
          } else {
            hasMorePages = false;
          }
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
   * Extract gazettes from the current browser page
   */
  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Extract gazette elements from the page
      // The structure has ul.list-group with li.list-group-item elements
      const gazetteData = await page.evaluate(() => {
        const data: any[] = [];
        
        // Find all list items that contain gazette info
        // Structure: <li class="list-group-item">
        //   <h4>DD/Mês/YYYY</h4>
        //   <span>N° XXXX / YYYY</span>
        //   <h5>Diário Oficial</h5>
        //   <div>Data: DD/MM/YYYY</div>
        //   <div>Descrição Diário:</div>
        //   <span>Tamanho: X.XXX MB</span>
        //   <a href="...">Visualizar arquivo</a>
        // </li>
        
        const listItems = document.querySelectorAll('.list-group-item, li.list-group-item, #arquivos li');
        
        for (const item of Array.from(listItems)) {
          // Skip items that are not gazette items (like headers)
          // Check for link with "abrir_arquivo" or containing "Visualizar" text
          let hasVisualizarLink = item.querySelector('a[href*="abrir_arquivo"]');
          if (!hasVisualizarLink) {
            // Check all links for "Visualizar" text
            const allLinks = item.querySelectorAll('a');
            for (const link of allLinks) {
              if (link.textContent?.includes('Visualizar')) {
                hasVisualizarLink = link;
                break;
              }
            }
          }
          if (!hasVisualizarLink) continue;
          
          // Extract edition number
          // Look for pattern "N° XXXX / YYYY"
          const editionElement = item.querySelector('span:not([class])');
          let editionText = editionElement?.textContent?.trim() || '';
          const editionMatch = editionText.match(/N[°º]\s*(\d+)\s*\/\s*(\d{4})/);
          const editionNumber = editionMatch ? editionMatch[1] : null;
          const editionYear = editionMatch ? editionMatch[2] : null;
          
          // Extract date
          // Look for pattern "Data: DD/MM/YYYY" or from h4 heading
          let dateText = '';
          // Find div containing "Data:" text
          const allDivs = item.querySelectorAll('div');
          for (const div of allDivs) {
            if (div.textContent?.includes('Data:')) {
              const match = div.textContent.match(/(\d{2})\/(\d{2})\/(\d{4})/);
              if (match) {
                dateText = `${match[1]}/${match[2]}/${match[3]}`;
                break;
              }
            }
          }
          
          // If no date found, try the h4 heading (Portuguese month format)
          if (!dateText) {
            const headingElement = item.querySelector('h4.list-group-item-heading, h4');
            const headingText = headingElement?.textContent?.trim() || '';
            // Pattern: DD/Mês/YYYY (e.g., "06/Janeiro/2026")
            const months: Record<string, string> = {
              'janeiro': '01', 'fevereiro': '02', 'março': '03', 'marco': '03',
              'abril': '04', 'maio': '05', 'junho': '06', 
              'julho': '07', 'agosto': '08', 'setembro': '09',
              'outubro': '10', 'novembro': '11', 'dezembro': '12'
            };
            const dateMatchPt = headingText.match(/(\d{2})\/(\w+)\/(\d{4})/i);
            if (dateMatchPt) {
              const monthNum = months[dateMatchPt[2].toLowerCase()];
              if (monthNum) {
                dateText = `${dateMatchPt[1]}/${monthNum}/${dateMatchPt[3]}`;
              }
            }
          }
          
          // Extract PDF URL
          const pdfLink = item.querySelector('a[href*="abrir_arquivo"]');
          let pdfUrl = pdfLink?.getAttribute('href') || '';
          
          // If not found, look for any "Visualizar" link
          if (!pdfUrl) {
            const allLinks = item.querySelectorAll('a');
            for (const link of allLinks) {
              if (link.textContent?.includes('Visualizar')) {
                pdfUrl = link.getAttribute('href') || '';
                break;
              }
            }
          }
          
          if (dateText && pdfUrl) {
            data.push({
              editionNumber,
              editionYear,
              dateText,
              pdfUrl,
            });
          }
        }
        
        return data;
      });
      
      logger.debug(`Found ${gazetteData.length} gazette items on page`);
      
      // Process each gazette item
      for (const item of gazetteData) {
        try {
          // Parse date (DD/MM/YYYY format)
          const dateMatch = item.dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) {
            logger.warn(`Could not parse date: ${item.dateText}`);
            continue;
          }
          
          const [, day, month, year] = dateMatch;
          const gazetteDate = new Date(`${year}-${month}-${day}`);
          
          // Validate date
          if (isNaN(gazetteDate.getTime())) {
            logger.warn(`Invalid date: ${item.dateText}`);
            continue;
          }
          
          // Construct full PDF URL if relative
          let pdfUrl = item.pdfUrl;
          if (!pdfUrl.startsWith('http')) {
            // Use valadares.mg.gov.br as the base
            pdfUrl = `https://www.valadares.mg.gov.br${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }
          
          // Create gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber: item.editionNumber || undefined,
            isExtraEdition: false,
            power: 'executive_legislative',
            sourceText: `Diário Oficial ${item.editionNumber ? `N° ${item.editionNumber}` : ''} - ${item.dateText}`,
          });
          
          if (gazette) {
            gazettes.push(gazette);
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

