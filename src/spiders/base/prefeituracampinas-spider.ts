import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraCampinasConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { getMonthlySequence } from '../../utils/date-utils';
import { logger } from '../../utils/logger';

/**
 * Spider for Campinas - Portal da Prefeitura de Campinas
 * 
 * Campinas provides a JSON API for accessing official gazette documents.
 * 
 * API Structure:
 * - Endpoint: https://portal-api.campinas.sp.gov.br/api/v1/publicacoes-dom/all/{YYYYMM}?_format=json
 * - Response: Array of gazette objects
 * - Each document has: dom_id, dom_edicao, dom_data_pub (DD/MM/YYYY), dom_arquivo, dom_extra_arquivo
 * 
 * File URLs:
 * - Base URL: https://portal-api.campinas.sp.gov.br (not the main campinas.sp.gov.br domain)
 * - PDF path: {dom_arquivo}
 * 
 * Extra Editions:
 * - dom_extra_arquivo is non-empty for extra editions
 */
export class PrefeituracampinasSpider extends BaseSpider {
  private apiBaseUrl = 'https://portal-api.campinas.sp.gov.br';
  // Note: PDF files are hosted on portal-api subdomain, not the main campinas.sp.gov.br
  private fileBaseUrl = 'https://portal-api.campinas.sp.gov.br';

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const campinasConfig = config.config as PrefeituraCampinasConfig;
    if (campinasConfig.baseUrl) {
      this.fileBaseUrl = campinasConfig.baseUrl;
    }
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const months = getMonthlySequence(this.startDate, this.endDate);

    logger.info(`Crawling Campinas gazettes for ${this.config.name}...`);

    for (const month of months) {
      const year = month.getFullYear();
      const monthNumber = month.getMonth() + 1;
      const monthPadded = String(monthNumber).padStart(2, '0');
      
      const url = `${this.apiBaseUrl}/api/v1/publicacoes-dom/all/${year}${monthPadded}?_format=json`;
      
      logger.debug(`Fetching gazettes for ${year}-${monthPadded}`);

      try {
        const response = await fetch(url);
        
        if (!response.ok) {
          logger.warn(`Failed to fetch ${url}: ${response.status}`);
          continue;
        }

        const data = await response.json() as Array<{
          dom_id: string;
          dom_edicao: string;
          dom_data_pub: string;
          dom_arquivo: string;
          dom_extra_arquivo: string;
        }>;

        for (const document of data) {
          // Parse date from DD/MM/YYYY format
          const [day, monthStr, yearStr] = document.dom_data_pub.split('/');
          const documentDate = new Date(`${yearStr}-${monthStr}-${day}`);

          // Filter by date range
          if (documentDate > this.endDate) continue;
          if (documentDate < this.startDate) continue;

          const gazette: Gazette = {
            date: `${yearStr}-${monthStr}-${day}`,
            fileUrl: `${this.fileBaseUrl}${document.dom_arquivo}`,
            territoryId: this.config.territoryId,
            scrapedAt: new Date().toISOString(),
            editionNumber: document.dom_edicao || undefined,
            isExtraEdition: document.dom_extra_arquivo !== '',
            power: 'executive',
          };

          gazettes.push(gazette);
        }
      } catch (error) {
        logger.error(`Error fetching gazettes for ${year}-${monthPadded}: ${error}`);
      }
    }

    logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`);
    return gazettes;
  }
}
