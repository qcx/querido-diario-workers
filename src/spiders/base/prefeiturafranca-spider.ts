import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeiturafrancaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { getDailySequence } from '../../utils/date-utils';
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
 */
export class PrefeiturafrancaSpider extends BaseSpider {
  private baseUrl: string;
  private apiUrl: string;
  private pdfBaseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const francaConfig = config.config as PrefeiturafrancaConfig;
    this.baseUrl = francaConfig.baseUrl || 'https://www.franca.sp.gov.br';
    this.apiUrl = `${this.baseUrl}/pmf-diario/rest/diario`;
    this.pdfBaseUrl = 'https://webpmf.franca.sp.gov.br/arquivos/diario-oficial/documentos';
  }

  /**
   * Set browser instance (for queue consumer context)
   * Note: This spider doesn't require browser automation
   */
  setBrowser(_browser: Fetcher): void {
    // Not needed - this spider uses HTTP requests
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const dates = getDailySequence(this.startDate, this.endDate);

    logger.info(`Crawling Franca gazettes for dates from ${this.startDate.toISOString()} to ${this.endDate.toISOString()}...`);

    for (const date of dates) {
      try {
        const dayGazettes = await this.fetchGazettesForDate(date);
        gazettes.push(...dayGazettes);
      } catch (error) {
        logger.error(`Error fetching gazette for ${date.toISOString()}: ${error}`);
      }

      // Small delay between requests to be respectful
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`);
    return gazettes;
  }

  private async fetchGazettesForDate(date: Date): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    // Format date as DD-MM-YYYY for the API
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const apiDate = `${day}-${month}-${year}`;
    const isoDate = `${year}-${month}-${day}`;

    logger.debug(`Fetching Franca gazette for ${apiDate}`);

    const endpoint = `${this.apiUrl}/buscaPorArquivo/${apiDate}`;
    
    try {
      const response = await fetch(endpoint, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; QDSpider/1.0)',
        },
      });

      if (!response.ok) {
        logger.warn(`Failed to fetch gazette for ${apiDate}: ${response.status}`);
        return gazettes;
      }

      const data: DiarioArquivo[] = await response.json();
      
      if (!data || data.length === 0) {
        logger.debug(`No gazettes found for ${apiDate}`);
        return gazettes;
      }

      for (const arquivo of data) {
        const pdfUrl = `${this.pdfBaseUrl}/${arquivo.nome}`;
        
        const gazette = await this.createGazette(date, pdfUrl, {
          editionNumber: arquivo.nomeExibicao,
          power: 'executive_legislative',
        });

        if (gazette) {
          gazettes.push(gazette);
        }
      }
    } catch (error) {
      logger.error(`Error fetching gazette for ${apiDate}: ${error}`);
    }

    return gazettes;
  }
}

