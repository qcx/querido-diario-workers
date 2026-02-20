import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraFrancoDaRochaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';
// @ts-ignore
import { parse } from 'node-html-parser';

/**
 * Spider for Prefeitura de Franco da Rocha official gazette
 * 
 * Uses WordPress with custom theme
 * 
 * The site structure:
 * 1. Listing page: https://www.francodarocha.sp.gov.br/diariooficial/
 *    - ul.noticias-lista > li.noticia-item.diario
 *    - time.noticia-meta: date (DD/MM/YYYY)
 *    - a > div.noticia-titulo: link to detail page
 * 
 * 2. Detail page: https://www.francodarocha.sp.gov.br/diariooficial/YYYY/MM/DD/diario-oficial-edicao-XXX/
 *    - div.wp-block-file > a[href$=".pdf"]: PDF links
 *    - time[datetime]: publication date
 * 
 * 3. PDF URL: https://www.francodarocha.sp.gov.br/diariooficial/wp-content/uploads/sites/2/YYYY/MM/arquivo.pdf
 * 
 * Pagination: /page/N/
 */
export class PrefeituraFrancoDaRochaSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraFrancoDaRochaConfig;
    this.baseUrl = platformConfig.url || platformConfig.baseUrl || 'https://www.francodarocha.sp.gov.br/diariooficial/';
  }

  /**
   * Parse Brazilian date (DD/MM/YYYY) to Date object
   */
  private parseBrazilianDate(dateStr: string): Date | null {
    const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!match) {
      return null;
    }
    const [, day, month, year] = match;
    return new Date(`${year}-${month}-${day}`);
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Franco da Rocha for ${this.config.name}...`);

    try {
      let currentPage = 1;
      let hasMorePages = true;
      let consecutiveEmptyPages = 0;
      const maxConsecutiveEmptyPages = 3;

      while (hasMorePages && consecutiveEmptyPages < maxConsecutiveEmptyPages) {
        const pageUrl = currentPage === 1 
          ? this.baseUrl 
          : `${this.baseUrl.replace(/\/$/, '')}/page/${currentPage}/`;
        
        logger.info(`Fetching page ${currentPage}: ${pageUrl}`);
        
        let pageHtml: string;
        try {
          pageHtml = await this.fetch(pageUrl);
        } catch (error: any) {
          if (error.message?.includes('404') || error.message?.includes('Not Found')) {
            logger.info(`Page ${currentPage} not found, stopping pagination`);
            break;
          }
          throw error;
        }
        
        const root = parse(pageHtml);
        
        // Find all gazette items
        const gazetteItems = root.querySelectorAll('li.noticia-item.diario');
        
        if (gazetteItems.length === 0) {
          consecutiveEmptyPages++;
          logger.debug(`No gazette items found on page ${currentPage}, consecutive empty: ${consecutiveEmptyPages}`);
          currentPage++;
          continue;
        }
        
        consecutiveEmptyPages = 0;
        let foundDateOutOfRange = false;
        
        for (const item of gazetteItems) {
          try {
            // Extract date
            const dateElement = item.querySelector('time.noticia-meta');
            const dateText = dateElement?.text?.trim();
            
            if (!dateText) {
              logger.warn('No date found in gazette item');
              continue;
            }
            
            const gazetteDate = this.parseBrazilianDate(dateText);
            if (!gazetteDate) {
              logger.warn(`Could not parse date from: ${dateText}`);
              continue;
            }
            
            // Check if date is before our range (gazettes are listed newest first)
            const startDate = new Date(this.dateRange.start);
            if (gazetteDate < startDate) {
              foundDateOutOfRange = true;
              continue;
            }
            
            // Check if date is in range
            if (!this.isInDateRange(gazetteDate)) {
              continue;
            }
            
            // Extract link to detail page
            const linkElement = item.querySelector('a[href]');
            const detailUrl = linkElement?.getAttribute('href');
            
            if (!detailUrl) {
              logger.warn(`No detail link found for gazette on ${dateText}`);
              continue;
            }
            
            // Extract edition from title
            const titleElement = item.querySelector('.noticia-titulo');
            const titleText = titleElement?.text?.trim() || '';
            const editionMatch = titleText.match(/[Ee]di[çc][ãa]o\s+([IVXLCDM]+|\d+)/i);
            const editionNumber = editionMatch ? editionMatch[1] : undefined;
            
            // Fetch detail page to get PDFs
            logger.debug(`Fetching detail page: ${detailUrl}`);
            const detailHtml = await this.fetch(detailUrl);
            const detailRoot = parse(detailHtml);
            
            // Find all PDF links
            const pdfLinks = detailRoot.querySelectorAll('div.wp-block-file a[href$=".pdf"]');
            
            if (pdfLinks.length === 0) {
              logger.warn(`No PDF links found on detail page: ${detailUrl}`);
              continue;
            }
            
            // Create a gazette for each PDF on this date
            for (const pdfLink of pdfLinks) {
              const pdfUrl = pdfLink.getAttribute('href');
              const pdfTitle = pdfLink.text?.trim() || '';
              
              if (!pdfUrl) {
                continue;
              }
              
              // Create gazette for this PDF
              const gazette = await this.createGazette(gazetteDate, pdfUrl, {
                editionNumber,
                power: 'executive_legislative',
                sourceText: `${titleText} - ${pdfTitle}`.trim() || `Edição ${editionNumber || 'N/A'} - ${dateText}`,
              });
              
              if (gazette) {
                gazettes.push(gazette);
              }
            }
            
            logger.debug(`Found ${pdfLinks.length} PDFs for ${dateText}`);
            
          } catch (error) {
            logger.error(`Error processing gazette item:`, error as Error);
          }
        }
        
        // If we found dates before our range and this page had no valid dates, stop
        if (foundDateOutOfRange && gazettes.length === 0) {
          // But continue to check if there are more recent dates on next page
          // (pagination might not be strictly ordered)
        }
        
        // Check for next page
        const paginationNext = root.querySelector('#paginacao a[href*="/page/"]');
        if (!paginationNext) {
          hasMorePages = false;
        } else {
          currentPage++;
        }
        
        // Safety limit
        if (currentPage > 50) {
          logger.warn('Reached page limit (50), stopping pagination');
          hasMorePages = false;
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from Franco da Rocha`);
      
    } catch (error) {
      logger.error(`Error crawling Franco da Rocha:`, error as Error);
    }

    return gazettes;
  }
}

