import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeiturauberlandiaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for Prefeitura de Uberlândia - Diário Oficial
 * 
 * Site structure:
 * - Diário Oficial published as WordPress custom post type
 * - URLs: https://www.uberlandia.mg.gov.br/diariooficial/edicao-{number}/
 * - Redirects to PDF: https://docs.uberlandia.mg.gov.br/wp-content/uploads/{YYYY}/{MM}/{number}.pdf
 * 
 * The site has a WAF that blocks direct curl requests, but the redirect pattern
 * allows us to directly construct PDF URLs from edition numbers.
 * 
 * Strategy:
 * 1. Start from a known recent edition number
 * 2. Iterate backwards/forwards to find gazettes within date range
 * 3. For each edition, check if PDF exists and extract date from URL path
 */
export class PrefeiturauberlandiaSpider extends BaseSpider {
  private baseUrl: string;
  private pdfBaseUrl: string;
  // Known edition reference: 7032 was published on 2025-01-28
  // Estimating ~1 edition per day
  private referenceEdition = 7032;
  private referenceDate = new Date('2025-01-28');
  
  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const uberlandiaConfig = config.config as PrefeiturauberlandiaConfig;
    this.baseUrl = uberlandiaConfig.baseUrl || 'https://www.uberlandia.mg.gov.br';
    this.pdfBaseUrl = 'https://docs.uberlandia.mg.gov.br/wp-content/uploads';
    logger.info(`Initializing PrefeiturauberlandiaSpider for ${config.name}`);
  }

  /**
   * Estimate edition number from a date
   * Based on reference: edition 7032 was published on 2025-01-28
   */
  private estimateEditionFromDate(date: Date): number {
    const daysDiff = Math.floor((date.getTime() - this.referenceDate.getTime()) / (1000 * 60 * 60 * 24));
    // Assuming ~1 edition per weekday (5 per week on average)
    const estimatedEditionDiff = Math.floor(daysDiff * 0.7); // ~5/7 days have editions
    return this.referenceEdition + estimatedEditionDiff;
  }

  /**
   * Check if a year/month is within the date range
   * More flexible than exact date matching since we only have month/year from the URL
   */
  private isMonthInRange(year: number, month: number): boolean {
    const startDate = new Date(this.dateRange.start);
    const endDate = new Date(this.dateRange.end);
    
    // Create first and last day of the month
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0); // Last day of month
    
    // Check if the month overlaps with the date range
    return monthEnd >= startDate && monthStart <= endDate;
  }

  /**
   * Try to fetch PDF and get its date from headers or URL
   */
  private async checkEdition(editionNumber: number): Promise<{ date: Date; pdfUrl: string } | null> {
    try {
      // Try common month/year combinations for the edition
      // The PDF URL pattern is: docs.uberlandia.mg.gov.br/wp-content/uploads/YYYY/MM/{edition}.pdf
      
      // Calculate possible year/month based on edition number estimate
      const estimatedDate = new Date(this.referenceDate);
      const daysDiff = Math.floor((editionNumber - this.referenceEdition) / 0.7);
      estimatedDate.setDate(estimatedDate.getDate() + daysDiff);
      
      // Try the estimated month and adjacent months
      const monthsToTry: { year: number; month: number }[] = [];
      
      for (let offset = -2; offset <= 2; offset++) {
        const tryDate = new Date(estimatedDate);
        tryDate.setMonth(tryDate.getMonth() + offset);
        monthsToTry.push({
          year: tryDate.getFullYear(),
          month: tryDate.getMonth() + 1
        });
      }
      
      // Remove duplicates
      const uniqueMonths = monthsToTry.filter((m, i, arr) => 
        arr.findIndex(x => x.year === m.year && x.month === m.month) === i
      );

      for (const { year, month } of uniqueMonths) {
        const monthStr = month.toString().padStart(2, '0');
        const pdfUrl = `${this.pdfBaseUrl}/${year}/${monthStr}/${editionNumber}.pdf`;
        
        try {
          // Try HEAD request to check if PDF exists
          const response = await fetch(pdfUrl, { 
            method: 'HEAD',
            redirect: 'follow'
          });
          
          if (response.ok) {
            // PDF exists! Check if the month is within our date range
            if (!this.isMonthInRange(year, month)) {
              logger.debug(`Edition ${editionNumber} found at ${pdfUrl} but month ${year}/${monthStr} out of date range`);
              return null;
            }
            
            // Use estimated date based on edition number progression
            // For more accurate dates, we estimate based on the edition's position within the month
            const startDate = new Date(this.dateRange.start);
            const endDate = new Date(this.dateRange.end);
            
            // Use the estimated date if it's within range, otherwise use a date within the month
            let gazetteDate = estimatedDate;
            
            // If estimated date is not in the same month as the PDF, adjust it
            if (estimatedDate.getMonth() !== month - 1 || estimatedDate.getFullYear() !== year) {
              // Use the last day of the month as approximation for recent editions
              gazetteDate = new Date(year, month, 0); // Last day of month
            }
            
            // Clamp to date range
            if (gazetteDate < startDate) {
              gazetteDate = startDate;
            }
            if (gazetteDate > endDate) {
              gazetteDate = endDate;
            }
            
            logger.debug(`Found edition ${editionNumber} at ${pdfUrl}, date: ${gazetteDate.toISOString().split('T')[0]}`);
            return { date: gazetteDate, pdfUrl };
          }
        } catch (error) {
          // PDF doesn't exist at this path, try next
          continue;
        }
      }
      
      return null;
    } catch (error) {
      logger.debug(`Error checking edition ${editionNumber}: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Try to directly access the redirect URL to get the real PDF location
   */
  private async getEditionViaRedirect(editionNumber: number): Promise<{ date: Date; pdfUrl: string } | null> {
    try {
      const editionUrl = `${this.baseUrl}/diariooficial/edicao-${editionNumber}/`;
      
      // Fetch with redirect follow to get final URL
      const response = await fetch(editionUrl, {
        method: 'HEAD',
        redirect: 'follow'
      });

      const finalUrl = response.url;
      
      if (finalUrl.includes('.pdf')) {
        // Extract date from URL path: .../YYYY/MM/number.pdf
        const match = finalUrl.match(/\/(\d{4})\/(\d{2})\/\d+\.pdf$/);
        
        if (match) {
          const year = parseInt(match[1]);
          const month = parseInt(match[2]);
          
          // Check if the month is within our date range
          if (!this.isMonthInRange(year, month)) {
            logger.debug(`Edition ${editionNumber} found via redirect but month ${year}/${month.toString().padStart(2, '0')} out of date range`);
            return null;
          }
          
          // Use the last day of the month as the gazette date (most recent approximation)
          const startDate = new Date(this.dateRange.start);
          const endDate = new Date(this.dateRange.end);
          let gazetteDate = new Date(year, month, 0); // Last day of month
          
          // Clamp to date range
          if (gazetteDate < startDate) {
            gazetteDate = startDate;
          }
          if (gazetteDate > endDate) {
            gazetteDate = endDate;
          }
          
          logger.debug(`Found edition ${editionNumber} via redirect: ${finalUrl}, date: ${gazetteDate.toISOString().split('T')[0]}`);
          return { date: gazetteDate, pdfUrl: finalUrl };
        }
      }
      
      return null;
    } catch (error) {
      // Site may block direct access, fall back to PDF URL guessing
      return null;
    }
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Uberlândia for ${this.config.name}...`);

    try {
      const startDate = new Date(this.dateRange.start);
      const endDate = new Date(this.dateRange.end);
      
      // Estimate edition range to search
      const startEdition = this.estimateEditionFromDate(startDate) - 10; // Buffer
      const endEdition = this.estimateEditionFromDate(endDate) + 10; // Buffer
      
      logger.info(`Searching editions from ${startEdition} to ${endEdition}`);
      
      // Track found editions to avoid duplicates
      const foundEditions = new Set<number>();
      let consecutiveNotFound = 0;
      const maxConsecutiveNotFound = 20;

      // Search from end date backwards (most recent first)
      for (let edition = endEdition; edition >= startEdition && consecutiveNotFound < maxConsecutiveNotFound; edition--) {
        if (foundEditions.has(edition)) {
          continue;
        }

        // First try direct PDF URL (faster)
        let result = await this.checkEdition(edition);
        
        // If that fails, try via redirect (may be blocked by WAF)
        if (!result) {
          result = await this.getEditionViaRedirect(edition);
        }

        if (result) {
          consecutiveNotFound = 0;
          foundEditions.add(edition);
          
          // Create gazette
          const gazette = await this.createGazette(result.date, result.pdfUrl, {
            editionNumber: edition.toString(),
            power: 'executive_legislative',
            sourceText: `Diário Oficial de Uberlândia - Edição ${edition}`,
          });
          
          if (gazette) {
            gazettes.push(gazette);
          }
        } else {
          consecutiveNotFound++;
        }

        // Small delay to be respectful
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from Uberlândia`);

    } catch (error) {
      logger.error(`Error crawling Uberlândia:`, error as Error);
    }

    return gazettes;
  }
}

