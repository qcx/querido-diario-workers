import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PtioConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for PTIO platform (portaldatransparencia.com.br)
 * Used by cities in Rio de Janeiro and São Paulo
 * Platform: ATM (Associação Transparência Municipal)
 * 
 * HTML Structure:
 * - Container: div.edicoes > div.sombra > div.box-edicao
 * - Edition: span.edicao > strong (e.g., "Edição 3.049 | Caderno 1 - Ano XIII")
 * - Date: div.data-caderno (format: "D/Mês/YYYY" like "6/Janeiro/2026")
 * - PDF: button with href="iframe.cfm?pagina=abreDocumento&arquivo=XXXX"
 *        or onClick="javascript:window.open('?pagina=abreDocumento&arquivo=XXXX')"
 */
export class PtioSpider extends BaseSpider {
  private baseUrl: string;
  
  // Month name mapping for Brazilian Portuguese
  private static readonly MONTH_MAP: Record<string, string> = {
    'janeiro': '01',
    'fevereiro': '02',
    'março': '03',
    'marco': '03',
    'abril': '04',
    'maio': '05',
    'junho': '06',
    'julho': '07',
    'agosto': '08',
    'setembro': '09',
    'outubro': '10',
    'novembro': '11',
    'dezembro': '12',
  };

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PtioConfig;
    this.baseUrl = platformConfig.baseUrl;
  }

  /**
   * Parse date from various formats used by PTIO:
   * - "6/Janeiro/2026" (format with month name in Portuguese)
   * - "DD/MM/YYYY" (numeric format, fallback)
   */
  private parseDate(rawDate: string): string | null {
    // Try format: D/Month/YYYY or DD/Month/YYYY (e.g., "6/Janeiro/2026")
    const monthNameMatch = rawDate.match(/(\d{1,2})\/(\w+)\/(\d{4})/i);
    if (monthNameMatch) {
      const [, day, monthName, year] = monthNameMatch;
      const month = PtioSpider.MONTH_MAP[monthName.toLowerCase()];
      if (month) {
        return `${year}-${month}-${day.padStart(2, '0')}`;
      }
    }
    
    // Try format: DD/MM/YYYY as fallback
    const numericMatch = rawDate.match(/(\d{1,2})\/(\d{2})\/(\d{4})/);
    if (numericMatch) {
      const [, day, month, year] = numericMatch;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    
    return null;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling PTIO for ${this.config.name}...`);

    try {
      let currentPage = 1;
      let hasNextPage = true;
      
      while (hasNextPage) {
        const url = currentPage === 1 ? this.baseUrl : `${this.baseUrl}?pagina=${currentPage}`;
        
        logger.debug(`Fetching page ${currentPage}: ${url}`);
        
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
          },
        });
        if (!response.ok) {
          logger.warn(`Failed to fetch page ${currentPage}: ${response.status}`);
          break;
        }

        const html = await response.text();
        
        // Split HTML by gazette blocks - each starts with <div class="edicoes">
        const gazetteBlocks = html.split(/<div[^>]*class="edicoes"[^>]*>/);
        let foundGazettes = 0;
        let foundOlderThanRange = false;
        
        // Skip the first split result (content before first gazette)
        for (let i = 1; i < gazetteBlocks.length; i++) {
          const gazetteHtml = gazetteBlocks[i];
          
          // Extract date - match data-caderno with various class combinations
          const dateMatch = gazetteHtml.match(/class="data-caderno[^"]*"[^>]*>([^<]+)</);
          if (!dateMatch) {
            logger.debug(`No date found in gazette block ${i}`);
            continue;
          }
          
          const rawDate = dateMatch[1].trim();
          const date = this.parseDate(rawDate);
          
          if (!date) {
            logger.debug(`Could not parse date: ${rawDate}`);
            continue;
          }
          
          // Check date range
          if (date > this.dateRange.end) {
            logger.debug(`Date ${date} is after range end ${this.dateRange.end}, skipping`);
            continue;
          }
          if (date < this.dateRange.start) {
            logger.debug(`Date ${date} is before range start ${this.dateRange.start}, stopping`);
            foundOlderThanRange = true;
            continue;
          }
          
          // Extract edition number - handle format like "Edição 3.049 | Caderno 1"
          const editionMatch = gazetteHtml.match(/Edição\s+([\d.]+)/i);
          const editionNumber = editionMatch ? editionMatch[1].replace(/\./g, '') : undefined;
          
          // Extract gazette URL from button href, onClick, or anchor
          let fileUrl: string | null = null;
          const baseUrlObj = new URL(this.baseUrl);
          
          // Try button with href attribute (main pattern)
          const buttonHrefMatch = gazetteHtml.match(/<button[^>]*href="([^"]+)"/);
          if (buttonHrefMatch) {
            const href = buttonHrefMatch[1];
            // Build full URL from iframe.cfm path
            if (href.includes('pagina=abreDocumento')) {
              // Extract the query parameters
              const queryMatch = href.match(/\?(.+)/);
              if (queryMatch) {
                fileUrl = `${baseUrlObj.origin}${baseUrlObj.pathname}?${queryMatch[1]}`;
              }
            }
          }
          
          // Try onClick handler (e.g., onClick="javascript:window.open('?pagina=abreDocumento&arquivo=XXXX')")
          if (!fileUrl) {
            const onClickMatch = gazetteHtml.match(/onClick="[^"]*\?pagina=abreDocumento&arquivo=([^'"]+)/);
            if (onClickMatch) {
              fileUrl = `${baseUrlObj.origin}${baseUrlObj.pathname}?pagina=abreDocumento&arquivo=${onClickMatch[1]}`;
            }
          }
          
          // Try anchor link as fallback
          if (!fileUrl) {
            const linkMatch = gazetteHtml.match(/<a[^>]*href="([^"]*abreDocumento[^"]*)"/);
            if (linkMatch) {
              const href = linkMatch[1];
              if (href.startsWith('http')) {
                fileUrl = href;
              } else {
                fileUrl = `${baseUrlObj.origin}${href.startsWith('/') ? '' : baseUrlObj.pathname}${href}`;
              }
            }
          }
          
          if (!fileUrl) {
            logger.debug(`No PDF URL found for gazette on ${date}`);
            continue;
          }
          
          gazettes.push({
            date,
            editionNumber,
            fileUrl,
            territoryId: this.config.territoryId,
            isExtraEdition: false,
            power: 'executive',
            scrapedAt: new Date().toISOString(),
          });
          
          foundGazettes++;
        }
        
        logger.debug(`Found ${foundGazettes} gazettes on page ${currentPage}`);
        
        // Stop if we found gazettes older than our range
        if (foundOlderThanRange) {
          hasNextPage = false;
          continue;
        }
        
        // Check for next page using pagination links
        const nextPageMatch = html.match(/<a[^>]*class="proximo"[^>]*href="([^"]+)"/) ||
                             html.match(/<a[^>]*href="\?pagina=(\d+)"[^>]*>\s*»\s*<\/a>/);
        hasNextPage = !!nextPageMatch && foundGazettes > 0;
        
        if (hasNextPage) {
          currentPage++;
          // Add delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from PTIO`);
    } catch (error) {
      logger.error(`Error crawling PTIO: ${error}`);
      throw error;
    }

    return gazettes;
  }
}
