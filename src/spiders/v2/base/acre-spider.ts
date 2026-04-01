import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, AcreConfig } from '../../../types';
import { logger } from '../../../utils/logger';
import { fetchWithRetry } from '../../../utils/http-client';

/*
 Spider para o Diário Oficial do Estado do Acre (DOE/AC)
 
 Este spider coleta diários oficiais do sistema centralizado do Acre que
 mencionam o município específico configurado.

 Atualmente o modo FETCH não funciona corretamente por conta do certificado SSL incompleto que
 a Cloudflare Workers impede.
 
 URL: https://www.diario.ac.gov.br/
 Características:
 - Sistema centralizado estadual
 - Todas as 22 cidades do Acre publicam no mesmo diário
 - Busca por palavra-chave (nome do município) + ano retorna diários que mencionam a cidade
 - Documentos em formato PDF
 - Suporta paginação (10 resultados por página)
 
 IMPORTANTE: O site usa POST para busca por palavra-chave.
 Parâmetros: palavra (nome da cidade), ano_palavra (ano), paginaIni (offset), palavraTipo (0=exato)
*/

export class AcreSpider extends BaseSpider {
  protected acreConfig: AcreConfig;
  private readonly BASE_URL = 'https://diario.ac.gov.br/';
  private readonly USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3729.169 Safari/537.36';
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.acreConfig = spiderConfig.config as AcreConfig;
    this.browser = browser || null;

    logger.info(`Initializing AcreSpider for ${spiderConfig.name}`);
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling DOE/AC for ${this.spiderConfig.name}...`);

    if (this.browser && this.acreConfig.requiresClientRendering) {
      return this.crawlWithBrowser();
    }

    return this.crawlWithFetch();
  }

  /**
   * HTTP-based crawling: iterates each day in the date range and
   * POSTs { data: "YYYYMMDD" } to fetch the gazette listing for that date.
   */
  private async crawlWithFetch(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();

    try {
      const days = this.getUTCDailySequence();

      for (const day of days) {
        const dayGazettes = await this.fetchGazettesByDate(day, seenUrls);
        gazettes.push(...dayGazettes);
      }

      logger.info(`Found ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      return gazettes;

    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error);
      return [];
    }
  }

  /**
   * Fetch gazettes for a single date via HTTP POST.
   */
  private async fetchGazettesByDate(date: Date, seenUrls: Set<string>): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const dateStr = this.formatDateParam(date);

    try {
      logger.debug(`Fetching DOE/AC for date ${dateStr}`);

      const html = await this.fetchDatePage(dateStr);
      const $ = this.loadHTML(html);

      const rows = $('.resultados_busca table tbody tr');

      for (let i = 0; i < rows.length; i++) {
        const row = $(rows[i]);

        const rowId = row.attr('id') || '';
        if (rowId.includes('trId2_')) continue;

        const cells = row.find('td');
        if (cells.length < 2) continue;

        const descriptionCell = cells.eq(1);
        const downloadLink = descriptionCell.find('a').attr('href');
        if (!downloadLink) continue;

        if (seenUrls.has(downloadLink)) continue;
        seenUrls.add(downloadLink);

        const description = descriptionCell.find('a').text().trim();
        const editionNumber = this.extractEditionNumber(description);
        const isExtra = /extra/i.test(description);

        const fullUrl = downloadLink.startsWith('http')
          ? downloadLink
          : `${this.BASE_URL}/${downloadLink.replace(/^\//, '')}`;

        const gazette = await this.createGazette(date, fullUrl, {
          editionNumber,
          isExtraEdition: isExtra,
          power: this.acreConfig.power || 'executive_legislative',
          sourceText: description,
          skipUrlResolution: true,
        });

        if (gazette) {
          gazettes.push(gazette);
        }
      }

      logger.debug(`Found ${gazettes.length} gazettes for date ${dateStr}`);
    } catch (error) {
      logger.error(`Error fetching DOE/AC for date ${dateStr}:`, error);
    }

    return gazettes;
  }

  /**
   * Browser-based crawling: iterates each day in the date range,
   * navigates via the buscaPorData form, and parses the result.
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();
    let browserInstance = null;
    let page = null;

    try {
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();

      const days = this.getUTCDailySequence();

      for (const day of days) {
        const dayGazettes = await this.fetchGazettesByDateWithBrowser(page, day, seenUrls);
        gazettes.push(...dayGazettes);
      }

      logger.info(`Found ${gazettes.length} gazettes for ${this.spiderConfig.name}`);

    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name} with browser:`, error);
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
      if (browserInstance) {
        await browserInstance.close().catch(() => {});
      }
    }

    return gazettes;
  }

  /**
   * Fetch gazettes for a single date via Puppeteer browser.
   * Sets the hidden "data" input and submits the buscaPorData form.
   */
  private async fetchGazettesByDateWithBrowser(browserPage: any, date: Date, seenUrls: Set<string>): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const dateStr = this.formatDateParam(date);

    try {
      logger.debug(`Fetching DOE/AC for date ${dateStr} with browser`);

      await browserPage.goto(this.BASE_URL, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;

      await browserPage.evaluate((d: string) => {
        const input = document.getElementById('data') as HTMLInputElement;
        if (input) input.value = d;
        const form = document.querySelector('form[name="buscaPorData"]') as HTMLFormElement;
        if (form) form.submit();
      }, dateStr);

      await new Promise(resolve => setTimeout(resolve, 3000));

      const html = await browserPage.content();
      const $ = this.loadHTML(html);

      const rows = $('.resultados_busca table tbody tr');

      for (let i = 0; i < rows.length; i++) {
        const row = $(rows[i]);

        const rowId = row.attr('id') || '';
        if (rowId.includes('trId2_')) continue;

        const cells = row.find('td');
        if (cells.length < 2) continue;

        const descriptionCell = cells.eq(1);
        const downloadLink = descriptionCell.find('a').attr('href');
        if (!downloadLink) continue;

        if (seenUrls.has(downloadLink)) continue;
        seenUrls.add(downloadLink);

        const description = descriptionCell.find('a').text().trim();
        const editionNumber = this.extractEditionNumber(description);
        const isExtra = /extra/i.test(description);

        const fullUrl = downloadLink.startsWith('http')
          ? downloadLink
          : `${this.BASE_URL}/${downloadLink.replace(/^\//, '')}`;

        const gazette = await this.createGazette(date, fullUrl, {
          editionNumber,
          isExtraEdition: isExtra,
          power: this.acreConfig.power || 'executive_legislative',
          sourceText: description,
          skipUrlResolution: true,
        });

        if (gazette) {
          gazettes.push(gazette);
        }
      }

      logger.debug(`Found ${gazettes.length} gazettes for date ${dateStr}`);

    } catch (error) {
      logger.error(`Error fetching DOE/AC for date ${dateStr} with browser:`, error);
    }

    return gazettes;
  }

  /**
   * POST the date-based form to the DOE/AC homepage.
   */
  private async fetchDatePage(dateStr: string): Promise<string> {
    const body = new URLSearchParams({ data: dateStr }).toString();

    logger.debug(`POST ${this.BASE_URL} with data=${dateStr}`);
    this.requestCount++;

    return fetchWithRetry(this.BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'User-Agent': this.USER_AGENT,
        'Origin': 'https://diario.ac.gov.br',
        'Referer': 'https://diario.ac.gov.br/',
      },
      body,
      timeout: 60000,
      retries: 5,
      retryDelay: 3000,
    });
  }

  /**
   * Format a Date as YYYYMMDD for the POST data parameter.
   * Uses UTC methods to stay consistent with how dates are stored.
   */
  private formatDateParam(date: Date): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  /**
   * UTC-safe daily sequence to avoid off-by-one from date-fns' local-time eachDayOfInterval.
   */
  private getUTCDailySequence(): Date[] {
    const dates: Date[] = [];
    const current = new Date(this.startDate.getTime());
    while (current <= this.endDate) {
      dates.push(new Date(current.getTime()));
      current.setUTCDate(current.getUTCDate() + 1);
    }
    return dates;
  }

  private extractEditionNumber(description: string): string | undefined {
    const match = description.match(/n[º°]?\s*(\d+)/i);
    return match ? match[1] : undefined;
  }
}
