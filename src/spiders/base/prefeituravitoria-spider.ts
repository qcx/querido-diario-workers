import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraVitoriaConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';
// @ts-ignore
import { parse } from 'node-html-parser';

/**
 * PrefeituraVitoriaSpider for Vitória, ES ASP.NET-based gazette site
 * 
 * Site Structure:
 * - ASP.NET site with ExibirArquivo.aspx endpoints
 * - Main page: https://diariooficial.vitoria.es.gov.br
 * - PDF links: ExibirArquivo.aspx?qs={encoded_query_string}
 * - Dates are shown in the page content
 * 
 * HTML Structure:
 * <a href='ExibirArquivo.aspx?qs=...' target="_blank">
 *   Diário Oficial publicado em DD/MM/YYYY
 * </a>
 */
export class PrefeituraVitoriaSpider extends BaseSpider {
  protected vitoriaConfig: PrefeituraVitoriaConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.vitoriaConfig = spiderConfig.config as PrefeituraVitoriaConfig;
    
    if (!this.vitoriaConfig.baseUrl) {
      throw new Error(`PrefeituraVitoriaSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraVitoriaSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.vitoriaConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    
    try {
      const html = await this.fetch(this.vitoriaConfig.baseUrl);
      const root = parse(html);
      
      // Find all links to ExibirArquivo.aspx
      const pdfLinks = root.querySelectorAll('a[href*="ExibirArquivo.aspx"]');
      
      logger.debug(`Found ${pdfLinks.length} gazette links`);
      
      for (const link of pdfLinks) {
        try {
          const href = link.getAttribute('href');
          const linkText = link.text?.trim() || '';
          
          if (!href) {
            continue;
          }
          
          // Make URL absolute
          const baseUrlObj = new URL(this.vitoriaConfig.baseUrl);
          const fullUrl = href.startsWith('http') 
            ? href 
            : `${baseUrlObj.origin}${href.startsWith('/') ? '' : '/'}${href}`;
          
          // Extract date from link text: "Diário Oficial publicado em DD/MM/YYYY"
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
      logger.error(`Error crawling ${this.vitoriaConfig.baseUrl}:`, error as Error);
    }
    
    logger.info(`Found ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    return gazettes;
  }
}
