import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { parse } from 'node-html-parser';

/**
 * Spider for Prefeitura de Araguari - MG
 * 
 * Site Structure:
 * - Base URL: https://araguari.mg.gov.br/correio
 * - Pagination: /p/{offset} (20 items per page)
 * - Each gazette is in a .panel.panel-info block
 * - Date: <h6><em>{weekday}, {DD} de {month} de {YYYY}</em></h6>
 * - PDF: <a href="...pdf">Leia Aqui</a>
 * - Edition: "Correio Oficial - Edição {number}" in .panel-heading
 */
export class PrefeituraAraguariSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as { baseUrl?: string; url?: string };
    this.baseUrl = platformConfig.baseUrl || platformConfig.url || 'https://araguari.mg.gov.br/correio';
    
    logger.info(`Initializing PrefeituraAraguariSpider for ${config.name} with URL: ${this.baseUrl}`);
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura Araguari for ${this.config.name}...`);

    try {
      const startDate = new Date(this.dateRange.start);
      const endDate = new Date(this.dateRange.end);

      let currentOffset = 0;
      const itemsPerPage = 20;
      let hasMorePages = true;
      let foundOlderThanStart = false;

      while (hasMorePages && !foundOlderThanStart) {
        const pageUrl = currentOffset === 0 
          ? this.baseUrl 
          : `${this.baseUrl}/p/${currentOffset}`;
        
        logger.debug(`Fetching page: ${pageUrl}`);
        
        const response = await fetch(pageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
          }
        });

        if (!response.ok) {
          logger.warn(`Failed to fetch page ${pageUrl}: ${response.status}`);
          break;
        }

        const html = await response.text();
        const root = parse(html);

        // Find all panel blocks with gazettes
        const panels = root.querySelectorAll('.panel.panel-info');
        
        if (panels.length === 0) {
          logger.debug('No more gazettes found on page');
          hasMorePages = false;
          break;
        }

        for (const panel of panels) {
          const gazette = this.parseGazettePanel(panel, startDate, endDate);
          
          if (gazette) {
            const startDateStr = startDate.toISOString().split('T')[0];
            if (gazette.date < startDateStr) {
              // We've gone past our date range
              foundOlderThanStart = true;
              break;
            }
            gazettes.push(gazette);
          }
        }

        // Move to next page
        currentOffset += itemsPerPage;

        // Check if there's a next page link
        const pagination = root.querySelector('ul.pagination');
        if (!pagination) {
          hasMorePages = false;
        } else {
          const nextPageLink = pagination.querySelector(`a[data-ci-pagination-page="${currentOffset}"]`);
          if (!nextPageLink) {
            hasMorePages = false;
          }
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`);
    } catch (error) {
      logger.error(`Error crawling Prefeitura Araguari: ${error}`);
      throw error;
    }

    return gazettes;
  }

  private parseGazettePanel(panel: any, startDate: Date, endDate: Date): Gazette | null {
    try {
      // Get edition from panel heading
      const heading = panel.querySelector('.panel-heading');
      const headingText = heading?.textContent?.trim() || '';
      const editionMatch = headingText.match(/Edição\s+(\d+)/i);
      const edition = editionMatch ? editionMatch[1] : undefined;

      // Get date from h6 > em
      const dateElement = panel.querySelector('h6 em');
      const dateText = dateElement?.textContent?.trim() || '';
      const parsedDate = this.parseBrazilianDate(dateText);

      if (!parsedDate) {
        logger.warn(`Could not parse date from: ${dateText}`);
        return null;
      }

      // Check if date is within range
      if (parsedDate < startDate || parsedDate > endDate) {
        return null;
      }
      
      const date = parsedDate;

      // Get PDF link
      const pdfLink = panel.querySelector('a[href*=".pdf"]');
      const pdfUrl = pdfLink?.getAttribute('href');

      if (!pdfUrl) {
        logger.warn(`No PDF URL found for edition ${edition}`);
        return null;
      }

      return {
        date: date.toISOString().split('T')[0], // YYYY-MM-DD format
        editionNumber: edition,
        isExtraEdition: false,
        fileUrl: pdfUrl,
        power: 'executive_legislative',
        territoryId: this.config.territoryId,
        scrapedAt: new Date().toISOString(),
      };
    } catch (error) {
      logger.warn(`Error parsing gazette panel: ${error}`);
      return null;
    }
  }

  /**
   * Parse Brazilian date format: "quarta, 07 de janeiro de 2026"
   */
  private parseBrazilianDate(dateText: string): Date | null {
    const months: { [key: string]: number } = {
      'janeiro': 0, 'fevereiro': 1, 'março': 2, 'marco': 2, 'abril': 3,
      'maio': 4, 'junho': 5, 'julho': 6, 'agosto': 7,
      'setembro': 8, 'outubro': 9, 'novembro': 10, 'dezembro': 11
    };

    // Pattern: "weekday, DD de month de YYYY"
    const match = dateText.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
    
    if (!match) {
      return null;
    }

    const [, day, monthName, year] = match;
    const monthLower = monthName.toLowerCase();
    const month = months[monthLower];

    if (month === undefined) {
      return null;
    }

    return new Date(parseInt(year), month, parseInt(day));
  }
}

