import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, EatosConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * API response types for EATOS platform
 */
interface EatosActsResponse {
  acts: EatosAct[];
  totalPages?: number;
  total?: number;
}

interface EatosAct {
  id: number;
  entityDisplayName: string;
  edition: string;
  date: string;  // ISO date string like "2025-12-22T16:40:44.059813-03:00"
  entityPath: string;
}

/**
 * Spider for EATOS (e-Atos) platform
 * 
 * Uses the EATOS REST API directly to fetch gazettes:
 * - API endpoint: https://api.publicacoesmunicipais.com.br/api/v1/acts
 * - PDF endpoint: https://api.publicacoesmunicipais.com.br/api/v2/acts/{city}/{edition}
 * 
 * The API-based approach is more reliable than browser-based calendar navigation
 * and avoids issues with JavaScript rendering and dropdown interactions.
 */
export class EatosSpider extends BaseSpider {
  private baseUrl: string;
  private urlPath: string;
  private apiBaseUrl = 'https://api.publicacoesmunicipais.com.br';
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as EatosConfig;
    this.baseUrl = platformConfig.baseUrl;
    // Extract the city path from baseUrl (e.g., "hortolandia" from "https://publicacoesmunicipais.com.br/eatos/hortolandia")
    this.urlPath = this.extractUrlPath(platformConfig.baseUrl);
    this.browser = browser || null;
  }

  /**
   * Extract the city path from the base URL
   * e.g., "https://publicacoesmunicipais.com.br/eatos/hortolandia" -> "hortolandia"
   */
  private extractUrlPath(baseUrl: string): string {
    try {
      const url = new URL(baseUrl);
      const pathParts = url.pathname.split('/').filter(p => p);
      // The last part should be the city identifier (e.g., "hortolandia", "ilhacomprida")
      return pathParts[pathParts.length - 1] || '';
    } catch {
      // Fallback: try to extract from path directly
      const parts = baseUrl.split('/').filter(p => p);
      return parts[parts.length - 1] || '';
    }
  }

  /**
   * Set browser instance (for queue consumer context - not used for API-based crawling)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling EATOS for ${this.config.name} (API-based)...`);

    if (!this.urlPath) {
      logger.error(`Could not extract URL path from baseUrl: ${this.baseUrl}`);
      return [];
    }

    logger.debug(`Using URL path: ${this.urlPath}`);

    try {
      let page = 1;
      const pageSize = 50; // Fetch larger batches for efficiency
      let hasMorePages = true;
      let foundOlderThanRange = false;
      
      while (hasMorePages && !foundOlderThanRange) {
        const apiUrl = `${this.apiBaseUrl}/api/v1/acts?page=${page}&pageSize=${pageSize}&urlPath=${this.urlPath}`;
        logger.debug(`Fetching page ${page}: ${apiUrl}`);
        
        try {
          const response = await fetch(apiUrl, {
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'Mozilla/5.0 (compatible; GoodFellowBot/1.0)',
            },
            signal: AbortSignal.timeout(30000),
          });
          this.requestCount++;
          
          if (!response.ok) {
            logger.error(`API request failed with status ${response.status}: ${apiUrl}`);
            break;
          }
          
          const data = await response.json() as EatosActsResponse;
          
          if (!data.acts || data.acts.length === 0) {
            logger.debug(`No more acts found on page ${page}`);
            hasMorePages = false;
            break;
          }
          
          logger.debug(`Found ${data.acts.length} acts on page ${page}`);
          
          for (const act of data.acts) {
            try {
              // Parse the date from API response
              const actDate = new Date(act.date);
              const isoDate = toISODate(actDate);
              
              // Check if date is within our range
              if (isoDate < this.dateRange.start) {
                logger.debug(`Act date ${isoDate} is before start date ${this.dateRange.start}, stopping pagination`);
                foundOlderThanRange = true;
                break;
              }
              
              if (isoDate > this.dateRange.end) {
                logger.debug(`Act date ${isoDate} is after end date ${this.dateRange.end}, skipping`);
                continue;
              }
              
              // Construct PDF URL - the API v2 endpoint returns PDF directly
              const pdfUrl = `${this.apiBaseUrl}/api/v2/acts/${this.urlPath}/${act.edition}`;
              
              // Check for extra edition indicators
              const isExtraEdition = /extra|supl|ee|esp/i.test(act.edition);
              
              const gazette = await this.createGazette(actDate, pdfUrl, {
                editionNumber: act.edition,
                isExtraEdition,
                power: 'executive',
                sourceText: `${act.entityDisplayName} - Edição ${act.edition} - ${isoDate}`,
              });
              
              if (gazette) {
                gazettes.push(gazette);
                logger.debug(`Created gazette for edition ${act.edition} on ${isoDate}`);
              } else {
                logger.warn(`Failed to create gazette for edition ${act.edition}`);
              }
              
            } catch (actError) {
              logger.error(`Error processing act ${act.edition}:`, actError as Error);
            }
          }
          
          // Check for more pages
          if (data.totalPages !== undefined && page >= data.totalPages) {
            hasMorePages = false;
          } else if (data.acts.length < pageSize) {
            // If we got fewer results than requested, we're likely at the end
            hasMorePages = false;
          } else {
            page++;
          }
          
          // Add a small delay between requests to be respectful
          if (hasMorePages && !foundOlderThanRange) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          
        } catch (fetchError) {
          logger.error(`Error fetching page ${page}:`, fetchError as Error);
          break;
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from EATOS API`);
      
    } catch (error) {
      logger.error(`Error crawling EATOS:`, error as Error);
      throw error;
    }

    return gazettes;
  }
}

