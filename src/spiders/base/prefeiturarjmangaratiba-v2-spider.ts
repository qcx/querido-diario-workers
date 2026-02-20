import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp } from '../../utils/date-utils';

/**
 * Configuration interface for Mangaratiba V2 spider
 */
interface PrefeituraRjMangaratibaV2Config {
  type: string;
  baseUrl: string;
}

/**
 * Spider for Mangaratiba - RJ gazette extraction
 * 
 * Website: https://mangaratiba.rj.gov.br/novoportal/publicacoes
 * 
 * The site has:
 * - Main page with the latest gazette
 * - Year pages at /novoportal/publicacoes-ano.php?ano=YYYY
 * - PDFs at /novoportal/assets/cg/_lib/file/doc/arquivos/publicacoes/dom-XXXX.pdf
 * - Table structure with columns: Edition Number, Date (DD/MM/YYYY), Views, Download Link
 */
export class PrefeituraRjMangaratibaV2Spider extends BaseSpider {
  private mangaratibaConfig: PrefeituraRjMangaratibaV2Config;
  private readonly userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.mangaratibaConfig = spiderConfig.config as PrefeituraRjMangaratibaV2Config;
    
    if (!this.mangaratibaConfig.baseUrl) {
      throw new Error(`PrefeituraRjMangaratibaV2Spider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraRjMangaratibaV2Spider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.mangaratibaConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    const processedUrls = new Set<string>();
    
    // Determine which years to crawl based on date range
    const startYear = this.startDate.getFullYear();
    const endYear = this.endDate.getFullYear();
    
    // Crawl each year in the range
    for (let year = endYear; year >= startYear; year--) {
      try {
        const yearGazettes = await this.crawlYear(year, processedUrls);
        gazettes.push(...yearGazettes);
        
        // If we've found gazettes before our start date, we can stop
        if (yearGazettes.length > 0) {
          const oldestDate = yearGazettes[yearGazettes.length - 1].date;
          if (new Date(oldestDate) < this.startDate) {
            logger.info(`Reached gazettes before start date, stopping crawl`);
            break;
          }
        }
      } catch (error) {
        logger.error(`Error crawling year ${year}:`, error as Error);
      }
    }
    
    logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    return gazettes;
  }

  /**
   * Crawl a specific year's gazettes
   */
  private async crawlYear(year: number, processedUrls: Set<string>): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const yearUrl = `https://mangaratiba.rj.gov.br/novoportal/publicacoes-ano.php?ano=${year}`;
    
    logger.info(`Crawling year ${year}: ${yearUrl}`);
    
    try {
      const response = await fetch(yearUrl, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      });
      this.requestCount++;
      
      if (!response.ok) {
        logger.warn(`Failed to fetch year ${year}: ${response.status}`);
        return gazettes;
      }
      
      const html = await response.text();
      
      // Extract gazette data from HTML
      // Pattern: onclick="window.open('URL','_blank');" with date in previous td
      const gazettePattern = /<tr>\s*<td>(\d+)<\/td>\s*<td>(\d{2}\/\d{2}\/\d{4})<\/td>\s*<td>\d+<\/td>\s*<td>\s*<a[^>]*onclick="window\.open\('([^']+)','_blank'\);"/gi;
      
      let match;
      while ((match = gazettePattern.exec(html)) !== null) {
        const editionNumber = match[1];
        const dateStr = match[2]; // DD/MM/YYYY
        const pdfUrl = match[3];
        
        if (processedUrls.has(pdfUrl)) {
          continue;
        }
        
        try {
          // Parse date
          const [day, month, yearPart] = dateStr.split('/');
          const gazetteDate = new Date(`${yearPart}-${month}-${day}`);
          
          if (isNaN(gazetteDate.getTime())) {
            logger.warn(`Invalid date: ${dateStr}`);
            continue;
          }
          
          // Check if within date range
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }
          
          // Detect extra editions
          const isExtra = /\b(extra|suplemento|extraordin[aá]ri[oa]|sup|se)\b/i.test(pdfUrl) ||
                          /\b(extra|suplemento|extraordin[aá]ri[oa]|sup|se)\b/i.test(editionNumber);
          
          // Create gazette directly without URL resolution (site blocks HEAD requests)
          const gazette = this.createGazetteDirectly(gazetteDate, pdfUrl, {
            power: 'executive_legislative',
            editionNumber: editionNumber,
            isExtraEdition: isExtra,
          });
          
          processedUrls.add(pdfUrl);
          gazettes.push(gazette);
          logger.info(`Found gazette for ${toISODate(gazetteDate)} (edição ${editionNumber}): ${pdfUrl}`);
        } catch (error) {
          logger.error(`Error processing gazette:`, error as Error);
        }
      }
      
      // Also try to get the main page gazette for current year
      if (year === new Date().getFullYear()) {
        await this.crawlMainPage(processedUrls, gazettes);
      }
      
    } catch (error) {
      logger.error(`Error fetching year ${year}:`, error as Error);
    }
    
    return gazettes;
  }

  /**
   * Crawl the main publications page for the latest gazette
   */
  private async crawlMainPage(processedUrls: Set<string>, gazettes: Gazette[]): Promise<void> {
    const mainUrl = this.mangaratibaConfig.baseUrl;
    
    try {
      const response = await fetch(mainUrl, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      });
      this.requestCount++;
      
      if (!response.ok) {
        logger.warn(`Failed to fetch main page: ${response.status}`);
        return;
      }
      
      const html = await response.text();
      
      // Extract the featured gazette from main page
      // Pattern: onclick="window.open('URL','_blank');" with date like "21 de janeiro de 2026"
      const featuredPattern = /onclick="window\.open\('([^']+\.pdf)','_blank'\);"/gi;
      const datePattern = /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i;
      const editionPattern = /D\.O\.M\.\s*Edição\s*(\d+)/i;
      
      // Find PDF URL
      const pdfMatch = featuredPattern.exec(html);
      if (!pdfMatch) return;
      
      const pdfUrl = pdfMatch[1];
      if (processedUrls.has(pdfUrl)) return;
      
      // Find date
      const dateMatch = datePattern.exec(html);
      if (!dateMatch) return;
      
      const day = dateMatch[1].padStart(2, '0');
      const monthName = dateMatch[2].toLowerCase();
      const year = dateMatch[3];
      
      const monthMap: Record<string, string> = {
        'janeiro': '01', 'fevereiro': '02', 'março': '03', 'marco': '03',
        'abril': '04', 'maio': '05', 'junho': '06',
        'julho': '07', 'agosto': '08', 'setembro': '09',
        'outubro': '10', 'novembro': '11', 'dezembro': '12',
      };
      
      const month = monthMap[monthName];
      if (!month) return;
      
      const gazetteDate = new Date(`${year}-${month}-${day}`);
      if (isNaN(gazetteDate.getTime())) return;
      
      if (!this.isInDateRange(gazetteDate)) return;
      
      // Find edition number
      const editionMatch = editionPattern.exec(html);
      const editionNumber = editionMatch ? editionMatch[1] : undefined;
      
      // Create gazette directly without URL resolution (site blocks HEAD requests)
      const gazette = this.createGazetteDirectly(gazetteDate, pdfUrl, {
        power: 'executive_legislative',
        editionNumber: editionNumber,
        isExtraEdition: false,
      });
      
      processedUrls.add(pdfUrl);
      gazettes.push(gazette);
      logger.info(`Found featured gazette for ${toISODate(gazetteDate)} (edição ${editionNumber || 'N/A'}): ${pdfUrl}`);
    } catch (error) {
      logger.error(`Error fetching main page:`, error as Error);
    }
  }

  /**
   * Creates a Gazette object directly without URL resolution
   * Used when the target site blocks HEAD requests used for URL resolution
   */
  private createGazetteDirectly(
    date: Date,
    fileUrl: string,
    options: {
      editionNumber?: string;
      isExtraEdition?: boolean;
      power?: 'executive' | 'legislative' | 'executive_legislative';
    } = {}
  ): Gazette {
    return {
      date: toISODate(date),
      fileUrl: fileUrl,
      territoryId: this.spiderConfig.territoryId,
      scrapedAt: getCurrentTimestamp(),
      editionNumber: options.editionNumber,
      isExtraEdition: options.isExtraEdition ?? false,
      power: options.power ?? 'executive_legislative',
    };
  }
}
