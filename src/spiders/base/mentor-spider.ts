import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, MentorConfig } from '../../types';
import { logger } from '../../utils/logger';

/**
 * MentorSpider implementation for Mentor/Metaway platform
 * 
 * The Mentor platform (by Metaway) is used by several Brazilian municipalities 
 * to publish their official gazettes with a REST API.
 * 
 * API Structure:
 * - Base URL pattern: https://{city}.mentor.metaway.com.br
 * - List endpoint: /recurso/diario/lista?dataInicial={start}&dataFinal={end}
 * - Detail endpoint: /recurso/diario/editar/{codigo} (returns PDF as base64 in arquivoPdf field)
 * - Frontend URL: /diario/#/diarios (Angular SPA)
 * 
 * API Response Format (list):
 * [
 *   {
 *     "codigo": 1791,
 *     "edicao": 2,
 *     "ano": 8,
 *     "dataPublicacao": "2026-01-06",
 *     "tipo": "R",
 *     "arquivoPdf": null,
 *     "assinado": true,
 *     "hash": "medHa6Q7fer0hrB",
 *     "paginas": null
 *   }
 * ]
 * 
 * API Response Format (detail):
 * {
 *   "codigo": 1791,
 *   "edicao": 2,
 *   "ano": 8,
 *   "dataPublicacao": "2026-01-06",
 *   "tipo": "R",
 *   "arquivoPdf": "<base64 encoded PDF>",
 *   ...
 * }
 */
export class MentorSpider extends BaseSpider {
  protected mentorConfig: MentorConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.mentorConfig = spiderConfig.config as MentorConfig;
    this.browser = browser || null;
    
    if (!this.mentorConfig.baseUrl) {
      throw new Error(`MentorSpider requires a baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing MentorSpider for ${spiderConfig.name} with baseUrl: ${this.mentorConfig.baseUrl}`, {
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
    logger.info(`Crawling Mentor platform for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    
    try {
      // Build date range parameters
      const startDateStr = `${this.dateRange.start}T00:00:00`;
      const endDateStr = `${this.dateRange.end}T23:59:59`;
      
      // Build API URL
      const apiUrl = `${this.mentorConfig.baseUrl}/recurso/diario/lista?dataInicial=${encodeURIComponent(startDateStr)}&dataFinal=${encodeURIComponent(endDateStr)}`;
      
      logger.debug(`Fetching gazette list from: ${apiUrl}`);
      
      const response = await fetch(apiUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });
      this.requestCount++;
      
      if (!response.ok) {
        logger.error(`Failed to fetch gazette list: ${response.status} ${response.statusText}`);
        return gazettes;
      }
      
      const diarioList = await response.json() as MentorDiarioListItem[];
      
      logger.info(`Found ${diarioList.length} gazettes from Mentor API`);
      
      // Process each gazette
      for (const diario of diarioList) {
        try {
          const gazette = await this.processDiario(diario);
          if (gazette) {
            // Filter by date range
            if (gazette.date >= this.dateRange.start && gazette.date <= this.dateRange.end) {
              gazettes.push(gazette);
            }
          }
        } catch (error) {
          logger.error(`Failed to process diario ${diario.codigo}:`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      
      logger.info(`Successfully processed ${gazettes.length} gazettes from Mentor platform`);
      
    } catch (error) {
      logger.error(`MentorSpider crawl failed:`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    
    return gazettes;
  }

  /**
   * Process a single diario item to get the PDF URL
   */
  private async processDiario(diario: MentorDiarioListItem): Promise<Gazette | null> {
    // Build the view URL (frontend URL for reference)
    const viewUrl = `${this.mentorConfig.baseUrl}/diario/#/diario/${diario.codigo}`;
    
    // Build edition string
    const editionParts: string[] = [];
    if (diario.edicao) {
      editionParts.push(`Ed. ${diario.edicao}`);
    }
    if (diario.ano) {
      editionParts.push(`Ano ${diario.ano}`);
    }
    
    // Map tipo to edition type
    const tipoMap: Record<string, string> = {
      'R': 'Regular',
      'E': 'Extraordinário',
      'S': 'Suplementar',
    };
    
    const tipoLabel = tipoMap[diario.tipo] || diario.tipo;
    if (tipoLabel) {
      editionParts.push(tipoLabel);
    }
    
    const editionNumber = editionParts.join(' / ') || `Código ${diario.codigo}`;
    
    // Use the editar endpoint which returns the PDF as base64
    // The downstream PDF fetcher will need to handle this special URL format
    const pdfUrl = `${this.mentorConfig.baseUrl}/recurso/diario/editar/${diario.codigo}`;
    
    // Parse the date to create the gazette using the base class method
    const gazetteDate = new Date(diario.dataPublicacao);
    
    // Use the base class createGazette method (but without URL resolution since this is an API endpoint)
    const gazette: Gazette = {
      date: diario.dataPublicacao,
      fileUrl: pdfUrl,
      territoryId: this.spiderConfig.territoryId,
      scrapedAt: new Date().toISOString(),
      editionNumber: editionNumber,
      isExtraEdition: diario.tipo === 'E',
      power: 'executive',
      sourceText: viewUrl,
    };
    
    logger.debug(`Processed gazette: ${gazette.editionNumber} (${gazette.date})`);
    
    return gazette;
  }
}

/**
 * Interface for Mentor API list response items
 */
interface MentorDiarioListItem {
  codigo: number;
  edicao: number;
  ano: number;
  dataPublicacao: string;
  tipo: string; // 'R' = Regular, 'E' = Extraordinário, 'S' = Suplementar
  arquivoPdf: string | null;
  assinado: boolean;
  hash: string;
  paginas: number | null;
}

