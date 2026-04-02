import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, InstarConfig } from '../../types';
import { logger } from '../../../../utils/logger'
// @ts-ignore
import { parse } from 'node-html-parser';
import { formatBrazilianDate } from '../../../../utils/date-utils';

/**
 * BaseInstarSpider implementation for Cloudflare Workers
 * 
 * The Instar platform is used by many Brazilian municipalities to publish their official gazettes.
 * This spider handles pagination and parsing:
 * 1. First request gets the total number of results
 * 2. Calculates total pages (50 results per page)
 * 3. Fetches all pages in parallel
 * 4. Parses each gazette element to extract date, edition number, and PDF URL
 * 
 * URL pattern: {base_url}/{page}/{start_date}/{end_date}/0/0/
 * Date format: DD-MM-YYYY
 * 
 * HTML Structure:
 * - Container: .dof_publicacao_diario
 * - Title/Edition: .dof_titulo_publicacao span (first)
 * - Date: Found in spans with pattern DD/MM/YYYY
 * - PDF Download: .dof_download[data-href]
 */
export class InstarSpider extends BaseSpider {
  protected instarConfig: InstarConfig;
  protected resultsPerPage = 50;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.instarConfig = spiderConfig.config as InstarConfig;
    
    if (!this.instarConfig.url) {
      throw new Error(`InstarSpider requires a base_url in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing InstarSpider for ${spiderConfig.name} with URL: ${this.instarConfig.url}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.instarConfig.url} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      const startDate = formatBrazilianDate(new Date(this.dateRange.start));
      const endDate = formatBrazilianDate(new Date(this.dateRange.end));
      
      // Step 1: Fetch first page to get total results
      const firstPageUrl = `${this.instarConfig.url}/1/${startDate}/${endDate}/0/0/`;
      logger.info(`Fetching first page: ${firstPageUrl}`);
      
      const firstPageHtml = await this.fetch(firstPageUrl);
      const firstPageRoot = parse(firstPageHtml);
      
      // Get total number of results
      const resultsText = firstPageRoot.querySelector('.sw_qtde_resultados')?.text || '0';
      const totalResults = parseInt(resultsText.trim(), 10);
      logger.info(`Found ${totalResults} total results`);
      
      if (totalResults === 0) {
        logger.info(`No gazettes found for ${this.spiderConfig.name}`);
        return gazettes;
      }
      
      // Calculate total pages
      const totalPages = Math.ceil(totalResults / this.resultsPerPage);
      logger.info(`Total pages to fetch: ${totalPages}`);
      
      // Step 2: Fetch all pages (including first page we already have)
      const pagePromises: Promise<string>[] = [];
      
      // Process first page
      pagePromises.push(Promise.resolve(firstPageHtml));
      
      // Fetch remaining pages
      for (let page = 2; page <= totalPages; page++) {
        const pageUrl = `${this.instarConfig.url}/${page}/${startDate}/${endDate}/0/0/`;
        pagePromises.push(this.fetch(pageUrl));
      }
      
      const allPagesHtml = await Promise.all(pagePromises);
      
      // Step 3: Parse all pages and collect gazettes
      for (const pageHtml of allPagesHtml) {
        const root = parse(pageHtml);
        const gazetteElements = root.querySelectorAll('.dof_publicacao_diario');
        
        for (const gazetteElement of gazetteElements) {
          const gazette = await this.parseGazetteElement(gazetteElement);
          if (gazette) {
            gazettes.push(gazette);
          }
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Parse a single gazette element from the listing page
   * 
   * HTML structure:
   * <div class="dof_publicacao_diario">
   *   <div class="dof_titulo_publicacao"><span>Edição nº 3249</span></div>
   *   <div class="dof_download" data-href="/portal/download/diario-oficial/xxx/">
   *   <span>Postagem: <span>02/10/2025 às 22h31</span></span>
   * </div>
   */
  private async parseGazetteElement(gazetteElement: any): Promise<Gazette | null> {
    try {
      // Extract edition number from title
      const titleElement = gazetteElement.querySelector('.dof_titulo_publicacao span');
      const titleText = titleElement?.text || '';
      const editionMatch = titleText.match(/\d+/);
      const editionNumber = editionMatch ? editionMatch[0] : 'N/A';
      
      // Extract date from the info section
      // Look for pattern DD/MM/YYYY in all spans
      const allSpans = gazetteElement.querySelectorAll('span');
      let gazetteDate: Date | null = null;
      
      for (const span of allSpans) {
        const text = span.text || '';
        const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        
        if (dateMatch) {
          const [, day, month, year] = dateMatch;
          gazetteDate = new Date(`${year}-${month}-${day}`);
          break;
        }
      }
      
      if (!gazetteDate) {
        logger.warn(`Could not extract date from gazette element: ${titleText}`);
        return null;
      }
      
      // Check if date is in range
      if (!this.isInDateRange(gazetteDate)) {
        return null;
      }
      
      // Extract PDF download URL
      const downloadElement = gazetteElement.querySelector('.dof_download');
      const downloadHref = downloadElement?.getAttribute('data-href');
      
      if (!downloadHref) {
        logger.warn(`No download link found for gazette ${titleText} on ${gazetteDate.toISOString().split('T')[0]}`);
        return null;
      }
      
      // Construct full PDF URL
      let pdfUrl = downloadHref;
      if (pdfUrl.startsWith('/')) {
        const baseUrlObj = new URL(this.instarConfig.url);
        pdfUrl = `${baseUrlObj.origin}${pdfUrl}`;
      }
      
      // Check if it's an extra edition
      const isExtraEdition = titleText.toLowerCase().includes('extra');
      
      return await this.createGazette(gazetteDate, pdfUrl, {
        editionNumber,
        isExtraEdition,
        power: 'executive_legislative',
      });
      
    } catch (error) {
      logger.error(`Error parsing gazette element:`, error as Error);
      return null;
    }
  }
}
