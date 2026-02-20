import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, AemerjConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Spider para o consórcio AEMERJ (Associação Estadual de Municípios do Rio de Janeiro)
 * 
 * Este spider coleta diários oficiais do sistema centralizado da AEMERJ
 * através do portal SIGPub da Vox Tecnologia.
 * 
 * URL Base: https://www.diariomunicipal.com.br/aemerj/
 * Pesquisa: https://www.diariomunicipal.com.br/aemerj/pesquisar
 * 
 * Características:
 * - Sistema SIGPub da Vox Tecnologia
 * - Sistema centralizado estadual (AEMERJ)
 * - Municípios do RJ publicam no mesmo sistema
 * - Download direto via URL do storage
 * - Filtro por entidade (município)
 * 
 * Municípios participantes (conforme dropdown do site):
 * - Prefeitura Municipal de Aperibé
 * - Prefeitura Municipal de Areal
 * - Prefeitura Municipal de Bom Jesus do Itabapoana
 * - Prefeitura Municipal de Duas Barras
 * - Prefeitura Municipal de Engenheiro Paulo de Frontin
 * - Prefeitura Municipal de Mendes
 * - Prefeitura Municipal de Mesquita
 * - Prefeitura Municipal de Pinheiral
 * - Prefeitura Municipal de Valença
 * - Prefeitura Municipal de Vassouras
 */
export class AemerjSpider extends BaseSpider {
  protected aemerjConfig: AemerjConfig;
  private readonly BASE_URL = 'https://www.diariomunicipal.com.br/aemerj';

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.aemerjConfig = spiderConfig.config as AemerjConfig;
    
    logger.info(`Initializing AemerjSpider for ${spiderConfig.name} (AEMERJ) - Entity: ${this.aemerjConfig.entityName}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling AEMERJ (RJ) for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    
    try {
      // Iterate through each date in the range
      const currentDate = new Date(this.startDate);
      const endDate = new Date(this.endDate);
      
      while (currentDate <= endDate) {
        const dateStr = this.formatDate(currentDate);
        const dayGazettes = await this.getGazettesForDate(dateStr, currentDate);
        gazettes.push(...dayGazettes);
        
        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      logger.info(`Found ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      return gazettes;
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error);
      return [];
    }
  }

  /**
   * Get gazettes for a specific date by fetching the calendar page
   */
  private async getGazettesForDate(dateStr: string, date: Date): Promise<Gazette[]> {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    
    // The AEMERJ site uses a calendar-based navigation
    // We fetch the main page and extract PDF links for the specific date
    const url = `${this.BASE_URL}/?dia=${day}&mes=${month}&ano=${year}`;
    
    try {
      logger.debug(`Fetching AEMERJ page for ${dateStr}: ${url}`);
      
      const response = await this.fetch(url);
      const gazettes: Gazette[] = [];
      
      // Extract PDF URLs from the HTML
      // Pattern: https://www-storage.voxtecnologia.com.br/?m=sigpub.publicacao&f=XXX&i=publicado_XXX_YYYY-MM-DD_hash.pdf
      const pdfUrlRegex = /https:\/\/www-storage\.voxtecnologia\.com\.br\/\?m=sigpub\.publicacao&amp;f=\d+&amp;i=publicado_\d+_(\d{4}-\d{2}-\d{2})_[a-f0-9]+\.pdf/g;
      const pdfUrlRegex2 = /https:\/\/www-storage\.voxtecnologia\.com\.br\/\?m=sigpub\.publicacao&f=\d+&i=publicado_\d+_(\d{4}-\d{2}-\d{2})_[a-f0-9]+\.pdf/g;
      
      const foundUrls = new Set<string>();
      
      // Try both patterns (with and without HTML encoding)
      for (const regex of [pdfUrlRegex, pdfUrlRegex2]) {
        const matches = response.matchAll(regex);
        
        for (const match of matches) {
          let pdfUrl = match[0];
          const pdfDateStr = match[1];
          
          // Decode HTML entities
          pdfUrl = pdfUrl.replace(/&amp;/g, '&');
          
          // Check if the date matches what we're looking for
          if (pdfDateStr === dateStr && !foundUrls.has(pdfUrl)) {
            foundUrls.add(pdfUrl);
            
            const gazette = await this.createGazette(date, pdfUrl, {
              editionNumber: this.extractEditionNumber(pdfUrl),
              power: this.aemerjConfig.power || 'executive_legislative',
              sourceText: `AEMERJ - ${this.aemerjConfig.entityName}`
            });
            
            if (gazette) {
              gazettes.push(gazette);
            }
          }
        }
      }
      
      if (gazettes.length > 0) {
        logger.debug(`Found ${gazettes.length} gazettes for ${dateStr}`);
      }
      
      return gazettes;
      
    } catch (error) {
      logger.error(`Error fetching gazettes for ${dateStr}:`, error);
      return [];
    }
  }

  /**
   * Extract edition number from URL
   */
  private extractEditionNumber(url: string): string {
    // Try to extract the edition ID from the URL
    // Pattern: publicado_EDITION_DATE_hash.pdf
    const match = url.match(/publicado_(\d+)_/);
    return match ? match[1] : 'N/A';
  }

  /**
   * Format date for API call (YYYY-MM-DD)
   */
  private formatDate(date: Date): string {
    return toISODate(date);
  }

  /**
   * Get API information for debugging/testing
   */
  async getApiInfo(): Promise<any> {
    try {
      const response = await this.fetch(this.BASE_URL);
      return {
        baseUrl: this.BASE_URL,
        entityName: this.aemerjConfig.entityName,
        htmlLength: response.length
      };
    } catch (error) {
      logger.error('Error getting API info:', error);
      return null;
    }
  }
}
