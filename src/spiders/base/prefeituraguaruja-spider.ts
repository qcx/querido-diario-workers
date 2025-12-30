import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraguarujaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { getMonthlySequence } from '../../utils/date-utils';
import { fetchWithRetry } from '../../utils/http-client';
import { logger } from '../../utils/logger';

interface DiarioOficialPost {
  ID: number;
  post_title: string; // Date in DD/MM/YYYY format
  post_date: string;
  metas: {
    data: string; // Date in DD/MM/YYYY format
    pdf: string; // Full PDF URL
    _thumbnail_id?: string;
  };
}

/**
 * Spider for Prefeitura de Guarujá - Diário Oficial
 * 
 * Site Structure:
 * - Main URL: https://www.guaruja.sp.gov.br/edicoes-diario-oficial
 * - Uses WordPress with custom API
 * 
 * API Endpoint:
 * - GET /list-diario-oficial?data=YYYY-MM
 * - Returns JSON array with posts containing PDF URLs in metas.pdf
 * 
 * PDF URL pattern:
 * - https://www.guaruja.sp.gov.br/plataforma/wp-content/uploads/{YYYY}/{MM}/{filename}.pdf
 */
export class PrefeituraguarujaSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const guarujaConfig = config.config as PrefeituraguarujaConfig;
    this.baseUrl = guarujaConfig.baseUrl || 'https://www.guaruja.sp.gov.br';
  }

  /**
   * Set browser instance (for queue consumer context)
   * Note: This spider doesn't require browser automation
   */
  setBrowser(_browser: Fetcher): void {
    // Not needed - this spider uses HTTP requests
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const monthDates = getMonthlySequence(this.startDate, this.endDate);

    logger.info(`Crawling Guarujá gazettes for ${monthDates.length} months...`);

    for (const monthDate of monthDates) {
      const year = monthDate.getFullYear();
      const month = monthDate.getMonth() + 1;
      
      try {
        const monthGazettes = await this.fetchGazettesForMonth(year, month);
        
        // Filter by exact date range
        for (const gazette of monthGazettes) {
          const gazetteDate = new Date(gazette.date);
          if (gazetteDate >= this.startDate && gazetteDate <= this.endDate) {
            gazettes.push(gazette);
          }
        }
      } catch (error) {
        logger.error(`Error fetching gazettes for ${year}-${month}: ${error}`);
      }

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`);
    return gazettes;
  }

  private async fetchGazettesForMonth(year: number, month: number): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const monthStr = String(month).padStart(2, '0');
    const apiDate = `${year}-${monthStr}`;

    logger.debug(`Fetching Guarujá gazettes for ${apiDate}`);

    const endpoint = `${this.baseUrl}/list-diario-oficial?data=${apiDate}`;
    
    try {
      const responseText = await fetchWithRetry(endpoint, {
        headers: {
          'Accept': 'application/json',
        },
        timeout: 15000,
        retries: 2,
      });

      if (!responseText || responseText.trim() === '' || responseText.trim() === '[]') {
        logger.debug(`No gazettes found for ${apiDate}`);
        return gazettes;
      }

      let data: DiarioOficialPost[];
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        logger.warn(`Failed to parse JSON for ${apiDate}: ${parseError}`);
        return gazettes;
      }

      if (!Array.isArray(data) || data.length === 0) {
        logger.debug(`No gazettes found for ${apiDate}`);
        return gazettes;
      }

      for (const post of data) {
        // Skip posts without PDF URL
        if (!post.metas || !post.metas.pdf) {
          continue;
        }

        // Parse date from metas.data (format: DD/MM/YYYY)
        const dateStr = post.metas.data;
        const dateMatch = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (!dateMatch) {
          logger.warn(`Could not parse date: ${dateStr}`);
          continue;
        }

        const [, day, monthParsed, yearParsed] = dateMatch;
        const gazetteDate = new Date(`${yearParsed}-${monthParsed}-${day}`);

        // Skip if date parsing failed
        if (isNaN(gazetteDate.getTime())) {
          logger.warn(`Invalid date: ${dateStr}`);
          continue;
        }

        const pdfUrl = post.metas.pdf;
        
        // Determine if it's an extra edition
        const isExtra = pdfUrl.toLowerCase().includes('extra');

        const gazette = await this.createGazette(gazetteDate, pdfUrl, {
          power: 'executive_legislative',
          isExtraEdition: isExtra,
        });

        if (gazette) {
          gazettes.push(gazette);
        }
      }
    } catch (error) {
      logger.error(`Error fetching gazettes for ${apiDate}: ${error}`);
    }

    return gazettes;
  }
}

