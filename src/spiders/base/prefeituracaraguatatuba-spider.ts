import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraCaraguatatubaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp } from '../../utils/date-utils';

/**
 * Spider for Prefeitura de Caraguatatuba official gazette
 * 
 * Site structure:
 * - Page URL: https://diariooficial.caraguatatuba.sp.gov.br/public/consulta
 * - Search: https://diariooficial.caraguatatuba.sp.gov.br/public/consulta/pesquisa?dataInicial={YYYY-MM-DD}&dataFinal={YYYY-MM-DD}
 * - PDF URL: https://diariooficial.caraguatatuba.sp.gov.br/public/consulta/diario/pdf/{id}
 * 
 * HTML Structure:
 * - Date: <p class="mb-0"><b>DD/MM/YYYY</b></p>
 * - Edition: <small class="text-muted">Edição nº XXXX</small> or "Edição nº XXXX EDICAO EXTRA"
 * - PDF link: <a href=".../diario/pdf/{id}">
 */
export class PrefeituraCaraguatatubaSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraCaraguatatubaConfig;
    this.baseUrl = platformConfig.baseUrl || 'https://diariooficial.caraguatatuba.sp.gov.br';
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura Caraguatatuba for ${this.config.name}...`);

    try {
      // Build search URL with date range
      const searchUrl = `${this.baseUrl}/public/consulta/pesquisa?dataInicial=${this.dateRange.start}&dataFinal=${this.dateRange.end}`;
      
      logger.info(`Fetching: ${searchUrl}`);
      
      const response = await fetch(searchUrl, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml',
          'User-Agent': 'Mozilla/5.0 (compatible; GoodFellowBot/1.0)',
        },
        signal: AbortSignal.timeout(30000),
      });
      this.requestCount++;
      
      if (!response.ok) {
        logger.error(`Request failed with status ${response.status}`);
        return [];
      }
      
      const html = await response.text();
      
      // Parse gazettes from HTML
      const parsedGazettes = this.parseGazettesFromHtml(html);
      
      // Filter unique gazettes and create gazette objects
      const seenIds = new Set<string>();
      
      for (const parsed of parsedGazettes) {
        // Skip duplicates (same id)
        if (seenIds.has(parsed.id)) {
          continue;
        }
        seenIds.add(parsed.id);
        
        // Check if date is in range
        if (parsed.date < this.dateRange.start || parsed.date > this.dateRange.end) {
          continue;
        }
        
        const gazette = this.createGazetteDirectly(
          new Date(parsed.date),
          parsed.pdfUrl,
          {
            editionNumber: parsed.editionNumber,
            isExtraEdition: parsed.isExtraEdition,
            power: 'executive',
            sourceText: `Diário Oficial de Caraguatatuba - Edição ${parsed.editionNumber}`,
          }
        );
        
        gazettes.push(gazette);
        logger.debug(`Added gazette: Edition ${parsed.editionNumber} - ${parsed.date}`);
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from Prefeitura Caraguatatuba`);
      
    } catch (error) {
      logger.error(`Error crawling Prefeitura Caraguatatuba:`, error as Error);
      throw error;
    }

    return gazettes;
  }

  /**
   * Parse gazettes from HTML response
   */
  private parseGazettesFromHtml(html: string): Array<{
    id: string;
    date: string;
    editionNumber: string;
    isExtraEdition: boolean;
    pdfUrl: string;
  }> {
    const gazettes: Array<{
      id: string;
      date: string;
      editionNumber: string;
      isExtraEdition: boolean;
      pdfUrl: string;
    }> = [];

    try {
      // Match date pattern: <b>DD/MM/YYYY</b>
      // Match edition pattern: Edição nº XXXX or Edição nº XXXX EDICAO EXTRA
      // Match PDF link: href=.../diario/pdf/{id}
      
      // Find all gazette cards by looking for the pattern of date + edition + pdf link
      const datePattern = /<b>(\d{2})\/(\d{2})\/(\d{4})<\/b>/g;
      const editionPattern = /Edição\s+nº\s+(\d+)(?:\s+[-]?\s*(?:EDICAO\s+)?EXTRA)?/gi;
      const pdfLinkPattern = /href=["']?([^"'\s>]*diario\/pdf\/(\d+))[^>]*>/g;
      
      // Extract all dates
      const dates: Array<{index: number; day: string; month: string; year: string}> = [];
      let dateMatch;
      while ((dateMatch = datePattern.exec(html)) !== null) {
        dates.push({
          index: dateMatch.index,
          day: dateMatch[1],
          month: dateMatch[2],
          year: dateMatch[3],
        });
      }
      
      // Extract all editions with their context to check for EXTRA
      const editions: Array<{index: number; number: string; isExtra: boolean}> = [];
      let editionMatch;
      while ((editionMatch = editionPattern.exec(html)) !== null) {
        const fullMatch = editionMatch[0].toUpperCase();
        editions.push({
          index: editionMatch.index,
          number: editionMatch[1],
          isExtra: fullMatch.includes('EXTRA'),
        });
      }
      
      // Extract all PDF links
      const pdfLinks: Array<{index: number; url: string; id: string}> = [];
      let pdfMatch;
      while ((pdfMatch = pdfLinkPattern.exec(html)) !== null) {
        let url = pdfMatch[1];
        // Make URL absolute if relative
        if (!url.startsWith('http')) {
          url = `${this.baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
        }
        pdfLinks.push({
          index: pdfMatch.index,
          url: url,
          id: pdfMatch[2],
        });
      }
      
      // Match each PDF link with its closest preceding date and edition
      for (const pdf of pdfLinks) {
        // Find the closest preceding date
        let closestDate = dates.filter(d => d.index < pdf.index).pop();
        
        // Find the closest preceding edition
        let closestEdition = editions.filter(e => e.index < pdf.index).pop();
        
        if (closestDate && closestEdition) {
          const isoDate = `${closestDate.year}-${closestDate.month}-${closestDate.day}`;
          
          gazettes.push({
            id: pdf.id,
            date: isoDate,
            editionNumber: closestEdition.number,
            isExtraEdition: closestEdition.isExtra,
            pdfUrl: pdf.url,
          });
        }
      }
      
    } catch (error) {
      logger.error(`Error parsing HTML:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Create gazette directly without URL resolution
   */
  private createGazetteDirectly(
    date: Date,
    fileUrl: string,
    options: {
      editionNumber?: string;
      isExtraEdition?: boolean;
      power?: 'executive' | 'legislative' | 'executive_legislative';
      sourceText?: string;
    } = {}
  ): Gazette {
    return {
      date: toISODate(date),
      fileUrl: fileUrl,
      territoryId: this.config.territoryId,
      scrapedAt: getCurrentTimestamp(),
      editionNumber: options.editionNumber,
      isExtraEdition: options.isExtraEdition ?? false,
      power: options.power ?? 'executive',
      sourceText: options.sourceText,
    };
  }
}

