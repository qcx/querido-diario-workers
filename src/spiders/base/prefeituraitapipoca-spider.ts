import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp } from '../../utils/date-utils';

interface DecretoEntry {
  id: string;
  title: string;
  date: Date;
  pdfPath: string;
}

export interface PrefeituraItapipocaConfig {
  type: 'prefeituraitapipoca';
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/**
 * PrefeituraItapipocaSpider implementation
 * 
 * Crawls Itapipoca-CE municipality gazette website.
 * The site publishes decrees and other official acts separately, not as consolidated gazettes.
 * 
 * Site structure:
 * - List page: https://www.itapipoca.ce.gov.br/decretos.php
 * - Detail page: https://www.itapipoca.ce.gov.br/decretos.php?id={ID}
 * - PDF URL: https://www.itapipoca.ce.gov.br/arquivos/{ID}/{FILENAME}.pdf
 * 
 * The list page shows decrees with pattern:
 * - <a href='decretos.php?id={ID}'>
 * - Date: <span><i class='fa fa-calendar-o'></i> DD/MM/YYYY</span>
 * - Title: <strong>DECRETO: {NUMBER}/{YEAR}</strong>
 */
export class PrefeituraItapipocaSpider extends BaseSpider {
  protected itapipocaConfig: PrefeituraItapipocaConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.itapipocaConfig = spiderConfig.config as PrefeituraItapipocaConfig;
    
    if (!this.itapipocaConfig.baseUrl) {
      throw new Error(`PrefeituraItapipocaSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraItapipocaSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.itapipocaConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Fetch all pages and collect decree entries
      const allEntries = await this.fetchAllDecretoEntries();
      
      if (allEntries.length === 0) {
        logger.warn(`No decreto entries found for ${this.spiderConfig.name}`);
        return gazettes;
      }
      
      logger.info(`Found ${allEntries.length} total decreto entries, filtering by date range...`);
      
      // Filter by date range
      const startDateStr = toISODate(this.startDate);
      const endDateStr = toISODate(this.endDate);
      
      const filteredEntries = allEntries.filter(entry => {
        const entryDateStr = toISODate(entry.date);
        return entryDateStr >= startDateStr && entryDateStr <= endDateStr;
      });
      
      logger.info(`${filteredEntries.length} decretos match the date range`, {
        startDate: startDateStr,
        endDate: endDateStr,
      });
      
      // Fetch PDF URLs for each entry
      for (const entry of filteredEntries) {
        try {
          const pdfUrl = await this.fetchPdfUrl(entry.id);
          
          if (!pdfUrl) {
            logger.warn(`No PDF found for decreto ${entry.id}`);
            continue;
          }
          
          const gazette: Gazette = {
            date: toISODate(entry.date),
            fileUrl: pdfUrl,
            territoryId: this.spiderConfig.territoryId,
            scrapedAt: getCurrentTimestamp(),
            editionNumber: entry.id,
            isExtraEdition: false,
            power: 'executive',
            sourceText: entry.title,
          };

          gazettes.push(gazette);
          logger.info(`Found decreto for ${toISODate(entry.date)}: ${pdfUrl}`);
        } catch (error) {
          logger.error(`Error processing decreto ${entry.id}:`, error as Error);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} decretos for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Fetch all decreto entries from the list page
   */
  private async fetchAllDecretoEntries(): Promise<DecretoEntry[]> {
    const entries: DecretoEntry[] = [];
    let currentPage = 1;
    const maxPages = 100; // Safety limit
    
    try {
      while (currentPage <= maxPages) {
        const pageUrl = currentPage === 1 
          ? this.itapipocaConfig.baseUrl
          : `${this.itapipocaConfig.baseUrl}?pagina=${currentPage}`;
        
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
        const pageEntries = this.parseDecretoEntries(html);
        
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
      
      logger.debug(`Fetched ${entries.length} decreto entries from ${currentPage} page(s)`);
      
    } catch (error) {
      logger.error(`Error fetching decreto entries: ${(error as Error).message}`);
    }
    
    return entries;
  }

  /**
   * Parse decreto entries from HTML
   */
  private parseDecretoEntries(html: string): DecretoEntry[] {
    const entries: DecretoEntry[] = [];
    
    // Pattern to match decreto entries
    // Look for: decretos.php?id={ID} followed by date DD/MM/YYYY
    // Format: <a href='decretos.php?id=3763'> ... <i class='fa fa-calendar-o'></i>  <i>08/12/2025</i>
    const entryPattern = /href=['"]decretos\.php\?id=(\d+)['"][^>]*>[^]*?<i class=['"]fa fa-calendar-o['"][^>]*><\/i>\s*<i>(\d{2})\/(\d{2})\/(\d{4})<\/i>/gi;
    
    // Pattern to extract title
    const titlePattern = /href=['"]decretos\.php\?id=(\d+)['"][^>]*>[^]*?<strong[^>]*>([^<]+)<\/strong>/gi;
    
    // Build title map
    const titleMap: Map<string, string> = new Map();
    let titleMatch;
    while ((titleMatch = titlePattern.exec(html)) !== null) {
      const [, id, title] = titleMatch;
      titleMap.set(id, title.trim());
    }
    
    let match;
    while ((match = entryPattern.exec(html)) !== null) {
      const [, id, day, month, year] = match;
      const date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));
      const title = titleMap.get(id) || `Decreto ${id}`;
      
      entries.push({
        id,
        title,
        date,
        pdfPath: '',
      });
    }
    
    // Deduplicate by ID
    const uniqueEntries = Array.from(
      new Map(entries.map(e => [e.id, e])).values()
    );
    
    return uniqueEntries;
  }

  /**
   * Fetch the PDF URL from a decreto detail page
   */
  private async fetchPdfUrl(decretoId: string): Promise<string | null> {
    try {
      const detailUrl = `${this.itapipocaConfig.baseUrl}?id=${decretoId}`;
      
      const response = await fetch(detailUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      });
      
      if (!response.ok) {
        logger.error(`Failed to fetch decreto detail ${decretoId}: ${response.status}`);
        return null;
      }
      
      const html = await response.text();
      
      // Look for PDF link pattern: href='arquivos/{ID}/{FILENAME}.pdf'
      const pdfPattern = /href=['"]([^'"]*arquivos\/\d+\/[^'"]+\.pdf)['"][^>]*>/i;
      const match = html.match(pdfPattern);
      
      if (match && match[1]) {
        const pdfPath = match[1];
        // Build full URL
        const baseUrl = this.itapipocaConfig.baseUrl.replace(/\/[^/]+\.php.*$/, '');
        const fullUrl = pdfPath.startsWith('http') ? pdfPath : `${baseUrl}/${pdfPath}`;
        return fullUrl;
      }
      
      return null;
    } catch (error) {
      logger.error(`Error fetching PDF URL for decreto ${decretoId}:`, error as Error);
      return null;
    }
  }
}
