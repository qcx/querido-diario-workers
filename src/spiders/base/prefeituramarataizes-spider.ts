import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraMarataizesConfig } from '../../types';
import { logger } from '../../utils/logger';
// @ts-ignore
import { parse } from 'node-html-parser';

/**
 * PrefeituraMarataizesSpider for Marataízes, ES
 * 
 * Site Structure:
 * - URL: https://www.marataizes.es.gov.br/diario_oficial
 * - HTML table structure with gazette listings
 * - Each table has class "tabeladocumento"
 * - First row contains: "Diário Oficial n° {edition} de {DD/MM/YYYY}"
 * - Second row contains PDF link with text "VISUALIZAR"
 * 
 * HTML Structure:
 * <table class="table table-bordered tabeladocumento">
 *   <tbody>
 *     <tr>
 *       <td colspan="3" class="noticia-titulo2">
 *         <strong> Diário Oficial n° 4463 de 12/01/2026</strong>
 *       </td>
 *     </tr>
 *     <tr>
 *       <td>Resumo:</td>
 *       <td> DIÁRIO OFICIAL </td>
 *       <td>
 *         <a href="...pdf" target="_blank" class="btn btn-default btn-primary">
 *           <i class="fa fa-lg fa-search"></i> VISUALIZAR
 *         </a>
 *       </td>
 *     </tr>
 *   </tbody>
 * </table>
 */
export class PrefeituraMarataizesSpider extends BaseSpider {
  protected marataizesConfig: PrefeituraMarataizesConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.marataizesConfig = spiderConfig.config as PrefeituraMarataizesConfig;
    
    if (!this.marataizesConfig.baseUrl) {
      throw new Error(`PrefeituraMarataizesSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraMarataizesSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.marataizesConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    
    try {
      const html = await this.fetch(this.marataizesConfig.baseUrl);
      const root = parse(html);
      
      // Find all tables with class "tabeladocumento"
      const tables = root.querySelectorAll('table.tabeladocumento');
      
      logger.debug(`Found ${tables.length} gazette tables`);
      
      for (const table of tables) {
        try {
          // Get the first row which contains the title with edition and date
          const titleRow = table.querySelector('tr');
          if (!titleRow) {
            continue;
          }
          
          const titleCell = titleRow.querySelector('td.noticia-titulo2, td strong');
          if (!titleCell) {
            continue;
          }
          
          const titleText = titleCell.text?.trim() || '';
          
          // Extract edition number and date from title
          // Pattern: "Diário Oficial n° {edition} de {DD/MM/YYYY}"
          const titleMatch = titleText.match(/Diário Oficial n[°º]?\s*(\d+)\s+de\s+(\d{2})\/(\d{2})\/(\d{4})/i);
          if (!titleMatch) {
            logger.debug(`Could not parse title: ${titleText}`);
            continue;
          }
          
          const [, edition, day, month, year] = titleMatch;
          const gazetteDate = new Date(`${year}-${month}-${day}`);
          
          // Validate date
          if (isNaN(gazetteDate.getTime())) {
            logger.warn(`Invalid date: ${day}/${month}/${year}`);
            continue;
          }
          
          // Filter by date range
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }
          
          // Get the second row which contains the PDF link
          const rows = table.querySelectorAll('tr');
          if (rows.length < 2) {
            continue;
          }
          
          const linkRow = rows[1];
          const pdfLink = linkRow.querySelector('a[href*=".pdf"]');
          
          if (!pdfLink) {
            logger.debug(`No PDF link found in table for edition ${edition}`);
            continue;
          }
          
          const href = pdfLink.getAttribute('href');
          if (!href) {
            continue;
          }
          
          // Make URL absolute
          const baseUrlObj = new URL(this.marataizesConfig.baseUrl);
          const fullUrl = href.startsWith('http') 
            ? href 
            : `${baseUrlObj.origin}${href.startsWith('/') ? '' : '/'}${href}`;
          
          // Create gazette
          const gazette = await this.createGazette(gazetteDate, fullUrl, {
            power: 'executive_legislative',
            sourceText: titleText,
            editionNumber: edition,
          });
          
          if (gazette) {
            gazettes.push(gazette);
          }
        } catch (error) {
          logger.error(`Error processing gazette table:`, error as Error);
        }
      }
    } catch (error) {
      logger.error(`Error crawling ${this.marataizesConfig.baseUrl}:`, error as Error);
    }
    
    logger.info(`Found ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    return gazettes;
  }
}
