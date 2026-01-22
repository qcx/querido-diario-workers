import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';
// @ts-ignore
import { parse } from 'node-html-parser';

/**
 * Configuration interface for São Fidélis RJ spider v2
 */
interface PrefeituraRjSaoFidelisV2Config {
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
 * PrefeituraRjSaoFidelisV2Spider for São Fidélis, RJ
 * 
 * Site Structure:
 * - URL: https://saofidelis.rj.gov.br/diariooficial
 * - WordPress site with Elementor tabs and accordions
 * - Each gazette entry has format: "DD de Mês de YYYY – Edição X.XXX – Download"
 * - PDF URL pattern: https://saofidelis.rj.gov.br/wp-content/uploads/{year}/{month}/Edicao-{number}.pdf
 * 
 * This spider uses HTTP-only mode (no browser required) since all PDF links 
 * are present in the static HTML (tabs/accordions content is server-rendered).
 */
export class PrefeituraRjSaoFidelisV2Spider extends BaseSpider {
  protected saoFidelisConfig: PrefeituraRjSaoFidelisV2Config;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.saoFidelisConfig = spiderConfig.config as PrefeituraRjSaoFidelisV2Config;
    
    if (!this.saoFidelisConfig.baseUrl) {
      throw new Error(`PrefeituraRjSaoFidelisV2Spider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraRjSaoFidelisV2Spider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.saoFidelisConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    
    try {
      // Fetch the main page
      const html = await this.fetch(this.saoFidelisConfig.baseUrl);
      
      // Parse HTML
      const root = parse(html);
      
      // Find all PDF links
      // The links are inside <p> tags with format:
      // <p>DD de Mês de YYYY – <strong>Edição X.XXX </strong>– <a href="...">Download</a></p>
      const links = root.querySelectorAll('a[href*=".pdf"]');
      
      logger.debug(`Found ${links.length} PDF links on page`);
      
      const processedUrls = new Set<string>();
      
      for (const link of links) {
        try {
          const href = link.getAttribute('href');
          const linkText = link.textContent.trim().toLowerCase();
          
          if (!href) continue;
          
          // Skip if not a download link
          if (!linkText.includes('download')) continue;
          
          // Skip duplicates
          if (processedUrls.has(href)) continue;
          processedUrls.add(href);
          
          // Get parent paragraph to extract date and edition
          let parentElement = link.parentNode;
          let contextText = '';
          
          // Walk up to find the paragraph with the full context
          let depth = 0;
          while (parentElement && depth < 5) {
            const text = parentElement.textContent || '';
            if (text.includes('de') && text.includes('Edição')) {
              contextText = text;
              break;
            }
            parentElement = parentElement.parentNode;
            depth++;
          }
          
          if (!contextText) {
            // Try to get context from sibling elements
            contextText = link.parentNode?.textContent || '';
          }
          
          // Extract date from context
          // Format: "DD de Mês de YYYY"
          const dateMatch = contextText.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
          
          if (!dateMatch) {
            logger.debug(`Could not extract date from: ${contextText.substring(0, 100)}`);
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
          
          // Extract edition number from context
          // Format: "Edição X.XXX" or "Edição 1.937"
          const editionMatch = contextText.match(/[Ee]di[çc][ãa]o\s*([\d.]+)/i);
          const edition = editionMatch ? editionMatch[1].replace(/\./g, '') : undefined;
          
          // Check for extra edition markers
          const isExtra = /\b(extra|suplemento|extraordin[aá]ri[oa])\b/i.test(contextText);
          
          // Make URL absolute if needed
          const pdfUrl = href.startsWith('http') 
            ? href 
            : new URL(href, this.saoFidelisConfig.baseUrl).href;
          
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
