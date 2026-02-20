import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraCasteloConfig } from '../../types';
import { logger } from '../../utils/logger';
// @ts-ignore
import { parse } from 'node-html-parser';

/**
 * PrefeituraCasteloSpider for Castelo, ES
 * 
 * Site Structure:
 * - URL: https://www.castelo.es.gov.br/diario-oficial
 * - Structure to be determined through investigation
 */
export class PrefeituraCasteloSpider extends BaseSpider {
  protected casteloConfig: PrefeituraCasteloConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.casteloConfig = spiderConfig.config as PrefeituraCasteloConfig;
    
    if (!this.casteloConfig.baseUrl) {
      throw new Error(`PrefeituraCasteloSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraCasteloSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.casteloConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    
    try {
      const html = await this.fetch(this.casteloConfig.baseUrl);
      const root = parse(html);
      
      // Look for PDF links - adjust selectors based on actual page structure
      const pdfLinks = root.querySelectorAll('a[href$=".pdf"], a[href*="pdf"]');
      
      logger.debug(`Found ${pdfLinks.length} PDF links`);
      
      for (const link of pdfLinks) {
        try {
          const pdfUrl = link.getAttribute('href');
          const linkText = link.text?.trim() || '';
          
          if (!pdfUrl) {
            continue;
          }
          
          // Make URL absolute
          const baseUrlObj = new URL(this.casteloConfig.baseUrl);
          const fullUrl = pdfUrl.startsWith('http') 
            ? pdfUrl 
            : `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          
          // Try to extract date from link text or nearby elements
          const dateMatch = linkText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) {
            logger.debug(`Could not parse date from: ${linkText}`);
            continue;
          }
          
          const [, day, month, year] = dateMatch;
          const gazetteDate = new Date(`${year}-${month}-${day}`);
          
          // Filter by date range
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }
          
          // Create gazette
          const gazette = await this.createGazette(gazetteDate, fullUrl, {
            power: 'executive_legislative',
            sourceText: linkText,
          });
          
          if (gazette) {
            gazettes.push(gazette);
          }
        } catch (error) {
          logger.error(`Error processing gazette link:`, error as Error);
        }
      }
    } catch (error) {
      logger.error(`Error crawling ${this.casteloConfig.baseUrl}:`, error as Error);
    }
    
    logger.info(`Found ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    return gazettes;
  }
}
