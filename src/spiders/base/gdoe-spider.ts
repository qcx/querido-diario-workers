import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Configuration for GDOE platform spider
 */
export interface GdoeConfig {
  type: 'gdoe';
  /** Base URL for the GDOE platform (e.g., "https://www.gdoe.com.br/assis") */
  baseUrl: string;
}

/**
 * Spider for GDOE platform (Ordem Pública Tecnologia)
 * Used by municipalities like Assis and Artur Nogueira
 * 
 * Site structure:
 * - List of gazettes with links containing date and edition info
 * - Pattern: "DD/MM/YYYY - Ano XX Edição nº XXXX (X páginas)"
 * - PDF links available on detail pages
 * - Search by date and keyword supported
 */
export class GdoeSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as GdoeConfig;
    this.baseUrl = platformConfig.baseUrl;
    
    if (!this.baseUrl) {
      throw new Error(`GdoeSpider requires baseUrl in config for ${config.name}`);
    }
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling GDOE for ${this.config.name}...`);

    try {
      // Iterate through each day in the date range
      const currentDate = new Date(this.startDate);
      const endDate = new Date(this.endDate);
      
      while (currentDate <= endDate) {
        try {
          const formattedDate = this.formatDateForApi(currentDate);
          const dayGazettes = await this.crawlDay(currentDate, formattedDate);
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

      logger.info(`Successfully crawled ${gazettes.length} gazettes from GDOE`);
    } catch (error) {
      logger.error(`Error crawling GDOE: ${error}`);
      throw error;
    }

    return gazettes;
  }

  /**
   * Crawl gazettes for a specific day
   */
  private async crawlDay(date: Date, formattedDate: string): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // GDOE uses search by date
      const searchUrl = `${this.baseUrl}?data=${formattedDate}`;
      
      logger.debug(`Fetching: ${searchUrl}`);
      const response = await fetch(searchUrl);
      this.requestCount++;
      
      if (!response.ok) {
        logger.warn(`Failed to fetch page: ${response.status}`);
        return gazettes;
      }

      const html = await response.text();
      
      // Find gazette links with date pattern
      // Pattern: DD/MM/YYYY - Ano XX Edição nº XXXX
      const dateStr = this.formatDateDisplay(date);
      const escapedDate = dateStr.replace(/\//g, '\\/');
      
      // Look for links containing the date
      const linkPattern = new RegExp(
        `<a[^>]+href="([^"]+)"[^>]*>[^<]*${escapedDate}[^<]*Edi[çc][ãa]o\\s+n[°º]?\\s*(\\d+)`,
        'gi'
      );
      
      const matches = html.matchAll(linkPattern);
      
      for (const match of matches) {
        const linkUrl = match[1];
        const editionNumber = match[2];
        
        // Resolve relative URLs
        let fullUrl = linkUrl;
        if (!fullUrl.startsWith('http')) {
          const baseUrlObj = new URL(this.baseUrl);
          fullUrl = `${baseUrlObj.origin}${fullUrl.startsWith('/') ? '' : '/'}${fullUrl}`;
        }
        
        // Fetch detail page to get PDF URL
        try {
          const pdfUrl = await this.extractPdfUrl(fullUrl);
          
          if (pdfUrl) {
            // Check if extra edition
            const isExtraEdition = linkUrl.toLowerCase().includes('extra') || 
                                   editionNumber.includes('-') ||
                                   editionNumber.includes('A');
            
            const gazette = await this.createGazette(date, pdfUrl, {
              editionNumber: editionNumber.replace(/[^0-9]/g, ''),
              isExtraEdition,
              power: 'executive_legislative',
            });
            
            if (gazette) {
              gazettes.push(gazette);
            }
          }
        } catch (error) {
          logger.warn(`Failed to extract PDF from ${fullUrl}:`, error as Error);
        }
        
        // Add delay between requests
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      // Alternative: look for date in link text without edition pattern
      if (gazettes.length === 0) {
        // Try simple link extraction
        const simpleLinkPattern = /<a[^>]+href="([^"]+\.pdf[^"]*)"[^>]*>/gi;
        const simpleMatches = html.matchAll(simpleLinkPattern);
        
        for (const match of simpleMatches) {
          const pdfUrl = match[1];
          let fullPdfUrl = pdfUrl;
          if (!fullPdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.baseUrl);
            fullPdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }
          
          // Check if this PDF matches the date
          const dateInUrl = toISODate(date).replace(/-/g, '');
          if (fullPdfUrl.includes(dateInUrl) || fullPdfUrl.includes(dateStr.replace(/\//g, ''))) {
            const gazette = await this.createGazette(date, fullPdfUrl, {
              power: 'executive_legislative',
            });
            
            if (gazette) {
              gazettes.push(gazette);
            }
          }
        }
      }
      
    } catch (error) {
      logger.error(`Error in crawlDay for ${toISODate(date)}:`, error as Error);
    }
    
    return gazettes;
  }

  /**
   * Extract PDF URL from detail page
   */
  private async extractPdfUrl(detailUrl: string): Promise<string | null> {
    try {
      const response = await fetch(detailUrl);
      this.requestCount++;
      
      if (!response.ok) {
        return null;
      }

      const html = await response.text();
      
      // Look for PDF download link
      // Common patterns: href="...pdf", data-href="...pdf", onclick with PDF
      const pdfPatterns = [
        /href="([^"]+\.pdf[^"]*)"/gi,
        /data-href="([^"]+\.pdf[^"]*)"/gi,
        /window\.open\(['"]([^'"]+\.pdf[^'"]*)['"]/gi,
      ];
      
      for (const pattern of pdfPatterns) {
        const match = pattern.exec(html);
        if (match) {
          let pdfUrl = match[1];
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }
          return pdfUrl;
        }
      }
      
      return null;
    } catch (error) {
      logger.warn(`Failed to extract PDF URL from ${detailUrl}:`, error as Error);
      return null;
    }
  }

  /**
   * Format date for API search (DD/MM/YYYY)
   */
  private formatDateForApi(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }

  /**
   * Format date for display matching (DD/MM/YYYY)
   */
  private formatDateDisplay(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }
}

