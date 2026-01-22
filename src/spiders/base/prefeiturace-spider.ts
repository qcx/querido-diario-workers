import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraCEConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp } from '../../utils/date-utils';

interface GazetteEntry {
  id: string;
  edition: string;
  date: Date;
  title: string;
}

/**
 * PrefeituraCESpider implementation
 * 
 * Crawls Ceará municipality gazette websites that use the standard template.
 * Used by: Caucaia, Juazeiro do Norte, Maranguape, Iguatu, Quixadá, and other CE cities.
 * 
 * Site structure:
 * - List page: https://www.{city}.ce.gov.br/diariooficial.php
 * - Detail page: https://www.{city}.ce.gov.br/diariooficial.php?id={ID}
 * - PDF URL: https://www.{city}.ce.gov.br/arquivos_download.php?id={ID}&pg=diariooficial
 * 
 * The list page shows gazettes with pattern:
 * - <div class='list-group-item'>
 *   - <strong>Diário Oficial: {EDITION}/{YEAR}</strong>
 *   - Date: <span class="calendarioIcon">DD/MM/YYYY</span>
 *   - Link: href='diariooficial.php?id={ID}'
 */
export class PrefeituraCESpider extends BaseSpider {
  protected ceConfig: PrefeituraCEConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.ceConfig = spiderConfig.config as PrefeituraCEConfig;
    
    if (!this.ceConfig.baseUrl) {
      throw new Error(`PrefeituraCESpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraCESpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.ceConfig.baseUrl} for ${this.spiderConfig.name}...`);
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
          const baseUrl = this.ceConfig.baseUrl.replace(/\/diariooficial\.php.*$/, '');
          const pdfUrl = `${baseUrl}/arquivos_download.php?id=${entry.id}&pg=diariooficial`;
          
          const gazette: Gazette = {
            date: toISODate(entry.date),
            fileUrl: pdfUrl,
            territoryId: this.spiderConfig.territoryId,
            scrapedAt: getCurrentTimestamp(),
            editionNumber: entry.edition,
            isExtraEdition: false,
            power: 'executive_legislative',
            sourceText: entry.title || `Diário Oficial - Edição ${entry.edition}`,
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
   * Fetch all gazette entries from the list page
   */
  private async fetchAllGazetteEntries(): Promise<GazetteEntry[]> {
    const entries: GazetteEntry[] = [];
    let currentPage = 1;
    const maxPages = 100; // Safety limit
    
    try {
      while (currentPage <= maxPages) {
        const pageUrl = currentPage === 1 
          ? this.ceConfig.baseUrl
          : `${this.ceConfig.baseUrl}?pagina=${currentPage}`;
        
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
          break;
        }
        
        entries.push(...pageEntries);
        
        // Check if we've reached the end date
        const oldestEntry = pageEntries[pageEntries.length - 1];
        if (oldestEntry && toISODate(oldestEntry.date) < toISODate(this.startDate)) {
          // All remaining entries are before start date
          break;
        }
        
        // Check if there's a next page
        if (!html.includes(`pagina=${currentPage + 1}`)) {
          break;
        }
        
        currentPage++;
      }
      
      logger.debug(`Fetched ${entries.length} gazette entries from ${currentPage} page(s)`);
      
    } catch (error) {
      logger.error(`Error fetching gazette entries: ${(error as Error).message}`);
    }
    
    return entries;
  }

  /**
   * Parse gazette entries from HTML
   */
  private parseGazetteEntries(html: string): GazetteEntry[] {
    const entries: GazetteEntry[] = [];
    
    // Pattern to match gazette entries
    // Look for: diariooficial.php?id={ID} and the date DD/MM/YYYY
    const entryPattern = /diariooficial\.php\?id=(\d+)[^<]*<[^>]*>[^<]*<\/a>[^<]*<[^>]*>[^<]*<i[^>]*class=['"]fa fa-calendar['"][^>]*><\/i>\s*(\d{2})\/(\d{2})\/(\d{4})/gi;
    
    // Alternative pattern for entries with edition info
    const entryPattern2 = /href=['"]diariooficial\.php\?id=(\d+)['"][^>]*>[^<]*(?:Visualizar edição)?[^<]*<\/a>[^<]*<span[^>]*class=['"]calendarioIcon['"][^>]*>[^<]*<i[^>]*>[^<]*<\/i>\s*(\d{2})\/(\d{2})\/(\d{4})/gi;
    
    let match;
    
    // First, extract all ID -> edition mappings
    const editionMap: Map<string, string> = new Map();
    const editionMatches = html.matchAll(/href=['"]diariooficial\.php\?id=(\d+)['"][^>]*>[^]*?<strong>[^<]*Diário\s+Oficial:\s*(\d+)\/(\d{4})/gi);
    for (const m of editionMatches) {
      editionMap.set(m[1], m[2]);
    }
    
    // Try first pattern
    while ((match = entryPattern.exec(html)) !== null) {
      const [, id, day, month, year] = match;
      const date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));
      const edition = editionMap.get(id) || id;
      
      entries.push({
        id,
        edition,
        date,
        title: `Diário Oficial - Edição ${edition}`,
      });
    }
    
    // If no results, try alternative pattern
    if (entries.length === 0) {
      while ((match = entryPattern2.exec(html)) !== null) {
        const [, id, day, month, year] = match;
        const date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));
        const edition = editionMap.get(id) || id;
        
        entries.push({
          id,
          edition,
          date,
          title: `Diário Oficial - Edição ${edition}`,
        });
      }
    }
    
    // Deduplicate by ID
    const uniqueEntries = Array.from(
      new Map(entries.map(e => [e.id, e])).values()
    );
    
    return uniqueEntries;
  }
}
