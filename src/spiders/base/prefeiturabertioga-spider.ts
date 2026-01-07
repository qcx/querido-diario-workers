import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraBertiogaConfig } from '../../types';
import { logger } from '../../utils/logger';
// @ts-ignore
import { parse, HTMLElement } from 'node-html-parser';
import { toISODate } from '../../utils/date-utils';

/**
 * Portuguese month names mapping
 */
const PORTUGUESE_MONTHS: Record<string, number> = {
  'janeiro': 0, 'fevereiro': 1, 'março': 2, 'marco': 2,
  'abril': 3, 'maio': 4, 'junho': 5,
  'julho': 6, 'agosto': 7, 'setembro': 8,
  'outubro': 9, 'novembro': 10, 'dezembro': 11
};

/**
 * PrefeituraBertiogaSpider for Bertioga municipality gazette collection
 * 
 * Site developed by KBRTEC using custom WordPress theme
 * 
 * HTML Structure:
 * - Container: section.arquivos > div.arquivos__list > div.arquivos__item
 * - Date: div.arquivos__info p.arquivos__text strong (format: "DD de MMMM de YYYY")
 * - Title: div.arquivos__content p.arquivos__text strong (e.g., "BOM 1265 - Atos Internos")
 * - PDF Link: div.arquivos__action a.arquivos__button href
 * - Pagination: nav.pagination with ?page=N links
 * 
 * URL: https://www.bertioga.sp.gov.br/boletim-oficial
 */
export class PrefeituraBertiogaSpider extends BaseSpider {
  protected bertiogaConfig: PrefeituraBertiogaConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.bertiogaConfig = spiderConfig.config as PrefeituraBertiogaConfig;
    
    if (!this.bertiogaConfig.baseUrl) {
      throw new Error(`PrefeituraBertiogaSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraBertiogaSpider for ${spiderConfig.name} with URL: ${this.bertiogaConfig.baseUrl}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.bertiogaConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    let currentPage = 1;
    let hasMorePages = true;
    let foundOlderThanRange = false;
    const maxPages = 100;

    while (hasMorePages && currentPage <= maxPages && !foundOlderThanRange) {
      try {
        // Build URL with page parameter
        const pageUrl = currentPage === 1 
          ? this.bertiogaConfig.baseUrl 
          : `${this.bertiogaConfig.baseUrl}?page=${currentPage}`;
        
        logger.debug(`Fetching page ${currentPage}: ${pageUrl}`);
        
        const html = await this.fetch(pageUrl);
        const root = parse(html);
        
        // Find all gazette items
        const items = root.querySelectorAll('.arquivos__item');
        
        if (items.length === 0) {
          logger.info(`No items found on page ${currentPage}, stopping pagination`);
          hasMorePages = false;
          continue;
        }
        
        logger.debug(`Found ${items.length} gazette items on page ${currentPage}`);
        
        for (const item of items) {
          try {
            const gazette = await this.parseGazetteItem(item);
            
            if (gazette) {
              const gazetteDate = new Date(gazette.date);
              
              // Check if older than date range
              if (gazetteDate < new Date(this.dateRange.start)) {
                foundOlderThanRange = true;
                continue;
              }
              
              // Check if in date range
              if (this.isInDateRange(gazetteDate)) {
                gazettes.push(gazette);
              }
            }
          } catch (error) {
            logger.error(`Error parsing gazette item:`, error as Error);
          }
        }
        
        // Check for next page
        const paginationItems = root.querySelectorAll('.pagination__item.pagination__number a');
        const hasNextPage = Array.from(paginationItems).some((link: any) => {
          const href = link.getAttribute('href') || '';
          return href.includes(`page=${currentPage + 1}`);
        });
        
        if (hasNextPage && !foundOlderThanRange) {
          currentPage++;
        } else {
          hasMorePages = false;
        }
        
      } catch (error) {
        logger.error(`Error fetching page ${currentPage}:`, error as Error);
        hasMorePages = false;
      }
    }
    
    logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    return gazettes;
  }

  /**
   * Parse a single gazette item from the listing page
   * 
   * HTML Structure:
   * <div class="arquivos__item">
   *   <div class="arquivos__info --small">
   *     <div class="arquivos__icon">...</div>
   *     <p class="arquivos__text">Data: <strong>30 de dezembro de 2025</strong></p>
   *   </div>
   *   <div class="arquivos__content --center --large">
   *     <p class="arquivos__text"><strong>BOM 1265 - Atos Internos</strong></p>
   *   </div>
   *   <div class="arquivos__action">
   *     <a href="https://www.bertioga.sp.gov.br/wp/wp-content/uploads/2025/12/BOLETIM1265.pdf" 
   *        target="_blank" title="Baixar documento" class="arquivos__button --blue">Baixar</a>
   *   </div>
   * </div>
   */
  private async parseGazetteItem(item: HTMLElement): Promise<Gazette | null> {
    try {
      // Extract date from arquivos__info
      const dateElement = item.querySelector('.arquivos__info .arquivos__text strong');
      const dateText = dateElement?.text?.trim();
      
      if (!dateText) {
        logger.warn('Could not find date in gazette item');
        return null;
      }
      
      // Parse Portuguese date format: "DD de MMMM de YYYY"
      const gazetteDate = this.parsePortugueseDate(dateText);
      
      if (!gazetteDate) {
        logger.warn(`Could not parse date: ${dateText}`);
        return null;
      }
      
      // Extract title from arquivos__content
      const titleElement = item.querySelector('.arquivos__content .arquivos__text strong');
      const titleText = titleElement?.text?.trim() || '';
      
      // Extract PDF URL from arquivos__action
      const pdfLink = item.querySelector('.arquivos__action a.arquivos__button');
      const pdfUrl = pdfLink?.getAttribute('href');
      
      if (!pdfUrl) {
        logger.warn(`No PDF URL found for: ${titleText}`);
        return null;
      }
      
      // Extract edition number from title (e.g., "BOM 1265" or "BOM 1265 - Atos Internos")
      const editionMatch = titleText.match(/BOM\s+(\d+)/i);
      const editionNumber = editionMatch ? editionMatch[1] : undefined;
      
      // Check if it's an extra/internal edition
      const isExtraEdition = titleText.toLowerCase().includes('extra') || 
                             titleText.toLowerCase().includes('atos internos') ||
                             titleText.toLowerCase().includes('anexo');
      
      return await this.createGazette(gazetteDate, pdfUrl, {
        editionNumber,
        isExtraEdition,
        power: 'executive_legislative',
        sourceText: titleText,
      });
      
    } catch (error) {
      logger.error(`Error parsing gazette item:`, error as Error);
      return null;
    }
  }

  /**
   * Parse Portuguese date format: "DD de MMMM de YYYY"
   * Example: "30 de dezembro de 2025"
   */
  private parsePortugueseDate(dateText: string): Date | null {
    try {
      // Match pattern: DD de MMMM de YYYY
      const match = dateText.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
      
      if (!match) {
        return null;
      }

      const day = parseInt(match[1], 10);
      const monthName = match[2].toLowerCase();
      const year = parseInt(match[3], 10);

      const month = PORTUGUESE_MONTHS[monthName];
      
      if (month === undefined) {
        logger.warn(`Unknown Portuguese month: ${monthName} in text: ${dateText}`);
        return null;
      }

      return new Date(year, month, day);

    } catch (error) {
      logger.error(`Error parsing Portuguese date "${dateText}":`, error as Error);
      return null;
    }
  }
}

