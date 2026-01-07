import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraJauConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * PrefeituraJauSpider implementation
 * 
 * Crawls Jaú's official gazette website (https://www.jau.sp.gov.br/jornal-oficial/)
 * 
 * Note: Jaú has two gazette systems:
 * 1. /diario-oficial - New electronic system (currently empty)
 * 2. /jornal-oficial/ - Historical archive with all published gazettes
 * 
 * This spider uses /jornal-oficial/ which contains all the actual gazette data.
 * 
 * Site Structure:
 * - Main URL: https://www.jau.sp.gov.br/jornal-oficial/
 * - HTML structure:
 *   - List items in ul.resultado-lista li.resultado-item
 *   - Each item has: h3 (Edição: NUMBER), ul with li.data, li.periodo, li.link
 *   - Publication date in li.data (e.g., "Data de publicação: 02/09/2025 16:38:00")
 *   - Download link in li.link > a with href to PDF
 *   - PDF URL format: /uploads/jornal_oficial/edicoes/{timestamp}_{filename}.pdf
 * 
 * The spider:
 * 1. Fetches the main gazette listing page
 * 2. Parses HTML to find gazette entries in .resultado-item
 * 3. Extracts PDF URLs from li.link a
 * 4. Extracts dates from li.data and edition numbers from h3
 * 5. Filters by date range
 */
export class PrefeituraJauSpider extends BaseSpider {
  protected jauConfig: PrefeituraJauConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.jauConfig = spiderConfig.config as PrefeituraJauConfig;
    
    if (!this.jauConfig.baseUrl) {
      throw new Error(`PrefeituraJauSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraJauSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    // Use /jornal-oficial/ endpoint which has the actual gazette data
    const jornalOficialUrl = this.jauConfig.baseUrl.replace('/diario-oficial', '/jornal-oficial/');
    
    logger.info(`Crawling ${jornalOficialUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];
    const processedUrls = new Set<string>();

    try {
      logger.info(`Fetching URL: ${jornalOficialUrl}`);

      const html = await this.fetch(jornalOficialUrl);
      const $ = this.loadHTML(html);

      // Find all gazette items using the correct selectors
      const gazetteItems = $('li.resultado-item');
      
      logger.info(`Found ${gazetteItems.length} gazette items`);

      // Process each gazette item
      for (let i = 0; i < gazetteItems.length; i++) {
        try {
          const $item = $(gazetteItems[i]);
          
          // Find the download link (in li.link a)
          const $downloadLink = $item.find('li.link a');
          
          if ($downloadLink.length === 0) {
            logger.debug('Skipping item without download link');
            continue;
          }
          
          let pdfUrl = $downloadLink.attr('href');
          
          if (!pdfUrl) {
            continue;
          }
          
          // Remove #page= suffix if present
          pdfUrl = pdfUrl.replace(/#page=.*$/, '');
          
          // Make URL absolute if relative
          if (!pdfUrl.startsWith('http')) {
            pdfUrl = pdfUrl.startsWith('/') 
              ? `https://www.jau.sp.gov.br${pdfUrl}` 
              : `https://www.jau.sp.gov.br/${pdfUrl}`;
          }
          
          // Skip duplicates
          if (processedUrls.has(pdfUrl)) {
            continue;
          }
          
          // Extract edition number from h3 (e.g., "Edição: 1330 - EXTRA" or "Edição: 1328")
          const $h3 = $item.find('h3');
          const h3Text = $h3.text().trim();
          
          // Extract edition number
          const editionMatch = h3Text.match(/Edição[:\s]*(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;
          
          // Check if it's an extra edition
          const isExtraEdition = /extra/i.test(h3Text);
          
          // Extract date from li.data (e.g., "Data de publicação: 02/09/2025 16:38:00")
          const $dataLi = $item.find('li.data');
          const dataText = $dataLi.text().trim();
          const dateMatch = dataText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          
          if (!dateMatch) {
            logger.debug(`Could not extract date from item: ${h3Text} - ${dataText}`);
            continue;
          }
          
          // Parse date (DD/MM/YYYY format)
          const day = parseInt(dateMatch[1], 10);
          const month = parseInt(dateMatch[2], 10) - 1;
          const year = parseInt(dateMatch[3], 10);
          const gazetteDate = new Date(year, month, day);
          
          // Check if date is in range
          if (!this.isInDateRange(gazetteDate)) {
            logger.debug(`Gazette date ${toISODate(gazetteDate)} is outside crawl range`);
            continue;
          }
          
          processedUrls.add(pdfUrl);
          
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber,
            isExtraEdition,
            power: 'executive_legislative',
            sourceText: h3Text,
          });
          
          if (gazette) {
            gazettes.push(gazette);
            logger.debug(`Added gazette: Edition ${editionNumber}, Date: ${toISODate(gazetteDate)}`);
          }
          
        } catch (error) {
          logger.error(`Error processing gazette item:`, error as Error);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }
}
