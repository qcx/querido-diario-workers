import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, AssesiConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp } from '../../utils/date-utils';

interface GazetteEntry {
  id: string;
  edition: string;
  date: Date;
  title: string;
  slug: string; // The slug used to fetch this entry (diariooficial, leis, decretos, etc)
}

/**
 * Default slugs to search for publications
 * These are common endpoints in the ASSESI system
 */
const DEFAULT_SLUGS = [
  'diariooficial',
  'leis', 
  'decretos',
  'processoseletivo',
  'publicacoes'
];

/**
 * AssesiSpider implementation
 * 
 * Crawls ASSESI-style municipality gazette websites.
 * ASSESI is a common system used by municipalities in Ceará.
 * 
 * This spider supports multiple publication endpoints:
 * - /diariooficial.php - Diário Oficial
 * - /leis.php - Leis
 * - /decretos.php - Decretos  
 * - /processoseletivo.php - Processo Seletivo
 * - /publicacoes.php - Publicações
 * 
 * Site structure:
 * - List page: https://www.{cidade}.ce.gov.br/{slug}.php
 * - Detail page: https://www.{cidade}.ce.gov.br/{slug}.php?id={ID}
 * - PDF URL: https://www.{cidade}.ce.gov.br/arquivos_download.php?id={ID}&pg={slug}
 * 
 * HTML structure:
 * - <div class='list-group-item tm-execute'>
 *   - <strong>Título: {EDITION}/{YEAR}</strong>
 *   - <a href='{slug}.php?id={ID}'>Visualizar edição</a>
 *   - <span class="calendarioIcon"><i class='fa fa-calendar'></i> DD/MM/YYYY</span>
 */
export class AssesiSpider extends BaseSpider {
  protected assesiConfig: AssesiConfig;
  private slugsToSearch: string[];

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.assesiConfig = spiderConfig.config as AssesiConfig;
    
    if (!this.assesiConfig.baseUrl) {
      throw new Error(`AssesiSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    // Determine which slugs to search
    // If slugs are explicitly configured, use those
    // Otherwise, extract from baseUrl or use defaults
    if (this.assesiConfig.slugs && this.assesiConfig.slugs.length > 0) {
      this.slugsToSearch = this.assesiConfig.slugs;
    } else {
      // Extract the slug from the baseUrl (e.g., diariooficial from diariooficial.php)
      const urlMatch = this.assesiConfig.baseUrl.match(/\/(\w+)\.php/);
      const primarySlug = urlMatch ? urlMatch[1] : 'diariooficial';
      
      // If searchAllSlugs is enabled, use all default slugs
      // Otherwise just use the primary slug from the URL
      if (this.assesiConfig.searchAllSlugs) {
        this.slugsToSearch = DEFAULT_SLUGS;
      } else {
        this.slugsToSearch = [primarySlug];
      }
    }
    
    logger.info(`Initializing AssesiSpider for ${spiderConfig.name} with slugs: ${this.slugsToSearch.join(', ')}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.assesiConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];
    const baseUrl = this.getBaseUrl();

    try {
      // Fetch entries from all configured slugs
      const allEntries = await this.fetchAllGazetteEntriesFromAllSlugs(baseUrl);
      
      if (allEntries.length === 0) {
        logger.warn(`No gazette entries found for ${this.spiderConfig.name} in any of the slugs: ${this.slugsToSearch.join(', ')}`);
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
          const pdfUrl = `${baseUrl}/arquivos_download.php?id=${entry.id}&pg=${entry.slug}`;
          
          const gazette: Gazette = {
            date: toISODate(entry.date),
            fileUrl: pdfUrl,
            territoryId: this.spiderConfig.territoryId,
            scrapedAt: getCurrentTimestamp(),
            editionNumber: entry.edition,
            isExtraEdition: false,
            power: 'executive_legislative',
            sourceText: entry.title || `${this.getSlugTitle(entry.slug)} - Edição ${entry.edition}`,
          };

          gazettes.push(gazette);
          logger.info(`Found gazette for ${toISODate(entry.date)} [${entry.slug}]: ${pdfUrl}`);
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
   * Get the base URL without the slug
   */
  private getBaseUrl(): string {
    return this.assesiConfig.baseUrl.replace(/\/\w+\.php.*$/, '');
  }

  /**
   * Get a human-readable title for a slug
   */
  private getSlugTitle(slug: string): string {
    const titles: Record<string, string> = {
      'diariooficial': 'Diário Oficial',
      'leis': 'Lei',
      'decretos': 'Decreto',
      'processoseletivo': 'Processo Seletivo',
      'publicacoes': 'Publicação',
    };
    return titles[slug] || slug;
  }

  /**
   * Fetch gazette entries from all configured slugs
   */
  private async fetchAllGazetteEntriesFromAllSlugs(baseUrl: string): Promise<GazetteEntry[]> {
    const allEntries: GazetteEntry[] = [];
    
    for (const slug of this.slugsToSearch) {
      const slugUrl = `${baseUrl}/${slug}.php`;
      logger.debug(`Searching in ${slug}.php...`);
      
      const entries = await this.fetchGazetteEntriesFromSlug(slugUrl, slug);
      
      if (entries.length > 0) {
        logger.info(`Found ${entries.length} entries in ${slug}.php`);
        allEntries.push(...entries);
      } else {
        logger.debug(`No entries found in ${slug}.php`);
      }
    }
    
    // Deduplicate by ID (same document might appear in multiple slugs)
    const uniqueEntries = Array.from(
      new Map(allEntries.map(e => [`${e.slug}_${e.id}`, e])).values()
    );
    
    return uniqueEntries;
  }

  /**
   * Fetch gazette entries from a specific slug endpoint
   */
  private async fetchGazetteEntriesFromSlug(slugUrl: string, slug: string): Promise<GazetteEntry[]> {
    const entries: GazetteEntry[] = [];
    let currentPage = 1;
    const maxPages = 100; // Safety limit
    
    try {
      while (currentPage <= maxPages) {
        const pageUrl = currentPage === 1 
          ? slugUrl
          : `${slugUrl}?pagina=${currentPage}`;
        
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
        const pageEntries = this.parseGazetteEntries(html, slug);
        
        if (pageEntries.length === 0) {
          // No more entries, stop pagination
          logger.debug(`No entries found on page ${currentPage}, stopping pagination`);
          break;
        }
        
        entries.push(...pageEntries);
        logger.debug(`Found ${pageEntries.length} entries on page ${currentPage}`);
        
        // Check if we've reached entries before the start date
        const oldestEntry = pageEntries[pageEntries.length - 1];
        if (oldestEntry && toISODate(oldestEntry.date) < toISODate(this.startDate)) {
          logger.debug(`Reached entries before start date, stopping pagination`);
          break;
        }
        
        // Check if there's a next page
        if (!html.includes(`pagina=${currentPage + 1}`)) {
          logger.debug(`No next page link found, stopping pagination`);
          break;
        }
        
        currentPage++;
      }
      
      logger.debug(`Fetched ${entries.length} gazette entries from ${currentPage} page(s) for ${slug}`);
      
    } catch (error) {
      logger.error(`Error fetching gazette entries from ${slug}: ${(error as Error).message}`);
    }
    
    return entries;
  }

  /**
   * Parse gazette entries from HTML
   * 
   * HTML structure:
   * <div class='list-group-item tm-execute'>
   *   <span>
   *     <strong><i class='fa fa-file-text-o'></i> Título: 3364/2026 </strong> - ANO 2026 EDIÇÃO Nº 3364
   *   </span>
   *   <div class="pull-right">
   *     <a class='btn btn-primary...' href='{slug}.php?id=3550'>Visualizar edição</a>
   *     <span class="calendarioIcon"><i class='fa fa-calendar'></i> 20/01/2026</span>
   *   </div>
   * </div>
   */
  private parseGazetteEntries(html: string, slug: string): GazetteEntry[] {
    const entries: GazetteEntry[] = [];
    const slugTitle = this.getSlugTitle(slug);
    
    // Create regex pattern for this specific slug
    const slugPattern = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape special chars
    
    // First, extract all edition info for this slug
    const editionMap: Map<string, string> = new Map();
    
    // Try to extract editions from the full HTML
    // Pattern: {slug}.php?id={ID} ... some title with number
    const editionRegex = new RegExp(`${slugPattern}\\.php\\?id=(\\d+)[^>]*>.*?(\\d+)(?:\\/\\d{4})?`, 'gis');
    const editionMatches = html.matchAll(editionRegex);
    for (const m of editionMatches) {
      editionMap.set(m[1], m[2]);
    }
    
    // Try to find entries with ID and date using list-group-item blocks
    // This is a more generic pattern that works with any slug
    const blockPattern = new RegExp(
      `<div[^>]*class=['"][^'"]*list-group-item[^'"]*['"][^>]*>[\\s\\S]*?href=['"]${slugPattern}\\.php\\?id=(\\d+)['"][\\s\\S]*?(\\d{2})\\/(\\d{2})\\/(\\d{4})[\\s\\S]*?<\\/div>`,
      'gi'
    );
    
    let match;
    while ((match = blockPattern.exec(html)) !== null) {
      const [, id, day, month, year] = match;
      const date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));
      const edition = editionMap.get(id) || id;
      
      entries.push({
        id,
        edition,
        date,
        title: `${slugTitle} - Edição ${edition}`,
        slug,
      });
    }
    
    // If block pattern didn't work, try simpler patterns
    if (entries.length === 0) {
      // Try to find all IDs and dates
      const idDatePattern = new RegExp(
        `href=['"]${slugPattern}\\.php\\?id=(\\d+)['"][^>]*>[\\s\\S]*?calendarioIcon[\\s\\S]*?(\\d{2})\\/(\\d{2})\\/(\\d{4})`,
        'gi'
      );
      
      while ((match = idDatePattern.exec(html)) !== null) {
        const [, id, day, month, year] = match;
        const date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));
        const edition = editionMap.get(id) || id;
        
        entries.push({
          id,
          edition,
          date,
          title: `${slugTitle} - Edição ${edition}`,
          slug,
        });
      }
    }
    
    // If still no results, try the most basic pattern
    if (entries.length === 0) {
      // Match any {slug}.php?id= followed by a date somewhere in the same block
      const simplePattern = new RegExp(`${slugPattern}\\.php\\?id=(\\d+)`, 'gi');
      const datePattern = /(\d{2})\/(\d{2})\/(\d{4})/g;
      
      const ids: string[] = [];
      while ((match = simplePattern.exec(html)) !== null) {
        if (!ids.includes(match[1])) {
          ids.push(match[1]);
        }
      }
      
      const dates: {day: string, month: string, year: string}[] = [];
      while ((match = datePattern.exec(html)) !== null) {
        dates.push({day: match[1], month: match[2], year: match[3]});
      }
      
      // Match IDs with dates (they appear in order)
      // Skip the first date if it's in the header
      const headerDateMatch = html.match(/Número:\s*\d+\/\d+\s*\|\s*(\d{2})\/(\d{2})\/(\d{4})/);
      let dateOffset = 0;
      if (headerDateMatch) {
        dateOffset = 1; // Skip header date
      }
      
      for (let i = 0; i < ids.length && (i + dateOffset) < dates.length; i++) {
        const id = ids[i];
        const dateInfo = dates[i + dateOffset];
        const date = new Date(Date.UTC(
          parseInt(dateInfo.year), 
          parseInt(dateInfo.month) - 1, 
          parseInt(dateInfo.day)
        ));
        const edition = editionMap.get(id) || id;
        
        entries.push({
          id,
          edition,
          date,
          title: `${slugTitle} - Edição ${edition}`,
          slug,
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
