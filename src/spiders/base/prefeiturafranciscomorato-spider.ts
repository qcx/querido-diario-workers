import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraFranciscoMoratoConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * PrefeituraFranciscoMoratoSpider implementation
 * 
 * Crawls Francisco Morato's official gazette website which uses a custom API.
 * 
 * API Endpoint: {baseUrl}/ServDiario?pAno=YYYY&pMes=MM&pOpcao=consultaEdicao
 * 
 * Response format:
 * [
 *   {
 *     "codDiario": 0,
 *     "dataInsercao": "2026-01-05 16:42:19.0",
 *     "nomeArquivo": "file-9548486746637-.pdf"
 *   },
 *   ...
 * ]
 * 
 * PDF URL: {baseUrl}/anexos/{nomeArquivo}
 */
export class PrefeituraFranciscoMoratoSpider extends BaseSpider {
  protected franciscoMoratoConfig: PrefeituraFranciscoMoratoConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.franciscoMoratoConfig = spiderConfig.config as PrefeituraFranciscoMoratoConfig;
    
    if (!this.franciscoMoratoConfig.baseUrl) {
      throw new Error(`PrefeituraFranciscoMoratoSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraFranciscoMoratoSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.franciscoMoratoConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];
    const processedUrls = new Set<string>();

    try {
      // Generate month/year combinations for the date range
      const monthYearCombinations = this.generateMonthYearCombinations();
      logger.info(`Generated ${monthYearCombinations.length} month/year combinations to check`);

      // Fetch gazettes for each month
      for (const { year, month } of monthYearCombinations) {
        try {
          const monthGazettes = await this.crawlMonth(year, month, processedUrls);
          gazettes.push(...monthGazettes);
        } catch (error) {
          logger.error(`Error crawling ${year}/${month}:`, error as Error);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Generate list of month/year combinations from start date to end date
   */
  private generateMonthYearCombinations(): { year: number; month: number }[] {
    const combinations: { year: number; month: number }[] = [];
    const current = new Date(this.startDate.getFullYear(), this.startDate.getMonth(), 1);
    const end = new Date(this.endDate.getFullYear(), this.endDate.getMonth(), 1);

    while (current <= end) {
      combinations.push({
        year: current.getFullYear(),
        month: current.getMonth() + 1, // JavaScript months are 0-indexed
      });
      
      // Move to next month
      current.setMonth(current.getMonth() + 1);
    }

    return combinations;
  }

  /**
   * Crawl gazettes for a specific month
   */
  private async crawlMonth(year: number, month: number, processedUrls: Set<string>): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      // Build API URL
      const apiUrl = `${this.franciscoMoratoConfig.baseUrl}/ServDiario?pAno=${year}&pMes=${month}&pOpcao=consultaEdicao`;
      logger.debug(`Fetching API: ${apiUrl}`);

      const response = await this.fetch(apiUrl);
      
      // Parse JSON response
      let apiResponse: FranciscoMoratoApiResponse[];
      try {
        apiResponse = JSON.parse(response);
      } catch (parseError) {
        logger.warn(`Failed to parse JSON response for ${year}/${month}`);
        return gazettes;
      }

      if (!Array.isArray(apiResponse) || apiResponse.length === 0) {
        logger.debug(`No gazettes found for ${year}/${month}`);
        return gazettes;
      }

      logger.debug(`Found ${apiResponse.length} gazettes for ${year}/${month}`);

      // Process each gazette entry
      for (const entry of apiResponse) {
        try {
          if (!entry.nomeArquivo || !entry.dataInsercao) {
            logger.debug('Skipping entry without nomeArquivo or dataInsercao');
            continue;
          }

          // Build PDF URL
          const pdfUrl = `${this.franciscoMoratoConfig.baseUrl}/anexos/${entry.nomeArquivo}`;

          // Skip if already processed
          if (processedUrls.has(pdfUrl)) {
            logger.debug(`Skipping duplicate PDF URL: ${pdfUrl}`);
            continue;
          }

          // Parse date from dataInsercao (format: "2026-01-05 16:42:19.0")
          const dateParts = entry.dataInsercao.split(' ')[0].split('-');
          if (dateParts.length !== 3) {
            logger.warn(`Could not parse date from: ${entry.dataInsercao}`);
            continue;
          }

          const [yearStr, monthStr, dayStr] = dateParts;
          const gazetteDate = new Date(
            parseInt(yearStr, 10),
            parseInt(monthStr, 10) - 1, // JavaScript months are 0-indexed
            parseInt(dayStr, 10)
          );

          // Check if date is in our crawl range
          if (!this.isInDateRange(gazetteDate)) {
            logger.debug(`Gazette date ${toISODate(gazetteDate)} is outside crawl range`);
            continue;
          }

          // Mark URL as processed
          processedUrls.add(pdfUrl);

          // Create gazette object
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            power: 'executive_legislative',
            sourceText: `Diário Oficial de ${toISODate(gazetteDate)}`,
          });

          if (gazette) {
            gazettes.push(gazette);
          }

        } catch (error) {
          logger.error(`Error processing gazette entry:`, error as Error);
        }
      }

    } catch (error) {
      logger.error(`Error fetching month ${year}/${month}:`, error as Error);
    }

    return gazettes;
  }
}

/**
 * Response type from Francisco Morato API
 */
interface FranciscoMoratoApiResponse {
  codDiario: number;
  dataInsercao: string;
  nomeArquivo: string;
}

