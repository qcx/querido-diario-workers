import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraPiracicabaConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * PrefeituraPiracicabaSpider implementation
 * 
 * Crawls Piracicaba's official gazette website.
 * 
 * Site structure:
 * - Page URL: https://diariooficial.piracicaba.sp.gov.br/{YYYY}/{MM}/{DD}/
 * - PDF URL: https://files.pmp.sp.gov.br/semad/diariooficial/{YYYY}/{MM}/{YYYYMMDD}.pdf
 * 
 * The spider:
 * 1. Generates dates in the requested range
 * 2. For each date, constructs the PDF URL using the pattern above
 * 3. Verifies the PDF exists by checking HTTP status
 * 4. Creates gazette objects for valid PDFs
 */
export class PrefeituraPiracicabaSpider extends BaseSpider {
  protected piracicabaConfig: PrefeituraPiracicabaConfig;
  private static readonly PDF_BASE_URL = 'https://files.pmp.sp.gov.br/semad/diariooficial';

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.piracicabaConfig = spiderConfig.config as PrefeituraPiracicabaConfig;
    
    if (!this.piracicabaConfig.baseUrl) {
      throw new Error(`PrefeituraPiracicabaSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraPiracicabaSpider for ${spiderConfig.name}`);
  }

  /**
   * Set the browser instance (not needed for this spider, but kept for interface compatibility)
   */
  setBrowser(_browser: Fetcher): void {
    // Not needed - this spider doesn't require browser automation
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.piracicabaConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Generate dates to check (daily intervals)
      const dates = this.generateDateRange();
      logger.info(`Generated ${dates.length} dates to check`);

      // Process each date
      for (const date of dates) {
        try {
          const pdfUrl = this.buildPdfUrl(date);
          
          logger.debug(`Checking PDF URL: ${pdfUrl}`);

          // Check if PDF exists by making a HEAD request
          const exists = await this.checkPdfExists(pdfUrl);
          
          if (!exists) {
            logger.debug(`No gazette found for date ${toISODate(date)}`);
            continue;
          }

          // Create the gazette object
          const gazette = await this.createGazette(date, pdfUrl, {
            power: 'executive_legislative',
            sourceText: `Diário Oficial de Piracicaba - ${this.formatDateBrazilian(date)}`,
          });

          if (gazette) {
            gazettes.push(gazette);
            logger.info(`Found gazette for ${toISODate(date)}: ${pdfUrl}`);
          }

          // Add small delay between requests to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 200));

        } catch (error) {
          logger.error(`Error processing date ${toISODate(date)}:`, error as Error);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Build PDF URL for a given date
   * Pattern: https://files.pmp.sp.gov.br/semad/diariooficial/{YYYY}/{MM}/{YYYYMMDD}.pdf
   */
  private buildPdfUrl(date: Date): string {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const dateStr = `${year}${month}${day}`;
    
    return `${PrefeituraPiracicabaSpider.PDF_BASE_URL}/${year}/${month}/${dateStr}.pdf`;
  }

  /**
   * Check if PDF exists by making a HEAD request
   */
  private async checkPdfExists(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(10000),
      });
      
      return response.ok;
    } catch (error) {
      logger.debug(`Error checking PDF ${url}: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Generate array of dates to check (daily intervals)
   */
  private generateDateRange(): Date[] {
    const dates: Date[] = [];
    const currentDate = new Date(this.startDate);
    const endDate = new Date(this.endDate);

    while (currentDate <= endDate) {
      dates.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return dates;
  }

  /**
   * Format date in Brazilian format: DD de MMMM de YYYY
   */
  private formatDateBrazilian(date: Date): string {
    const months = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    
    const day = date.getDate().toString().padStart(2, '0');
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    
    return `${day} de ${month} de ${year}`;
  }
}
