import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituracarapicuibaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp, fromISODate } from '../../utils/date-utils';

interface EditionInfo {
  id: string;
  editionNumber: string;
  isExtra: boolean;
  extraNumber?: string;
  pdfUrl: string;
  viewUrl: string;
}

/**
 * Spider for Prefeitura de Carapicuíba - Diário Oficial
 * 
 * Site Structure:
 * - Main listing: https://diario.carapicuiba.sp.gov.br/diario-oficial/
 * - Filter by date: ?DocumentoSearch[data_inicio]=YYYY-MM-DD&DocumentoSearch[data_fim]=YYYY-MM-DD
 * - Edition page: /diario-oficial/view/{id}
 * - PDF links: /uploads/diario_oficial/{id}/{hash}.pdf
 * 
 * The site supports date range filtering via query parameters.
 */
export class PrefeituracarapicuibaSpider extends BaseSpider {
  private baseUrl: string;
  private static readonly MONTHS_PT: { [key: string]: number } = {
    'janeiro': 0, 'fevereiro': 1, 'março': 2, 'abril': 3,
    'maio': 4, 'junho': 5, 'julho': 6, 'agosto': 7,
    'setembro': 8, 'outubro': 9, 'novembro': 10, 'dezembro': 11,
  };

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const carapicuibaConfig = config.config as PrefeituracarapicuibaConfig;
    this.baseUrl = carapicuibaConfig.baseUrl || 'https://diario.carapicuiba.sp.gov.br';
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    logger.info(`Crawling Carapicuíba gazettes from ${this.baseUrl}...`);

    try {
      // Build URL with date filters
      const startDateStr = toISODate(this.startDate);
      const endDateStr = toISODate(this.endDate);
      
      const listUrl = `${this.baseUrl}/diario-oficial/index?DocumentoSearch%5Bdata_inicio%5D=${startDateStr}&DocumentoSearch%5Bdata_fim%5D=${endDateStr}&per-page=100`;
      
      logger.info(`Fetching gazette list with date filter: ${startDateStr} to ${endDateStr}`);
      
      // Fetch the filtered listing page
      const response = await fetch(listUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      });
      
      if (!response.ok) {
        logger.error(`Failed to fetch ${listUrl}: ${response.status}`);
        return gazettes;
      }

      const html = await response.text();
      
      // Extract editions from the page
      const editions = this.parseEditionList(html);
      
      if (editions.length === 0) {
        logger.info(`No gazettes found for date range ${startDateStr} to ${endDateStr}`);
        return gazettes;
      }
      
      logger.info(`Found ${editions.length} editions in the listing, fetching dates...`);
      
      // For each edition, fetch the detail page to get the publication date
      for (const edition of editions) {
        try {
          const date = await this.fetchEditionDate(edition.viewUrl);
          
          if (!date) {
            logger.warn(`Could not extract date for edition ${edition.editionNumber}, skipping`);
            continue;
          }
          
          // Create full PDF URL
          const fullPdfUrl = edition.pdfUrl.startsWith('http') 
            ? edition.pdfUrl 
            : `${this.baseUrl}${edition.pdfUrl}`;
          
          const gazette: Gazette = {
            date: toISODate(date),
            fileUrl: fullPdfUrl,
            territoryId: this.config.territoryId,
            scrapedAt: getCurrentTimestamp(),
            editionNumber: edition.editionNumber,
            isExtraEdition: edition.isExtra,
            power: 'executive',
            sourceText: `Diário Oficial de Carapicuíba - Edição nº ${edition.editionNumber}${edition.isExtra ? ` - EXTRA${edition.extraNumber ? ` ${edition.extraNumber}` : ''}` : ''}`,
          };

          gazettes.push(gazette);
          logger.info(`Found gazette: Edition ${edition.editionNumber} - ${toISODate(date)}`);
        } catch (e) {
          logger.warn(`Failed to process edition ${edition.editionNumber}: ${e}`);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`);
      return gazettes;
    } catch (error) {
      logger.error(`Error crawling Carapicuíba gazettes: ${error}`);
      return gazettes;
    }
  }

  /**
   * Parse edition list from the main listing page HTML
   */
  private parseEditionList(html: string): EditionInfo[] {
    const editions: EditionInfo[] = [];
    const seenIds = new Set<string>();
    
    // Pattern: <div class="box-publicacao" data-key="1025">
    //          <h4>Edição nº 743 - EXTRA 2 - Ano 8</h4>
    //          ...
    //          <a ... href="/diario-oficial/view/1025" ...>Publicações</a>
    //          <a ... href="/uploads/diario_oficial/1320/...pdf" ...>Original</a>
    
    // Match each box-publicacao block
    const blockPattern = /<div class="box-publicacao" data-key="(\d+)">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
    
    let blockMatch;
    while ((blockMatch = blockPattern.exec(html)) !== null) {
      const id = blockMatch[1];
      const content = blockMatch[2];
      
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      
      // Extract edition title
      const titleMatch = content.match(/<h4>Edição\s+n[º°]\s*(\d+)(?:\s*-\s*EXTRA\s*(\d*))?\s*-\s*Ano\s*\d+<\/h4>/i);
      if (!titleMatch) continue;
      
      const editionNumber = titleMatch[1];
      const isExtra = content.includes('EXTRA');
      const extraNumber = titleMatch[2] || undefined;
      
      // Extract PDF URL
      const pdfMatch = content.match(/href="([^"]*\.pdf)"/i);
      if (!pdfMatch) continue;
      
      const pdfUrl = pdfMatch[1];
      const viewUrl = `${this.baseUrl}/diario-oficial/view/${id}`;
      
      editions.push({
        id,
        editionNumber,
        isExtra,
        extraNumber,
        pdfUrl,
        viewUrl,
      });
    }
    
    // Fallback: simpler pattern matching if block pattern fails
    if (editions.length === 0) {
      logger.debug('Block pattern failed, trying simpler pattern matching');
      
      // Pattern for data-key and edition
      const simplePattern = /data-key="(\d+)"[\s\S]*?<h4>Edição\s+n[º°]\s*(\d+)(?:\s*-\s*EXTRA\s*(\d*))?\s*-\s*Ano\s*\d+<\/h4>[\s\S]*?href="([^"]*\.pdf)"/gi;
      
      let simpleMatch;
      while ((simpleMatch = simplePattern.exec(html)) !== null) {
        const [, id, editionNumber, extraNumber, pdfUrl] = simpleMatch;
        
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        
        editions.push({
          id,
          editionNumber,
          isExtra: !!extraNumber || html.includes(`data-key="${id}"`) && html.substring(html.indexOf(`data-key="${id}"`), html.indexOf(`data-key="${id}"`) + 200).includes('EXTRA'),
          extraNumber: extraNumber || undefined,
          pdfUrl,
          viewUrl: `${this.baseUrl}/diario-oficial/view/${id}`,
        });
      }
    }
    
    logger.debug(`Parsed ${editions.length} editions from listing page`);
    return editions;
  }

  /**
   * Fetch the edition detail page to extract the publication date
   */
  private async fetchEditionDate(viewUrl: string): Promise<Date | null> {
    try {
      const response = await fetch(viewUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      });
      
      if (!response.ok) {
        logger.warn(`Failed to fetch ${viewUrl}: ${response.status}`);
        return null;
      }
      
      const html = await response.text();
      
      // Pattern: "30 de dezembro de 2025"
      const datePattern = /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i;
      const match = html.match(datePattern);
      
      if (!match) {
        logger.warn(`Could not find date pattern in ${viewUrl}`);
        return null;
      }
      
      const day = parseInt(match[1], 10);
      const monthName = match[2].toLowerCase();
      const year = parseInt(match[3], 10);
      
      const month = PrefeituracarapicuibaSpider.MONTHS_PT[monthName];
      if (month === undefined) {
        logger.warn(`Unknown month: ${monthName}`);
        return null;
      }
      
      return new Date(Date.UTC(year, month, day));
    } catch (error) {
      logger.error(`Error fetching edition date from ${viewUrl}: ${error}`);
      return null;
    }
  }
}
