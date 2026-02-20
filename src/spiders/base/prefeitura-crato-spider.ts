import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraCratoConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp } from '../../utils/date-utils';

interface GazetteEntry {
  editionNumber: string;
  date: Date;
  pdfUrl: string;
}

/**
 * PrefeituraCratoSpider implementation
 * 
 * Crawls the Crato-CE municipality gazette website.
 * URL: https://mail.crato.ce.gov.br/diariooficial/?p=
 * 
 * Site structure:
 * - List page: https://mail.crato.ce.gov.br/diariooficial/?p={PAGE}
 * - PDF URLs: https://mail.crato.ce.gov.br/site/conteudo/2/{TIMESTAMP}_1.pdf
 * 
 * The list page shows gazettes in a table with pattern:
 * - <td>{INDEX}</td>
 * - <td><a href="...pdf">Diário Oficial nº {EDITION}</a></td>
 * - <td>...</td> (view link)
 * - <td>...</td> (download link)
 * - <td>{DD/MM/YYYY}</td>
 * 
 * Pagination uses ?p={PAGE} parameter with bootpag jQuery plugin.
 */
export class PrefeituraCratoSpider extends BaseSpider {
  protected cratoConfig: PrefeituraCratoConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.cratoConfig = spiderConfig.config as PrefeituraCratoConfig;
    
    if (!this.cratoConfig.baseUrl) {
      throw new Error(`PrefeituraCratoSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraCratoSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.cratoConfig.baseUrl} for ${this.spiderConfig.name}...`);
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
          const gazette: Gazette = {
            date: toISODate(entry.date),
            fileUrl: entry.pdfUrl,
            territoryId: this.spiderConfig.territoryId,
            scrapedAt: getCurrentTimestamp(),
            editionNumber: entry.editionNumber,
            isExtraEdition: false,
            power: 'executive_legislative',
            sourceText: `Diário Oficial nº ${entry.editionNumber}`,
          };

          gazettes.push(gazette);
          logger.info(`Found gazette for ${toISODate(entry.date)}: ${entry.pdfUrl}`);
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
   * Fetch all gazette entries from all pages
   */
  private async fetchAllGazetteEntries(): Promise<GazetteEntry[]> {
    const entries: GazetteEntry[] = [];
    let currentPage = 1;
    const maxPages = 500; // Safety limit (site has ~413 pages)
    
    try {
      while (currentPage <= maxPages) {
        const pageUrl = `${this.cratoConfig.baseUrl}${currentPage}`;
        
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
          logger.debug(`Reached entries before start date on page ${currentPage}, stopping pagination`);
          break;
        }
        
        // Check total pages from bootpag data
        const totalPagesMatch = html.match(/data-bootpag-total="(\d+)"/);
        const totalPages = totalPagesMatch ? parseInt(totalPagesMatch[1]) : maxPages;
        
        if (currentPage >= totalPages) {
          logger.debug(`Reached last page (${currentPage}/${totalPages})`);
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
   * Expected HTML structure:
   * <tr>
   *   <td>1</td>
   *   <td><a href="https://mail.crato.ce.gov.br/site/conteudo/2/1769081088_1.pdf" class="text-primary" target="_blank">Diário Oficial nº 5889</a></td>
   *   <td class="text-center"><a href="...pdf" class="text-primary" target="_blank"><i class="fa fa-folder-open"></i></a></td>
   *   <td class="text-center"><a href="...pdf" class="text-primary" download><i class="fa fa-download"></i></a></td>
   *   <td>21/01/2026</td>
   * </tr>
   */
  private parseGazetteEntries(html: string): GazetteEntry[] {
    const entries: GazetteEntry[] = [];
    
    // Pattern to match gazette rows
    // Looking for: PDF URL, edition number, and date
    const rowPattern = /<tr>\s*<td>\d+<\/td>\s*<td><a\s+href="([^"]+\.pdf)"[^>]*>Diário Oficial nº (\d+)<\/a><\/td>[\s\S]*?<td>(\d{2})\/(\d{2})\/(\d{4})<\/td>/gi;
    
    let match;
    while ((match = rowPattern.exec(html)) !== null) {
      const [, pdfUrl, editionNumber, day, month, year] = match;
      const date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));
      
      entries.push({
        editionNumber,
        date,
        pdfUrl,
      });
    }
    
    // Deduplicate by PDF URL
    const uniqueEntries = Array.from(
      new Map(entries.map(e => [e.pdfUrl, e])).values()
    );
    
    logger.debug(`Parsed ${uniqueEntries.length} gazette entries from page`);
    
    return uniqueEntries;
  }
}
