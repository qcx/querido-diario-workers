import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraJuazeiroDoNorteConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp } from '../../utils/date-utils';

interface GazetteEntry {
  id: string;
  edition: string;
  year: string;
  date: Date;
  pdfPath: string;
}

/**
 * PrefeituraJuazeiroDoNorteSpider implementation
 * 
 * Crawls Juazeiro do Norte gazette website.
 * 
 * Site structure:
 * - List page: https://www.juazeirodonorte.ce.gov.br/diariolista.php
 * - Pagination: https://www.juazeirodonorte.ce.gov.br/diariolista.php?pagina=2
 * - PDF URL: https://www.juazeirodonorte.ce.gov.br/diario/{ID}/{EDITION}_{YEAR}_0000001.pdf
 * 
 * HTML structure:
 * - <a href='diario/{ID}/{EDITION}_{YEAR}_0000001.pdf' target='_blank' class='list-group-item'>
 * - <h4>DIÁRIO: {EDITION}/{YEAR}</h4>
 * - <span><i class='fa fa-calendar'></i> DD/MM/YYYY</span>
 */
export class PrefeituraJuazeiroDoNorteSpider extends BaseSpider {
  protected config: PrefeituraJuazeiroDoNorteConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeituraJuazeiroDoNorteConfig;
    
    if (!this.config.baseUrl) {
      throw new Error(`PrefeituraJuazeiroDoNorteSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraJuazeiroDoNorteSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.config.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Fetch all pages and collect gazette entries
      const allEntries = await this.fetchAllGazetteEntries();
      
      if (allEntries.length === 0) {
        logger.warn(`No gazette entries found for ${this.spiderConfig.name}`);
        return gazettes;
      }
      
      logger.info(`Found ${allEntries.length} total gazette entries, filtering by date range...`);
      
      // Filter by date range
      const startDateStr = toISODate(this.startDate);
      const endDateStr = toISODate(this.endDate);
      
      const filteredEntries = allEntries.filter(entry => {
        const entryDateStr = toISODate(entry.date);
        return entryDateStr >= startDateStr && entryDateStr <= endDateStr;
      });
      
      logger.info(`${filteredEntries.length} gazettes match the date range`, {
        startDate: startDateStr,
        endDate: endDateStr,
      });
      
      // Create gazette objects
      for (const entry of filteredEntries) {
        try {
          const baseUrl = this.config.baseUrl.replace(/\/diariolista\.php.*$/, '');
          const pdfUrl = `${baseUrl}/${entry.pdfPath}`;
          
          const gazette: Gazette = {
            date: toISODate(entry.date),
            fileUrl: pdfUrl,
            territoryId: this.spiderConfig.territoryId,
            scrapedAt: getCurrentTimestamp(),
            editionNumber: entry.edition,
            isExtraEdition: false,
            power: 'executive_legislative',
            sourceText: `Diário Oficial - Edição ${entry.edition}/${entry.year}`,
          };

          gazettes.push(gazette);
          logger.info(`Found gazette for ${toISODate(entry.date)}: ${pdfUrl}`);
        } catch (error) {
          logger.error(`Error creating gazette for ${toISODate(entry.date)}:`, error as Error);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Fetch all gazette entries from the list page with pagination
   */
  private async fetchAllGazetteEntries(): Promise<GazetteEntry[]> {
    const entries: GazetteEntry[] = [];
    let currentPage = 1;
    const maxPages = 100; // Safety limit
    
    try {
      while (currentPage <= maxPages) {
        const pageUrl = currentPage === 1 
          ? this.config.baseUrl
          : `${this.config.baseUrl}?pagina=${currentPage}`;
        
        logger.debug(`Fetching page ${currentPage}: ${pageUrl}`);
        
        const response = await fetch(pageUrl, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
          },
        });
        
        if (!response.ok) {
          logger.error(`Failed to fetch page ${currentPage}: ${response.status} ${response.statusText}`);
          break;
        }
        
        const html = await response.text();
        const pageEntries = this.parseGazetteEntries(html);
        
        if (pageEntries.length === 0) {
          // No more entries, stop pagination
          logger.debug(`No entries found on page ${currentPage}, stopping pagination`);
          break;
        }
        
        entries.push(...pageEntries);
        
        // Check if we've reached entries before the start date
        const oldestEntry = pageEntries[pageEntries.length - 1];
        if (oldestEntry && toISODate(oldestEntry.date) < toISODate(this.startDate)) {
          logger.debug(`Reached entries before start date, stopping pagination`);
          break;
        }
        
        // Check if there's a next page
        const nextPagePattern = `pagina=${currentPage + 1}`;
        if (!html.includes(nextPagePattern)) {
          logger.debug(`No next page link found, stopping pagination`);
          break;
        }
        
        currentPage++;
      }
      
      logger.info(`Fetched ${entries.length} gazette entries from ${currentPage} page(s)`);
      
    } catch (error) {
      logger.error(`Error fetching gazette entries: ${(error as Error).message}`);
    }
    
    return entries;
  }

  /**
   * Parse gazette entries from HTML
   * 
   * Pattern: <a href='diario/{ID}/{EDITION}_{YEAR}_0000001.pdf' target='_blank' class='list-group-item'>
   *          ...DIÁRIO: {EDITION}/{YEAR}...
   *          ...<i class='fa fa-calendar'></i> DD/MM/YYYY...
   */
  private parseGazetteEntries(html: string): GazetteEntry[] {
    const entries: GazetteEntry[] = [];
    
    // Pattern to match gazette entries with PDF links and dates
    // href='diario/{ID}/{EDITION}_{YEAR}_0000001.pdf' ... DIÁRIO: {EDITION}/{YEAR} ... DD/MM/YYYY
    const entryPattern = /href=['"]?(diario\/(\d+)\/(\d+)_(\d{4})_\d+\.pdf)['"]?[^>]*class=['"]?list-group-item['"]?[^>]*>[\s\S]*?DIÁRIO:\s*\d+\/\d{4}[\s\S]*?fa-calendar['"]?><\/i>\s*(\d{2})\/(\d{2})\/(\d{4})/gi;
    
    let match;
    while ((match = entryPattern.exec(html)) !== null) {
      const [, pdfPath, id, edition, year, day, month, dateYear] = match;
      const date = new Date(Date.UTC(parseInt(dateYear), parseInt(month) - 1, parseInt(day)));
      
      entries.push({
        id,
        edition,
        year,
        date,
        pdfPath,
      });
    }
    
    // If the first pattern didn't work, try a simpler pattern
    if (entries.length === 0) {
      // Alternative pattern: just look for the PDF links and dates separately
      const pdfPattern = /href=['"]?(diario\/(\d+)\/(\d+)_(\d{4})_\d+\.pdf)['"]?/gi;
      const datePattern = /fa-calendar['"]?><\/i>\s*(\d{2})\/(\d{2})\/(\d{4})/gi;
      
      const pdfMatches: Array<{ pdfPath: string; id: string; edition: string; year: string }> = [];
      const dateMatches: Array<{ day: string; month: string; year: string }> = [];
      
      let pdfMatch;
      while ((pdfMatch = pdfPattern.exec(html)) !== null) {
        pdfMatches.push({
          pdfPath: pdfMatch[1],
          id: pdfMatch[2],
          edition: pdfMatch[3],
          year: pdfMatch[4],
        });
      }
      
      let dateMatch;
      while ((dateMatch = datePattern.exec(html)) !== null) {
        dateMatches.push({
          day: dateMatch[1],
          month: dateMatch[2],
          year: dateMatch[3],
        });
      }
      
      // Match PDFs with dates (they should be in the same order)
      const minLength = Math.min(pdfMatches.length, dateMatches.length);
      for (let i = 0; i < minLength; i++) {
        const pdf = pdfMatches[i];
        const dateInfo = dateMatches[i];
        const date = new Date(Date.UTC(parseInt(dateInfo.year), parseInt(dateInfo.month) - 1, parseInt(dateInfo.day)));
        
        entries.push({
          id: pdf.id,
          edition: pdf.edition,
          year: pdf.year,
          date,
          pdfPath: pdf.pdfPath,
        });
      }
    }
    
    // Deduplicate by PDF path
    const uniqueEntries = Array.from(
      new Map(entries.map(e => [e.pdfPath, e])).values()
    );
    
    logger.debug(`Parsed ${uniqueEntries.length} unique gazette entries from page`);
    
    return uniqueEntries;
  }
}
