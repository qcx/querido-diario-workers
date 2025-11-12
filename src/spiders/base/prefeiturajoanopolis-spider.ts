import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraJoanopolisConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * PrefeituraJoanopolisSpider implementation
 * 
 * Crawls Joanópolis's official gazette website which uses date range URLs
 * to display gazettes for a specific period.
 * 
 * The spider:
 * 1. Builds URL with date range: {baseUrl}/1/{startDate}/{endDate}/0/0/
 *    where dates are in DD-MM-YYYY format
 * 2. Fetches HTML page with list of gazettes
 * 3. Parses HTML to find items in .dof_area_listagem_publicacao_diario.sw_area_listagem
 * 4. Extracts PDF URLs from .dof_download[data-href] attributes
 * 5. Extracts dates from "Postagem: DD/MM/YYYY às HHhMM" text
 * 6. Extracts edition numbers from "Edição nº NNN" text
 * 7. Filters gazettes to match the requested date range
 */
export class PrefeituraJoanopolisSpider extends BaseSpider {
  protected joanopolisConfig: PrefeituraJoanopolisConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.joanopolisConfig = spiderConfig.config as PrefeituraJoanopolisConfig;
    
    if (!this.joanopolisConfig.baseUrl) {
      throw new Error(`PrefeituraJoanopolisSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraJoanopolisSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.joanopolisConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Build URL with date range
      const startDateStr = this.formatDateForUrl(this.startDate);
      const endDateStr = this.formatDateForUrl(this.endDate);
      const searchUrl = `${this.joanopolisConfig.baseUrl}/1/${startDateStr}/${endDateStr}/0/0/`;
      
      logger.debug(`Fetching URL: ${searchUrl}`);

      const html = await this.fetch(searchUrl);
      const $ = this.loadHTML(html);

      // Find the list container
      const listContainer = $('.dof_area_listagem_publicacao_diario.sw_area_listagem');
      
      if (listContainer.length === 0) {
        logger.warn('No gazette list container found on page');
        return gazettes;
      }

      // Find all gazette items
      const gazetteItems = listContainer.find('.dof_publicacao_diario.sw_item_listagem');
      logger.debug(`Found ${gazetteItems.length} gazette items on page`);

      // Process each gazette item
      const gazettePromises: Promise<Gazette | null>[] = [];
      
      gazetteItems.each((_, element) => {
        try {
          const $item = $(element);
          
          // Extract PDF URL from data-href attribute
          const pdfPath = $item.find('.dof_download[data-href]').attr('data-href');
          
          if (!pdfPath) {
            logger.debug('Skipping item without PDF URL');
            return;
          }

          // Make URL absolute if relative
          let pdfUrl: string;
          if (pdfPath.startsWith('http')) {
            pdfUrl = pdfPath;
          } else {
            // Extract base domain from baseUrl (e.g., "https://www.joanopolis.sp.gov.br")
            const baseUrlObj = new URL(this.joanopolisConfig.baseUrl);
            const baseDomain = `${baseUrlObj.protocol}//${baseUrlObj.host}`;
            // Ensure pdfPath starts with /
            const normalizedPath = pdfPath.startsWith('/') ? pdfPath : `/${pdfPath}`;
            pdfUrl = `${baseDomain}${normalizedPath}`;
          }

          // Extract edition number from title
          const titleText = $item.find('.dof_titulo_publicacao span').first().text().trim();
          const editionMatch = titleText.match(/Edição\s+nº\s+(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;

          // Extract posting date from info section
          // Look for the sw_info_listagem that contains "Postagem:"
          let dateMatch: RegExpMatchArray | null = null;
          $item.find('.sw_info_listagem').each((_, infoEl) => {
            const infoText = $(infoEl).text();
            const match = infoText.match(/Postagem:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
            if (match) {
              dateMatch = match;
              return false; // Break the loop
            }
          });
          
          if (!dateMatch) {
            logger.warn(`Could not extract date from item: ${titleText}`);
            return;
          }

          // Parse date (DD/MM/YYYY format)
          const day = parseInt(dateMatch[1], 10);
          const month = parseInt(dateMatch[2], 10) - 1; // JavaScript months are 0-indexed
          const year = parseInt(dateMatch[3], 10);
          const gazetteDate = new Date(year, month, day);

          // Check if date is in our crawl range
          if (!this.isInDateRange(gazetteDate)) {
            logger.debug(`Gazette date ${toISODate(gazetteDate)} is outside crawl range`);
            return;
          }

          // Create the gazette object promise
          gazettePromises.push(
            this.createGazette(gazetteDate, pdfUrl, {
              editionNumber,
              isExtraEdition: false,
              power: 'executive_legislative',
              sourceText: titleText,
            })
          );

        } catch (error) {
          logger.error(`Error processing gazette item:`, error as Error);
        }
      });

      // Await all gazette creation promises
      const results = await Promise.all(gazettePromises);
      
      // Filter out null results and add to gazettes array
      for (const gazette of results) {
        if (gazette) {
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
   * Format date for URL: DD-MM-YYYY
   * Example: new Date(2025, 10, 1) -> "01-11-2025"
   */
  private formatDateForUrl(date: Date): string {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  }
}

