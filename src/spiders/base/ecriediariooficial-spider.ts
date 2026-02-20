import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, EcrieDiarioOficialConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * EcrieDiarioOficialSpider implementation for ecriediariooficial.com.br
 * 
 * This spider is specifically designed for municipalities using the 
 * ecriediariooficial.com.br platform, which has a different structure
 * than the standard ecrie platform.
 * 
 * Used by municipalities like Biritiba Mirim.
 * 
 * Site Structure:
 * - URL: https://ecriediariooficial.com.br/{cidade}
 * - PDFs hosted on ecrie.com.br with ASS_u_* prefix
 * - Article cards with .list-item class
 * - Date in .list-item__date element
 * - Edition in .list-item__title
 * - View button with .list-item__button class
 * - Pagination via select dropdown
 */
export class EcrieDiarioOficialSpider extends BaseSpider {
  protected config: EcrieDiarioOficialConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as EcrieDiarioOficialConfig;
    
    if (!this.config.baseUrl) {
      throw new Error(`EcrieDiarioOficialSpider requires a baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing EcrieDiarioOficialSpider for ${spiderConfig.name} with URL: ${this.config.baseUrl}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.config.baseUrl} for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    let currentPage = 1;
    const maxPages = 50; // Safety limit
    let hasMorePages = true;

    while (hasMorePages && currentPage <= maxPages) {
      // Build URL with pagination if needed
      const url = currentPage === 1 
        ? this.config.baseUrl 
        : `${this.config.baseUrl}?p=${currentPage}`;
      
      logger.debug(`Fetching page ${currentPage}: ${url}`);
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        }
      });
      this.requestCount++;
      
      if (!response.ok) {
        throw new Error(`HTTP request failed with status ${response.status}`);
      }
      
      const html = await response.text();
      
      // Extract gazettes from HTML
      const pageGazettes = this.extractGazettesFromHtml(html);
      
      if (pageGazettes.length === 0) {
        hasMorePages = false;
        continue;
      }
      
      // Filter by date range and check if we should continue
      let foundOlderThanRange = false;
      for (const gazette of pageGazettes) {
        const gazetteDate = new Date(gazette.date);
        if (this.isInDateRange(gazetteDate)) {
          gazettes.push(gazette);
        } else if (gazetteDate < new Date(this.dateRange.start)) {
          foundOlderThanRange = true;
        }
      }
      
      logger.debug(`Found ${pageGazettes.length} gazettes on page ${currentPage}, ${gazettes.length} total in date range`);
      
      // Stop if we found gazettes older than our date range
      if (foundOlderThanRange) {
        logger.debug('Found gazettes older than date range, stopping pagination');
        break;
      }
      
      // Check for more pages - look for select options or pagination links
      const hasNextPage = html.includes(`<option>${currentPage + 1}</option>`) ||
                          html.includes(`?p=${currentPage + 1}`) || 
                          html.includes(`&p=${currentPage + 1}`);
      
      if (hasNextPage) {
        currentPage++;
      } else {
        hasMorePages = false;
      }
    }

    logger.info(`Successfully crawled ${gazettes.length} gazettes via HTTP`);
    return gazettes;
  }

  /**
   * Extract gazettes from HTML content
   * Specific to ecriediariooficial.com.br format
   */
  private extractGazettesFromHtml(html: string): Gazette[] {
    const gazettes: Gazette[] = [];
    
    // Pattern to match gazette articles
    // Format: <article class="list-item">...</article>
    const articlePattern = /<article[^>]*class="[^"]*list-item[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
    
    let match;
    while ((match = articlePattern.exec(html)) !== null) {
      const articleHtml = match[1];
      
      // Extract PDF URL from .list-item__button or any link with ecrie.com.br
      // Pattern: href="https://ecrie.com.br/Sistema/Conteudos/DiarioOficial/upload/ASS_u_182_DDMMYYYYHHMMSS.pdf"
      const pdfLinkMatch = articleHtml.match(/<a[^>]*href="([^"]*ecrie\.com\.br[^"]*\.pdf)"[^>]*>/i);
      if (!pdfLinkMatch) continue;
      
      const pdfUrl = pdfLinkMatch[1];
      
      // Extract date from .list-item__date element
      // Format: <p class="list-item__date">DD/MM/YYYY</p>
      const dateClassMatch = articleHtml.match(/<p[^>]*class="[^"]*list-item__date[^"]*"[^>]*>(\d{2})\/(\d{2})\/(\d{4})<\/p>/i);
      
      let gazetteDate: Date | null = null;
      
      if (dateClassMatch) {
        const [, day, month, year] = dateClassMatch;
        gazetteDate = new Date(`${year}-${month}-${day}`);
      } else {
        // Fallback: try to extract from filename (ASS_u_182_DDMMYYYYHHMMSS.pdf)
        const filenameMatch = pdfUrl.match(/(?:ASS_)?u_\d+_(\d{2})(\d{2})(\d{4})\d{6}\.pdf/);
        if (filenameMatch) {
          const [, day, month, year] = filenameMatch;
          gazetteDate = new Date(`${year}-${month}-${day}`);
        } else {
          // Try DD/MM/YYYY anywhere in the article
          const slashDateMatch = articleHtml.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (slashDateMatch) {
            const [, day, month, year] = slashDateMatch;
            gazetteDate = new Date(`${year}-${month}-${day}`);
          }
        }
      }
      
      if (!gazetteDate || isNaN(gazetteDate.getTime())) continue;
      
      // Extract edition number from .list-item__title
      // Format: <h3 class="list-item__title">Edição nº 0095</h3>
      const titleMatch = articleHtml.match(/<h3[^>]*class="[^"]*list-item__title[^"]*"[^>]*>[^<]*[Ee]di[çc][ãa]o\s*n?[°º]?\s*(\d+)/i);
      const editionNumber = titleMatch ? titleMatch[1] : undefined;
      
      // Check if extra edition
      const isExtra = articleHtml.toLowerCase().includes('extra');
      
      // Extract source text for reference
      const textMatch = articleHtml.match(/<h3[^>]*class="[^"]*list-item__title[^"]*"[^>]*>([^<]*)</);
      const sourceText = textMatch ? textMatch[1].trim() : `Edição ${editionNumber || 'N/A'}`;
      
      const gazette = this.createGazetteSync(gazetteDate, pdfUrl, {
        editionNumber,
        isExtraEdition: isExtra,
        power: 'executive_legislative',
        sourceText,
      });
      
      if (gazette) {
        gazettes.push(gazette);
      }
    }
    
    return gazettes;
  }

  /**
   * Synchronous version of createGazette for use in extractGazettesFromHtml
   */
  private createGazetteSync(date: Date, pdfUrl: string, options: {
    editionNumber?: string;
    isExtraEdition?: boolean;
    power?: string;
    sourceText?: string;
  }): Gazette | null {
    try {
      return {
        date: toISODate(date),
        fileUrl: pdfUrl,
        territoryId: this.spiderConfig.territoryId,
        power: (options.power || 'executive_legislative') as 'executive' | 'legislative' | 'executive_legislative',
        isExtraEdition: options.isExtraEdition || false,
        editionNumber: options.editionNumber,
        scrapedAt: new Date().toISOString(),
        sourceText: options.sourceText,
      };
    } catch (error) {
      logger.warn('Failed to create gazette', { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }
}

