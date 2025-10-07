import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, AcreConfig } from '../../types';
import { logger } from '../../utils/logger';
import { formatDateForUrl, formatDateBR } from '../../utils/date-utils';

/**
 * Spider para o Diário Oficial do Estado do Acre (DOE/AC)
 * 
 * Este spider coleta diários oficiais do sistema centralizado do Acre onde
 * todas as publicações municipais são incluídas no diário estadual.
 * 
 * URL: https://www.diario.ac.gov.br/
 * Características:
 * - Sistema centralizado estadual
 * - Todas as 22 cidades do Acre publicam no mesmo diário
 * - Busca por palavra-chave permite filtrar por município
 * - Documentos em formato PDF
 */
export class AcreSpider extends BaseSpider {
  protected acreConfig: AcreConfig;
  private readonly BASE_URL = 'https://www.diario.ac.gov.br';
  private readonly SEARCH_URL = 'https://www.diario.ac.gov.br/busca.php';

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.acreConfig = spiderConfig.config as AcreConfig;
    
    if (!this.acreConfig.cityName) {
      throw new Error(`AcreSpider requires a cityName in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing AcreSpider for ${spiderConfig.name} - searching for: ${this.acreConfig.cityName}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling DOE/AC for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    
    try {
      // For Acre, we need to search for gazettes that contain the city name
      // The system publishes daily gazettes that include all municipalities
      const searchResults = await this.searchGazettes();
      
      for (const result of searchResults) {
        if (this.isInDateRange(result.date)) {
          gazettes.push(result);
        }
      }
      
      logger.info(`Found ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      return gazettes;
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error);
      return [];
    }
  }

  /**
   * Search for gazettes containing the city name
   */
  private async searchGazettes(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    // Get current year from date range
    const startYear = new Date(this.dateRange.start).getFullYear();
    const endYear = new Date(this.dateRange.end).getFullYear();
    
    // Search for each year in the range
    for (let year = startYear; year <= endYear; year++) {
      const yearGazettes = await this.searchByYear(year);
      gazettes.push(...yearGazettes);
    }
    
    return gazettes;
  }

  /**
   * Search gazettes for a specific year
   */
  private async searchByYear(year: number): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    // Construct search URL with city name and year
    const searchParams = new URLSearchParams({
      palavra: this.acreConfig.cityName,
      ano: year.toString(),
      tipo: 'palavra' // Search by keyword
    });
    
    const searchUrl = `${this.SEARCH_URL}?${searchParams.toString()}`;
    
    try {
      logger.debug(`Searching for ${this.acreConfig.cityName} in year ${year}: ${searchUrl}`);
      
      const html = await this.fetch(searchUrl);
      const $ = this.loadHTML(html);
      
      // Parse search results
      // The search results typically show in a table format
      $('table tr').each((index, element) => {
        if (index === 0) return; // Skip header row
        
        const row = $(element);
        const cells = row.find('td');
        
        if (cells.length >= 3) {
          const dateText = cells.eq(0).text().trim();
          const descriptionCell = cells.eq(1);
          const downloadLink = descriptionCell.find('a').attr('href');
          
          if (dateText && downloadLink) {
            const date = this.parseDate(dateText);
            
            if (date && this.isInDateRange(date)) {
              const description = descriptionCell.text().trim();
              const editionNumber = this.extractEditionNumber(description);
              
              // Construct full download URL
              const fullUrl = downloadLink.startsWith('http') 
                ? downloadLink 
                : `${this.BASE_URL}/${downloadLink.replace(/^\//, '')}`;
              
              const gazette = this.createGazette(date, fullUrl, {
                editionNumber,
                power: this.acreConfig.power || 'executive_legislative',
                sourceText: description
              });
              
              gazettes.push(gazette);
            }
          }
        }
      });
      
      logger.debug(`Found ${gazettes.length} gazettes for ${this.acreConfig.cityName} in ${year}`);
      
    } catch (error) {
      logger.error(`Error searching for ${this.acreConfig.cityName} in ${year}:`, error);
    }
    
    return gazettes;
  }

  /**
   * Parse date from Brazilian format (DD/MM/YYYY)
   */
  private parseDate(dateText: string): Date | null {
    const match = dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (match) {
      const [, day, month, year] = match;
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }
    return null;
  }

  /**
   * Extract edition number from description
   */
  private extractEditionNumber(description: string): string | undefined {
    const match = description.match(/n[º°]\s*(\d+)/i);
    return match ? match[1] : undefined;
  }

  /**
   * Get the latest gazette (for testing and quick access)
   */
  async getLatestGazette(): Promise<Gazette | null> {
    try {
      const html = await this.fetch(this.BASE_URL);
      const $ = this.loadHTML(html);
      
      // Look for the latest edition link
      const latestLink = $('a[href*="download.php"]').first();
      const href = latestLink.attr('href');
      
      if (href) {
        const fullUrl = href.startsWith('http') ? href : `${this.BASE_URL}/${href.replace(/^\//, '')}`;
        const description = latestLink.text().trim();
        const editionNumber = this.extractEditionNumber(description);
        
        // Try to extract date from the description or use current date
        const today = new Date();
        
        return this.createGazette(today, fullUrl, {
          editionNumber,
          power: this.acreConfig.power || 'executive_legislative',
          sourceText: description
        });
      }
      
    } catch (error) {
      logger.error(`Error getting latest gazette:`, error);
    }
    
    return null;
  }
}
