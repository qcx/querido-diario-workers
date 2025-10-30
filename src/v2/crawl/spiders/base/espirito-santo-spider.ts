import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, EspiritoSantoConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Spider para o Diário Oficial dos Municípios do Espírito Santo (DOM - AMUNES)
 * 
 * Este spider coleta diários oficiais do sistema centralizado da AMUNES
 * (Associação dos Municípios do Espírito Santo) através de API estruturada.
 * 
 * API: https://ioes.dio.es.gov.br/apifront/portal/edicoes/edicoes_from_data/
 * Download: https://ioes.dio.es.gov.br/portal/edicoes/download/
 * 
 * Características:
 * - API JSON estruturada por data
 * - Sistema centralizado estadual (AMUNES)
 * - Todos os 78 municípios do ES publicam no mesmo sistema
 * - Download direto por ID da edição
 * - Informações completas: número, páginas, data, etc.
 */
export class EspiritoSantoSpider extends BaseSpider {
  protected espiritoSantoConfig: EspiritoSantoConfig;
  private readonly API_BASE_URL = 'https://ioes.dio.es.gov.br/apifront/portal/edicoes/edicoes_from_data';
  private readonly DOWNLOAD_BASE_URL = 'https://ioes.dio.es.gov.br/portal/edicoes/download';

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.espiritoSantoConfig = spiderConfig.config as EspiritoSantoConfig;
    
    logger.info(`Initializing EspiritoSantoSpider for ${spiderConfig.name} (DOM - AMUNES)`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling DOM - AMUNES (ES) for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    
    try {
      // Iterate through each date in the range
      const currentDate = new Date(this.startDate);
      const endDate = new Date(this.endDate);
      
      while (currentDate <= endDate) {
        const dateStr = this.formatDate(currentDate);
        const dayGazettes = await this.getGazettesForDate(dateStr);
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
   * Get gazettes for a specific date
   */
  private async getGazettesForDate(dateStr: string): Promise<Gazette[]> {
    const url = `${this.API_BASE_URL}/${dateStr}.json?&subtheme=dom`;
    
    try {
      logger.debug(`Fetching API data for ${dateStr}: ${url}`);
      
      const response = await this.fetch(url);
      const data = JSON.parse(response);
      
      if (data.erro) {
        if (data.msg !== "Edição não existente!") {
          logger.debug(`API returned error for ${dateStr}: ${data.msg}`);
        }
        return [];
      }
      
      const gazettes: Gazette[] = [];
      
      if (data.itens && Array.isArray(data.itens)) {
        for (const item of data.itens) {
          if (this.isValidEdition(item)) {
            const gazette = await this.createGazetteFromItem(item, dateStr);
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
   * Check if an edition item is valid (DOM - AMUNES type)
   */
  private isValidEdition(item: any): boolean {
    return (
      item &&
      item.id &&
      item.tipo_edicao_nome &&
      item.tipo_edicao_nome.includes('DOM - AMUNES')
    );
  }

  /**
   * Create a Gazette object from API item
   */
  private async createGazetteFromItem(item: any, dateStr: string): Promise<Gazette | null> {
    try {
      const downloadUrl = `${this.DOWNLOAD_BASE_URL}/${item.id}`;
      const date = this.parseDate(item.data || dateStr);
      
      if (!date) {
        logger.error(`Could not parse date for item ${item.id}`);
        return null;
      }
      
      return await this.createGazette(date, downloadUrl, {
        editionNumber: item.numero?.toString(),
        power: this.espiritoSantoConfig.power || 'executive_legislative',
        sourceText: `${item.tipo_edicao_nome} - ${item.paginas} páginas`
      });
      
    } catch (error) {
      logger.error(`Error creating gazette from item ${item.id}:`, error);
      return null;
    }
  }

  /**
   * Format date for API call (YYYY-MM-DD)
   */
  private formatDate(date: Date): string {
    return toISODate(date);
  }

  /**
   * Parse date from Brazilian format (DD/MM/YYYY) or ISO format
   */
  private parseDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    
    // Try Brazilian format first (DD/MM/YYYY)
    const brMatch = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (brMatch) {
      const [, day, month, year] = brMatch;
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }
    
    // Try ISO format (YYYY-MM-DD)
    const isoMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      const [, year, month, day] = isoMatch;
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }
    
    return null;
  }

  /**
   * Get API information for debugging/testing
   */
  async getApiInfo(): Promise<any> {
    const today = this.formatDate(new Date());
    const url = `${this.API_BASE_URL}/${today}.json?&subtheme=dom`;
    
    try {
      const response = await this.fetch(url);
      return JSON.parse(response);
    } catch (error) {
      logger.error('Error getting API info:', error);
      return null;
    }
  }
}
