import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, InstarConfig } from '../../types';
import { logger } from '../../utils/logger';
// @ts-ignore
import { parse } from 'node-html-parser';
import { formatBrazilianDate, toISODate } from '../../utils/date-utils';

/**
 * Spider específico para Prefeitura de Guanhães - MG
 * 
 * A URL termina com /ver/ e requer navegação específica.
 * Este spider estende a funcionalidade do InstarSpider mas ajusta
 * a URL base para funcionar corretamente com o padrão /ver/
 * 
 * URL: https://www.guanhaes.mg.gov.br/portal/diario-oficial/ver/
 */
export class PrefeituraGuanhaesSpider extends BaseSpider {
  protected instarConfig: InstarConfig;
  protected resultsPerPage = 50;
  private browser: Fetcher | null = null;
  private baseUrl: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.instarConfig = spiderConfig.config as InstarConfig;
    this.browser = browser || null;
    
    // Ajusta a URL base removendo /ver/ para usar o padrão Instar
    // A URL original é: https://www.guanhaes.mg.gov.br/portal/diario-oficial/ver/
    // Ajustamos para: https://www.guanhaes.mg.gov.br/portal/diario-oficial
    const originalUrl = this.instarConfig.url || '';
    if (originalUrl.endsWith('/ver/')) {
      this.baseUrl = originalUrl.replace(/\/ver\/?$/, '');
    } else {
      this.baseUrl = originalUrl;
    }
    
    logger.info(`Initializing PrefeituraGuanhaesSpider for ${spiderConfig.name}`, {
      originalUrl,
      adjustedUrl: this.baseUrl,
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
    logger.info(`Crawling ${this.baseUrl} for ${this.spiderConfig.name}...`);
    
    // Use browser-based crawling ONLY if:
    // 1. Browser is available AND
    // 2. requiresClientRendering is explicitly set to true in config
    if (this.browser && this.instarConfig.requiresClientRendering === true) {
      return this.crawlWithBrowser();
    }
    
    // Otherwise use standard fetch-based crawling
    return this.crawlWithFetch();
  }

  /**
   * Browser-based crawling for Guanhães
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Navega para a URL original com /ver/ primeiro
      const originalUrl = this.instarConfig.url || this.baseUrl;
      logger.debug(`Navigating to: ${originalUrl}`);
      await page.goto(originalUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Aguarda a página carregar
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Verifica se há iframe ou redirecionamento
      const iframeSrc = await page.evaluate(() => {
        const iframe = document.querySelector('iframe[src*="diario"]');
        return iframe ? (iframe as HTMLIFrameElement).src : null;
      });
      
      let targetUrl = originalUrl;
      if (iframeSrc) {
        targetUrl = iframeSrc;
        logger.debug(`Found iframe src: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'networkidle0', timeout: 30000 });
        this.requestCount++;
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      // Extrai gazettes de todas as páginas
      let hasMorePages = true;
      let currentPage = 1;
      
      while (hasMorePages) {
        logger.debug(`Extracting gazettes from page ${currentPage}`);
        
        // Aguarda pelos elementos
        try {
          await page.waitForSelector('.edocman-document-title-td, table tbody tr, .dof_publicacao_diario, article', { timeout: 10000 });
        } catch (error) {
          logger.warn('Document table/list not found, may be empty');
          break;
        }
        
        // Verifica qual formato a página usa
        const hasStandardInstar = await page.$('.dof_publicacao_diario');
        const hasEdocmanSpecific = await page.$('.edocman-document-title-td');
        const hasEdocmanTable = await page.$('table tbody tr');
        
        let pageGazettes: Gazette[] = [];
        let extractionMethod = '';
        
        // Prioridade 1: Formato Instar padrão
        if (hasStandardInstar) {
          logger.debug('Using standard Instar format extraction');
          extractionMethod = 'standardInstar';
          pageGazettes = await this.extractStandardInstarGazettes(page);
        }
        
        // Prioridade 2: Formato Edocman
        if (pageGazettes.length === 0 && (hasEdocmanSpecific || hasEdocmanTable)) {
          logger.debug('Using edocman format extraction');
          extractionMethod = 'edocman';
          pageGazettes = await this.extractGazettesFromPage(page, browserInstance);
        }
        
        // Prioridade 3: Formato baseado em artigos
        if (pageGazettes.length === 0) {
          const hasArticleFormat = await page.$('article');
          if (hasArticleFormat) {
            logger.debug('Using article-based format extraction (fallback)');
            extractionMethod = 'article';
            pageGazettes = await this.extractArticleBasedGazettes(page);
          }
        }
        
        if (pageGazettes.length === 0 && !extractionMethod) {
          logger.warn('No recognized format found on page');
          break;
        }
        
        // Filtra por intervalo de datas
        for (const gazette of pageGazettes) {
          if (gazette && this.isInDateRange(new Date(gazette.date))) {
            gazettes.push(gazette);
          }
        }
        
        logger.debug(`Found ${pageGazettes.length} gazettes on page ${currentPage}, ${gazettes.length} in date range`);
        
        // Verifica se encontrou gazettes mais antigas que o intervalo - para paginação cedo
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
        
        // Verifica paginação
        const nextPageButton = await page.$('a[href*="page"], .pagination .next:not(.disabled), .pager .next:not(.disabled), button[name="Anteriores"], [class*="pagination"] button:not(:disabled)');
        if (nextPageButton && pageGazettes.length > 0) {
          logger.debug(`Clicking next page button`);
          await nextPageButton.click();
          await new Promise(resolve => setTimeout(resolve, 2000));
          currentPage++;
          
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
   * Fetch-based crawling usando o padrão Instar ajustado
   */
  private async crawlWithFetch(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      // Primeiro, tenta buscar a página base
      logger.info(`Fetching base URL: ${this.baseUrl}`);
      const basePageHtml = await this.fetch(this.baseUrl);
      const basePageRoot = parse(basePageHtml);
      
      // Verifica se é formato baseado em artigos estáticos
      const articleElements = basePageRoot.querySelectorAll('article.list-item, article');
      if (articleElements.length > 0) {
        logger.info(`Detected static article-based format with ${articleElements.length} articles`);
        return this.crawlStaticArticleFormat(basePageHtml);
      }
      
      // Verifica se tem suporte ao padrão Instar URL
      const hasInstarPattern = basePageRoot.querySelector('.sw_qtde_resultados') !== null;
      
      if (!hasInstarPattern) {
        // Tenta o padrão Instar URL de qualquer forma
        const startDate = formatBrazilianDate(new Date(this.dateRange.start));
        const endDate = formatBrazilianDate(new Date(this.dateRange.end));
        const testUrl = `${this.baseUrl}/1/${startDate}/${endDate}/0/0/`;
        
        try {
          const testPageHtml = await this.fetch(testUrl);
          const testRoot = parse(testPageHtml);
          const testResults = testRoot.querySelector('.sw_qtde_resultados');
          if (!testResults) {
            logger.warn(`Site ${this.spiderConfig.name} does not support standard Instar URL pattern, trying article format`);
            return this.crawlStaticArticleFormat(basePageHtml);
          }
        } catch (error) {
          logger.warn(`Could not access Instar URL pattern, falling back to article format`);
          return this.crawlStaticArticleFormat(basePageHtml);
        }
      }
      
      const startDate = formatBrazilianDate(new Date(this.dateRange.start));
      const endDate = formatBrazilianDate(new Date(this.dateRange.end));
      
      // Busca primeira página para obter total de resultados
      const firstPageUrl = `${this.baseUrl}/1/${startDate}/${endDate}/0/0/`;
      logger.info(`Fetching first page: ${firstPageUrl}`);
      
      const firstPageHtml = await this.fetch(firstPageUrl);
      const firstPageRoot = parse(firstPageHtml);
      
      // Obtém número total de resultados
      const resultsText = firstPageRoot.querySelector('.sw_qtde_resultados')?.text || '0';
      const totalResults = parseInt(resultsText.trim(), 10);
      logger.info(`Found ${totalResults} total results`);
      
      if (totalResults === 0) {
        logger.info(`No gazettes found for ${this.spiderConfig.name}`);
        return gazettes;
      }
      
      // Calcula total de páginas
      const totalPages = Math.ceil(totalResults / this.resultsPerPage);
      logger.info(`Total pages to fetch: ${totalPages}`);
      
      // Busca todas as páginas
      const pagePromises: Promise<string>[] = [];
      pagePromises.push(Promise.resolve(firstPageHtml));
      
      for (let page = 2; page <= totalPages; page++) {
        const pageUrl = `${this.baseUrl}/${page}/${startDate}/${endDate}/0/0/`;
        pagePromises.push(this.fetch(pageUrl));
      }
      
      const allPagesHtml = await Promise.all(pagePromises);
      
      // Processa todas as páginas e coleta gazettes
      for (const pageHtml of allPagesHtml) {
        const root = parse(pageHtml);
        const gazetteElements = root.querySelectorAll('.dof_publicacao_diario');
        
        for (const gazetteElement of gazetteElements) {
          const gazette = await this.parseGazetteElement(gazetteElement);
          if (gazette) {
            gazettes.push(gazette);
          }
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Extrai gazettes do formato Instar padrão
   */
  private async extractStandardInstarGazettes(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const baseUrlObj = new URL(this.baseUrl);
    const origin = baseUrlObj.origin;
    
    const gazetteElements = await page.$$('.dof_publicacao_diario');
    
    for (const element of gazetteElements) {
      try {
        const gazette = await element.evaluate((el: Element, origin: string) => {
          const titleElement = el.querySelector('.dof_titulo_publicacao span');
          const title = titleElement?.textContent?.trim() || '';
          
          // Extrai número da edição do título
          const editionMatch = title.match(/(?:ed[\.\s]*|edi[çc][ãa]o[\.\s]*)?(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;
          
          // Verifica se é edição extra
          const isExtra = /extra|supl|ee|esp/i.test(title);
          
          // Busca data nos spans
          const allSpans = Array.from(el.querySelectorAll('span'));
          let dateStr = '';
          
          for (const span of allSpans) {
            const text = span.textContent?.trim() || '';
            const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (dateMatch) {
              dateStr = text;
              break;
            }
          }
          
          if (!dateStr) {
            return null;
          }
          
          // Converte data DD/MM/YYYY para YYYY-MM-DD
          const [day, month, year] = dateStr.split('/');
          const date = `${year}-${month}-${day}`;
          
          // Busca link do PDF
          const downloadElement = el.querySelector('.dof_download[data-href]');
          const pdfUrl = downloadElement?.getAttribute('data-href') || 
                        downloadElement?.getAttribute('href') ||
                        el.querySelector('a[href*=".pdf"]')?.getAttribute('href') || '';
          
          if (!pdfUrl) {
            return null;
          }
          
          // Converte URL relativa para absoluta se necessário
          let fileUrl = pdfUrl;
          if (pdfUrl.startsWith('/')) {
            fileUrl = `${origin}${pdfUrl}`;
          } else if (!pdfUrl.startsWith('http')) {
            fileUrl = `${origin}/${pdfUrl}`;
          }
          
          return {
            date,
            editionNumber,
            fileUrl,
            isExtraEdition: isExtra,
          };
        }, origin);
        
        if (gazette) {
          gazettes.push({
            ...gazette,
            territoryId: this.spiderConfig.territoryId,
            power: 'executive',
            scrapedAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        logger.warn('Error extracting gazette element', { error: error instanceof Error ? error.message : String(error) });
      }
    }
    
    return gazettes;
  }

  /**
   * Extrai gazettes do formato Edocman
   */
  private async extractGazettesFromPage(page: any, browserInstance: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const baseUrlObj = new URL(this.baseUrl);
    const origin = baseUrlObj.origin;
    
    // Tenta encontrar elementos edocman
    const rows = await page.$$('.edocman-document-title-td, table tbody tr');
    
    for (const row of rows) {
      try {
        const gazette = await row.evaluate((el: Element) => {
          // Busca link do documento
          const linkElement = el.querySelector('a[href*="document"], a[href*="download"]');
          if (!linkElement) return null;
          
          const detailUrl = linkElement.getAttribute('href') || '';
          
          // Busca data
          const dateElement = el.querySelector('.dateinformation, [class*="date"]');
          const dateText = dateElement?.textContent?.trim() || '';
          const dateMatch = dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          
          if (!dateMatch) return null;
          
          const [day, month, year] = dateMatch[0].split('/');
          const date = `${year}-${month}-${day}`;
          
          // Busca título para extrair número da edição
          const titleElement = el.querySelector('a, .title, [class*="title"]');
          const title = titleElement?.textContent?.trim() || '';
          const editionMatch = title.match(/(?:ed[\.\s]*|edi[çc][ãa]o[\.\s]*)?(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;
          const isExtra = /extra|supl|ee|esp/i.test(title);
          
          return {
            date,
            editionNumber,
            detailUrl,
            isExtraEdition: isExtra,
          };
        });
        
        if (gazette && gazette.detailUrl) {
          // Navega para a página de detalhes para obter o PDF
          try {
            const detailPage = await browserInstance.newPage();
            await detailPage.goto(gazette.detailUrl, { waitUntil: 'networkidle0', timeout: 15000 });
            
            const pdfUrl = await detailPage.evaluate(() => {
              const downloadLink = document.querySelector('.edocmandownloadlink, a[href*=".pdf"], button[onclick*="download"]');
              return downloadLink?.getAttribute('href') || 
                     downloadLink?.getAttribute('onclick')?.match(/['"]([^'"]*\.pdf[^'"]*)['"]/)?.[1] ||
                     null;
            });
            
            await detailPage.close();
            
            if (pdfUrl) {
              let fileUrl = pdfUrl;
              if (pdfUrl.startsWith('/')) {
                fileUrl = `${origin}${pdfUrl}`;
              } else if (!pdfUrl.startsWith('http')) {
                fileUrl = `${origin}/${pdfUrl}`;
              }
              
              gazettes.push({
                date: gazette.date,
                editionNumber: gazette.editionNumber,
                fileUrl,
                territoryId: this.spiderConfig.territoryId,
                isExtraEdition: gazette.isExtraEdition,
                power: 'executive',
                scrapedAt: new Date().toISOString(),
              });
            }
          } catch (error) {
            logger.warn('Error fetching detail page', { error: error instanceof Error ? error.message : String(error) });
          }
        }
      } catch (error) {
        logger.warn('Error extracting edocman row', { error: error instanceof Error ? error.message : String(error) });
      }
    }
    
    return gazettes;
  }

  /**
   * Extrai gazettes do formato baseado em artigos
   */
  private async extractArticleBasedGazettes(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const baseUrlObj = new URL(this.baseUrl);
    const origin = baseUrlObj.origin;
    
    const articles = await page.$$('article');
    
    for (const article of articles) {
      try {
        const gazette = await article.evaluate((el: Element, origin: string) => {
          // Busca link do PDF
          const pdfLink = el.querySelector('a[href*=".pdf"]');
          if (!pdfLink) return null;
          
          const pdfUrl = pdfLink.getAttribute('href') || '';
          
          // Busca data no texto do artigo
          const text = el.textContent || '';
          const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) return null;
          
          const [day, month, year] = dateMatch[0].split('/');
          const date = `${year}-${month}-${day}`;
          
          // Busca título para extrair número da edição
          const titleElement = el.querySelector('h1, h2, h3, .title, [class*="title"]');
          const title = titleElement?.textContent?.trim() || text.substring(0, 100);
          const editionMatch = title.match(/(?:ed[\.\s]*|edi[çc][ãa]o[\.\s]*)?(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;
          const isExtra = /extra|supl|ee|esp/i.test(title);
          
          let fileUrl = pdfUrl;
          if (pdfUrl.startsWith('/')) {
            fileUrl = `${origin}${pdfUrl}`;
          } else if (!pdfUrl.startsWith('http')) {
            fileUrl = `${origin}/${pdfUrl}`;
          }
          
          return {
            date,
            editionNumber,
            fileUrl,
            isExtraEdition: isExtra,
          };
        }, origin);
        
        if (gazette) {
          gazettes.push({
            ...gazette,
            territoryId: this.spiderConfig.territoryId,
            power: 'executive',
            scrapedAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        logger.warn('Error extracting article', { error: error instanceof Error ? error.message : String(error) });
      }
    }
    
    return gazettes;
  }

  /**
   * Extrai gazettes do formato estático baseado em artigos (fetch)
   */
  private async crawlStaticArticleFormat(html: string): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const root = parse(html);
    
    const articles = root.querySelectorAll('article.list-item, article');
    
    for (const article of articles) {
      try {
        const pdfLink = article.querySelector('a[href*=".pdf"]');
        if (!pdfLink) continue;
        
        const pdfUrl = pdfLink.getAttribute('href') || '';
        
        // Busca data
        const text = article.textContent || '';
        const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (!dateMatch) continue;
        
        const [day, month, year] = dateMatch[0].split('/');
        const date = `${year}-${month}-${day}`;
        
        // Verifica se está no intervalo de datas
        if (!this.isInDateRange(new Date(date))) {
          continue;
        }
        
        // Busca título
        const titleElement = article.querySelector('h1, h2, h3, .title, [class*="title"]');
        const title = titleElement?.textContent?.trim() || text.substring(0, 100);
        const editionMatch = title.match(/(?:ed[\.\s]*|edi[çc][ãa]o[\.\s]*)?(\d+)/i);
        const editionNumber = editionMatch ? editionMatch[1] : undefined;
        const isExtra = /extra|supl|ee|esp/i.test(title);
        
        let fileUrl = pdfUrl;
        if (pdfUrl.startsWith('/')) {
          const baseUrlObj = new URL(this.baseUrl);
          fileUrl = `${baseUrlObj.origin}${pdfUrl}`;
        } else if (!pdfUrl.startsWith('http')) {
          const baseUrlObj = new URL(this.baseUrl);
          fileUrl = `${baseUrlObj.origin}/${pdfUrl}`;
        }
        
        gazettes.push({
          date,
          editionNumber,
          fileUrl,
          territoryId: this.spiderConfig.territoryId,
          isExtraEdition: isExtra,
          power: 'executive',
          scrapedAt: new Date().toISOString(),
        });
      } catch (error) {
        logger.warn('Error extracting static article', { error: error instanceof Error ? error.message : String(error) });
      }
    }
    
    return gazettes;
  }

  /**
   * Parse um elemento de gazette do formato Instar padrão
   */
  private async parseGazetteElement(element: any): Promise<Gazette | null> {
    try {
      const titleElement = element.querySelector('.dof_titulo_publicacao span');
      const title = titleElement?.textContent?.trim() || '';
      
      // Extrai número da edição
      const editionMatch = title.match(/(?:ed[\.\s]*|edi[çc][ãa]o[\.\s]*)?(\d+)/i);
      const editionNumber = editionMatch ? editionMatch[1] : undefined;
      const isExtra = /extra|supl|ee|esp/i.test(title);
      
      // Busca data
      const allSpans = Array.from(element.querySelectorAll('span'));
      let dateStr = '';
      
      for (const span of allSpans) {
        const text = span.textContent?.trim() || '';
        const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (dateMatch) {
          dateStr = text;
          break;
        }
      }
      
      if (!dateStr) {
        return null;
      }
      
      const [day, month, year] = dateStr.split('/');
      const date = `${year}-${month}-${day}`;
      
      // Verifica se está no intervalo de datas
      if (!this.isInDateRange(new Date(date))) {
        return null;
      }
      
      // Busca link do PDF
      const downloadElement = element.querySelector('.dof_download[data-href]');
      const pdfUrl = downloadElement?.getAttribute('data-href') || 
                    downloadElement?.getAttribute('href') ||
                    element.querySelector('a[href*=".pdf"]')?.getAttribute('href') || '';
      
      if (!pdfUrl) {
        return null;
      }
      
      // Converte URL relativa para absoluta
      let fileUrl = pdfUrl;
      if (pdfUrl.startsWith('/')) {
        const baseUrlObj = new URL(this.baseUrl);
        fileUrl = `${baseUrlObj.origin}${pdfUrl}`;
      } else if (!pdfUrl.startsWith('http')) {
        const baseUrlObj = new URL(this.baseUrl);
        fileUrl = `${baseUrlObj.origin}/${pdfUrl}`;
      }
      
      return {
        date,
        editionNumber,
        fileUrl,
        territoryId: this.spiderConfig.territoryId,
        isExtraEdition: isExtra,
        power: 'executive',
        scrapedAt: new Date().toISOString(),
      };
    } catch (error) {
      logger.warn('Error parsing gazette element', { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }
}
