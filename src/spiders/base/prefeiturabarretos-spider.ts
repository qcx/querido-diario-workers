import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';
// @ts-ignore
import { parse } from 'node-html-parser';

/**
 * Configuration for Prefeitura de Barretos spider
 */
export interface PrefeituraBarretosConfig {
  type: 'prefeiturabarretos';
  /** Base URL for the Folha de Barretos (e.g., "http://barretos.sp.gov.br/folha-de-barretos") */
  baseUrl: string;
}

/**
 * Prefeitura de Barretos spider implementation
 * 
 * Site Structure:
 * - Base URL: http://barretos.sp.gov.br/folha-de-barretos
 * - Year pages: http://barretos.sp.gov.br/folha-de-barretos/{YYYY}
 * - PDF URL: https://files.barretos.sp.gov.br/pdf/newspaper/{hash}.pdf
 * 
 * HTML Structure:
 * - Container: div.column.first
 * - Edition links: <a href="https://files.barretos.sp.gov.br/pdf/newspaper/{hash}.pdf">
 *                    Edição {edition} - {DD} de {Month} de {YYYY}
 *                  </a>
 * 
 * The site shows editions grouped by year with a sidebar containing year links.
 */
export class PrefeituraBarretosSpider extends BaseSpider {
  protected barretosConfig: PrefeituraBarretosConfig;

  // Month name mapping for Portuguese
  private monthNames: Record<string, number> = {
    'janeiro': 1,
    'fevereiro': 2,
    'março': 3,
    'marco': 3,
    'abril': 4,
    'maio': 5,
    'junho': 6,
    'julho': 7,
    'agosto': 8,
    'setembro': 9,
    'outubro': 10,
    'novembro': 11,
    'dezembro': 12,
  };

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.barretosConfig = spiderConfig.config as PrefeituraBarretosConfig;
    
    if (!this.barretosConfig.baseUrl) {
      throw new Error(`PrefeituraBarretosSpider requires a baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraBarretosSpider for ${spiderConfig.name} with URL: ${this.barretosConfig.baseUrl}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.barretosConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    
    try {
      // Determine which years to fetch based on date range
      const startYear = new Date(this.dateRange.start).getFullYear();
      const endYear = new Date(this.dateRange.end).getFullYear();
      
      logger.info(`Fetching gazettes from ${startYear} to ${endYear}`);
      
      // Fetch each year page
      for (let year = endYear; year >= startYear; year--) {
        const yearGazettes = await this.crawlYear(year);
        gazettes.push(...yearGazettes);
        
        // Check if we found gazettes older than our range - stop early
        const foundOlderThanRange = yearGazettes.some(g => {
          const gazetteDate = new Date(g.date);
          return gazetteDate < new Date(this.dateRange.start);
        });
        
        if (foundOlderThanRange && year > startYear) {
          logger.debug(`Found gazettes older than date range in ${year}, continuing to ensure coverage`);
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
      throw error;
    }
    
    return gazettes;
  }

  /**
   * Crawl a specific year page
   */
  private async crawlYear(year: number): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Construct year URL
      const yearUrl = `${this.barretosConfig.baseUrl}/${year}`;
      logger.debug(`Fetching year page: ${yearUrl}`);
      
      const html = await this.fetch(yearUrl);
      const root = parse(html);
      
      // Find the main column with editions
      const mainColumn = root.querySelector('.column.first');
      
      if (!mainColumn) {
        logger.warn(`No main column found for year ${year}`);
        return gazettes;
      }
      
      // Find all edition links
      const links = mainColumn.querySelectorAll('a[href*="files.barretos.sp.gov.br"]');
      
      logger.debug(`Found ${links.length} edition links for year ${year}`);
      
      for (const link of links) {
        try {
          const gazette = await this.parseEditionLink(link);
          
          if (gazette && this.isInDateRange(new Date(gazette.date))) {
            gazettes.push(gazette);
          }
        } catch (error) {
          logger.error(`Error parsing edition link:`, error as Error);
        }
      }
      
      logger.debug(`Extracted ${gazettes.length} gazettes in date range for year ${year}`);
      
    } catch (error) {
      // If year page doesn't exist (404), log and continue
      if (error instanceof Error && error.message.includes('404')) {
        logger.debug(`Year ${year} page not found, skipping`);
      } else {
        logger.error(`Error crawling year ${year}:`, error as Error);
      }
    }
    
    return gazettes;
  }

  /**
   * Parse an edition link element
   * 
   * Expected format: "Edição 3070 - 06 de Janeiro de 2026"
   */
  private async parseEditionLink(link: any): Promise<Gazette | null> {
    try {
      const href = link.getAttribute('href');
      const text = link.text?.trim() || link.textContent?.trim() || '';
      
      if (!href || !text) {
        return null;
      }
      
      // Parse edition number: "Edição 3070 - ..."
      const editionMatch = text.match(/[Ee]di[çc][ãa]o\s+(\d+)/);
      const editionNumber = editionMatch ? editionMatch[1] : undefined;
      
      // Parse date: "... - 06 de Janeiro de 2026"
      // Format: DD de Month de YYYY
      // Note: Use [A-Za-zÀ-ÿ]+ instead of \w+ to match accented characters like "ç" in "Março"
      const dateMatch = text.match(/(\d{1,2})\s+de\s+([A-Za-zÀ-ÿ]+)\s+de\s+(\d{4})/i);
      
      if (!dateMatch) {
        logger.warn(`Could not parse date from: ${text}`);
        return null;
      }
      
      const [, dayStr, monthStr, yearStr] = dateMatch;
      const day = parseInt(dayStr, 10);
      const year = parseInt(yearStr, 10);
      const monthLower = monthStr.toLowerCase();
      const month = this.monthNames[monthLower];
      
      if (!month) {
        logger.warn(`Unknown month: ${monthStr}`);
        return null;
      }
      
      // Create date object
      const gazetteDate = new Date(year, month - 1, day);
      
      // Check if extra edition (e.g., "Edição Extra" or "- A", "- B")
      const isExtraEdition = text.toLowerCase().includes('extra') || 
                            /\s+-\s+[A-Z]$/i.test(text);
      
      // Create gazette
      return await this.createGazette(gazetteDate, href, {
        editionNumber,
        isExtraEdition,
        power: 'executive_legislative',
        sourceText: text,
      });
      
    } catch (error) {
      logger.error(`Error parsing edition link:`, error as Error);
      return null;
    }
  }
}

