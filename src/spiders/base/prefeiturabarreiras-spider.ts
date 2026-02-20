import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraBarreirasConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp, parseBrazilianDate } from '../../utils/date-utils';

/**
 * PrefeituraBarreirasSpider implementation
 * 
 * Crawls the official gazette from Barreiras, BA
 * Site: https://barreiras.ba.gov.br/diario-oficial/
 * 
 * The site is a WordPress page with direct links to PDF files.
 * PDFs are stored at: //www.barreiras.ba.gov.br/diario/pdf/{year}/diario{number}.pdf
 * 
 * The page contains links in format:
 * <a href="//www.barreiras.ba.gov.br/diario/pdf/2026/diario4581.pdf">21/01/2026 - Diário Oficial - Edição 4581</a>
 */
export class PrefeituraBarreirasSpider extends BaseSpider {
  protected barreirasConfig: PrefeituraBarreirasConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.barreirasConfig = spiderConfig.config as PrefeituraBarreirasConfig;
    
    if (!this.barreirasConfig.baseUrl) {
      throw new Error(`PrefeituraBarreirasSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraBarreirasSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.barreirasConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      const html = await this.fetch(this.barreirasConfig.baseUrl);
      const $ = this.loadHTML(html);

      // Find all PDF links
      const pdfLinks = $('a[href*=".pdf"]').toArray();
      
      logger.info(`Found ${pdfLinks.length} PDF links`);

      for (const link of pdfLinks) {
        try {
          const $link = $(link);
          let href = $link.attr('href');
          const text = $link.text().trim();
          
          // Skip if not a diario link
          if (!href?.includes('diario') || !href.includes('.pdf')) {
            continue;
          }

          // Fix protocol-relative URLs
          if (href.startsWith('//')) {
            href = `https:${href}`;
          } else if (!href.startsWith('http')) {
            href = `https://www.barreiras.ba.gov.br${href}`;
          }

          // Extract date and edition from the link text
          // Format: "21/01/2026 - Diário Oficial - Edição 4581"
          const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          const editionMatch = text.match(/Edição\s*(\d+)/i);
          
          if (!dateMatch) {
            // Try to extract from URL
            const urlMatch = href.match(/diario(\d+)\.pdf/i);
            if (!urlMatch) {
              logger.debug(`Could not extract date from: ${text}`);
              continue;
            }
          }

          let date: string;
          if (dateMatch) {
            const [, day, month, year] = dateMatch;
            date = `${year}-${month}-${day}`;
          } else {
            // Skip if we can't determine the date
            continue;
          }

          const dateObj = new Date(date);
          
          // Check if date is in range
          if (!this.isInDateRange(dateObj)) {
            continue;
          }

          const editionNumber = editionMatch ? editionMatch[1] : undefined;

          const gazette: Gazette = {
            date,
            fileUrl: href,
            territoryId: this.spiderConfig.territoryId,
            scrapedAt: getCurrentTimestamp(),
            isExtraEdition: false,
            power: 'executive_legislative',
            editionNumber,
            sourceText: text || `Diário Oficial ${date}`,
          };

          gazettes.push(gazette);
          logger.info(`Found gazette: ${date} - Edition ${editionNumber || 'N/A'}`);
        } catch (error) {
          logger.warn(`Error processing PDF link:`, { error: (error as Error).message });
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }
}
