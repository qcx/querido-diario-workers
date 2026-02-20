import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraGuacuiConfig } from '../../types';
import { logger } from '../../utils/logger';
// @ts-ignore
import { parse } from 'node-html-parser';

/**
 * PrefeituraGuacuiSpider for Guaçuí, ES
 * 
 * Site Structure:
 * - URL: https://www.guacui.es.gov.br/diario-oficial
 * - Structure to be determined through investigation
 */
export class PrefeituraGuacuiSpider extends BaseSpider {
  protected guacuiConfig: PrefeituraGuacuiConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.guacuiConfig = spiderConfig.config as PrefeituraGuacuiConfig;
    
    if (!this.guacuiConfig.baseUrl) {
      throw new Error(`PrefeituraGuacuiSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraGuacuiSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.guacuiConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    
    try {
      const html = await this.fetch(this.guacuiConfig.baseUrl);
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
          const baseUrlObj = new URL(this.guacuiConfig.baseUrl);
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
      logger.error(`Error crawling ${this.guacuiConfig.baseUrl}:`, error as Error);
    }
    
    logger.info(`Found ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    return gazettes;
  }
}
