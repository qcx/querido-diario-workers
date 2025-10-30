import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, AtendeV2Config } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for Atende.net platform (Layout 2)
 * Used by 22 cities in Paraná (PR) and Rio Grande do Sul (RS)
 * 
 * Characteristics:
 * - AJAX-based with GET parameters
 * - City-specific subdomain
 * - Numeric pagination
 * - Direct PDF downloads
 * - Integrated date filtering
 */
export class AtendeV2Spider extends BaseSpider {
  private citySubdomain: string;
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as AtendeV2Config;
    this.citySubdomain = platformConfig.citySubdomain;
    this.baseUrl = `https://${this.citySubdomain}.atende.net/diariooficial/edicao/pagina/atende.php`;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling AtendeV2 for ${this.config.name}...`);

    try {
      let currentPage = 1;
      let lastPage = 1;
      let shouldContinue = true;
      
      while (shouldContinue && currentPage <= lastPage) {
        logger.debug(`Fetching page ${currentPage}...`);
        
        // Build URL with parameters
        const url = this.buildUrl(currentPage);
        
        const response = await fetch(url);
        if (!response.ok) {
          logger.warn(`Failed to fetch page ${currentPage}: ${response.status}`);
          break;
        }
        
        const html = await response.text();
        const $ = this.loadHTML(html);
        
        // Update last page number
        if (currentPage === 1) {
          lastPage = this.getLastPage($);
          logger.debug(`Total pages: ${lastPage}`);
        }
        
        // Parse gazette list
        const items = $('div.nova_listagem div.linha');
        logger.debug(`Found ${items.length} items on page ${currentPage}`);
        
        if (items.length === 0) {
          break;
        }
        
        let foundInRange = false;
        
        for (let i = 0; i < items.length; i++) {
          const element = items[i];
          const $item = $(element);
          
          // Extract date
          const dateText = $item.find('div.data').text().trim();
          const date = this.parseDate(dateText);
          
          if (!date) {
            logger.debug(`Could not parse date: ${dateText}`);
            continue;
          }
          
          // Check date range
          if (date > this.endDate) {
            continue; // Skip future dates
          }
          
          if (date < this.startDate) {
            shouldContinue = false; // Stop crawling
            continue;
          }
          
          foundInRange = true;
          
          // Extract edition type
          const editionType = $item.find('div.tipo').text().trim();
          const isExtraEdition = this.isExtraEdition(editionType);
          
          // Extract edition number
          const titleText = $item.find('div.titulo').text().trim();
          const editionMatch = titleText.match(/\d+/);
          const editionNumber = editionMatch ? editionMatch[0] : undefined;
          
          // Extract download URL
          const buttons = $item.find('button[data-link]');
          if (buttons.length === 0) {
            logger.debug(`No download button found for edition ${editionNumber}`);
            continue;
          }
          
          const downloadUrl = $(buttons[buttons.length - 1]).attr('data-link');
          if (!downloadUrl) {
            logger.debug(`No download URL found for edition ${editionNumber}`);
            continue;
          }
          
          const gazette = await this.createGazette(date, downloadUrl, {
            editionNumber,
            isExtraEdition,
            power: 'executive_legislative',
          });
          
          if (gazette) {
            gazettes.push(gazette);
          }
        }
        
        // If no items in range found, stop
        if (!foundInRange) {
          shouldContinue = false;
        }
        
        currentPage++;
        
        // Add delay between requests
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from AtendeV2`);
    } catch (error) {
      logger.error(`Error crawling AtendeV2: ${error}`);
      throw error;
    }

    return gazettes;
  }

  /**
   * Build URL with GET parameters for pagination
   */
  private buildUrl(page: number): string {
    const params = new URLSearchParams({
      rot: '54015',
      aca: '101',
      ajax: 't',
      processo: 'loadPluginDiarioOficial',
      parametro: JSON.stringify({
        codigoPlugin: 1,
        filtroPlugin: {
          pagina: page.toString(),
        },
      }),
    });
    
    return `${this.baseUrl}?${params.toString()}`;
  }

  /**
   * Get the last page number from pagination
   */
  private getLastPage($: any): number {
    const paginationButtons = $('div#paginacao li.dst button');
    if (paginationButtons.length === 0) {
      return 1;
    }
    
    const lastButton = paginationButtons.last();
    const lastPageValue = lastButton.attr('value');
    
    return lastPageValue ? parseInt(lastPageValue, 10) : 1;
  }

  /**
   * Parse date from text (e.g., "04/10/2025" or "03 de Outubro de 2025")
   */
  private parseDate(dateText: string): Date | null {
    // Try DD/MM/YYYY format first
    const numericMatch = dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (numericMatch) {
      const day = numericMatch[1];
      const month = numericMatch[2];
      const year = numericMatch[3];
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }
    
    // Try extended format: "DD de MÊS de YYYY"
    const months: { [key: string]: number } = {
      'janeiro': 0, 'fevereiro': 1, 'março': 2, 'abril': 3,
      'maio': 4, 'junho': 5, 'julho': 6, 'agosto': 7,
      'setembro': 8, 'outubro': 9, 'novembro': 10, 'dezembro': 11
    };
    
    const extendedMatch = dateText.match(/(\d{2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
    if (extendedMatch) {
      const day = parseInt(extendedMatch[1]);
      const monthName = extendedMatch[2].toLowerCase();
      const year = parseInt(extendedMatch[3]);
      const month = months[monthName];
      
      if (month !== undefined) {
        return new Date(year, month, day);
      }
    }
    
    return null;
  }

  /**
   * Check if edition is extra/supplementary
   */
  private isExtraEdition(editionType: string): boolean {
    const extraPattern = /suplementar|retificação|extraordinária|extra/i;
    return extraPattern.test(editionType);
  }
}
