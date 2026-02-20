import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraAtibaiaConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp } from '../../utils/date-utils';
// @ts-ignore
import { parse } from 'node-html-parser';

/**
 * Prefeitura de Atibaia Spider
 * 
 * Site Structure (MaterializeCSS-based):
 * - Page URL: https://www.prefeituradeatibaia.com.br/imprensa/numero.php?ano=YYYY
 * - Editions are listed in blockquote elements with PDF links
 * - PDF URL pattern: pdf/YYYY/NNNN_hash.pdf (relative to base)
 * - Link text: "Edição <b>NNNN</b> de [dia da semana], DD de Mês de YYYY"
 * - Extra editions have B, C, D suffix (e.g., 2910B, 2910C)
 * 
 * Month names in Portuguese:
 * Janeiro, Fevereiro, Março, Abril, Maio, Junho,
 * Julho, Agosto, Setembro, Outubro, Novembro, Dezembro
 */
export class PrefeituraAtibaiaSpider extends BaseSpider {
  protected platformConfig: PrefeituraAtibaiaConfig;
  
  private monthMap: Record<string, number> = {
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

  /**
   * Decode common HTML entities
   */
  private decodeHtmlEntities(text: string): string {
    return text
      .replace(/&aacute;/g, 'á')
      .replace(/&eacute;/g, 'é')
      .replace(/&iacute;/g, 'í')
      .replace(/&oacute;/g, 'ó')
      .replace(/&uacute;/g, 'ú')
      .replace(/&atilde;/g, 'ã')
      .replace(/&otilde;/g, 'õ')
      .replace(/&ccedil;/g, 'ç')
      .replace(/&Ccedil;/g, 'Ç')
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
  }

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.platformConfig = spiderConfig.config as PrefeituraAtibaiaConfig;
    
    if (!this.platformConfig.baseUrl) {
      throw new Error(`PrefeituraAtibaiaSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraAtibaiaSpider for ${spiderConfig.name}`, {
      baseUrl: this.platformConfig.baseUrl,
    });
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.platformConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    
    try {
      // Get the years we need to crawl based on date range
      const startYear = new Date(this.dateRange.start).getFullYear();
      const endYear = new Date(this.dateRange.end).getFullYear();
      
      logger.debug(`Will crawl years from ${startYear} to ${endYear}`);
      
      // Crawl each year
      for (let year = endYear; year >= startYear; year--) {
        const yearGazettes = await this.crawlYear(year);
        
        // Filter by date range and add to results
        for (const gazette of yearGazettes) {
          // Parse the gazette date string to get a proper Date object
          const [y, m, d] = gazette.date.split('-').map(n => parseInt(n, 10));
          const gazetteDate = new Date(Date.UTC(y, m - 1, d));
          const inRange = this.isInDateRange(gazetteDate);
          if (inRange) {
            gazettes.push(gazette);
          }
        }
        
        logger.debug(`Found ${yearGazettes.length} gazettes for year ${year}, ${gazettes.length} in date range so far`);
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }
    
    return gazettes;
  }

  /**
   * Crawl all editions for a specific year
   */
  private async crawlYear(year: number): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    // Build URL for the year page
    const yearUrl = `${this.platformConfig.baseUrl}numero.php?ano=${year}`;
    
    logger.debug(`Fetching year ${year}: ${yearUrl}`);
    
    try {
      const html = await this.fetch(yearUrl);
      const root = parse(html);
      
      // Find all blockquote elements containing gazette links
      const blockquotes = root.querySelectorAll('blockquote');
      
      logger.debug(`Found ${blockquotes.length} blockquote elements for year ${year}`);
      
      for (const blockquote of blockquotes) {
        const link = blockquote.querySelector('a');
        if (!link) continue;
        
        const href = link.getAttribute('href');
        const linkText = link.text || link.textContent || '';
        
        if (!href || !href.includes('pdf')) continue;
        
        try {
          const gazette = this.parseGazetteLink(href, linkText, year);
          if (gazette) {
            gazettes.push(gazette);
          }
        } catch (parseError) {
          logger.warn(`Failed to parse gazette link: ${linkText}`, { error: (parseError as Error).message });
        }
      }
      
    } catch (error) {
      logger.error(`Error fetching year ${year}:`, error as Error);
    }
    
    return gazettes;
  }

  /**
   * Parse a gazette link and extract metadata
   * 
   * Example link text: "Edição 2912 de quarta-feira, 31 de Dezembro de 2025"
   * Example href: "pdf/2025/2912_11485344476702471f74bd0cef1442d2.pdf"
   */
  private parseGazetteLink(href: string, rawLinkText: string, year: number): Gazette | null {
    // Decode HTML entities first
    const linkText = this.decodeHtmlEntities(rawLinkText);
    // Build full PDF URL
    let pdfUrl = href;
    if (!pdfUrl.startsWith('http')) {
      // Remove leading slash if present
      if (pdfUrl.startsWith('/')) {
        pdfUrl = pdfUrl.substring(1);
      }
      pdfUrl = `${this.platformConfig.baseUrl}${pdfUrl}`;
    }
    
    // Extract edition number from link text
    // Pattern: "Edição <b>NNNN</b>" or "Edição NNNN"
    const editionMatch = linkText.match(/Edição\s*(?:<b>)?(\d+[A-Z]?)(?:<\/b>)?/i);
    const editionNumber = editionMatch ? editionMatch[1] : undefined;
    
    // Check if it's an extra edition (has letter suffix like B, C, D)
    const isExtraEdition = editionNumber ? /[A-Z]$/i.test(editionNumber) : false;
    
    // Extract date from link text
    // Pattern: "DD de Mês de YYYY"
    // Using character class to capture accented Portuguese month names (like Março, Março)
    const dateMatch = linkText.match(/(\d{1,2})\s+de\s+([A-Za-záàâãéèêíìîóòôõúùûçÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ]+)\s+de\s+(\d{4})/i);
    
    if (!dateMatch) {
      logger.warn(`Could not parse date from: ${linkText}`);
      return null;
    }
    
    const day = parseInt(dateMatch[1], 10);
    const monthName = dateMatch[2].toLowerCase();
    const yearFromText = parseInt(dateMatch[3], 10);
    
    const month = this.monthMap[monthName];
    if (!month) {
      logger.warn(`Unknown month name: ${monthName}`);
      return null;
    }
    
    // Create UTC date to avoid timezone issues
    const gazetteDate = new Date(Date.UTC(yearFromText, month - 1, day));
    
    // Validate date
    if (isNaN(gazetteDate.getTime())) {
      logger.warn(`Invalid date: ${day}/${month}/${yearFromText}`);
      return null;
    }
    
    // Create gazette directly without URL resolution (PDFs are direct links)
    return {
      date: toISODate(gazetteDate),
      fileUrl: pdfUrl,
      territoryId: this.spiderConfig.territoryId,
      scrapedAt: getCurrentTimestamp(),
      editionNumber: editionNumber?.replace(/[A-Z]$/i, ''), // Remove letter suffix for edition number
      isExtraEdition,
      power: 'executive_legislative',
      sourceText: linkText,
    };
  }
}

