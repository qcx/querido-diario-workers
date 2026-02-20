import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraPauloAfonsoConfig } from '../../types';
import { logger } from '../../utils/logger';

/**
 * PrefeituraPauloAfonsoSpider implementation
 * 
 * Crawls gazette data from Paulo Afonso, BA using the DIOF API.
 * 
 * System: diario.io.org.br
 * API: https://diof.io.org.br/api/
 * Client ID: 587
 * 
 * The API uses POST requests with monthly date intervals to fetch gazette data.
 * PDF downloads are available from the new API URL pattern.
 */
export class PrefeituraPauloAfonsoSpider extends BaseSpider {
  protected pauloAfonsoConfig: PrefeituraPauloAfonsoConfig;
  private readonly API_URL = 'https://diof.io.org.br/api';

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.pauloAfonsoConfig = spiderConfig.config as PrefeituraPauloAfonsoConfig;
    
    if (!this.pauloAfonsoConfig.clientId) {
      throw new Error(`PrefeituraPauloAfonsoSpider requires clientId in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraPauloAfonsoSpider for ${spiderConfig.name} with clientId: ${this.pauloAfonsoConfig.clientId}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling Paulo Afonso gazette for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Generate monthly intervals
      const intervals = this.generateMonthlyIntervals();
      logger.info(`Generated ${intervals.length} monthly intervals`);
      
      // Fetch gazettes for each interval
      for (const interval of intervals) {
        const intervalGazettes = await this.fetchGazettesForInterval(interval);
        gazettes.push(...intervalGazettes);
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Generate monthly intervals for the date range
   */
  private generateMonthlyIntervals(): Array<{ start: string; end: string }> {
    const intervals: Array<{ start: string; end: string }> = [];
    const startDate = new Date(this.dateRange.start);
    const endDate = new Date(this.dateRange.end);
    
    let currentStart = new Date(startDate);
    
    while (currentStart <= endDate) {
      // Calculate end of current month or end date, whichever is earlier
      const currentEnd = new Date(currentStart.getFullYear(), currentStart.getMonth() + 1, 0);
      const intervalEnd = currentEnd > endDate ? endDate : currentEnd;
      
      intervals.push({
        start: this.formatISODate(currentStart),
        end: this.formatISODate(intervalEnd),
      });
      
      // Move to next month
      currentStart = new Date(currentStart.getFullYear(), currentStart.getMonth() + 1, 1);
    }
    
    return intervals;
  }

  /**
   * Fetch gazettes for a specific interval
   */
  private async fetchGazettesForInterval(interval: { start: string; end: string }): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      logger.info(`Fetching gazettes for interval: ${interval.start} to ${interval.end}`);
      
      const apiUrl = `${this.API_URL}/diario-oficial/edicoes-anteriores-group`;
      const body = {
        cod_cliente: this.pauloAfonsoConfig.clientId.toString(),
        dat_envio_ini: interval.start,
        dat_envio_fim: interval.end,
        des_observacao: '',
        edicao: null,
      };
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Origin': 'https://diario.io.org.br',
          'Referer': 'https://diario.io.org.br/',
        },
        body: JSON.stringify(body),
      });
      
      if (!response.ok) {
        logger.warn(`API returned status ${response.status} for interval ${interval.start} to ${interval.end}`);
        return gazettes;
      }
      
      const apiResponse = await response.json() as {
        data: Array<{
          key: string;
          elements: Array<{
            dat_envio: string;
            des_arquivoa4: string;
            cod_documento: string;
            num_edicao?: number;
          }>
        }>;
        page: number | null;
        pages: number;
        count: number;
      };
      
      // Check if we have data
      if (!apiResponse.data || !Array.isArray(apiResponse.data)) {
        logger.warn(`No data returned from API for interval ${interval.start} to ${interval.end}`);
        return gazettes;
      }
      
      // Process each gazette date group
      for (const dateGroup of apiResponse.data) {
        for (const gazetteItem of dateGroup.elements) {
          const parsedGazette = await this.parseGazetteItem(gazetteItem);
          if (parsedGazette) {
            gazettes.push(parsedGazette);
          }
        }
      }
      
    } catch (error) {
      logger.error(`Error fetching gazettes for interval:`, error as Error);
    }
    
    return gazettes;
  }

  /**
   * Parse a single gazette item from the API response
   */
  private async parseGazetteItem(item: {
    dat_envio: string;
    des_arquivoa4: string;
    cod_documento: string;
    num_edicao?: number;
  }): Promise<Gazette | null> {
    try {
      // Parse date
      const gazetteDate = new Date(item.dat_envio);
      
      // Check if date is in range
      if (!this.isInDateRange(gazetteDate)) {
        return null;
      }
      
      // Build PDF URL - use the new API URL pattern
      const fileUrl = `${this.API_URL}/diario-oficial/download/${item.des_arquivoa4}.pdf`;
      
      return await this.createGazette(gazetteDate, fileUrl, {
        editionNumber: item.num_edicao?.toString() || item.cod_documento,
        isExtraEdition: false,
        power: this.pauloAfonsoConfig.power,
      });
      
    } catch (error) {
      logger.error(`Error parsing gazette item:`, error as Error);
      return null;
    }
  }

  /**
   * Format date as YYYY-MM-DD for DIOF API
   */
  private formatISODate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
