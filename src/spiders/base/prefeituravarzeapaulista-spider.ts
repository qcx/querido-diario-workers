import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraVarzeaPaulistaConfig } from '../../types';
import { logger } from '../../utils/logger';
// @ts-ignore
import { parse } from 'node-html-parser';

/**
 * Spider for Prefeitura de Várzea Paulista
 * 
 * Site Structure (WordPress GOVe5 theme):
 * - Page URL: https://transparencia.varzeapaulista.sp.gov.br/imprensa-oficial/
 * - Listings with links: ?nm_ano=YYYY&nm_mes=MM (MM=0 for all months)
 * - Each edition shows as a card with link: ?nm_ano=YYYY&nm_mes=0&nm_edicao=NNNN
 * - Card content: <b>NNNNª Edição</b><br>DD/MM/YYYY
 * - Meta refresh redirect to PDF when viewing an edition
 * - PDF URL pattern: https://transparencia5.varzeapaulista.sp.gov.br/include/imprensa/pdf/{YYYY}_{NNNN}.pdf
 * 
 * Crawling Strategy:
 * - For each year in the date range, fetch the listing page with nm_ano=YYYY&nm_mes=0
 * - Parse edition cards to extract edition number and date
 * - Construct PDF URL directly: {baseUrl}/{year}_{edition}.pdf
 */
export class PrefeituraVarzeaPaulistaSpider extends BaseSpider {
  protected platformConfig: PrefeituraVarzeaPaulistaConfig;
  private readonly PDF_BASE_URL = 'https://transparencia5.varzeapaulista.sp.gov.br/include/imprensa/pdf';

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.platformConfig = spiderConfig.config as PrefeituraVarzeaPaulistaConfig;

    if (!this.platformConfig.baseUrl) {
      throw new Error(`PrefeituraVarzeaPaulistaSpider requires baseUrl in config for ${spiderConfig.name}`);
    }

    logger.info(`Initializing PrefeituraVarzeaPaulistaSpider for ${spiderConfig.name} with baseUrl: ${this.platformConfig.baseUrl}`);
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const startDate = new Date(this.dateRange.start);
    const endDate = new Date(this.dateRange.end);

    // Get unique years to crawl
    const startYear = startDate.getFullYear();
    const endYear = endDate.getFullYear();

    logger.info(`Crawling Várzea Paulista gazettes from ${startYear} to ${endYear}`);

    // Crawl each year
    for (let year = endYear; year >= startYear; year--) {
      try {
        const yearGazettes = await this.crawlYear(year);
        
        // Filter by date range and add to results
        for (const gazette of yearGazettes) {
          const gazetteDate = new Date(gazette.date);
          if (this.isInDateRange(gazetteDate)) {
            gazettes.push(gazette);
          }
        }

        // If we found gazettes older than our start date, we can stop
        const hasOlderThanRange = yearGazettes.some(g => {
          const gazetteDate = new Date(g.date);
          return gazetteDate < startDate;
        });

        if (hasOlderThanRange && year < endYear) {
          logger.info(`Found gazettes older than date range, stopping at year ${year}`);
          break;
        }
      } catch (error) {
        logger.error(`Error crawling year ${year}:`, error as Error);
      }
    }

    logger.info(`Successfully crawled ${gazettes.length} gazettes for Várzea Paulista`);
    return gazettes;
  }

  /**
   * Crawl all gazettes for a specific year
   */
  private async crawlYear(year: number): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    // Fetch the year listing page
    const url = `${this.platformConfig.baseUrl}?nm_ano=${year}&nm_mes=0`;
    logger.debug(`Fetching year listing: ${url}`);

    try {
      const html = await this.fetch(url);
      const root = parse(html);

      // Find all edition cards
      // Structure: <div class='page_item'><a href='?nm_ano=YYYY&nm_mes=0&nm_edicao=NNNN'>
      //   <div style='text-align:center;'>
      //     <img ...>
      //     <b>NNNNª Edição</b>
      //     <br>DD/MM/YYYY
      //   </div>
      // </a></div>
      
      const pageItems = root.querySelectorAll('.page_item');
      
      if (pageItems.length === 0) {
        // Try alternative selector - look for links with nm_edicao parameter
        const editionLinks = root.querySelectorAll('a[href*="nm_edicao"]');
        
        for (const link of editionLinks) {
          const gazette = await this.parseEditionFromLink(link, year);
          if (gazette) {
            gazettes.push(gazette);
          }
        }
      } else {
        for (const item of pageItems) {
          const link = item.querySelector('a[href*="nm_edicao"]');
          if (link) {
            const gazette = await this.parseEditionFromLink(link, year);
            if (gazette) {
              gazettes.push(gazette);
            }
          }
        }
      }

      logger.debug(`Found ${gazettes.length} gazettes for year ${year}`);
    } catch (error) {
      logger.error(`Error fetching year ${year}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Parse a gazette from an edition link element
   */
  private async parseEditionFromLink(link: any, defaultYear: number): Promise<Gazette | null> {
    try {
      const href = link.getAttribute('href') || '';
      const content = link.text || link.innerHTML || '';

      // Extract edition number from href or content
      // Href pattern: ?nm_ano=YYYY&nm_mes=0&nm_edicao=NNNN
      const editionMatch = href.match(/nm_edicao=(\d+)/);
      if (!editionMatch) {
        logger.debug(`Could not extract edition from href: ${href}`);
        return null;
      }
      const editionNumber = editionMatch[1];

      // Extract year from href
      const yearMatch = href.match(/nm_ano=(\d{4})/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : defaultYear;

      // Extract date from content
      // Content pattern: NNNNª Edição\nDD/MM/YYYY or similar
      const dateMatch = content.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (!dateMatch) {
        logger.debug(`Could not extract date from content: ${content.substring(0, 100)}`);
        return null;
      }

      const [, day, month, dateYear] = dateMatch;
      const gazetteDate = new Date(`${dateYear}-${month}-${day}`);

      // Construct PDF URL
      // Pattern: https://transparencia5.varzeapaulista.sp.gov.br/include/imprensa/pdf/{YYYY}_{NNNN}.pdf
      const pdfUrl = `${this.PDF_BASE_URL}/${dateYear}_${editionNumber}.pdf`;

      // Check if extra edition (usually indicated by suffix like "A", "B" or "Extra")
      const isExtraEdition = content.toLowerCase().includes('extra') ||
                             /\d+[A-Za-z]/.test(editionNumber);

      return await this.createGazette(gazetteDate, pdfUrl, {
        editionNumber,
        isExtraEdition,
        power: 'executive_legislative',
        sourceText: `Edição ${editionNumber} - ${day}/${month}/${dateYear}`,
      });
    } catch (error) {
      logger.error('Error parsing edition link:', error as Error);
      return null;
    }
  }
}

