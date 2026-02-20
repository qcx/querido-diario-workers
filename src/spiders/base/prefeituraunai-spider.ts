import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraUnaiConfig } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for Prefeitura de Unaí diário oficial
 * 
 * Site Structure:
 * - URL: https://www.prefeituraunai.mg.gov.br/diario-oficial
 * - Uses Portal Fácil platform similar to Ipatinga
 * - Requires browser rendering due to JavaScript-heavy page
 */
export class PrefeituraUnaiSpider extends BaseSpider {
  protected unaiConfig: PrefeituraUnaiConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.unaiConfig = spiderConfig.config as PrefeituraUnaiConfig;
    this.browser = browser || null;
    
    if (!this.unaiConfig.baseUrl) {
      throw new Error(`PrefeituraUnaiSpider requires a baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraUnaiSpider for ${spiderConfig.name} with URL: ${this.unaiConfig.baseUrl}`, {
      hasBrowser: !!this.browser,
    });
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.unaiConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error('PrefeituraUnaiSpider requires browser rendering');
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
      
      logger.debug(`Navigating to: ${this.unaiConfig.baseUrl}`);
      const response = await page.goto(this.unaiConfig.baseUrl, { waitUntil: 'networkidle0', timeout: 45000 });
      this.requestCount++;
      
      // Log response status for debugging
      const status = response?.status();
      logger.debug(`Page loaded with status: ${status}`);
      
      if (status === 404 || status === 503) {
        logger.warn(`Page returned ${status}, checking if page content exists`);
        const pageContent = await page.content();
        const hasContent = pageContent.length > 1000;
        logger.debug(`Page has content: ${hasContent}, length: ${pageContent.length}`);
        
        // If 404, try alternative URLs
        if (status === 404) {
          const altUrls = [
            'https://www.prefeituraunai.mg.gov.br/pmu2/index.php/transparencia/diario-oficial',
            'https://www.prefeituraunai.mg.gov.br/pmu2/index.php/servicos/diario-oficial',
            'https://www.prefeituraunai.mg.gov.br/pmu2/index.php/publicacoes/diario-oficial',
          ];
          
          for (const altUrl of altUrls) {
            logger.debug(`Trying alternative URL: ${altUrl}`);
            const altResponse = await page.goto(altUrl, { waitUntil: 'networkidle0', timeout: 30000 });
            if (altResponse?.status() === 200) {
              logger.info(`Found working URL: ${altUrl}`);
              break;
            }
          }
        }
      }
      
      // Wait for page to stabilize and JavaScript to load the gazettes
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Debug: Log page title and URL
      const pageTitle = await page.title();
      const currentUrl = page.url();
      logger.debug(`Page title: ${pageTitle}, Current URL: ${currentUrl}`);
      
      // Debug: Get page structure info
      const pageInfo = await page.evaluate(() => {
        return {
          bodyTextLength: document.body?.textContent?.length || 0,
          pdfLinks: document.querySelectorAll('a[href*=".pdf"]').length,
          allLinks: document.querySelectorAll('a').length,
          hasListGroup: !!document.querySelector('.list-group, ul.list-group, #arquivos'),
          hasTable: !!document.querySelector('table'),
          hasArticles: document.querySelectorAll('article').length,
          pageTextPreview: document.body?.textContent?.substring(0, 300) || '',
        };
      });
      logger.debug(`Page structure info: ${JSON.stringify(pageInfo)}`);
      
      // Try multiple selector patterns for different page structures
      const selectors = [
        '#arquivos li',
        '.list-group-item',
        'ul.list-group li',
        '.dof_publicacao_diario',
        'table tbody tr',
        '.gazette-item',
        '.publicacao-item',
        '[class*="diario"]',
        '[class*="publicacao"]',
        'article',
        '.item',
      ];
      
      let foundSelector = null;
      for (const selector of selectors) {
        try {
          await page.waitForSelector(selector, { timeout: 2000 });
          foundSelector = selector;
          logger.debug(`Found elements with selector: ${selector}`);
          break;
        } catch (e) {
          // Continue to next selector
        }
      }
      
      if (!foundSelector) {
        logger.warn('Gazette list not found with any selector, page may be empty or have different structure');
        // Debug: Log page structure
        const pageStructure = await page.evaluate(() => {
          return {
            bodyClasses: document.body?.className || '',
            mainContent: document.querySelector('main, #main, .main, .content, #content')?.className || 'not found',
            linksCount: document.querySelectorAll('a').length,
            pdfLinks: Array.from(document.querySelectorAll('a[href*=".pdf"]')).slice(0, 5).map(a => ({
              text: a.textContent?.trim().substring(0, 50),
              href: a.getAttribute('href'),
            })),
          };
        });
        logger.debug(`Page structure: ${JSON.stringify(pageStructure)}`);
      }
      
      // Additional wait for JavaScript to finish loading content
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extract gazettes from the page with pagination support
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
        const hasNextPageButton = await page.evaluate(() => {
          // Look for "Anteriores" button
          const buttons = document.querySelectorAll('button');
          for (const button of buttons) {
            if (button.textContent?.includes('Anteriores') && !button.disabled) {
              return true;
            }
          }
          // Look for pagination links
          const paginationLinks = document.querySelectorAll('a.page-link, .pagination a[href*="page"]');
          for (const link of paginationLinks) {
            if (link.textContent?.includes('›') || link.textContent?.includes('»')) {
              return true;
            }
          }
          return false;
        });
        
        if (hasNextPageButton) {
          // Click the button using evaluate
          const clicked = await page.evaluate(() => {
            const buttons = document.querySelectorAll('button');
            for (const button of buttons) {
              if (button.textContent?.includes('Anteriores') && !button.disabled) {
                button.click();
                return true;
              }
            }
            // Try pagination links
            const paginationLinks = document.querySelectorAll('a.page-link, .pagination a[href*="page"]');
            for (const link of paginationLinks) {
              const el = link as HTMLAnchorElement;
              if (link.textContent?.includes('›') || link.textContent?.includes('»')) {
                el.click();
                return true;
              }
            }
            return false;
          });
          
          if (clicked) {
            logger.debug('Clicked next page button');
            await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for content to load
            currentPage++;
          } else {
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
        const data: any[] = [];
        
        // First, try to find any PDF links on the page as fallback
        const allPdfLinks = document.querySelectorAll('a[href*=".pdf"]');
        console.log(`Found ${allPdfLinks.length} PDF links on page`);
        
        // Try Portal Fácil format first
        const listItems = document.querySelectorAll('.list-group-item, li.list-group-item, #arquivos li, table tbody tr, .item, article, [class*="publicacao"], [class*="diario"]');
        
        for (const item of Array.from(listItems)) {
          let hasVisualizarLink = item.querySelector('a[href*="abrir_arquivo"], a[href*="download"], a[href*=".pdf"]');
          if (!hasVisualizarLink) {
            const allLinks = item.querySelectorAll('a');
            for (const link of allLinks) {
              if (link.textContent?.includes('Visualizar') || link.textContent?.includes('Download') || link.textContent?.includes('Baixar')) {
                hasVisualizarLink = link;
                break;
              }
            }
          }
          if (!hasVisualizarLink) continue;
          
          let editionText = '';
          const editionElement = item.querySelector('span, h4, h5');
          editionText = editionElement?.textContent?.trim() || '';
          const editionMatch = editionText.match(/N[°º]\s*(\d+)/);
          const editionNumber = editionMatch ? editionMatch[1] : null;
          
          let dateText = '';
          
          // First, try to find date in "Data:" div
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
          
          // If not found, try all divs, spans, h4, h5 for date pattern
          if (!dateText) {
            const allElements = item.querySelectorAll('div, span, h4, h5');
            for (const el of allElements) {
              const text = el.textContent || '';
              const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
              if (dateMatch) {
                dateText = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;
                break;
              }
            }
          }
          
          // Try Portuguese month format (DD/Mês/YYYY)
          if (!dateText) {
            const months: Record<string, string> = {
              'janeiro': '01', 'fevereiro': '02', 'março': '03', 'marco': '03',
              'abril': '04', 'maio': '05', 'junho': '06', 
              'julho': '07', 'agosto': '08', 'setembro': '09',
              'outubro': '10', 'novembro': '11', 'dezembro': '12'
            };
            
            // Try editionText first
            const dateMatchPt = editionText.match(/(\d{2})\/(\w+)\/(\d{4})/i);
            if (dateMatchPt) {
              const monthNum = months[dateMatchPt[2].toLowerCase()];
              if (monthNum) {
                dateText = `${dateMatchPt[1]}/${monthNum}/${dateMatchPt[3]}`;
              }
            }
            
            // Try all text content
            if (!dateText) {
              const allElements = item.querySelectorAll('*');
              for (const el of allElements) {
                const text = el.textContent || '';
                const dateMatchPt2 = text.match(/(\d{2})\/(\w+)\/(\d{4})/i);
                if (dateMatchPt2) {
                  const monthNum = months[dateMatchPt2[2].toLowerCase()];
                  if (monthNum) {
                    dateText = `${dateMatchPt2[1]}/${monthNum}/${dateMatchPt2[3]}`;
                    break;
                  }
                }
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
              if (link.textContent?.includes('Visualizar') || link.textContent?.includes('Download') || link.textContent?.includes('Baixar')) {
                pdfUrl = link.getAttribute('href') || '';
                break;
              }
            }
          }
          
          // Try PDF links
          if (!pdfUrl) {
            const pdfLinks = item.querySelectorAll('a[href*=".pdf"], a[href*="download"], a[href*="abrir_arquivo"]');
            if (pdfLinks.length > 0) {
              pdfUrl = pdfLinks[0].getAttribute('href') || '';
            }
          }
          
          if (dateText && pdfUrl) {
            data.push({
              editionNumber,
              dateText,
              pdfUrl,
            });
          }
        }
        
        // Try Instar format if no items found
        if (data.length === 0) {
          const instarItems = document.querySelectorAll('.dof_publicacao_diario');
          for (const item of Array.from(instarItems)) {
            const titleElement = item.querySelector('.dof_titulo_publicacao span');
            const downloadElement = item.querySelector('.dof_download[data-href]');
            
            if (titleElement && downloadElement) {
              const titleText = titleElement.textContent || '';
              const editionMatch = titleText.match(/Edi[çc][ãa]o\s+n[°º]?\s*(\d+)/i);
              const editionNumber = editionMatch ? editionMatch[1] : null;
              
              const dateMatch = titleText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
              const dateText = dateMatch ? `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}` : '';
              
              const pdfUrl = downloadElement.getAttribute('data-href') || downloadElement.getAttribute('href') || '';
              
              if (dateText && pdfUrl) {
                data.push({
                  editionNumber,
                  dateText,
                  pdfUrl,
                });
              }
            }
          }
        }
        
        // Last resort: try to find any PDF links and extract dates from surrounding text
        if (data.length === 0 && allPdfLinks.length > 0) {
          console.log('Trying fallback: extracting from PDF links');
          for (const link of Array.from(allPdfLinks)) {
            const pdfUrl = link.getAttribute('href') || '';
            if (!pdfUrl) continue;
            
            // Look for date in link text, parent elements, or URL
            let dateText = '';
            const linkText = link.textContent || '';
            const parentText = link.parentElement?.textContent || '';
            const fullText = `${linkText} ${parentText}`;
            
            // Try to find date in text
            const dateMatch = fullText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (dateMatch) {
              dateText = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;
            } else {
              // Try to extract from URL
              const urlDateMatch = pdfUrl.match(/(\d{2})[-\/](\d{2})[-\/](\d{4})/);
              if (urlDateMatch) {
                dateText = `${urlDateMatch[1]}/${urlDateMatch[2]}/${urlDateMatch[3]}`;
              }
            }
            
            if (dateText || pdfUrl) {
              // Extract edition number if present
              const editionMatch = fullText.match(/[Ee]di[çc][ãa]o\s+[nN]?[°º]?\s*(\d+)/i) || 
                                   pdfUrl.match(/[Ee]di[çc][ãa]o[_-]?(\d+)/i) ||
                                   pdfUrl.match(/(\d{4,5})\.pdf/i);
              const editionNumber = editionMatch ? editionMatch[1] : null;
              
              data.push({
                editionNumber,
                dateText: dateText || '',
                pdfUrl,
              });
            }
          }
        }
        
        console.log(`Total gazettes extracted: ${data.length}`);
        return data;
      });
      
      logger.debug(`Found ${gazetteData.length} gazette items on page`);
      
      for (const item of gazetteData) {
        try {
          const dateMatch = item.dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) {
            logger.warn(`Could not parse date: ${item.dateText}`);
            continue;
          }
          
          const [, day, month, year] = dateMatch;
          const gazetteDate = new Date(`${year}-${month}-${day}`);
          
          if (isNaN(gazetteDate.getTime())) {
            logger.warn(`Invalid date: ${item.dateText}`);
            continue;
          }
          
          let pdfUrl = item.pdfUrl;
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.unaiConfig.baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }
          
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

