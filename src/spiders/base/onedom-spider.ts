import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Configuration for 1DOM platform spider
 */
export interface OnedomConfig {
  type: 'onedom';
  /** Base URL for the 1DOM platform (e.g., "https://araraquara.1dom.com.br") */
  baseUrl: string;
}

/**
 * Spider for 1DOM platform
 * Used by municipalities like Araraquara and Pindamonhangaba
 * 
 * Site structure:
 * - Calendar-based date picker
 * - Search form with keyword and date filters
 * - AJAX-based content loading
 * - PDF download links for each edition
 */
export class OnedomSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as OnedomConfig;
    this.baseUrl = platformConfig.baseUrl;
    
    if (!this.baseUrl) {
      throw new Error(`OnedomSpider requires baseUrl in config for ${config.name}`);
    }
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling 1DOM for ${this.config.name}...`);

    try {
      // 1DOM uses an API endpoint for searching
      // The format is typically: /api/publicacoes or /busca
      const apiUrl = `${this.baseUrl}/api/publicacoes`;
      
      // Iterate through each day in the date range
      const currentDate = new Date(this.startDate);
      const endDate = new Date(this.endDate);
      
      while (currentDate <= endDate) {
        try {
          const dayGazettes = await this.crawlDay(currentDate);
          gazettes.push(...dayGazettes);
          
          if (dayGazettes.length > 0) {
            logger.info(`Found ${dayGazettes.length} gazette(s) for ${toISODate(currentDate)}`);
          }
        } catch (error) {
          logger.error(`Error crawling date ${toISODate(currentDate)}:`, error as Error);
        }
        
        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1);
        
        // Add delay between requests
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from 1DOM`);
    } catch (error) {
      logger.error(`Error crawling 1DOM: ${error}`);
      throw error;
    }

    return gazettes;
  }

  /**
   * Crawl gazettes for a specific day
   */
  private async crawlDay(date: Date): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      const formattedDate = toISODate(date);
      
      // Try different API endpoints
      const endpoints = [
        `${this.baseUrl}/api/publicacoes?data=${formattedDate}`,
        `${this.baseUrl}/busca?data_inicio=${formattedDate}&data_fim=${formattedDate}`,
        `${this.baseUrl}?data=${formattedDate}`,
      ];
      
      for (const url of endpoints) {
        try {
          logger.debug(`Trying endpoint: ${url}`);
          const response = await fetch(url, {
            headers: {
              'Accept': 'application/json, text/html',
              'X-Requested-With': 'XMLHttpRequest',
            },
          });
          this.requestCount++;
          
          if (!response.ok) {
            continue;
          }

          const contentType = response.headers.get('content-type') || '';
          
          if (contentType.includes('application/json')) {
            // Parse JSON response
            const data = await response.json();
            const jsonGazettes = await this.parseJsonResponse(data, date);
            if (jsonGazettes.length > 0) {
              gazettes.push(...jsonGazettes);
              break;
            }
          } else {
            // Parse HTML response
            const html = await response.text();
            const htmlGazettes = await this.parseHtmlResponse(html, date);
            if (htmlGazettes.length > 0) {
              gazettes.push(...htmlGazettes);
              break;
            }
          }
        } catch (error) {
          logger.debug(`Endpoint ${url} failed:`, error as Error);
          continue;
        }
      }
      
    } catch (error) {
      logger.error(`Error in crawlDay for ${toISODate(date)}:`, error as Error);
    }
    
    return gazettes;
  }

  /**
   * Parse JSON API response
   */
  private async parseJsonResponse(data: any, date: Date): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Handle different response structures
      const items = data.data || data.items || data.publicacoes || (Array.isArray(data) ? data : []);
      
      for (const item of items) {
        // Extract fields from the item
        const pdfUrl = item.arquivo || item.pdf || item.url || item.link;
        const editionNumber = item.numero || item.edicao || item.edition;
        const isExtra = item.tipo === 'extraordinaria' || item.extra || false;
        
        if (pdfUrl) {
          let fullPdfUrl = pdfUrl;
          if (!fullPdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.baseUrl);
            fullPdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }
          
          const gazette = await this.createGazette(date, fullPdfUrl, {
            editionNumber: editionNumber?.toString(),
            isExtraEdition: isExtra,
            power: 'executive_legislative',
          });
          
          if (gazette) {
            gazettes.push(gazette);
          }
        }
      }
    } catch (error) {
      logger.error('Error parsing JSON response:', error as Error);
    }
    
    return gazettes;
  }

  /**
   * Parse HTML response
   */
  private async parseHtmlResponse(html: string, date: Date): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      const dateStr = this.formatDateDisplay(date);
      
      // Look for links with edition patterns
      const patterns = [
        // Pattern: href="...pdf" with nearby date
        /<a[^>]+href="([^"]+\.pdf[^"]*)"[^>]*>([^<]*)<\/a>/gi,
        // Pattern: data-url with PDF
        /data-url="([^"]+\.pdf[^"]*)"/gi,
        // Pattern: download link
        /<a[^>]+href="([^"]+)"[^>]*download[^>]*>/gi,
      ];
      
      for (const pattern of patterns) {
        const matches = html.matchAll(pattern);
        
        for (const match of matches) {
          const url = match[1];
          const linkText = match[2] || '';
          
          // Check if this link is for the target date
          const dateInUrl = toISODate(date).replace(/-/g, '');
          const dateFormatted = dateStr.replace(/\//g, '');
          
          if (url.includes(dateInUrl) || url.includes(dateFormatted) || 
              linkText.includes(dateStr) || html.includes(dateStr)) {
            
            let fullUrl = url;
            if (!fullUrl.startsWith('http')) {
              const baseUrlObj = new URL(this.baseUrl);
              fullUrl = `${baseUrlObj.origin}${url.startsWith('/') ? '' : '/'}${url}`;
            }
            
            // Extract edition number if available
            const editionMatch = linkText.match(/[Ee]di[çc][ãa]o\s*n?[°º]?\s*(\d+)/i);
            const editionNumber = editionMatch ? editionMatch[1] : undefined;
            
            const gazette = await this.createGazette(date, fullUrl, {
              editionNumber,
              isExtraEdition: linkText.toLowerCase().includes('extra'),
              power: 'executive_legislative',
            });
            
            if (gazette) {
              gazettes.push(gazette);
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error parsing HTML response:', error as Error);
    }
    
    return gazettes;
  }

  /**
   * Format date for display (DD/MM/YYYY)
   */
  private formatDateDisplay(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }
}

