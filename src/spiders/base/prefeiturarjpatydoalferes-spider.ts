import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Configuration interface for Paty do Alferes spider
 */
interface PrefeituraRjPatyDoAlferesConfig {
  type: string;
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/**
 * Spider for Paty do Alferes-RJ gazette extraction
 * 
 * The Paty do Alferes website uses WordPress for gazette listings.
 * The structure is:
 * - Each gazette is a link with class "bold" inside a list item
 * - The link text contains the edition number and date: "D.O. {numero} – {dd}/{mm}/{yyyy}"
 * - PDF links are direct downloads from wp-content/uploads
 * 
 * Example link:
 * <a class="bold" href="https://patydoalferes.rj.gov.br/wp-content/uploads/2010/09/D.O.-4660-21-01-2026.pdf" 
 *    title="D.O. 4660 – 21/01/2026">D.O. 4660 – 21/01/2026</a>
 */
export class PrefeituraRjPatyDoAlferesSpider extends BaseSpider {
  private patydoalferesConfig: PrefeituraRjPatyDoAlferesConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, _browser?: unknown) {
    super(spiderConfig, dateRange);
    this.patydoalferesConfig = spiderConfig.config as PrefeituraRjPatyDoAlferesConfig;
    
    if (!this.patydoalferesConfig.baseUrl) {
      throw new Error(`PrefeituraRjPatyDoAlferesSpider requires baseUrl in config`);
    }
    
    logger.info(`Initializing PrefeituraRjPatyDoAlferesSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.patydoalferesConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    
    try {
      const pageGazettes = await this.fetchPage();
      
      for (const gazette of pageGazettes) {
        gazettes.push(gazette);
      }
    } catch (error) {
      logger.error(`Error fetching page:`, error as Error);
    }
    
    logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    return gazettes;
  }

  /**
   * Fetch the main page with all gazettes
   */
  private async fetchPage(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    const url = this.patydoalferesConfig.baseUrl;
    
    logger.debug(`Fetching: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    this.requestCount++;
    
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status} fetching ${url}`);
    }
    
    const html = await response.text();
    
    // Extract gazette data from HTML
    const gazetteItems = this.extractGazettesFromHtml(html);
    
    logger.debug(`Extracted ${gazetteItems.length} total gazette entries, filtering by date range: ${toISODate(this.startDate)} to ${toISODate(this.endDate)}`);
    
    // Filter by date range BEFORE creating gazette objects (to avoid unnecessary URL resolution)
    const filteredItems = gazetteItems.filter(item => this.isInDateRange(item.date));
    
    logger.info(`Found ${filteredItems.length} gazettes in date range (out of ${gazetteItems.length} total)`);
    
    for (const item of filteredItems) {
      try {
        const gazette = await this.createGazette(item.date, item.pdfUrl, {
          power: 'executive_legislative',
          editionNumber: item.editionNumber,
          isExtraEdition: item.isExtra,
        });
        
        if (gazette) {
          gazettes.push(gazette);
          logger.info(`Found gazette for ${toISODate(item.date)} (edição ${item.editionNumber || 'N/A'}): ${item.pdfUrl}`);
        }
      } catch (error) {
        logger.error(`Error creating gazette:`, error as Error);
      }
    }
    
    return gazettes;
  }

  /**
   * Extract gazette data from HTML using regex
   * 
   * The site has links in format:
   * <a class="bold" href="https://patydoalferes.rj.gov.br/wp-content/uploads/2010/09/D.O.-4660-21-01-2026.pdf" 
   *    title="D.O. 4660 – 21/01/2026">D.O. 4660 – 21/01/2026</a>
   */
  private extractGazettesFromHtml(html: string): Array<{
    date: Date;
    pdfUrl: string;
    editionNumber?: string;
    isExtra: boolean;
  }> {
    const results: Array<{
      date: Date;
      pdfUrl: string;
      editionNumber?: string;
      isExtra: boolean;
    }> = [];
    
    // Pattern to find gazette links with PDF URLs
    // Matches: <a class="bold" href="...pdf" title="D.O. 4660 – 21/01/2026">D.O. 4660 – 21/01/2026</a>
    const linkPattern = /<a\s+class="bold"\s+href="([^"]+\.pdf)"[^>]*>([^<]+)<\/a>/gi;
    
    let match;
    const processedUrls = new Set<string>();
    
    while ((match = linkPattern.exec(html)) !== null) {
      const [, pdfUrl, linkText] = match;
      
      // Skip duplicates
      if (processedUrls.has(pdfUrl)) {
        continue;
      }
      processedUrls.add(pdfUrl);
      
      // Decode HTML entities in link text
      const decodedText = linkText
        .replace(/&#8211;/g, '–')
        .replace(/&ndash;/g, '–')
        .replace(/&#8212;/g, '—')
        .replace(/&mdash;/g, '—')
        .replace(/&nbsp;/g, ' ');
      
      // Extract date from link text
      // Pattern: "D.O. 4660 – 21/01/2026" or "D.O. 4660 - 21/01/2026"
      const dateMatch = decodedText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      
      if (!dateMatch) {
        // Try to extract date from PDF filename
        // Pattern: D.O.-4660-21-01-2026.pdf
        const urlDateMatch = pdfUrl.match(/D\.O\.-\d+-(\d{2})-(\d{2})-(\d{4})(?:-|\.)/i);
        if (urlDateMatch) {
          const [, day, month, year] = urlDateMatch;
          const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
          
          if (!isNaN(date.getTime())) {
            // Extract edition number from text
            const editionMatch = decodedText.match(/D\.O\.\s*(\d+)/i);
            const editionNumber = editionMatch ? editionMatch[1] : undefined;
            
            // Check if extra edition
            const isExtra = /\b(Esp|Extra|Extraordin[áa]ri[oa]|Suplemento|Especial)\b/i.test(decodedText);
            
            results.push({
              date,
              pdfUrl,
              editionNumber,
              isExtra,
            });
          }
        }
        continue;
      }
      
      const [, day, month, year] = dateMatch;
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      
      if (isNaN(date.getTime())) {
        logger.warn(`Invalid date: ${day}/${month}/${year}`);
        continue;
      }
      
      // Extract edition number from text
      // Pattern: "D.O. 4660" or "D.O. 4660 – 21/01/2026 – Esp-SOCIAL"
      const editionMatch = decodedText.match(/D\.O\.\s*(\d+)/i);
      const editionNumber = editionMatch ? editionMatch[1] : undefined;
      
      // Check if extra edition
      // Patterns: "Esp-SOCIAL", "Esp-Dec9627", "Esp-PatyPrevi", etc.
      const isExtra = /\b(Esp|Extra|Extraordin[áa]ri[oa]|Suplemento|Especial)\b/i.test(decodedText);
      
      results.push({
        date,
        pdfUrl,
        editionNumber,
        isExtra,
      });
    }
    
    logger.debug(`Extracted ${results.length} gazette entries from HTML`);
    return results;
  }
}
