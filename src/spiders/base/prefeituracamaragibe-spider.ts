import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp } from '../../utils/date-utils';

/**
 * Configuration for Camaragibe spider
 */
export interface PrefeituracamaragibeConfig {
  type: "prefeituracamaragibe";
  /** Base URL for the diário oficial portal */
  baseUrl: string;
}

/**
 * PrefeituracamaragibeSpider implementation
 * 
 * Crawls the custom Diário Oficial portal for Camaragibe - PE.
 * The portal uses a simple structure with PDFs stored in a predictable pattern:
 * /storage/edicao/edicaoYYYY-MM-DD.pdf
 * 
 * Example: https://diariooficial.camaragibe.pe.gov.br/
 */
export class PrefeituracamaragibeSpider extends BaseSpider {
  private readonly camaragibeConfig: PrefeituracamaragibeConfig;
  private readonly baseUrl: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.camaragibeConfig = spiderConfig.config as PrefeituracamaragibeConfig;
    this.baseUrl = this.camaragibeConfig.baseUrl || 'https://diariooficial.camaragibe.pe.gov.br';
    
    logger.info(`Initializing PrefeituracamaragibeSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling Camaragibe from ${toISODate(this.startDate)} to ${toISODate(this.endDate)}...`);
    const gazettes: Gazette[] = [];

    try {
      // First, try to fetch the main page to understand the structure
      const response = await fetch(this.baseUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        },
      });

      if (response.ok) {
        const html = await response.text();
        
        // Extract any PDF links from the page
        const pdfPattern = /href\s*=\s*["']([^"']*\.pdf)["']/gi;
        const pdfMatches = [...html.matchAll(pdfPattern)];
        
        // Extract edition dates from the page structure
        const datePattern = /edicao(\d{4})-(\d{2})-(\d{2})/gi;
        const dateMatches = [...html.matchAll(datePattern)];
        
        logger.debug(`Found ${pdfMatches.length} PDF links and ${dateMatches.length} date patterns`);
        
        const startDateStr = toISODate(this.startDate);
        const endDateStr = toISODate(this.endDate);
        
        // Process extracted PDFs
        for (const match of pdfMatches) {
          let pdfUrl = match[1];
          
          // Extract date from PDF URL
          const urlDateMatch = pdfUrl.match(/(\d{4})-(\d{2})-(\d{2})/);
          if (urlDateMatch) {
            const dateStr = `${urlDateMatch[1]}-${urlDateMatch[2]}-${urlDateMatch[3]}`;
            
            if (dateStr >= startDateStr && dateStr <= endDateStr) {
              // Make URL absolute
              if (!pdfUrl.startsWith('http')) {
                pdfUrl = new URL(pdfUrl, this.baseUrl).toString();
              }
              
              const gazette: Gazette = {
                date: dateStr,
                fileUrl: pdfUrl,
                territoryId: this.spiderConfig.territoryId,
                scrapedAt: getCurrentTimestamp(),
                isExtraEdition: pdfUrl.toLowerCase().includes('extra'),
                power: 'executive_legislative',
                sourceText: `Diário Oficial de Camaragibe - ${urlDateMatch[3]}/${urlDateMatch[2]}/${urlDateMatch[1]}`,
              };
              
              gazettes.push(gazette);
              logger.info(`Found gazette for ${dateStr} from page`);
            }
          }
        }
      }
      
      // Iterate through dates and try predictable PDF URLs
      // Pattern: /storage/edicao/edicaoYYYY-MM-DD.pdf
      const currentDate = new Date(this.startDate);
      const endDateObj = new Date(this.endDate);
      const processedDates = new Set<string>();
      
      // Track already found dates
      for (const gazette of gazettes) {
        processedDates.add(gazette.date);
      }
      
      while (currentDate <= endDateObj) {
        const year = currentDate.getFullYear();
        const month = (currentDate.getMonth() + 1).toString().padStart(2, '0');
        const day = currentDate.getDate().toString().padStart(2, '0');
        const dateStr = toISODate(currentDate);
        
        // Skip if already found
        if (processedDates.has(dateStr)) {
          currentDate.setDate(currentDate.getDate() + 1);
          continue;
        }
        
        // Try different PDF URL patterns
        const pdfUrls = [
          `${this.baseUrl}/storage/edicao/edicao${year}-${month}-${day}.pdf`,
          `${this.baseUrl}/storage/edicao/edicao_${year}-${month}-${day}.pdf`,
          `${this.baseUrl}/storage/edicoes/${year}/${month}/edicao${year}-${month}-${day}.pdf`,
          `${this.baseUrl}/edicoes/${year}/${month}/${day}/diario.pdf`,
          `${this.baseUrl}/pdf/${year}${month}${day}.pdf`,
        ];
        
        for (const pdfUrl of pdfUrls) {
          try {
            const headResponse = await fetch(pdfUrl, {
              method: 'HEAD',
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              },
            });
            
            if (headResponse.ok) {
              const gazette: Gazette = {
                date: dateStr,
                fileUrl: pdfUrl,
                territoryId: this.spiderConfig.territoryId,
                scrapedAt: getCurrentTimestamp(),
                isExtraEdition: false,
                power: 'executive_legislative',
                sourceText: `Diário Oficial de Camaragibe - ${day}/${month}/${year}`,
              };
              
              gazettes.push(gazette);
              processedDates.add(dateStr);
              logger.info(`Found gazette for ${dateStr}`);
              break;
            }
          } catch (error) {
            // PDF doesn't exist at this URL
          }
        }
        
        currentDate.setDate(currentDate.getDate() + 1);
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from Camaragibe`);
      
    } catch (error) {
      logger.error(`Error crawling Camaragibe:`, error as Error);
    }

    return gazettes;
  }
}
