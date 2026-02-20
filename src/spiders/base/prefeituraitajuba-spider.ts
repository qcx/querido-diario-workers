import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraItajubaConfig } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for Prefeitura de Itajubá diário oficial
 * 
 * Site Structure:
 * - URL: https://www.itajuba.mg.gov.br/diario-eletronico
 * - Uses Portal Fácil platform similar to Ipatinga
 * - Requires browser rendering due to JavaScript-heavy page
 */
export class PrefeituraItajubaSpider extends BaseSpider {
  protected itajubaConfig: PrefeituraItajubaConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.itajubaConfig = spiderConfig.config as PrefeituraItajubaConfig;
    this.browser = browser || null;
    
    if (!this.itajubaConfig.baseUrl) {
      throw new Error(`PrefeituraItajubaSpider requires a baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraItajubaSpider for ${spiderConfig.name} with URL: ${this.itajubaConfig.baseUrl}`, {
      hasBrowser: !!this.browser,
    });
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.itajubaConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error('PrefeituraItajubaSpider requires browser rendering');
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
      
      logger.debug(`Navigating to: ${this.itajubaConfig.baseUrl}`);
      await page.goto(this.itajubaConfig.baseUrl, { waitUntil: 'networkidle0', timeout: 45000 });
      this.requestCount++;
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      try {
        await page.waitForSelector('#arquivos li, .list-group-item, ul.list-group, .dof_publicacao_diario', { timeout: 15000 });
      } catch (error) {
        logger.warn('Gazette list not found, page may be empty or still loading');
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
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
        
        // Try Portal Fácil format first
        const listItems = document.querySelectorAll('.list-group-item, li.list-group-item, #arquivos li');
        
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
          const allDivs = item.querySelectorAll('div, span, h4, h5');
          for (const div of allDivs) {
            const text = div.textContent || '';
            const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (dateMatch) {
              dateText = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;
              break;
            }
          }
          
          if (!dateText) {
            const months: Record<string, string> = {
              'janeiro': '01', 'fevereiro': '02', 'março': '03', 'marco': '03',
              'abril': '04', 'maio': '05', 'junho': '06', 
              'julho': '07', 'agosto': '08', 'setembro': '09',
              'outubro': '10', 'novembro': '11', 'dezembro': '12'
            };
            const dateMatchPt = editionText.match(/(\d{2})\/(\w+)\/(\d{4})/i);
            if (dateMatchPt) {
              const monthNum = months[dateMatchPt[2].toLowerCase()];
              if (monthNum) {
                dateText = `${dateMatchPt[1]}/${monthNum}/${dateMatchPt[3]}`;
              }
            }
          }
          
          let pdfUrl = '';
          const pdfLink = item.querySelector('a[href*=".pdf"], a[href*="download"], a[href*="abrir_arquivo"]');
          pdfUrl = pdfLink?.getAttribute('href') || '';
          
          if (!pdfUrl) {
            const allLinks = item.querySelectorAll('a');
            for (const link of allLinks) {
              if (link.textContent?.includes('Visualizar') || link.textContent?.includes('Download')) {
                pdfUrl = link.getAttribute('href') || '';
                break;
              }
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
            const baseUrlObj = new URL(this.itajubaConfig.baseUrl);
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

