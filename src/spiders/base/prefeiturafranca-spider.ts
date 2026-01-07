import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeiturafrancaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { getDailySequence, toISODate, getCurrentTimestamp } from '../../utils/date-utils';
import { logger } from '../../utils/logger';

interface DiarioArquivo {
  id: number;
  nome: string;
  nomeExibicao: string;
  data: number; // timestamp in milliseconds
  tamanho: string;
  numero: number;
}

/**
 * Spider for Prefeitura de Franca - Diário Oficial
 * 
 * Site Structure:
 * - Main URL: https://www.franca.sp.gov.br/pmf-diario
 * - Uses custom AngularJS app with REST API
 * 
 * API Endpoints:
 * - GET /pmf-diario/rest/diario/init - Returns list of all available dates (format: M-D-YYYY)
 * - GET /pmf-diario/rest/diario/buscaPorArquivo/DD-MM-YYYY - Returns files for specific date
 * 
 * PDF URL pattern:
 * - https://webpmf.franca.sp.gov.br/arquivos/diario-oficial/documentos/{filename}
 * - Example: 2918-23122025.pdf
 * 
 * NOTE: This spider requires Puppeteer because the www.franca.sp.gov.br server
 * has TLS/connectivity issues with Cloudflare Workers direct fetch.
 */
export class PrefeiturafrancaSpider extends BaseSpider {
  private baseUrl: string;
  private apiUrl: string;
  private pdfBaseUrl: string;
  private browser?: Fetcher;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const francaConfig = config.config as PrefeiturafrancaConfig;
    // baseUrl from config may include /pmf-diario/, so we normalize to base domain
    const configUrl = francaConfig.baseUrl || 'https://www.franca.sp.gov.br/pmf-diario/';
    // Extract base domain (without /pmf-diario path)
    const urlObj = new URL(configUrl);
    this.baseUrl = `${urlObj.protocol}//${urlObj.host}`;
    this.apiUrl = `${this.baseUrl}/pmf-diario/rest/diario`;
    this.pdfBaseUrl = 'https://webpmf.franca.sp.gov.br/arquivos/diario-oficial/documentos';
  }

  /**
   * Set browser instance (for queue consumer context)
   * Required for this spider to work due to TLS issues with direct fetch
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error('PrefeiturafrancaSpider requires browser binding');
      return [];
    }

    const gazettes: Gazette[] = [];
    const dates = getDailySequence(this.startDate, this.endDate);

    logger.info(`Crawling Franca gazettes for dates from ${this.startDate.toISOString()} to ${this.endDate.toISOString()}...`);

    let browserInstance = null;
    let page = null;

    try {
      // Launch browser once for all requests
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();

      // Navigate to main page first to establish session
      const mainPageUrl = `${this.baseUrl}/pmf-diario/`;
      logger.debug(`Navigating to main page: ${mainPageUrl}`);
      await page.goto(mainPageUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;

      // Wait for page to load
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Fetch gazettes for each date
      for (const date of dates) {
        try {
          const dayGazettes = await this.fetchGazettesForDate(page, date);
          gazettes.push(...dayGazettes);
        } catch (error) {
          logger.error(`Error fetching gazette for ${date.toISOString()}: ${error}`);
        }

        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`);

    } catch (error) {
      logger.error(`Error in Franca spider: ${error}`);
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (e) {
          logger.warn(`Error closing page: ${(e as Error).message}`);
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (e) {
          logger.warn(`Error closing browser: ${(e as Error).message}`);
        }
      }
    }

    return gazettes;
  }

  /**
   * Fetch gazettes for a specific date using the browser's JavaScript context
   */
  private async fetchGazettesForDate(page: any, date: Date): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    // Format date as DD-MM-YYYY for the API
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const apiDate = `${day}-${month}-${year}`;

    logger.debug(`Fetching Franca gazette for ${apiDate}`);

    const endpoint = `${this.apiUrl}/buscaPorArquivo/${apiDate}`;

    try {
      // Use page.evaluate to make the fetch request from within the browser context
      // This bypasses TLS issues since the request comes from the browser
      const data = await page.evaluate(async (url: string) => {
        try {
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
            },
          });
          
          if (!response.ok) {
            return { error: `Status ${response.status}`, data: null };
          }
          
          const text = await response.text();
          if (!text || text.trim() === '' || text.trim() === '[]') {
            return { error: null, data: [] };
          }
          
          return { error: null, data: JSON.parse(text) };
        } catch (e) {
          return { error: String(e), data: null };
        }
      }, endpoint);

      this.requestCount++;

      if (data.error) {
        logger.warn(`API request failed for ${apiDate}: ${data.error}`);
        return gazettes;
      }

      if (!data.data || data.data.length === 0) {
        logger.debug(`No gazettes found for ${apiDate}`);
        return gazettes;
      }

      for (const arquivo of data.data as DiarioArquivo[]) {
        const pdfUrl = `${this.pdfBaseUrl}/${arquivo.nome}`;
        
        // Create gazette directly without URL resolution
        // The webpmf.franca.sp.gov.br domain has connectivity issues with CF Workers
        // but the URLs are direct and valid - they just need to be accessed by the OCR processor
        const gazette: Gazette = {
          date: toISODate(date),
          fileUrl: pdfUrl,
          territoryId: this.config.territoryId,
          scrapedAt: getCurrentTimestamp(),
          editionNumber: arquivo.nomeExibicao,
          isExtraEdition: false,
          power: 'executive_legislative',
          // Mark as requiring client rendering so OCR will use browser to fetch the PDF
          requiresClientRendering: true,
        };

        gazettes.push(gazette);
        logger.debug(`Found gazette: ${pdfUrl} (edition ${arquivo.nomeExibicao})`);
      }
    } catch (error) {
      logger.error(`Error fetching gazette for ${apiDate}: ${error}`);
    }

    return gazettes;
  }
}
