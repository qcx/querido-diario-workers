import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';
import * as cheerio from 'cheerio';

/**
 * Configuration interface for EDocman spider
 */
export interface EdocmanConfig {
  type: string;
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/**
 * Spider for Joomla EDocman component
 * 
 * This spider handles sites that use the EDocman component for document management.
 * The structure typically includes:
 * - Document cards with class .edocman-document
 * - Title in .edocman-document-title with download link
 * - Date in .dateinformation with format DD-MM-YYYY
 * - Download URLs following pattern: {base_url}/{document-slug}/download
 * 
 * Example site: Parambu - CE (https://parambu.ce.gov.br/transparencia-2/transparencia/diario-oficial)
 * 
 * HTML Structure:
 * <div class="edocman-document">
 *   <h3 class="edocman-document-title">
 *     <a href="/path/to/document/download">DIÁRIO OFICIAL - ANO VII- EDIÇÃO 0990</a>
 *     <div class="dateinformation">21-01-2026</div>
 *   </h3>
 * </div>
 */
export class EdocmanSpider extends BaseSpider {
  protected edocmanConfig: EdocmanConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.edocmanConfig = spiderConfig.config as EdocmanConfig;
    
    if (!this.edocmanConfig.baseUrl) {
      throw new Error(`EdocmanSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing EdocmanSpider for ${spiderConfig.name} with URL: ${this.edocmanConfig.baseUrl}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.edocmanConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    const processedUrls = new Set<string>();
    
    try {
      let currentPage = 1;
      let hasMorePages = true;
      let foundOlderThanRange = false;
      const maxPages = 100;
      
      while (hasMorePages && currentPage <= maxPages && !foundOlderThanRange) {
        // Build URL for current page - EDocman uses limitstart parameter for pagination
        const pageUrl = currentPage === 1 
          ? this.edocmanConfig.baseUrl 
          : `${this.edocmanConfig.baseUrl}?limitstart=${(currentPage - 1) * 5}`;
        
        logger.debug(`Fetching page ${currentPage}: ${pageUrl}`);
        
        const html = await this.fetchPage(pageUrl);
        const pageGazettes = this.extractGazettesFromPage(html, processedUrls);
        
        logger.debug(`Found ${pageGazettes.length} gazettes on page ${currentPage}`);
        
        if (pageGazettes.length === 0) {
          hasMorePages = false;
          continue;
        }
        
        // Check if we found gazettes older than our date range
        for (const gazette of pageGazettes) {
          const gazetteDate = new Date(gazette.date);
          const startDate = new Date(this.dateRange.start);
          
          if (gazetteDate < startDate) {
            foundOlderThanRange = true;
            logger.debug(`Found gazette older than date range: ${gazette.date}`);
          }
          
          // Only add gazettes within date range
          if (this.isInDateRange(gazetteDate)) {
            gazettes.push(gazette);
          }
        }
        
        // Check for next page by looking for pagination links
        const $ = cheerio.load(html);
        const nextPageLink = $('a[title="Próximo"], a:contains("Próximo"), .pagination-next a, ul.pagination li:contains("Próximo") a').first();
        
        if (nextPageLink.length > 0 && pageGazettes.length > 0) {
          currentPage++;
        } else {
          hasMorePages = false;
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }
    
    return gazettes;
  }

  /**
   * Fetch a page and return HTML
   */
  private async fetchPage(url: string): Promise<string> {
    this.requestCount++;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return response.text();
  }

  /**
   * Extract gazettes from page HTML using EDocman structure
   */
  private extractGazettesFromPage(html: string, processedUrls: Set<string>): Gazette[] {
    const $ = cheerio.load(html);
    const gazettes: Gazette[] = [];
    
    // Find all EDocman document containers
    $('.edocman-document').each((_, element) => {
      try {
        const $doc = $(element);
        
        // Get the title element
        const $title = $doc.find('.edocman-document-title, h3.edocman-document-title');
        const titleText = $title.find('a').first().text().trim();
        
        // Skip if not a gazette (doesn't contain "diário oficial")
        if (!titleText.toLowerCase().includes('diário oficial') && 
            !titleText.toLowerCase().includes('diario oficial')) {
          return;
        }
        
        // Get download link from title or taskbar
        let downloadUrl = '';
        
        // First try the title link (usually points to download)
        const $titleLink = $title.find('a[href*="/download"]').first();
        if ($titleLink.length > 0) {
          downloadUrl = $titleLink.attr('href') || '';
        }
        
        // If not found, try the taskbar download button
        if (!downloadUrl) {
          const $downloadBtn = $doc.find('.edocman-taskbar a[href*="/download"]').first();
          if ($downloadBtn.length > 0) {
            downloadUrl = $downloadBtn.attr('href') || '';
          }
        }
        
        // If still not found, try any link with "download" in href
        if (!downloadUrl) {
          const $anyDownload = $doc.find('a[href*="download"]').first();
          if ($anyDownload.length > 0) {
            downloadUrl = $anyDownload.attr('href') || '';
          }
        }
        
        if (!downloadUrl) {
          logger.debug(`No download link found for: ${titleText}`);
          return;
        }
        
        // Make URL absolute
        downloadUrl = this.makeAbsoluteUrl(downloadUrl);
        
        // Skip if already processed
        if (processedUrls.has(downloadUrl)) {
          return;
        }
        processedUrls.add(downloadUrl);
        
        // Get date from .dateinformation element
        const $dateInfo = $doc.find('.dateinformation');
        const dateText = $dateInfo.text().trim();
        
        // Parse date (format: DD-MM-YYYY)
        const gazetteDate = this.parseDateFromText(dateText);
        
        if (!gazetteDate) {
          logger.debug(`Could not parse date from: ${dateText}`);
          return;
        }
        
        // Extract edition number from title
        // Pattern: "EDIÇÃO 0990" or "EDIÇÃO nº 0990"
        const editionMatch = titleText.match(/[Ee]di[çc][ãa]o\s*[nN]?[°º]?\s*(\d+)/i) || 
                            titleText.match(/EDIÇÃO\s*(\d+)/i);
        const editionNumber = editionMatch ? editionMatch[1] : undefined;
        
        // Check for extra edition
        const isExtra = /\b(extra|suplemento|extraordin[aá]ri[oa])\b/i.test(titleText);
        
        // Create gazette
        const gazette: Gazette = {
          date: toISODate(gazetteDate),
          fileUrl: downloadUrl,
          territoryId: this.spiderConfig.territoryId,
          power: 'executive_legislative',
          editionNumber,
          isExtraEdition: isExtra,
          scrapedAt: new Date().toISOString(),
        };
        
        gazettes.push(gazette);
        logger.debug(`Found gazette: ${toISODate(gazetteDate)} - Edition ${editionNumber || 'N/A'}`);
        
      } catch (error) {
        logger.error(`Error processing document element:`, error as Error);
      }
    });
    
    return gazettes;
  }

  /**
   * Parse date from text
   * Supports formats:
   * - DD-MM-YYYY
   * - DD/MM/YYYY
   * - DD.MM.YYYY
   */
  private parseDateFromText(text: string): Date | null {
    // Pattern: DD-MM-YYYY or DD/MM/YYYY or DD.MM.YYYY
    const dateMatch = text.match(/(\d{2})[-\/.](\d{2})[-\/.](\d{4})/);
    if (dateMatch) {
      const [, day, month, year] = dateMatch;
      const date = new Date(`${year}-${month}-${day}`);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
    
    // Pattern: YYYY-MM-DD (ISO format)
    const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      const [, year, month, day] = isoMatch;
      const date = new Date(`${year}-${month}-${day}`);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
    
    return null;
  }

  /**
   * Make URL absolute
   */
  private makeAbsoluteUrl(href: string): string {
    if (!href) return '';
    if (href.startsWith('http')) return href;
    
    const baseUrl = new URL(this.edocmanConfig.baseUrl);
    if (href.startsWith('//')) return baseUrl.protocol + href;
    if (href.startsWith('/')) return baseUrl.origin + href;
    
    return new URL(href, this.edocmanConfig.baseUrl).href;
  }
}
