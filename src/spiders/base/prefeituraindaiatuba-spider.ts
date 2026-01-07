import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { formatBrazilianDate, toISODate } from '../../utils/date-utils';

/**
 * Configuration for PrefeituraIndaiatubaSpider
 */
export interface PrefeituraIndaiatubaConfig {
  type: 'prefeituraindaiatuba';
  url: string;
}

/**
 * PrefeituraIndaiatubaSpider implementation for Cloudflare Workers
 * 
 * The Indaiatuba official gazette portal has a custom structure:
 * - URL: https://www.indaiatuba.sp.gov.br/comunicacao/imprensa-oficial/edicoes/
 * - Supports POST requests with date range filters (i_datainicial, i_datafinal, env)
 * - Returns HTML with links in format: <a href="/download/{id}/" title="Download da Edição N.º XXXX">Edição N.º XXXX - Publicada em DD/MM/YYYY</a>
 * - Download links return PDF files directly
 * 
 * Date filter parameters:
 * - i_datainicial: Start date (DD/MM/YYYY)
 * - i_datafinal: End date (DD/MM/YYYY)
 * - env: Must be "1" to enable the search
 */
export class PrefeituraIndaiatubaSpider extends BaseSpider {
  protected config: PrefeituraIndaiatubaConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeituraIndaiatubaConfig;
    
    if (!this.config.url) {
      throw new Error(`PrefeituraIndaiatubaSpider requires a url in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraIndaiatubaSpider for ${spiderConfig.name} with URL: ${this.config.url}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.config.url} for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];

    try {
      // Format dates for POST request (DD/MM/YYYY)
      const startDate = formatBrazilianDate(new Date(this.dateRange.start));
      const endDate = formatBrazilianDate(new Date(this.dateRange.end));
      
      logger.info(`Searching for gazettes from ${startDate} to ${endDate}`);
      
      // Make POST request with date filters
      const formData = new URLSearchParams();
      formData.append('i_datainicial', startDate);
      formData.append('i_datafinal', endDate);
      formData.append('env', '1');
      
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        },
        body: formData.toString(),
      });
      this.requestCount++;
      
      if (!response.ok) {
        throw new Error(`HTTP request failed with status ${response.status}`);
      }
      
      const html = await response.text();
      
      // Extract gazettes from HTML
      const extractedGazettes = this.extractGazettesFromHtml(html);
      
      // Filter by date range (extra safety check)
      for (const gazette of extractedGazettes) {
        const gazetteDate = new Date(gazette.date);
        if (this.isInDateRange(gazetteDate)) {
          gazettes.push(gazette);
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Extract gazettes from HTML content
   * 
   * HTML Structure:
   * <li><a href="/download/71741/" title="Download da Edição N.º 3477">Edição N.º 3477 - Publicada em 06/01/2026</a></li>
   * 
   * Note: The page uses ISO-8859-1 encoding, so characters may appear as "Edi��o N.�" 
   * when interpreted as UTF-8. We use flexible patterns to handle both cases.
   */
  private extractGazettesFromHtml(html: string): Gazette[] {
    const gazettes: Gazette[] = [];
    
    // Pattern to match gazette links - flexible to handle encoding issues
    // Matches: <a href="/download/{id}/" title="Download da Edi...">...DD/MM/YYYY...</a>
    // The [^"]* allows for any characters in the title including corrupted encoding
    const linkPattern = /<a\s+href="(\/download\/\d+\/?)"[^>]*title="Download[^"]*"[^>]*>([^<]+)<\/a>/gi;
    
    let match;
    while ((match = linkPattern.exec(html)) !== null) {
      try {
        const downloadPath = match[1];
        const linkText = match[2];
        
        // Skip if this doesn't look like a gazette link (must have a date)
        const dateMatch = linkText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (!dateMatch) {
          continue;
        }
        
        // Extract edition number from link text
        // Format: "Edição N.º 3477" or "Edi��o N.� 3477" (encoding issues)
        // Use flexible pattern that captures digits after "Edi" prefix
        const editionMatch = linkText.match(/Edi[^\s]*\s+N[^\s]*\s*(\d+)/i) || linkText.match(/(\d{4,})/);
        const editionNumber = editionMatch ? editionMatch[1] : undefined;
        
        const [, day, month, year] = dateMatch;
        const gazetteDate = new Date(`${year}-${month}-${day}`);
        
        if (isNaN(gazetteDate.getTime())) {
          logger.warn(`Invalid date parsed from: ${linkText}`);
          continue;
        }
        
        // Construct full PDF URL
        const baseUrlObj = new URL(this.config.url);
        const pdfUrl = `${baseUrlObj.origin}${downloadPath}`;
        
        // Check if it's an extra edition (based on having multiple editions on same date)
        const isExtraEdition = false; // We'll set this later if we find duplicates
        
        // Create gazette
        const gazette = this.createGazetteSync(gazetteDate, pdfUrl, {
          editionNumber,
          isExtraEdition,
          power: 'executive_legislative',
          sourceText: linkText.trim(),
        });
        
        if (gazette) {
          gazettes.push(gazette);
        }
        
      } catch (error) {
        logger.error(`Error parsing gazette link:`, error as Error);
      }
    }
    
    // Mark extra editions for dates with multiple gazettes
    const dateCount: { [date: string]: number } = {};
    for (const gazette of gazettes) {
      dateCount[gazette.date] = (dateCount[gazette.date] || 0) + 1;
    }
    
    // Mark all but the first gazette on each date as extra editions
    const dateFirstSeen: { [date: string]: boolean } = {};
    for (const gazette of gazettes) {
      if (dateCount[gazette.date] > 1) {
        if (dateFirstSeen[gazette.date]) {
          gazette.isExtraEdition = true;
        } else {
          dateFirstSeen[gazette.date] = true;
        }
      }
    }
    
    logger.info(`Extracted ${gazettes.length} gazettes from HTML`);
    return gazettes;
  }

  /**
   * Synchronous version of createGazette
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

