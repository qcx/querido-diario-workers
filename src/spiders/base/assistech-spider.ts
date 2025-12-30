import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Configuration for Assistech platform spider
 */
export interface AssistechConfig {
  type: 'assistech';
  /** Base URL for the Assistech platform (e.g., "https://assistechpublicacoes.com.br/app/pmararassp/diario-oficial") */
  baseUrl: string;
}

/**
 * Spider for Assistech Publicações platform
 * Used by municipalities like Araras
 * 
 * Site structure:
 * - List of official gazette editions
 * - PDF download links for each edition
 * - Date-based organization
 */
export class AssistechSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as AssistechConfig;
    this.baseUrl = platformConfig.baseUrl;
    
    if (!this.baseUrl) {
      throw new Error(`AssistechSpider requires baseUrl in config for ${config.name}`);
    }
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Assistech for ${this.config.name}...`);

    try {
      // Fetch the main page
      logger.debug(`Fetching: ${this.baseUrl}`);
      const response = await fetch(this.baseUrl);
      this.requestCount++;
      
      if (!response.ok) {
        logger.error(`Failed to fetch page: ${response.status}`);
        return gazettes;
      }

      const html = await response.text();
      
      // Parse gazette listings
      const gazetteLinks = await this.extractGazetteLinks(html);
      
      // Filter by date range and create gazette objects
      for (const link of gazetteLinks) {
        if (this.isInDateRange(link.date)) {
          const gazette = await this.createGazette(link.date, link.pdfUrl, {
            editionNumber: link.editionNumber,
            isExtraEdition: link.isExtra,
            power: 'executive_legislative',
          });
          
          if (gazette) {
            gazettes.push(gazette);
          }
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from Assistech`);
    } catch (error) {
      logger.error(`Error crawling Assistech: ${error}`);
      throw error;
    }

    return gazettes;
  }

  /**
   * Extract gazette links from HTML
   */
  private async extractGazetteLinks(html: string): Promise<Array<{
    date: Date;
    pdfUrl: string;
    editionNumber?: string;
    isExtra: boolean;
  }>> {
    const links: Array<{
      date: Date;
      pdfUrl: string;
      editionNumber?: string;
      isExtra: boolean;
    }> = [];
    
    try {
      // Pattern for gazette entries with date and PDF link
      // Common patterns in Assistech:
      // - Table rows with date and download link
      // - Card/list items with date and PDF link
      
      const patterns = [
        // Pattern: Link with date in text or nearby
        /<a[^>]+href="([^"]+\.pdf[^"]*)"[^>]*>([^<]*)<\/a>/gi,
        // Pattern: Row with date and download link
        /<tr[^>]*>[\s\S]*?(\d{2}\/\d{2}\/\d{4})[\s\S]*?href="([^"]+\.pdf[^"]*)"[\s\S]*?<\/tr>/gi,
        // Pattern: List item with date and PDF
        /<li[^>]*>[\s\S]*?(\d{2}\/\d{2}\/\d{4})[\s\S]*?href="([^"]+)"[\s\S]*?<\/li>/gi,
      ];
      
      // Try each pattern
      for (const pattern of patterns) {
        const matches = html.matchAll(pattern);
        
        for (const match of matches) {
          try {
            let pdfUrl: string;
            let dateStr: string;
            let linkText = '';
            
            // Parse based on pattern structure
            if (pattern.source.includes('<tr')) {
              dateStr = match[1];
              pdfUrl = match[2];
            } else if (pattern.source.includes('<li')) {
              dateStr = match[1];
              pdfUrl = match[2];
            } else {
              pdfUrl = match[1];
              linkText = match[2] || '';
              
              // Try to extract date from link text or URL
              const dateMatch = linkText.match(/(\d{2})\/(\d{2})\/(\d{4})/) ||
                               pdfUrl.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})/);
              
              if (!dateMatch) continue;
              
              if (dateMatch[0].includes('/')) {
                dateStr = dateMatch[0];
              } else {
                dateStr = `${dateMatch[3]}/${dateMatch[2]}/${dateMatch[1]}`;
              }
            }
            
            // Parse date
            const [day, month, year] = dateStr.split('/');
            const date = new Date(`${year}-${month}-${day}`);
            
            if (isNaN(date.getTime())) continue;
            
            // Resolve relative URL
            let fullPdfUrl = pdfUrl;
            if (!fullPdfUrl.startsWith('http')) {
              const baseUrlObj = new URL(this.baseUrl);
              fullPdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
            }
            
            // Extract edition number
            const editionMatch = (linkText || pdfUrl).match(/[Ee]di[çc][ãa]o\s*n?[°º]?\s*(\d+)/i) ||
                                (linkText || pdfUrl).match(/n[°º]?\s*(\d+)/i);
            const editionNumber = editionMatch ? editionMatch[1] : undefined;
            
            // Check if extra edition
            const isExtra = (linkText || pdfUrl).toLowerCase().includes('extra') ||
                           (linkText || pdfUrl).toLowerCase().includes('suplemento');
            
            // Avoid duplicates
            if (!links.some(l => l.pdfUrl === fullPdfUrl)) {
              links.push({
                date,
                pdfUrl: fullPdfUrl,
                editionNumber,
                isExtra,
              });
            }
          } catch (error) {
            logger.debug(`Failed to parse match:`, error as Error);
            continue;
          }
        }
      }
      
      // Sort by date descending
      links.sort((a, b) => b.date.getTime() - a.date.getTime());
      
    } catch (error) {
      logger.error('Error extracting gazette links:', error as Error);
    }
    
    return links;
  }
}

