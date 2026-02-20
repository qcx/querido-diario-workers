import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';
// @ts-ignore
import { parse } from 'node-html-parser';

/**
 * Configuration interface for Arraial do Cabo RJ spider v2
 */
interface PrefeituraRjArraialDoCaboV2Config {
  type: string;
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/**
 * PrefeituraRjArraialDoCaboV2Spider for Arraial do Cabo, RJ
 * 
 * Site Structure:
 * - URL: https://www.arraial.rj.gov.br/diariooficial
 * - Cards with gazette info (edition number, date, visits)
 * - PDF URL pattern: /diariooficial/diariopdf?id={id}
 * - Pagination: ?pagina={n}
 * - Date format: DD/MM/YYYY
 * 
 * This spider uses HTTP-only mode (no browser required) since all gazette data
 * is present in the static HTML.
 */
export class PrefeituraRjArraialDoCaboV2Spider extends BaseSpider {
  protected arraialConfig: PrefeituraRjArraialDoCaboV2Config;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.arraialConfig = spiderConfig.config as PrefeituraRjArraialDoCaboV2Config;
    
    if (!this.arraialConfig.baseUrl) {
      throw new Error(`PrefeituraRjArraialDoCaboV2Spider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraRjArraialDoCaboV2Spider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.arraialConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    const processedUrls = new Set<string>();
    let currentPage = 1;
    let hasMorePages = true;
    let consecutiveEmptyPages = 0;
    const maxConsecutiveEmptyPages = 3;
    
    try {
      while (hasMorePages && consecutiveEmptyPages < maxConsecutiveEmptyPages) {
        const pageUrl = currentPage === 1 
          ? this.arraialConfig.baseUrl 
          : `${this.arraialConfig.baseUrl}?pagina=${currentPage}`;
        
        logger.debug(`Fetching page ${currentPage}: ${pageUrl}`);
        
        const html = await this.fetch(pageUrl);
        const root = parse(html);
        
        // Find all gazette cards
        const cards = root.querySelectorAll('.card');
        
        if (cards.length === 0) {
          consecutiveEmptyPages++;
          logger.debug(`No cards found on page ${currentPage}`);
          currentPage++;
          continue;
        }
        
        let foundGazettesInRange = false;
        let foundGazetteBeforeRange = false;
        
        for (const card of cards) {
          try {
            // Get card header (edition info)
            const header = card.querySelector('.card-header');
            const headerText = header?.textContent?.trim() || '';
            
            // Extract edition number from "Diário Oficial 1581/2026"
            const editionMatch = headerText.match(/Diário Oficial\s+(\d+)\/(\d{4})/i);
            const editionNumber = editionMatch ? editionMatch[1] : undefined;
            
            // Get card body (date and visits)
            const body = card.querySelector('.card-body');
            const bodyText = body?.textContent || '';
            
            // Extract date from "Data: DD/MM/YYYY"
            const dateMatch = bodyText.match(/Data:\s*(\d{2})\/(\d{2})\/(\d{4})/);
            
            if (!dateMatch) {
              logger.debug(`Could not extract date from card: ${bodyText.substring(0, 100)}`);
              continue;
            }
            
            const [, day, month, year] = dateMatch;
            const gazetteDate = new Date(`${year}-${month}-${day}`);
            
            if (isNaN(gazetteDate.getTime())) {
              logger.debug(`Invalid date: ${day}/${month}/${year}`);
              continue;
            }
            
            // Check if gazette is after our date range (skip it, but continue processing)
            if (gazetteDate > this.endDate) {
              continue;
            }
            
            // Check if gazette is before our date range - mark for stop and skip
            if (gazetteDate < this.startDate) {
              foundGazetteBeforeRange = true;
              logger.debug(`Found gazette before date range (${toISODate(gazetteDate)}), will stop pagination after this page`);
              continue;
            }
            
            foundGazettesInRange = true;
            
            // Get PDF link from card footer
            const footer = card.querySelector('.card-footer');
            const pdfLink = footer?.querySelector('a[href*="diariopdf"]');
            const href = pdfLink?.getAttribute('href');
            
            if (!href) {
              logger.debug(`No PDF link found in card for date ${day}/${month}/${year}`);
              continue;
            }
            
            // Make URL absolute
            const pdfUrl = href.startsWith('http') 
              ? href 
              : new URL(href, this.arraialConfig.baseUrl).href;
            
            // Skip duplicates
            if (processedUrls.has(pdfUrl)) {
              continue;
            }
            processedUrls.add(pdfUrl);
            
            // Check for extra edition markers
            const isExtra = /\b(extra|suplemento|extraordin[aá]ri[oa])\b/i.test(bodyText) ||
                           bodyText.includes('Edição extra:');
            
            // Create gazette
            const gazette = await this.createGazette(gazetteDate, pdfUrl, {
              power: 'executive_legislative',
              editionNumber,
              isExtraEdition: isExtra,
            });
            
            if (gazette) {
              gazettes.push(gazette);
              logger.debug(`Found gazette for ${toISODate(gazetteDate)} (edição ${editionNumber || 'N/A'}): ${pdfUrl}`);
            }
            
          } catch (error) {
            logger.error(`Error processing gazette card:`, error as Error);
          }
        }
        
        // Reset consecutive empty pages counter if we found cards
        consecutiveEmptyPages = 0;
        
        // Check pagination - stop if we found any gazette before our date range
        // Since gazettes are in reverse chronological order, finding one before range means we've gone too far
        if (foundGazetteBeforeRange) {
          logger.debug(`Found gazette before date range on page ${currentPage}, stopping pagination`);
          hasMorePages = false;
          break;
        }
        
        // Check if there's a next page link
        const pagination = root.querySelector('.pagination');
        const nextPageLink = pagination?.querySelector('a[href*="pagina=' + (currentPage + 1) + '"]') ||
                           pagination?.querySelector('a:contains("Próxima")');
        
        if (!nextPageLink) {
          logger.debug(`No next page link found, stopping pagination`);
          hasMorePages = false;
        } else {
          currentPage++;
          
          // Safety limit to prevent infinite loops
          if (currentPage > 200) {
            logger.warn(`Reached maximum page limit (200), stopping pagination`);
            hasMorePages = false;
          }
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name} (${currentPage} pages)`);
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }
    
    return gazettes;
  }
}
