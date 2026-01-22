import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraRioDeJaneiroConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';
// @ts-ignore
import { parse } from 'node-html-parser';

/**
 * PrefeituraRioDeJaneiroSpider for Rio de Janeiro, RJ
 * 
 * Site Structure:
 * - URL: https://doweb.rio.rj.gov.br/
 * - The page contains embedded JSON data in JavaScript variables:
 *   - DADOS_ULTIMAS_EDICOES: Array of recent editions
 *   - DADOS_ULTIMA_DATA: Latest edition data
 * - Each edition has: id, data (DD/MM/YYYY), suplemento, numero, tipo_edicao_id, etc.
 * - PDF URL pattern: /portal/edicoes/download/{id}
 */
export class PrefeituraRioDeJaneiroSpider extends BaseSpider {
  protected rioConfig: PrefeituraRioDeJaneiroConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.rioConfig = spiderConfig.config as PrefeituraRioDeJaneiroConfig;
    
    if (!this.rioConfig.baseUrl) {
      throw new Error(`PrefeituraRioDeJaneiroSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraRioDeJaneiroSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.rioConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    
    try {
      // Fetch the main page
      const html = await this.fetch(this.rioConfig.baseUrl);
      this.requestCount++;
      
      // Extract JSON data from JavaScript variables
      const dadosUltimasEdicoesMatch = html.match(/let DADOS_ULTIMAS_EDICOES = ({[^;]+});/);
      const dadosUltimaDataMatch = html.match(/let DADOS_ULTIMA_DATA = ({[^;]+});/);
      
      let allEditions: any[] = [];
      
      if (dadosUltimasEdicoesMatch) {
        try {
          const jsonStr = dadosUltimasEdicoesMatch[1].replace(/'/g, '"');
          const data = JSON.parse(jsonStr);
          if (data.itens && Array.isArray(data.itens)) {
            allEditions.push(...data.itens);
          }
        } catch (error) {
          logger.warn(`Failed to parse DADOS_ULTIMAS_EDICOES: ${error}`);
        }
      }
      
      if (dadosUltimaDataMatch) {
        try {
          const jsonStr = dadosUltimaDataMatch[1].replace(/'/g, '"');
          const data = JSON.parse(jsonStr);
          if (data.itens && Array.isArray(data.itens)) {
            allEditions.push(...data.itens);
          }
        } catch (error) {
          logger.warn(`Failed to parse DADOS_ULTIMA_DATA: ${error}`);
        }
      }
      
      logger.debug(`Found ${allEditions.length} editions in embedded JSON`);
      
      // Process each edition
      const processedIds = new Set<string>();
      
      for (const edition of allEditions) {
        try {
          if (!edition.id || processedIds.has(edition.id)) {
            continue;
          }
          
          processedIds.add(edition.id);
          
          // Parse date (DD/MM/YYYY)
          const dateParts = edition.data.split('/');
          if (dateParts.length !== 3) {
            logger.warn(`Invalid date format: ${edition.data}`);
            continue;
          }
          
          const [day, month, year] = dateParts;
          const gazetteDate = new Date(`${year}-${month}-${day}`);
          
          if (isNaN(gazetteDate.getTime())) {
            logger.warn(`Invalid date: ${edition.data}`);
            continue;
          }
          
          // Filter by date range
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }
          
          // Construct PDF URL
          const baseUrlObj = new URL(this.rioConfig.baseUrl);
          const pdfUrl = `${baseUrlObj.origin}/portal/edicoes/download/${edition.id}`;
          
          // Check if it's an extra edition (suplemento)
          const isExtraEdition = edition.suplemento && edition.suplemento.trim() !== '';
          
          // Create gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            power: 'executive_legislative',
            editionNumber: edition.numero?.toString(),
            isExtraEdition,
            sourceText: edition.suplemento_nome || edition.tipo_edicao_nome || '',
          });
          
          if (gazette) {
            gazettes.push(gazette);
            logger.debug(`Found gazette for ${toISODate(gazetteDate)}: ${pdfUrl}`);
          }
        } catch (error) {
          logger.error(`Error processing edition ${edition.id}:`, error as Error);
        }
      }
      
      // If we didn't get enough data from embedded JSON, try fetching more
      // by making requests for dates in the range
      if (gazettes.length === 0) {
        logger.info('No gazettes found in embedded JSON, trying date-based search...');
        
        const currentDate = new Date(this.startDate);
        const endDate = new Date(this.endDate);
        
        while (currentDate <= endDate) {
          try {
            const dayGazettes = await this.fetchGazettesForDate(currentDate);
            gazettes.push(...dayGazettes);
          } catch (error) {
            logger.error(`Error fetching gazettes for ${toISODate(currentDate)}:`, error as Error);
          }
          
          currentDate.setDate(currentDate.getDate() + 1);
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }
    
    return gazettes;
  }
  
  /**
   * Fetch gazettes for a specific date by making a POST request
   */
  private async fetchGazettesForDate(date: Date): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      const dateStr = `${day}/${month}/${year}`;
      
      // The site uses POST to /buscanova with dataEdicaoPortal parameter
      const baseUrlObj = new URL(this.rioConfig.baseUrl);
      const searchUrl = `${baseUrlObj.origin}/buscanova/`;
      
      const formData = new URLSearchParams();
      formData.append('dataEdicaoPortal', dateStr);
      
      const response = await fetch(searchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (compatible; GoodFellowBot/1.0)',
        },
        body: formData.toString(),
        signal: AbortSignal.timeout(30000),
      });
      this.requestCount++;
      
      if (!response.ok) {
        logger.debug(`Failed to fetch gazettes for ${dateStr}: ${response.status}`);
        return gazettes;
      }
      
      const html = await response.text();
      const root = parse(html);
      
      // Look for PDF download links
      const pdfLinks = root.querySelectorAll('a[href*="/portal/edicoes/download/"], a[href*="download"]');
      
      for (const link of pdfLinks) {
        try {
          const href = link.getAttribute('href');
          if (!href) continue;
          
          const baseUrlObj = new URL(this.rioConfig.baseUrl);
          const pdfUrl = href.startsWith('http') 
            ? href 
            : `${baseUrlObj.origin}${href.startsWith('/') ? '' : '/'}${href}`;
          
          const gazette = await this.createGazette(date, pdfUrl, {
            power: 'executive_legislative',
          });
          
          if (gazette) {
            gazettes.push(gazette);
          }
        } catch (error) {
          logger.error(`Error processing PDF link:`, error as Error);
        }
      }
    } catch (error) {
      logger.error(`Error fetching gazettes for date:`, error as Error);
    }
    
    return gazettes;
  }
}
