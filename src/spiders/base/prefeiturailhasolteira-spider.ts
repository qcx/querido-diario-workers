import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraIlhaSolteiraConfig } from '../../types';
import { logger } from '../../utils/logger';
// @ts-ignore
import { parse } from 'node-html-parser';

/**
 * PrefeituraIlhaSolteiraSpider for Ilha Solteira, SP
 * 
 * Site Structure:
 * - WordPress site with yearly pages for SOEM (Semanário Oficial Eletrônico Municipal)
 * - Pages: https://ilhasolteira.sp.gov.br/soem-{YEAR}
 * - PDFs listed directly on page using wp-block-file blocks
 * 
 * HTML Structure:
 * <div class="wp-block-file">
 *   <a href="https://ilhasolteira.sp.gov.br/wp-content/uploads/2025/12/xxx.pdf">
 *     SOEM 2025 N. 1275 – 30 de dezembro
 *   </a>
 *   <a href="..." class="wp-block-file__button" download>Baixar</a>
 * </div>
 * 
 * Title format: "SOEM YYYY N. {edição} – {dia} de {mês}" or "SUPLEMENTO SOEM ..."
 */
export class PrefeituraIlhaSolteiraSpider extends BaseSpider {
  private baseUrl: string;

  // Month names in Portuguese (including common typos/variations)
  private readonly monthNames: Record<string, number> = {
    'janeiro': 1,
    'jan': 1,
    'fevereiro': 2,
    'fev': 2,
    'março': 3,
    'marco': 3,
    'mar': 3,
    'abril': 4,
    'abr': 4,
    'maio': 5,
    'maip': 5, // common typo
    'mai': 5,
    'junho': 6,
    'jun': 6,
    'julho': 7,
    'jul': 7,
    'agosto': 8,
    'ago': 8,
    'setembro': 9,
    'set': 9,
    'outubro': 10,
    'out': 10,
    'novembro': 11,
    'nov': 11,
    'dezembro': 12,
    'dez': 12
  };

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    const config = spiderConfig.config as PrefeituraIlhaSolteiraConfig;
    this.baseUrl = config.baseUrl || 'https://ilhasolteira.sp.gov.br';
    
    logger.info(`Initializing PrefeituraIlhaSolteiraSpider for ${spiderConfig.name} with URL: ${this.baseUrl}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.baseUrl} for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    
    // Get unique years in the date range
    const startYear = this.startDate.getFullYear();
    const endYear = this.endDate.getFullYear();
    
    // Crawl each year
    for (let year = endYear; year >= startYear; year--) {
      try {
        const yearGazettes = await this.crawlYear(year);
        gazettes.push(...yearGazettes);
      } catch (error) {
        logger.warn(`Error crawling year ${year}:`, error as Error);
        // Continue with other years
      }
    }
    
    logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    return gazettes;
  }

  /**
   * Crawl a specific year page
   */
  private async crawlYear(year: number): Promise<Gazette[]> {
    const pageUrl = `${this.baseUrl}/soem-${year}`;
    logger.debug(`Fetching year page: ${pageUrl}`);
    
    const gazettes: Gazette[] = [];
    
    try {
      const html = await this.fetch(pageUrl);
      const root = parse(html);
      
      // Find all wp-block-file elements
      const fileBlocks = root.querySelectorAll('.wp-block-file');
      
      logger.debug(`Found ${fileBlocks.length} file blocks on page for ${year}`);
      
      for (const block of fileBlocks) {
        try {
          // Get the main link (first <a> that's not the download button)
          const links = block.querySelectorAll('a');
          let pdfUrl: string | undefined;
          let titleText: string | undefined;
          
          for (const link of links) {
            const href = link.getAttribute('href');
            const isDownloadButton = link.classList.contains('wp-block-file__button');
            
            if (href && href.endsWith('.pdf')) {
              pdfUrl = href;
              if (!isDownloadButton) {
                titleText = link.text?.trim();
              }
            }
          }
          
          if (!pdfUrl) {
            continue;
          }
          
          // Parse title to extract date and edition
          // Format: "SOEM 2025 N. 1275 – 30 de dezembro" or "SUPLEMENTO SOEM 2025 N. 1275 – 30 de dezembro"
          const titleInfo = this.parseTitle(titleText || '', year);
          
          if (!titleInfo) {
            logger.debug(`Could not parse title: ${titleText}`);
            continue;
          }
          
          const { date: gazetteDate, editionNumber, isExtra } = titleInfo;
          
          // Check if date is in range
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }
          
          // Create gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber,
            isExtraEdition: isExtra,
            power: 'executive_legislative',
            sourceText: titleText,
          });
          
          if (gazette) {
            gazettes.push(gazette);
          }
          
        } catch (error) {
          logger.debug(`Error processing file block:`, { error: (error as Error).message });
        }
      }
      
    } catch (error) {
      if ((error as any).message?.includes('404') || (error as any).message?.includes('Not Found')) {
        logger.debug(`Year page ${year} returned 404`);
      } else {
        throw error;
      }
    }
    
    return gazettes;
  }

  /**
   * Parse title to extract date and edition number
   * Examples:
   * - "SOEM 2025 N. 1275 – 30 de dezembro"
   * - "SUPLEMENTO SOEM 2025 N. 1275 – 30 de dezembro"
   * - "SOEM 2025 N 1273 – 23 de dezembro"
   */
  private parseTitle(title: string, defaultYear: number): { date: Date; editionNumber: string; isExtra: boolean } | null {
    // Check if it's an extra edition (suplemento)
    const isExtra = title.toLowerCase().includes('suplemento');
    
    // Extract edition number - "N. 1275" or "N 1275"
    const editionMatch = title.match(/N\.?\s*(\d+)/i);
    const editionNumber = editionMatch ? editionMatch[1] : undefined;
    
    // Extract date - "30 de dezembro" or "23 de dezembro de 2025"
    const dateMatch = title.match(/(\d{1,2})\s+de\s+(\w+)(?:\s+de\s+(\d{4}))?/i);
    
    if (!dateMatch) {
      return null;
    }
    
    const day = parseInt(dateMatch[1], 10);
    const monthName = dateMatch[2].toLowerCase();
    const yearFromTitle = dateMatch[3] ? parseInt(dateMatch[3], 10) : defaultYear;
    
    const month = this.monthNames[monthName];
    
    if (!month || !day || day < 1 || day > 31) {
      return null;
    }
    
    const gazetteDate = new Date(yearFromTitle, month - 1, day);
    
    // Validate date is reasonable
    if (isNaN(gazetteDate.getTime())) {
      return null;
    }
    
    return {
      date: gazetteDate,
      editionNumber: editionNumber || '',
      isExtra
    };
  }
}

