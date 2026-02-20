import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraRjSeropedicaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Response item from Bubble.io API for Seropédica boletim_oficial
 */
interface BoletimOficialItem {
  _id: string;
  link_do_pdf: string;
  data_da_edicao: string;
  numero_da_edicao: number;
  edicao_extra: 'sim' | 'não';
  ano_da_edicao: string;
  apagado?: boolean;
  'Created Date': string;
  'Modified Date': string;
  'Created By': string;
}

/**
 * Response structure from Bubble.io API
 */
interface BubbleApiResponse {
  response: {
    cursor: number;
    results: BoletimOficialItem[];
    count: number;
    remaining: number;
  };
}

/**
 * Spider for Prefeitura de Seropédica - RJ
 * 
 * This spider extracts gazettes from the Portal da Transparência de Seropédica,
 * which is built on Bubble.io platform.
 * 
 * API Structure:
 * - Endpoint: {baseUrl}/api/1.1/obj/boletim_oficial
 * - Parameters: limit, cursor, sort_field, descending, constraints
 * - Response: Bubble.io standard response with results array
 * 
 * Data Fields:
 * - link_do_pdf: URL to the PDF file (may start with // for protocol-relative URLs)
 * - data_da_edicao: Publication date in ISO format
 * - numero_da_edicao: Edition number
 * - edicao_extra: "sim" for extra editions, "não" for regular
 * - apagado: Boolean indicating if the item was deleted
 */
export class PrefeituraRjSeropedicaSpider extends BaseSpider {
  private seropedicaConfig: PrefeituraRjSeropedicaConfig;
  private readonly API_LIMIT = 100; // Max items per request

  constructor(config: SpiderConfig, dateRange: DateRange, _browser?: Fetcher) {
    super(config, dateRange);
    this.seropedicaConfig = config.config as PrefeituraRjSeropedicaConfig;
    // This spider uses direct API calls, no browser needed
  }

  /**
   * Set browser for client-side rendering (not used by this spider as it uses direct API calls)
   */
  setBrowser(_browser: Fetcher): void {
    // This spider doesn't need browser - uses direct API fetch
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let cursor = 0;
    let hasMore = true;

    logger.info(`Crawling Seropédica gazettes from ${this.seropedicaConfig.baseUrl}...`);

    // Build constraints for date filtering
    const startDateConstraint = {
      key: 'data_da_edicao',
      constraint_type: 'greater than',
      value: this.startDate.toISOString()
    };
    const endDateConstraint = {
      key: 'data_da_edicao',
      constraint_type: 'less than',
      value: new Date(this.endDate.getTime() + 24 * 60 * 60 * 1000).toISOString() // Add 1 day to include end date
    };

    while (hasMore) {
      try {
        // Build API URL with constraints
        const constraints = JSON.stringify([startDateConstraint, endDateConstraint]);
        const apiUrl = new URL(`${this.seropedicaConfig.baseUrl}/api/1.1/obj/boletim_oficial`);
        apiUrl.searchParams.set('limit', this.API_LIMIT.toString());
        apiUrl.searchParams.set('cursor', cursor.toString());
        apiUrl.searchParams.set('sort_field', 'data_da_edicao');
        apiUrl.searchParams.set('descending', 'true');
        apiUrl.searchParams.set('constraints', constraints);

        logger.debug(`Fetching page with cursor ${cursor}: ${apiUrl.toString()}`);

        const response = await fetch(apiUrl.toString(), {
          headers: {
            'Accept': 'application/json',
          }
        });
        this.requestCount++;

        if (!response.ok) {
          logger.error(`Failed to fetch Seropédica API: ${response.status} ${response.statusText}`);
          break;
        }

        const data = await response.json() as BubbleApiResponse;

        if (!data.response || !Array.isArray(data.response.results)) {
          logger.error('Invalid API response structure');
          break;
        }

        const items = data.response.results;
        logger.debug(`Received ${items.length} items, remaining: ${data.response.remaining}`);

        for (const item of items) {
          // Skip deleted items
          if (item.apagado === true) {
            continue;
          }

          // Parse the publication date
          const date = new Date(item.data_da_edicao);
          
          // Double-check date range (API constraints should handle this, but be safe)
          if (date < this.startDate || date > this.endDate) {
            continue;
          }

          // Normalize PDF URL (handle protocol-relative URLs)
          let pdfUrl = item.link_do_pdf;
          if (pdfUrl.startsWith('//')) {
            pdfUrl = 'https:' + pdfUrl;
          } else if (!pdfUrl.startsWith('http')) {
            // Handle relative URLs
            const baseUrl = new URL(this.seropedicaConfig.baseUrl);
            pdfUrl = `${baseUrl.protocol}//${baseUrl.host}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }

          const gazette: Gazette = {
            date: date.toISOString().split('T')[0],
            fileUrl: pdfUrl,
            territoryId: this.config.territoryId,
            scrapedAt: new Date().toISOString(),
            editionNumber: item.numero_da_edicao?.toString(),
            isExtraEdition: item.edicao_extra === 'sim',
            power: 'executive',
          };

          gazettes.push(gazette);
        }

        // Check if there are more results
        if (data.response.remaining > 0) {
          cursor += items.length;
        } else {
          hasMore = false;
        }

        // Safety check to prevent infinite loops
        if (items.length === 0) {
          hasMore = false;
        }

      } catch (error) {
        logger.error(`Error fetching Seropédica gazettes:`, error as Error);
        break;
      }
    }

    logger.info(`Successfully crawled ${gazettes.length} gazettes for Seropédica`);
    return gazettes;
  }
}
