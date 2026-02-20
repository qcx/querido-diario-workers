import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituracaieirasConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Gazette listing response from Caieiras API
 */
interface CaieirasListItem {
  pasta: string;
  titulo: string;
  apelido: string;
  inicioPublicacao: string;
  anoPublicacao: string;
  mesPublicacao: string;
  Artigo_imagem: string;
  Artigo_arquivo: string;
}

interface CaieirasListResponse {
  success: boolean;
  elements: CaieirasListItem[];
}

/**
 * Gazette details response from Caieiras API
 */
interface CaieirasDetailResponse {
  success: boolean;
  elements: {
    pasta: string;
    titulo: string;
    contexto: string;
    inicioPublicacao: string;
  }[];
  imagem: string;
}

/**
 * Spider for Prefeitura de Caieiras official gazette
 * 
 * Uses custom API endpoints:
 * 
 * 1. List API: POST /service/listarImprensaOficial/
 *    - Body: inicio=N (pagination, 10 items per page)
 *    - Returns: { success: true, elements: [...] }
 * 
 * 2. Detail API: POST /service/capturarImprensa/
 *    - Body: apelido={apelido}_{pasta}
 *    - Returns: { success: true, elements: [...], imagem: "documento_pdf_XXX.pdf" }
 * 
 * 3. PDF URL: https://caieiras.sp.gov.br/internetfiles/front/{pasta}/{imagem}
 * 
 * Date format: DD/MM/YY (e.g., "05/01/26" = January 5, 2026)
 */
export class PrefeituracaieirasSpider extends BaseSpider {
  private baseUrl: string;
  private apiBaseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituracaieirasConfig;
    this.baseUrl = platformConfig.url || platformConfig.baseUrl || 'https://www.caieiras.sp.gov.br';
    this.apiBaseUrl = this.baseUrl.replace(/\/$/, '');
  }

  /**
   * Parse Brazilian short date (DD/MM/YY) to Date object
   */
  private parseBrazilianShortDate(dateStr: string): Date | null {
    // Match DD/MM/YY format
    const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{2})/);
    if (!match) {
      return null;
    }
    const [, day, month, yearShort] = match;
    // Convert 2-digit year to 4-digit (assume 20XX for years < 50, 19XX otherwise)
    const yearNum = parseInt(yearShort, 10);
    const year = yearNum < 50 ? 2000 + yearNum : 1900 + yearNum;
    return new Date(`${year}-${month}-${day}`);
  }

  /**
   * Fetch gazette list from API
   */
  private async fetchGazetteList(offset: number): Promise<CaieirasListResponse> {
    const response = await fetch(`${this.apiBaseUrl}/service/listarImprensaOficial/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `inicio=${offset}`,
    });
    this.requestCount++;
    
    if (!response.ok) {
      throw new Error(`Failed to fetch gazette list: ${response.status} ${response.statusText}`);
    }
    
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (error) {
      logger.error(`Failed to parse gazette list response: ${text.substring(0, 200)}`);
      throw new Error('Failed to parse gazette list response');
    }
  }

  /**
   * Fetch gazette details from API to get PDF filename
   */
  private async fetchGazetteDetail(apelido: string, pasta: string): Promise<CaieirasDetailResponse | null> {
    try {
      const response = await fetch(`${this.apiBaseUrl}/service/capturarImprensa/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `apelido=${apelido}_${pasta}`,
      });
      this.requestCount++;
      
      if (!response.ok) {
        logger.warn(`Failed to fetch gazette detail for ${apelido}_${pasta}: ${response.status}`);
        return null;
      }
      
      const text = await response.text();
      try {
        const data = JSON.parse(text);
        if (data.success) {
          return data;
        }
        return null;
      } catch (error) {
        logger.warn(`Failed to parse gazette detail response for ${apelido}_${pasta}`);
        return null;
      }
    } catch (error) {
      logger.warn(`Error fetching gazette detail for ${apelido}_${pasta}:`, error as Error);
      return null;
    }
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Caieiras for ${this.config.name}...`);

    try {
      let offset = 0;
      let hasMorePages = true;
      let foundDateBeforeRange = false;
      const maxPages = 50; // Safety limit
      const pageSize = 10;

      while (hasMorePages && !foundDateBeforeRange && offset < maxPages * pageSize) {
        logger.debug(`Fetching gazette list with offset ${offset}`);
        
        const listResponse = await this.fetchGazetteList(offset);
        
        if (!listResponse.success || !listResponse.elements || listResponse.elements.length === 0) {
          logger.debug('No more gazettes found');
          break;
        }

        for (const item of listResponse.elements) {
          try {
            // Parse publication date
            const gazetteDate = this.parseBrazilianShortDate(item.inicioPublicacao);
            
            if (!gazetteDate) {
              logger.warn(`Could not parse date from: ${item.inicioPublicacao}`);
              continue;
            }

            // Check if date is before our range (gazettes are listed newest first)
            const startDate = new Date(this.dateRange.start);
            if (gazetteDate < startDate) {
              foundDateBeforeRange = true;
              continue;
            }

            // Check if date is in range
            if (!this.isInDateRange(gazetteDate)) {
              continue;
            }

            // Get PDF URL - prefer Artigo_arquivo if available
            let pdfFilename = item.Artigo_arquivo;
            
            // If no Artigo_arquivo, fetch details to get the PDF
            if (!pdfFilename) {
              const detail = await this.fetchGazetteDetail(item.apelido, item.pasta);
              if (detail && detail.imagem) {
                pdfFilename = detail.imagem;
              }
            }

            if (!pdfFilename) {
              logger.warn(`No PDF found for gazette: ${item.titulo}`);
              continue;
            }

            // Construct PDF URL
            const pdfUrl = `https://www.caieiras.sp.gov.br/internetfiles/front/${item.pasta}/${pdfFilename}`;

            // Extract edition number from title
            const editionMatch = item.titulo.match(/[Nn][°º]?\s*(\d+)/);
            const editionNumber = editionMatch ? editionMatch[1] : undefined;

            // Check if it's an extra edition
            const isExtraEdition = item.titulo.toLowerCase().includes('extra');

            // Create gazette
            const gazette = await this.createGazette(gazetteDate, pdfUrl, {
              editionNumber,
              isExtraEdition,
              power: 'executive_legislative',
              sourceText: item.titulo,
            });

            if (gazette) {
              gazettes.push(gazette);
              logger.debug(`Found gazette: ${item.titulo} on ${item.inicioPublicacao} -> ${pdfUrl}`);
            }

          } catch (error) {
            logger.error(`Error processing gazette item ${item.titulo}:`, error as Error);
          }
        }

        // Increment offset for next page
        offset += pageSize;
        
        // If we got fewer items than page size, we've reached the end
        if (listResponse.elements.length < pageSize) {
          hasMorePages = false;
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from Caieiras`);

    } catch (error) {
      logger.error(`Error crawling Caieiras:`, error as Error);
    }

    return gazettes;
  }
}



