import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Configuration for Prefeitura de Sabará spider
 * 
 * Site Structure:
 * - URL: https://site.sabara.mg.gov.br/prefeitura/decretos/
 * - WordPress-based site with individual decree/portaria pages
 * - Each decree has its own page with PDF download
 * - Format: "DECRETO N° XXX/YYYY - Description"
 * - Large number of decrees published individually
 * 
 * Note: Sabará does not have a consolidated daily gazette.
 * Official acts are published individually on the city website.
 */
export interface PrefeiturasabaraConfig {
  type: 'prefeiturasabara';
  /** Base URL for the Prefeitura Sabará decretos page */
  baseUrl: string;
}

export class PrefeiturasabaraSpider extends BaseSpider {
  protected sabaraConfig: PrefeiturasabaraConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.sabaraConfig = spiderConfig.config as PrefeiturasabaraConfig;
    logger.info(`Initializing PrefeiturasabaraSpider for ${spiderConfig.name} with URL: ${this.sabaraConfig.baseUrl}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.sabaraConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      const html = await this.fetch(this.sabaraConfig.baseUrl);
      const $ = this.loadHTML(html);

      // Find all decree/portaria entries
      // Structure: heading with "DECRETO N° XXX/YYYY" followed by description and link
      const decretoHeadings = $('h4, h5, h6').filter((_, el) => {
        const text = $(el).text();
        return text.includes('DECRETO') || text.includes('Decreto') || 
               text.includes('PORTARIA') || text.includes('Portaria');
      });

      logger.debug(`Found ${decretoHeadings.length} potential decrees/portarias`);

      for (let i = 0; i < decretoHeadings.length; i++) {
        const heading = decretoHeadings.eq(i);
        const headingText = heading.text().trim();
        
        // Extract decree number and year
        // Format: "DECRETO N° 726/2025 Nomeação" or "Decreto n°721/2025 Exoneração"
        const decretoMatch = headingText.match(/(DECRETO|Decreto)\s*[nN]°?\s*(\d+)\/(\d{4})/i);
        const portariaMatch = headingText.match(/(PORTARIA|Portaria)\s*[nN]°?\s*(\d+)\/(\d{4})/i);
        
        const match = decretoMatch || portariaMatch;
        if (!match) {
          logger.debug(`Could not parse decree/portaria: ${headingText.substring(0, 50)}...`);
          continue;
        }

        const [, type, number, year] = match;
        const editionNumber = `${type.toUpperCase()} ${number}/${year}`;

        // Try to find the associated link
        // Links are usually in a following listitem
        const nextLink = heading.nextAll('li').first().find('a').first();
        let pdfUrl = nextLink.attr('href');
        
        if (!pdfUrl) {
          // Try to find link in parent or sibling elements
          pdfUrl = heading.find('a').attr('href') || 
                   heading.parent().find('a').first().attr('href');
        }

        if (!pdfUrl) {
          logger.debug(`No link found for: ${editionNumber}`);
          continue;
        }

        // Resolve relative URLs
        if (pdfUrl.startsWith('/')) {
          pdfUrl = `https://site.sabara.mg.gov.br${pdfUrl}`;
        } else if (!pdfUrl.startsWith('http')) {
          pdfUrl = new URL(pdfUrl, this.sabaraConfig.baseUrl).toString();
        }

        // For decrees, we use the current year as date approximation
        // since exact dates aren't always available in the listing
        // The actual date should be in the PDF content
        const yearNum = parseInt(year, 10);
        const decreeDate = new Date(`${yearNum}-01-01T00:00:00.000Z`);

        // Only process if year is in our date range
        const rangeStartYear = this.startDate.getFullYear();
        const rangeEndYear = this.endDate.getFullYear();
        
        if (yearNum < rangeStartYear || yearNum > rangeEndYear) {
          logger.debug(`Decree year ${yearNum} out of range (${rangeStartYear}-${rangeEndYear})`);
          continue;
        }

        // Use current date for decrees from current year
        const gazetteDate = yearNum === new Date().getFullYear() 
          ? new Date() 
          : decreeDate;

        const gazette = await this.createGazette(gazetteDate, pdfUrl, {
          editionNumber: editionNumber,
          isExtraEdition: false,
          power: 'executive',
          sourceText: headingText.substring(0, 200),
        });

        if (gazette) {
          gazettes.push(gazette);
          logger.debug(`Found decree: ${editionNumber}`);
        }
      }

      // Deduplicate by URL (some decrees might appear multiple times)
      const uniqueGazettes = gazettes.filter((gazette, index, self) =>
        index === self.findIndex(g => g.fileUrl === gazette.fileUrl)
      );

      logger.info(`Found ${uniqueGazettes.length} unique decrees/portarias from Prefeitura Sabará`);
      return uniqueGazettes;

    } catch (error) {
      logger.error(`Error crawling Prefeitura Sabará:`, error as Error);
    }

    return gazettes;
  }
}

