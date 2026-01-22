import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';
// @ts-ignore
import { parse } from 'node-html-parser';

/**
 * Configuration interface for Valença RJ spider
 */
interface PrefeituraRjValencaConfig {
  type: string;
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/**
 * Month name mappings for Portuguese date parsing
 */
const MONTH_NAMES: Record<string, number> = {
  'janeiro': 0,
  'fevereiro': 1,
  'março': 2,
  'marco': 2,
  'abril': 3,
  'maio': 4,
  'junho': 5,
  'julho': 6,
  'agosto': 7,
  'setembro': 8,
  'outubro': 9,
  'novembro': 10,
  'dezembro': 11,
};

/**
 * PrefeituraRjValencaSpider for Valença, RJ
 * 
 * Site Structure:
 * - URL: https://valenca.rj.gov.br/boletins-oficiais/
 * - Static HTML page with list of gazettes organized by year
 * - Each gazette has a direct PDF link
 * - Format: "Boletim Oficial n° {number} – {day} de {month} de {year}"
 * - PDF URL pattern: http://valenca.rj.gov.br/wp-content/uploads/{year}/BO/BO_{number}.pdf
 * 
 * This spider uses HTTP-only mode (no browser required) since the page is static HTML.
 */
export class PrefeituraRjValencaSpider extends BaseSpider {
  protected valencaConfig: PrefeituraRjValencaConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.valencaConfig = spiderConfig.config as PrefeituraRjValencaConfig;
    
    if (!this.valencaConfig.baseUrl) {
      throw new Error(`PrefeituraRjValencaSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraRjValencaSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.valencaConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    
    try {
      // Fetch the main page
      const html = await this.fetch(this.valencaConfig.baseUrl);
      
      // Parse HTML
      const root = parse(html);
      
      // Find all PDF links - they follow the pattern:
      // <a href="http://valenca.rj.gov.br/wp-content/uploads/{year}/BO/BO_{number}.pdf">
      //   Boletim Oficial n° {number} – {day} de {month} de {year}
      // </a>
      const links = root.querySelectorAll('a[href*=".pdf"]');
      
      logger.debug(`Found ${links.length} PDF links on page`);
      
      for (const link of links) {
        try {
          const href = link.getAttribute('href');
          const text = link.textContent.trim();
          
          if (!href || !text) continue;
          
          // Only process Boletim Oficial links
          if (!text.toLowerCase().includes('boletim oficial')) continue;
          
          // Extract date from link text
          // Format: "Boletim Oficial n° 2.036 – 21 de Janeiro de 2026"
          // Note: The dash can be – (en-dash) or - (hyphen)
          const dateMatch = text.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
          
          if (!dateMatch) {
            logger.debug(`Could not extract date from: ${text}`);
            continue;
          }
          
          const [, day, monthName, year] = dateMatch;
          
          // Convert month name to number
          const monthIndex = MONTH_NAMES[monthName.toLowerCase()];
          
          if (monthIndex === undefined) {
            logger.debug(`Invalid month name: ${monthName}`);
            continue;
          }
          
          const gazetteDate = new Date(
            parseInt(year),
            monthIndex,
            parseInt(day)
          );
          
          if (isNaN(gazetteDate.getTime())) {
            logger.debug(`Invalid date: ${day}/${monthIndex + 1}/${year}`);
            continue;
          }
          
          // Filter by date range
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }
          
          // Extract edition number from text
          // Format: "n° 2.036" or "nº 2036"
          const editionMatch = text.match(/n[°º]\s*([\d.]+)/i);
          const edition = editionMatch ? editionMatch[1].replace(/\./g, '') : undefined;
          
          // Check for extra edition markers
          const isExtra = /\b(extra|suplemento|extraordin[aá]ri[oa])\b/i.test(text);
          
          // Make URL absolute if needed
          const pdfUrl = href.startsWith('http') 
            ? href 
            : new URL(href, this.valencaConfig.baseUrl).href;
          
          // Create gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            power: 'executive_legislative',
            editionNumber: edition,
            isExtraEdition: isExtra,
          });
          
          if (gazette) {
            gazettes.push(gazette);
            logger.debug(`Found gazette for ${toISODate(gazetteDate)} (edição ${edition || 'N/A'}): ${pdfUrl}`);
          }
          
        } catch (error) {
          logger.error(`Error processing gazette link:`, error as Error);
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }
    
    return gazettes;
  }
}
