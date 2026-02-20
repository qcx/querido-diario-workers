import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraCachoeiroConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';
// @ts-ignore
import { parse } from 'node-html-parser';

/**
 * PrefeituraCachoeiroSpider for Cachoeiro de Itapemirim, ES
 * 
 * Site Structure:
 * - URL: https://diario.cachoeiro.es.gov.br/dio/home/diario_oficial
 * - HTML list of gazettes with format: "Diário Oficial n° {number} de {DD/MM/YYYY}"
 * - Each entry has "VISUALIZAR O DIÁRIO OFICIAL" link
 * - Pagination with page numbers
 */
export class PrefeituraCachoeiroSpider extends BaseSpider {
  protected cachoeiroConfig: PrefeituraCachoeiroConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.cachoeiroConfig = spiderConfig.config as PrefeituraCachoeiroConfig;
    
    if (!this.cachoeiroConfig.baseUrl) {
      throw new Error(`PrefeituraCachoeiroSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraCachoeiroSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.cachoeiroConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    
    try {
      // Start with first page
      let currentPage = 1;
      let hasMorePages = true;
      const maxPages = 50; // Safety limit
      const baseUrlObj = new URL(this.cachoeiroConfig.baseUrl);
      
      while (hasMorePages && currentPage <= maxPages) {
        const pageUrl = currentPage === 1 
          ? this.cachoeiroConfig.baseUrl
          : `${this.cachoeiroConfig.baseUrl}?page=${currentPage}`;
        
        logger.debug(`Fetching page ${currentPage}: ${pageUrl}`);
        
        const html = await this.fetch(pageUrl);
        const root = parse(html);
        
        // Extract gazettes from current page
        const pageGazettes = await this.extractGazettesFromPage(root, baseUrlObj);
        
        if (pageGazettes.length === 0) {
          hasMorePages = false;
          logger.debug(`No gazettes found on page ${currentPage}, stopping pagination`);
          break;
        }
        
        // Filter by date range and add to results
        let foundOlderThanRange = false;
        for (const parsed of pageGazettes) {
          const gazetteDate = new Date(parsed.date);
          
          if (gazetteDate < this.startDate) {
            foundOlderThanRange = true;
            continue;
          }
          
          if (this.isInDateRange(gazetteDate)) {
            const gazette = await this.createGazette(gazetteDate, parsed.pdfUrl, {
              power: 'executive_legislative',
              sourceText: parsed.sourceText,
              editionNumber: parsed.editionNumber,
              isExtraEdition: parsed.isExtraEdition,
            });
            
            if (gazette) {
              gazettes.push(gazette);
            }
          }
        }
        
        logger.debug(`Page ${currentPage}: Found ${pageGazettes.length} gazettes, ${gazettes.length} total in date range`);
        
        // Stop if we found gazettes older than our date range
        if (foundOlderThanRange) {
          logger.debug('Found gazettes older than date range, stopping pagination');
          hasMorePages = false;
          break;
        }
        
        // Check for pagination - look for next page link (numbers 1, 2, 3, etc. or "próximo")
        const nextPageLink = root.querySelector(`a[href*="page=${currentPage + 1}"], .pagination a[href*="page=${currentPage + 1}"], a:contains("${currentPage + 1}")`);
        hasMorePages = !!nextPageLink;
        
        currentPage++;
        
        // Add small delay between pages
        if (hasMorePages) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      logger.info(`Found ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    } catch (error) {
      logger.error(`Error crawling ${this.cachoeiroConfig.baseUrl}:`, error as Error);
    }
    
    return gazettes;
  }

  /**
   * Extract gazettes from a single page
   */
  private async extractGazettesFromPage(root: any, baseUrlObj: URL): Promise<Array<{
    date: string;
    pdfUrl: string;
    editionNumber: string;
    isExtraEdition: boolean;
    sourceText: string;
  }>> {
    const gazettes: Array<{
      date: string;
      pdfUrl: string;
      editionNumber: string;
      isExtraEdition: boolean;
      sourceText: string;
    }> = [];
    
    try {
      // Find all links with text containing "VISUALIZAR O DIÁRIO OFICIAL"
      const allLinks = root.querySelectorAll('a');
      const seenUrls = new Set<string>();
      
      for (const link of allLinks) {
        try {
          const linkText = link.text?.trim() || '';
          
          // Look for "VISUALIZAR O DIÁRIO OFICIAL" (exclude "ATOS")
          if (!linkText.includes('VISUALIZAR O DIÁRIO OFICIAL') || linkText.includes('ATOS')) {
            continue;
          }
          
          const href = link.getAttribute('href');
          if (!href) {
            continue;
          }
          
          // Make URL absolute
          let pdfUrl = href;
          if (!pdfUrl.startsWith('http')) {
            pdfUrl = href.startsWith('/')
              ? `${baseUrlObj.origin}${href}`
              : `${baseUrlObj.origin}/${href}`;
          }
          
          // Skip duplicates
          if (seenUrls.has(pdfUrl)) {
            continue;
          }
          seenUrls.add(pdfUrl);
          
          // Find the gazette title by traversing up the DOM tree
          let parent = link.parentNode;
          let gazetteText = '';
          let maxDepth = 10;
          let depth = 0;
          
          while (parent && depth < maxDepth) {
            const parentText = parent.text?.trim() || '';
            
            // Look for pattern: "Diário Oficial n° {number} de {DD/MM/YYYY}"
            const gazetteMatch = parentText.match(/Diário Oficial n[°º]?\s*(\d+)\s+de\s+(\d{2})\/(\d{2})\/(\d{4})(?:\s+Edição\s+Extra)?/i);
            
            if (gazetteMatch) {
              gazetteText = parentText;
              break;
            }
            
            parent = parent.parentNode;
            depth++;
          }
          
          if (!gazetteText) {
            // If not found in parent, try searching in the entire document for text near this link
            // This is a fallback approach
            continue;
          }
          
          // Extract edition number and date
          const gazetteMatch = gazetteText.match(/Diário Oficial n[°º]?\s*(\d+)\s+de\s+(\d{2})\/(\d{2})\/(\d{4})(?:\s+Edição\s+Extra)?/i);
          if (!gazetteMatch) {
            continue;
          }
          
          const [, editionNumber, day, month, year] = gazetteMatch;
          const isExtraEdition = /Edição\s+Extra/i.test(gazetteMatch[0]);
          const gazetteDate = new Date(`${year}-${month}-${day}`);
          
          // Validate date
          if (isNaN(gazetteDate.getTime())) {
            logger.warn(`Invalid date: ${day}/${month}/${year}`);
            continue;
          }
          
          gazettes.push({
            date: `${year}-${month}-${day}`,
            pdfUrl,
            editionNumber,
            isExtraEdition,
            sourceText: gazetteMatch[0],
          });
        } catch (error) {
          logger.error(`Error processing gazette link:`, error as Error);
        }
      }
      
    } catch (error) {
      logger.error(`Error extracting gazettes from page:`, error as Error);
    }
    
    return gazettes;
  }
}
