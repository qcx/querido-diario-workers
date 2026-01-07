import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';

interface PrefeituraSumareConfig {
  type: 'prefeiturasumare';
  url: string;
}

/**
 * Spider for Sumaré SP gazette website
 * 
 * Site structure:
 * - URL: https://www.sumare.sp.gov.br/Diario.Oficial.php?edicao=todas
 * - Each gazette is in a <li class="DOM"> card
 * - PDF link: <a href="pdfDiario.php?edicao=XXXX&pdf=diario-XXXX-hash.pdf" title="Abrir PDF da Edição XXXX de DD/MM/YYYY">
 * - Date in footer: <div class="areaMetade">DD/MM/YYYY</div>
 * - Edition number in header: <div class="file-title">Edição XXXX</div>
 */
export class PrefeituraSumareSpider extends BaseSpider {
  private baseUrl: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    const config = spiderConfig.config as PrefeituraSumareConfig;
    this.baseUrl = config.url;
    
    logger.info(`Initializing PrefeituraSumareSpider for ${spiderConfig.name} with URL: ${this.baseUrl}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling Sumaré gazette website for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Fetch the main page with all editions
      const response = await fetch(this.baseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        }
      });
      this.requestCount++;

      if (!response.ok) {
        throw new Error(`HTTP request failed with status ${response.status}`);
      }

      const html = await response.text();
      
      // Extract all gazette links using regex
      // The HTML structure is: <a target="_blank" href="https://..." class="..." title="Abrir PDF da Edição XXXX de DD/MM/YYYY">
      // We need to capture both href and title from the same <a> tag
      const linkPattern = /<a[^>]*href="([^"]*pdfDiario\.php[^"]*)"[^>]*title="Abrir PDF da Edi[çc][ãa]o (\d+) de (\d{2})\/(\d{2})\/(\d{4})"[^>]*>/gi;
      
      let match;
      while ((match = linkPattern.exec(html)) !== null) {
        try {
          const [, href, editionNumber, day, month, year] = match;
          
          // Parse date
          const gazetteDate = new Date(Date.UTC(
            parseInt(year),
            parseInt(month) - 1,
            parseInt(day)
          ));

          // Check if date is in our crawl range
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }

          // Build absolute URL
          let pdfUrl = href;
          if (!pdfUrl.startsWith('http')) {
            const urlObj = new URL(this.baseUrl);
            pdfUrl = `${urlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }

          // Check for extra edition in the link context
          // Look for "Extra" or "Extraordin" near this link
          const linkIndex = match.index;
          const contextStart = Math.max(0, linkIndex - 200);
          const contextEnd = Math.min(html.length, linkIndex + 500);
          const context = html.substring(contextStart, contextEnd);
          const isExtraEdition = /extra|extraordin[áa]ri/i.test(context);

          // Create gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber,
            isExtraEdition,
            power: 'executive_legislative',
            sourceText: `Edição ${editionNumber} - ${day}/${month}/${year}`,
          });

          if (gazette) {
            gazettes.push(gazette);
            logger.debug(`Found gazette: Edição ${editionNumber} - ${year}-${month}-${day}`);
          }
        } catch (error) {
          logger.warn(`Error processing gazette match`, { error: error instanceof Error ? error.message : String(error) });
        }
      }

      // If no gazettes found with the first pattern, try alternative pattern
      if (gazettes.length === 0) {
        logger.debug('First pattern failed, trying alternative extraction');
        
        // Alternative: Extract from card elements
        // Pattern: <div class="areaMetade">DD/MM/YYYY</div> ... href="...pdfDiario.php..."
        const cardPattern = /<li[^>]*class="[^"]*DOM[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
        
        while ((match = cardPattern.exec(html)) !== null) {
          try {
            const cardHtml = match[1];
            
            // Extract PDF URL
            const urlMatch = cardHtml.match(/href="([^"]*pdfDiario\.php[^"]*)"/i);
            if (!urlMatch) continue;
            
            // Extract date from title or footer
            const dateMatch = cardHtml.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (!dateMatch) continue;
            
            // Extract edition number
            const editionMatch = cardHtml.match(/[Ee]di[çc][ãa]o\s*(\d+)/);
            const editionNumber = editionMatch ? editionMatch[1] : undefined;
            
            const [, day, month, year] = dateMatch;
            const gazetteDate = new Date(Date.UTC(
              parseInt(year),
              parseInt(month) - 1,
              parseInt(day)
            ));
            
            if (!this.isInDateRange(gazetteDate)) {
              continue;
            }
            
            // Build absolute URL
            let pdfUrl = urlMatch[1];
            if (!pdfUrl.startsWith('http')) {
              const urlObj = new URL(this.baseUrl);
              pdfUrl = `${urlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
            }
            
            const isExtraEdition = /extra|extraordin[áa]ri/i.test(cardHtml);
            
            const gazette = await this.createGazette(gazetteDate, pdfUrl, {
              editionNumber,
              isExtraEdition,
              power: 'executive_legislative',
              sourceText: `Edição ${editionNumber} - ${day}/${month}/${year}`,
            });
            
            if (gazette) {
              gazettes.push(gazette);
              logger.debug(`Found gazette (alt): Edição ${editionNumber} - ${year}-${month}-${day}`);
            }
          } catch (error) {
            logger.warn(`Error processing card match`, { error: error instanceof Error ? error.message : String(error) });
          }
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from Sumaré`);
      
    } catch (error) {
      logger.error(`Error crawling Sumaré gazette website:`, error as Error);
      throw error;
    }

    return gazettes;
  }
}

