import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraItaboraiConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, fromISODate, parseBrazilianDate } from '../../utils/date-utils';

/**
 * Spider for Prefeitura de Itaboraí official gazette
 * 
 * The site uses a custom API endpoint that returns HTML with gazette information.
 * API: https://do.ib.itaborai.rj.gov.br/dados-portal-novo.php
 * 
 * API Parameters:
 * - acao=1: List all editions
 * - acao=2, dado=<edition_number>: Search by edition number
 * - acao=3, dado=[start_date, end_date]: Search by date range
 * 
 * HTML Structure:
 * - Each gazette is in a <div class='card card-avulso-diario...'>
 * - Edition number: <p class='card-titulo-min'> Edição N° {number}</p>
 * - Date: <p class='card-titulo-min'>Postado em {DD/MM/YYYY}</p>
 * - PDF URL: <a href='{url}'>Abrir documento</a>
 * - Extra editions have class 'card-avulso-diario-extraordinario'
 */
export class PrefeituraItaboraiSpider extends BaseSpider {
  private _baseUrl: string;
  private browser: Fetcher | null = null;
  private readonly API_URL = 'https://do.ib.itaborai.rj.gov.br/dados-portal-novo.php';

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraItaboraiConfig;
    this._baseUrl = platformConfig.baseUrl || 'https://site.ib.itaborai.rj.gov.br/diario-oficial/';
    this.browser = browser || null;
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura Itaboraí for ${this.config.name}... (${this._baseUrl})`);

    try {
      logger.debug(`Fetching all gazettes from API (will filter by date range)`);

      // Call API to get all editions (acao=1)
      // We'll filter by date range in the parsing step
      const formData = new URLSearchParams();
      formData.append('acao', '1');

      const response = await fetch(this.API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });

      if (!response.ok) {
        logger.error(`API request failed with status ${response.status}`);
        return gazettes;
      }

      const html = await response.text();
      this.requestCount++;

      // Parse HTML response
      const $ = this.loadHTML(html);

      // Find all gazette cards
      const gazetteCards = $('.card-avulso-diario, .card-avulso-diario-extraordinario');
      logger.info(`Found ${gazetteCards.length} gazette cards in API response`);

      for (let i = 0; i < gazetteCards.length; i++) {
        const card = gazetteCards.eq(i);
        const gazette = this.parseGazetteCard(card, $);

        if (gazette) {
          // Date filtering is done in parseGazetteCard, but double-check here
          const gazetteDate = fromISODate(gazette.date);
          if (gazetteDate >= this.startDate && gazetteDate <= this.endDate) {
            gazettes.push(gazette);
          }
        }
      }

      logger.info(`Successfully extracted ${gazettes.length} gazettes for ${this.config.name} (filtered from ${gazetteCards.length} total)`);

    } catch (error) {
      logger.error(`Error crawling ${this.config.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Format date as DD/MM/YYYY for API
   */
  private formatDateForAPI(date: Date): string {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }

  /**
   * Parse a gazette card element from the HTML response
   */
  private parseGazetteCard(card: any, $: any): Gazette | null {
    try {
      // Extract edition number from text like "Edição N° 13"
      const editionText = card.find('.card-titulo-min').first().text().trim();
      const editionMatch = editionText.match(/Edição\s+N[°ºo]?\s*(\d+)/i);
      const editionNumber = editionMatch ? editionMatch[1] : undefined;

      // Extract date from text like "Postado em 16/01/2026"
      const dateText = card.find('.card-titulo-min').last().text().trim();
      const dateMatch = dateText.match(/Postado\s+em\s+(\d{2}\/\d{2}\/\d{4})/i);
      
      if (!dateMatch) {
        logger.warn(`Could not extract date from card: ${dateText}`);
        return null;
      }

      // Parse date DD/MM/YYYY to ISO format
      const dateStr = dateMatch[1]; // Format: DD/MM/YYYY
      const dateObj = parseBrazilianDate(dateStr);
      
      if (isNaN(dateObj.getTime())) {
        logger.warn(`Invalid date parsed: ${dateStr}`);
        return null;
      }

      const date = toISODate(dateObj);

      // Check if date is within range
      if (date < this.dateRange.start || date > this.dateRange.end) {
        return null;
      }

      // Extract PDF URL
      const pdfLink = card.find('a[href*=".pdf"]').first();
      const fileUrl = pdfLink.attr('href');

      if (!fileUrl) {
        logger.warn(`No PDF URL found in gazette card`);
        return null;
      }

      // Check if it's an extra edition
      const isExtraEdition = card.hasClass('card-avulso-diario-extraordinario') || 
                            card.find('.card-titulo-med').text().toLowerCase().includes('extraordinária');

      return {
        date,
        editionNumber,
        fileUrl,
        territoryId: this.config.territoryId,
        isExtraEdition,
        power: 'executive',
        scrapedAt: new Date().toISOString(),
      };

    } catch (error) {
      logger.error(`Error parsing gazette card:`, error as Error);
      return null;
    }
  }
}
