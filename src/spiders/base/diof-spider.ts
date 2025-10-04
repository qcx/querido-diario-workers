import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, DiofConfig } from '../../types';
import { logger } from '../../utils/logger';

/**
 * BaseDiofSpider implementation for Cloudflare Workers
 * 
 * DIOF is a centralized platform used by many Brazilian municipalities.
 * The platform has a multi-step process:
 * 
 * 1. Extract client_id from the website (3 different methods depending on the site type)
 * 2. Call the API with monthly intervals to get gazette data
 * 3. Try to download from the new API, fallback to old API if needed
 * 
 * API URL: https://diof.io.org.br/api
 */
export class DiofSpider extends BaseSpider {
  protected diofConfig: DiofConfig;
  private clientId?: string;
  private readonly API_URL = 'https://diof.io.org.br/api';

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.diofConfig = spiderConfig.config as DiofConfig;
    
    if (!this.diofConfig.website) {
      throw new Error(`DiofSpider requires a website in config for ${spiderConfig.name}`);
    }
    
    if (!this.diofConfig.power) {
      throw new Error(`DiofSpider requires a power in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing DiofSpider for ${spiderConfig.name} with website: ${this.diofConfig.website}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.diofConfig.website} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Step 1: Get client ID
      await this.getClientId();
      
      if (!this.clientId) {
        logger.error(`Could not extract client_id for ${this.spiderConfig.name}`);
        return gazettes;
      }
      
      logger.info(`Extracted client_id: ${this.clientId}`);
      
      // Step 2: Generate monthly intervals
      const intervals = this.generateMonthlyIntervals();
      logger.info(`Generated ${intervals.length} monthly intervals`);
      
      // Step 3: Fetch gazettes for each interval
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
   * Extract client_id from the website
   * Supports 3 different methods:
   * 1. Direct DIOF site: call API
   * 2. SAI site: extract from iframe
   * 3. IMAP site: extract from URL
   */
  private async getClientId(): Promise<void> {
    const website = this.diofConfig.website;
    
    if (website.includes('sai.io')) {
      // Method 2: SAI site - extract from iframe
      logger.info(`Extracting client_id from SAI site`);
      const html = await this.fetch(website);
      const iframeMatch = html.match(/src="[^"]*[?&]c=(\d+)/);
      if (iframeMatch) {
        this.clientId = iframeMatch[1];
      }
    } else if (website.includes('dom.imap')) {
      // Method 3: IMAP site - extract from URL parameter
      logger.info(`Extracting client_id from IMAP site`);
      const urlMatch = website.match(/varCodigo=(\d+)/);
      if (urlMatch) {
        this.clientId = urlMatch[1];
      }
    } else {
      // Method 1: Direct DIOF site - call API
      logger.info(`Extracting client_id from DIOF API`);
      try {
        const apiUrl = `${this.API_URL}/dados-cliente/info/`;
        const response = await fetch(apiUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'Origin': website,
            'Referer': website,
          },
        });
        
        if (response.ok) {
          const data = await response.json() as { cod_cliente: string };
          this.clientId = data.cod_cliente;
        } else {
          logger.warn(`API returned status ${response.status}, trying to extract from page`);
          // Fallback: try to extract from page HTML
          const html = await this.fetch(website);
          const clientMatch = html.match(/cod_cliente['":\s]+(\d+)/);
          if (clientMatch) {
            this.clientId = clientMatch[1];
          }
        }
      } catch (error) {
        logger.error(`Error calling DIOF API:`, error as Error);
      }
    }
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
        cod_cliente: this.clientId,
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
        },
        body: JSON.stringify(body),
      });
      
      if (!response.ok) {
        logger.warn(`API returned status ${response.status} for interval ${interval.start} to ${interval.end}`);
        return gazettes;
      }
      
      const data = await response.json() as Array<{ elements: Array<{
        dat_envio: string;
        des_arquivoa4: string;
        cod_documento: string;
      }> }>;
      
      // Process each gazette date group
      for (const dateGroup of data) {
        for (const gazette of dateGroup.elements) {
          const parsedGazette = await this.parseGazetteItem(gazette);
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
  }): Promise<Gazette | null> {
    try {
      // Parse date
      const gazetteDate = new Date(item.dat_envio);
      
      // Check if date is in range
      if (!this.isInDateRange(gazetteDate)) {
        return null;
      }
      
      // Try new API URL first
      const primaryUrl = `${this.API_URL}/diario-oficial/download/${item.des_arquivoa4}.pdf`;
      
      // Fallback URL (old SAI API)
      const fallbackUrl = `https://sai.io.org.br/Handler.ashx?f=diario&query=${item.cod_documento}&c=${this.clientId}&m=0`;
      
      // Test if primary URL works
      let fileUrl = primaryUrl;
      try {
        const testResponse = await fetch(primaryUrl, { method: 'HEAD' });
        if (!testResponse.ok) {
          logger.debug(`Primary URL failed, using fallback for document ${item.cod_documento}`);
          fileUrl = fallbackUrl;
        }
      } catch (error) {
        logger.debug(`Primary URL test failed, using fallback for document ${item.cod_documento}`);
        fileUrl = fallbackUrl;
      }
      
      return this.createGazette(gazetteDate, fileUrl, {
        editionNumber: item.cod_documento,
        isExtraEdition: false,
        power: this.diofConfig.power,
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
