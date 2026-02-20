import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, ProcedeConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp } from '../../utils/date-utils';

/**
 * Response structure from the Procede API
 */
interface ProcedeDiaryEntry {
  data: string;      // Date in YYYY-MM-DD format
  hora: string;      // Time in HH:MM:SS format
  ano: string;       // Roman numeral year
  edicao: number;    // Edition number
  resumo: string;    // Summary of contents
  arquivo: string;   // PDF filename or full URL
  extra: string | null; // Extra file (part 2) if exists
  pasta: string;     // Folder name on server (e.g., "itabuna")
}

interface ProcedeApiResponse {
  diaries: ProcedeDiaryEntry[];
  lastEdition?: {
    edicao: number;
    data: string;
    hora: string;
    arquivo: string;
    extra: string | null;
    pasta: string;
    link_mensagem?: string;
    mensagem?: string;
  }[];
}

/**
 * ProcedeSpider implementation
 * 
 * Crawls gazette data from Procede Bahia system.
 * Procede is a document certification system used by municipalities in Bahia.
 * 
 * API Structure:
 * - API Endpoint: https://api.procedebahia.com.br/diaries
 * - Parameters:
 *   - cod_entity: Entity code (e.g., 88 for Itabuna)
 *   - start_date: Start date in YYYY-MM-DD format
 *   - end_date: End date in YYYY-MM-DD format
 * 
 * PDF URLs are constructed as:
 * - If arquivo contains 'https://diariooficial.procedebahia.com.br' -> use directly
 * - Otherwise: https://procede.api.br/{pasta}/publicacoes/{arquivo}
 */
export class ProcedeSpider extends BaseSpider {
  protected procedeConfig: ProcedeConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.procedeConfig = spiderConfig.config as ProcedeConfig;
    
    if (!this.procedeConfig.codEntity) {
      throw new Error(`ProcedeSpider requires codEntity in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing ProcedeSpider for ${spiderConfig.name} with entity code: ${this.procedeConfig.codEntity}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling Procede API for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      const apiUrl = this.buildApiUrl();
      logger.info(`Fetching from API: ${apiUrl}`);
      
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const data: ProcedeApiResponse = await response.json();
      
      if (!data.diaries || data.diaries.length === 0) {
        logger.warn(`No diaries found for ${this.spiderConfig.name} in the date range`);
        return gazettes;
      }

      logger.info(`Found ${data.diaries.length} diaries from API`);

      // Process each diary entry
      for (const entry of data.diaries) {
        try {
          const gazette = this.createGazetteFromEntry(entry);
          if (gazette) {
            gazettes.push(gazette);
            logger.info(`Found gazette for ${entry.data}: Edition ${entry.edicao}`);
          }

          // If there's an extra file (part 2), create another gazette entry
          if (entry.extra) {
            const extraGazette = this.createGazetteFromEntry(entry, true);
            if (extraGazette) {
              gazettes.push(extraGazette);
              logger.info(`Found gazette extra for ${entry.data}: Edition ${entry.edicao} (Part 2)`);
            }
          }
        } catch (error) {
          logger.error(`Error processing entry for ${entry.data}:`, error as Error);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Build the API URL with date range parameters
   */
  private buildApiUrl(): string {
    const baseUrl = this.procedeConfig.apiUrl || 'https://api.procedebahia.com.br/diaries';
    const startDate = toISODate(this.startDate);
    const endDate = toISODate(this.endDate);
    
    return `${baseUrl}?cod_entity=${this.procedeConfig.codEntity}&start_date=${startDate}&end_date=${endDate}`;
  }

  /**
   * Build the PDF URL from the entry
   */
  private buildPdfUrl(entry: ProcedeDiaryEntry, isExtra: boolean = false): string {
    const arquivo = isExtra && entry.extra ? entry.extra : entry.arquivo;
    
    // Check if arquivo already contains the full URL
    if (arquivo.includes('https://diariooficial.procedebahia.com.br')) {
      return arquivo;
    }
    
    // Construct URL using the standard pattern
    const baseDownloadUrl = this.procedeConfig.downloadBaseUrl || 'https://procede.api.br';
    return `${baseDownloadUrl}/${entry.pasta}/publicacoes/${encodeURIComponent(arquivo)}`;
  }

  /**
   * Create a Gazette object from a Procede diary entry
   */
  private createGazetteFromEntry(entry: ProcedeDiaryEntry, isExtra: boolean = false): Gazette | null {
    try {
      const pdfUrl = this.buildPdfUrl(entry, isExtra);
      const partSuffix = isExtra ? ' (Parte 2)' : '';
      
      const gazette: Gazette = {
        date: entry.data,
        fileUrl: pdfUrl,
        territoryId: this.spiderConfig.territoryId,
        scrapedAt: getCurrentTimestamp(),
        editionNumber: entry.edicao.toString(),
        isExtraEdition: isExtra,
        power: 'executive_legislative',
        sourceText: `Diário Oficial - Edição ${entry.edicao}${partSuffix}`,
      };

      return gazette;
    } catch (error) {
      logger.error(`Error creating gazette from entry:`, error as Error);
      return null;
    }
  }
}
