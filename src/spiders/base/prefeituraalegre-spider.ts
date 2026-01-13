import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraAlegreConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';
// @ts-ignore
import { parse } from 'node-html-parser';

/**
 * PrefeituraAlegreSpider for Alegre, ES WordPress-based gazette site
 * 
 * Site Structure:
 * - WordPress site with PDFs organized by category (decretos, leis) and year
 * - URLs: https://www.alegre.es.gov.br/diariooficial/{category}-{year}/
 * - PDFs are listed in tables with direct links
 * - PDF filenames contain: {number} - {year} - {description}.pdf
 * - Categories: decretos, leis
 * 
 * HTML Structure:
 * <td style='padding:3px;'>
 *   <a target='_blank' href='https://alegre.es.gov.br/arquivos/diario-oficial/decretos/2026/14170 - 2026 - ...pdf'>
 *     14170 - 2026 - ...
 *   </a>
 * </td>
 */
export class PrefeituraAlegreSpider extends BaseSpider {
  protected alegreConfig: PrefeituraAlegreConfig;
  private readonly BASE_URL = 'https://www.alegre.es.gov.br';

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.alegreConfig = spiderConfig.config as PrefeituraAlegreConfig;
    
    if (!this.alegreConfig.baseUrl) {
      throw new Error(`PrefeituraAlegreSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraAlegreSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.alegreConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    const categories = ['decretos', 'leis'];
    
    // Get years from date range
    const startYear = this.startDate.getFullYear();
    const endYear = this.endDate.getFullYear();
    
    for (const category of categories) {
      for (let year = startYear; year <= endYear; year++) {
        try {
          const categoryGazettes = await this.crawlCategory(category, year);
          gazettes.push(...categoryGazettes);
        } catch (error) {
          logger.error(`Error crawling ${category} for year ${year}:`, error as Error);
        }
      }
    }
    
    logger.info(`Found ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    return gazettes;
  }

  /**
   * Crawl a specific category and year
   */
  private async crawlCategory(category: string, year: number): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const url = `${this.alegreConfig.baseUrl}/diariooficial/${category}-${year}/`;
    
    logger.debug(`Fetching ${category} for year ${year}: ${url}`);
    
    try {
      const html = await this.fetch(url);
      const root = parse(html);
      
      // Find all PDF links in table cells
      const pdfLinks = root.querySelectorAll('td a[href$=".pdf"]');
      
      logger.debug(`Found ${pdfLinks.length} PDF links for ${category}/${year}`);
      
      for (const link of pdfLinks) {
        try {
          const pdfUrl = link.getAttribute('href');
          const linkText = link.text?.trim() || '';
          
          if (!pdfUrl) {
            continue;
          }
          
          // Make URL absolute if relative
          const fullPdfUrl = pdfUrl.startsWith('http') 
            ? pdfUrl 
            : `${this.BASE_URL}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          
          // Extract date from filename: {number} - {year} - {description}.pdf
          // The year is in the filename, but we need to extract the actual publication date
          // For now, we'll use the year from the URL and try to parse more from the filename
          const filenameMatch = pdfUrl.match(/(\d{4})\s*-\s*(\d{4})/);
          if (filenameMatch) {
            const fileYear = parseInt(filenameMatch[2]);
            
            // Try to extract day/month from filename or use first day of year as fallback
            // Since we don't have exact dates in the filename, we'll use the year and filter by date range
            // This is a limitation - we'd need to fetch each PDF to get the actual date
            // For now, we'll create gazettes for the year and let the date range filter handle it
            
            // Create a date at the start of the year for filtering
            const gazetteDate = new Date(fileYear, 0, 1);
            
            // Only include if year is in our range
            if (fileYear >= this.startDate.getFullYear() && fileYear <= this.endDate.getFullYear()) {
              // Extract number from filename
              const numberMatch = linkText.match(/^(\d+)/);
              const editionNumber = numberMatch ? numberMatch[1] : undefined;
              
              // Create gazette - note: we're using year start date as approximation
              // In a real implementation, you might want to fetch the PDF to extract the actual date
              const gazette = await this.createGazette(gazetteDate, fullPdfUrl, {
                editionNumber,
                power: 'executive_legislative',
                sourceText: `${category} - ${linkText}`,
              });
              
              if (gazette) {
                gazettes.push(gazette);
              }
            }
          }
        } catch (error) {
          logger.error(`Error processing PDF link:`, error as Error);
        }
      }
    } catch (error) {
      logger.error(`Error fetching ${category}/${year}:`, error as Error);
    }
    
    return gazettes;
  }
}
