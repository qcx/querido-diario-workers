import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeiturapirassunungaConfig } from '../../types';
import { logger } from '../../utils/logger';
// @ts-ignore
import { parse } from 'node-html-parser';

/**
 * Spider for Prefeitura de Pirassununga
 * 
 * Site Structure:
 * - Main page: https://pirassununga.sp.gov.br/servicos/governamental/diario-oficial
 *   Lists years as articles with links like /diario-oficial/2024-29
 * 
 * - Year pages: https://pirassununga.sp.gov.br/servicos/governamental/diario-oficial/2024-29
 *   Table with gazette PDF links hosted on ecrie.com.br
 * 
 * - PDF name format: "YYYY-MM-DD - Diário Eletrônico nº XXX - DD de Mês de YYYY.pdf"
 *   The date can be extracted from the filename prefix (YYYY-MM-DD)
 * 
 * Example PDF URL:
 * https://ecrie.com.br/sistema/conteudos/arquivo/a_200_8_1_10072024171501.pdf
 */
export class PrefeiturapirasSunungaSpider extends BaseSpider {
  private platformConfig: PrefeiturapirassunungaConfig;
  private baseUrl: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.platformConfig = spiderConfig.config as PrefeiturapirassunungaConfig;
    this.baseUrl = this.platformConfig.url || this.platformConfig.baseUrl || '';
    
    if (!this.baseUrl) {
      throw new Error(`PrefeiturapirasSunungaSpider requires a url in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeiturapirasSunungaSpider for ${spiderConfig.name} with URL: ${this.baseUrl}`);
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      logger.info(`Crawling Pirassununga gazettes from ${this.baseUrl}`);
      
      // Step 1: Get the main page to find year links
      const mainPageHtml = await this.fetch(this.baseUrl);
      const mainPageRoot = parse(mainPageHtml);
      
      // Find all year links (pattern: /diario-oficial/YYYY-ID)
      const yearLinks = mainPageRoot.querySelectorAll('a[href*="diario-oficial/"]');
      const yearUrls: { year: number; url: string }[] = [];
      
      for (const link of yearLinks) {
        const href = link.getAttribute('href');
        if (!href) continue;
        
        // Match pattern like /diario-oficial/2024-29
        const yearMatch = href.match(/diario-oficial\/(\d{4})-\d+$/);
        if (yearMatch) {
          const year = parseInt(yearMatch[1], 10);
          const fullUrl = href.startsWith('http') ? href : `https://pirassununga.sp.gov.br${href}`;
          
          // Only add if we haven't seen this year
          if (!yearUrls.find(y => y.year === year)) {
            yearUrls.push({ year, url: fullUrl });
          }
        }
      }
      
      logger.info(`Found ${yearUrls.length} year pages: ${yearUrls.map(y => y.year).join(', ')}`);
      
      // Step 2: Determine which years we need based on date range
      const startYear = new Date(this.dateRange.start).getFullYear();
      const endYear = new Date(this.dateRange.end).getFullYear();
      
      const relevantYears = yearUrls.filter(y => y.year >= startYear && y.year <= endYear);
      logger.info(`Processing ${relevantYears.length} relevant years for date range: ${relevantYears.map(y => y.year).join(', ')}`);
      
      // Step 3: For each relevant year, fetch the page and extract gazettes
      for (const yearInfo of relevantYears) {
        const yearGazettes = await this.crawlYearPage(yearInfo.url, yearInfo.year);
        gazettes.push(...yearGazettes);
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from Pirassununga`);
      
    } catch (error) {
      logger.error(`Error crawling Pirassununga:`, error as Error);
      throw error;
    }
    
    return gazettes;
  }

  /**
   * Crawl a specific year page and extract gazette entries
   */
  private async crawlYearPage(url: string, year: number): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      logger.debug(`Fetching year page: ${url}`);
      const pageHtml = await this.fetch(url);
      const root = parse(pageHtml);
      
      // Find PDF links inside table cells (td elements)
      // The structure is: <td><a href="https://ecrie.com.br/...">YYYY-MM-DD - Diário Eletrônico...</a></td>
      // We need to avoid dropdown links (class="dropdown__link") which are for other content
      const tableCells = root.querySelectorAll('td');
      const pdfLinks: { href: string; text: string }[] = [];
      
      for (const cell of tableCells) {
        const link = cell.querySelector('a[href*="ecrie.com.br"]');
        if (link) {
          const href = link.getAttribute('href');
          const text = link.text?.trim() || '';
          if (href && href.includes('.pdf')) {
            pdfLinks.push({ href, text });
          }
        }
      }
      
      logger.debug(`Found ${pdfLinks.length} PDF links in table cells on year ${year} page`);
      
      for (const { href, text } of pdfLinks) {
        // Extract date from filename text (pattern: YYYY-MM-DD - ...)
        const dateMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!dateMatch) {
          logger.debug(`Could not parse date from: ${text}`);
          continue;
        }
        
        const [, yearStr, month, day] = dateMatch;
        const gazetteDate = new Date(`${yearStr}-${month}-${day}`);
        
        // Check if in date range
        if (!this.isInDateRange(gazetteDate)) {
          continue;
        }
        
        // Extract edition number
        const editionMatch = text.match(/n[ºo°]\s*(\d+)/i);
        const editionNumber = editionMatch ? editionMatch[1] : undefined;
        
        // Check if it's an extra/complementary edition
        const isExtraEdition = text.toLowerCase().includes('extra') || 
                               text.toLowerCase().includes('complementar') ||
                               text.toLowerCase().includes('suplementar');
        
        // Create gazette
        const gazette = await this.createGazette(gazetteDate, href, {
          editionNumber,
          isExtraEdition,
          power: 'executive_legislative',
          sourceText: text,
        });
        
        if (gazette) {
          gazettes.push(gazette);
        }
      }
      
      logger.debug(`Extracted ${gazettes.length} gazettes from year ${year}`);
      
    } catch (error) {
      logger.error(`Error crawling year page ${url}:`, error as Error);
    }
    
    return gazettes;
  }
}

