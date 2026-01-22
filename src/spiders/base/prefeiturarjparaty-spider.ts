import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraRjParatyConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp } from '../../utils/date-utils';

/**
 * API response structure for Paraty's gazette documents
 */
interface ParatyDocumentoResponse {
  Titulo: string;
  DocumentoCategoria: {
    Id: number;
    Descricao: string | null;
  };
  DocumentoArquivoAtual: {
    Arquivo: string;
    CaminhoLogicoArquivo: string;
    ArquivoNome: string;
    Tamanho: string;
    Formato: string;
  };
  DataPublicacao: string; // DD/MM/YYYY format
  Texto: string | null;
  Tag: Array<{
    Descricao: string;
    Slug: string;
  }>;
}

/**
 * PrefeituraRjParatySpider implementation
 * 
 * Crawls Paraty's official gazette website using their JSON API.
 * 
 * API endpoints:
 * - List documents: https://www.paraty.rj.gov.br/API/API/Documentos?CategoriaId=6&PageNumber=1&PageSize=50
 * - Calendar: https://www.paraty.rj.gov.br/API/API/Documentos/Calendario?Ano=2026&CategoriaId=6&Mes=1
 * 
 * The API returns JSON with gazette information including:
 * - Titulo: Edition title (e.g., "Edição N°. 1945/2026")
 * - DataPublicacao: Publication date in DD/MM/YYYY format
 * - DocumentoArquivoAtual.CaminhoLogicoArquivo: Direct PDF URL
 * 
 * This spider:
 * 1. Fetches gazette list from the API with pagination
 * 2. Parses dates and filters by date range
 * 3. Returns gazette objects with direct PDF URLs
 */
export class PrefeituraRjParatySpider extends BaseSpider {
  protected paratyConfig: PrefeituraRjParatyConfig;
  private static readonly API_BASE = 'https://www.paraty.rj.gov.br/API/API';
  private static readonly CATEGORIA_DIARIO_OFICIAL = 6;
  private static readonly PAGE_SIZE = 50;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.paratyConfig = spiderConfig.config as PrefeituraRjParatyConfig;
    
    if (!this.paratyConfig.baseUrl) {
      throw new Error(`PrefeituraRjParatySpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraRjParatySpider for ${spiderConfig.name}`);
  }

  /**
   * Set browser instance (not needed for this spider, but required by interface)
   */
  setBrowser(browser: Fetcher): void {
    // This spider uses HTTP API, no browser needed
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling Paraty gazette API for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Fetch all gazettes from the API with pagination
      const allDocuments = await this.fetchAllDocuments();
      
      if (allDocuments.length === 0) {
        logger.warn(`No gazette documents found from API for ${this.spiderConfig.name}`);
        return gazettes;
      }
      
      logger.info(`Found ${allDocuments.length} total gazette documents, filtering by date range...`);
      
      // Convert date range to comparable format
      const startDateStr = toISODate(this.startDate);
      const endDateStr = toISODate(this.endDate);
      
      // Process each document
      for (const doc of allDocuments) {
        try {
          // Parse date from DD/MM/YYYY format
          const gazetteDate = this.parseBrazilianDate(doc.DataPublicacao);
          
          if (!gazetteDate) {
            logger.warn(`Invalid date format: ${doc.DataPublicacao}`);
            continue;
          }
          
          const gazetteDateStr = toISODate(gazetteDate);
          
          // Filter by date range
          if (gazetteDateStr < startDateStr || gazetteDateStr > endDateStr) {
            continue;
          }
          
          // Extract edition number from title (e.g., "Edição N°. 1945/2026" -> "1945")
          const editionMatch = doc.Titulo.match(/[Ee]di[çc][ãa]o\s*[Nn]?[ºo°.]*\s*(\d+)/);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;
          
          // Check if it's an extra edition
          const isExtraEdition = /\b(extra|suplemento|extraordin[aá]ri[oa])\b/i.test(doc.Titulo);
          
          // Get PDF URL
          const pdfUrl = doc.DocumentoArquivoAtual?.CaminhoLogicoArquivo;
          
          if (!pdfUrl) {
            logger.warn(`No PDF URL found for document: ${doc.Titulo}`);
            continue;
          }
          
          // Create gazette object
          const gazette: Gazette = {
            date: gazetteDateStr,
            fileUrl: pdfUrl,
            territoryId: this.spiderConfig.territoryId,
            scrapedAt: getCurrentTimestamp(),
            editionNumber,
            isExtraEdition,
            power: 'executive_legislative',
            sourceText: `Diário Oficial de Paraty - ${doc.Titulo} - ${doc.DataPublicacao}`,
          };
          
          gazettes.push(gazette);
          logger.info(`Found gazette for ${gazetteDateStr}: ${pdfUrl}`);
        } catch (error) {
          logger.error(`Error processing document ${doc.Titulo}:`, error as Error);
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Fetch all documents from the API with pagination
   */
  private async fetchAllDocuments(): Promise<ParatyDocumentoResponse[]> {
    const allDocuments: ParatyDocumentoResponse[] = [];
    let pageNumber = 1;
    let hasMore = true;
    const maxPages = 20; // Safety limit
    
    while (hasMore && pageNumber <= maxPages) {
      try {
        const url = new URL(`${PrefeituraRjParatySpider.API_BASE}/Documentos`);
        url.searchParams.set('CategoriaId', PrefeituraRjParatySpider.CATEGORIA_DIARIO_OFICIAL.toString());
        url.searchParams.set('PageNumber', pageNumber.toString());
        url.searchParams.set('PageSize', PrefeituraRjParatySpider.PAGE_SIZE.toString());
        url.searchParams.set('Palavra', '');
        url.searchParams.set('Tag', '');
        url.searchParams.set('Edicao', '');
        url.searchParams.set('Todos', '');
        
        logger.debug(`Fetching page ${pageNumber}: ${url.toString()}`);
        
        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
          },
        });
        
        this.requestCount++;
        
        if (!response.ok) {
          logger.error(`API request failed: ${response.status} ${response.statusText}`);
          break;
        }
        
        const documents: ParatyDocumentoResponse[] = await response.json();
        
        if (!documents || documents.length === 0) {
          hasMore = false;
          break;
        }
        
        allDocuments.push(...documents);
        logger.debug(`Fetched ${documents.length} documents from page ${pageNumber}`);
        
        // Check if we've reached the end
        if (documents.length < PrefeituraRjParatySpider.PAGE_SIZE) {
          hasMore = false;
        }
        
        // Check if we've gone past our date range (optimization)
        const lastDoc = documents[documents.length - 1];
        const lastDate = this.parseBrazilianDate(lastDoc.DataPublicacao);
        if (lastDate && lastDate < this.startDate) {
          logger.debug(`Reached documents before start date, stopping pagination`);
          hasMore = false;
        }
        
        pageNumber++;
        
      } catch (error) {
        logger.error(`Error fetching page ${pageNumber}:`, error as Error);
        break;
      }
    }
    
    return allDocuments;
  }

  /**
   * Parse a date string in Brazilian DD/MM/YYYY format
   */
  private parseBrazilianDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    
    const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!match) return null;
    
    const [, day, month, year] = match;
    // Create date in UTC to avoid timezone issues
    return new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));
  }
}
