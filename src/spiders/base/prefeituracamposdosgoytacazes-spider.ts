import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraCamposDosGoytacazesConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';
// @ts-ignore
import { parse } from 'node-html-parser';

/**
 * PrefeituraCamposDosGoytacazesSpider for Campos dos Goytacazes, RJ
 * 
 * Site Structure:
 * - URL: https://www.campos.rj.gov.br/diario-oficial.php
 * - HTML page with list of gazettes
 * - Each gazette has a link: /app/assets/diario-oficial/link/{id}
 * - Links redirect directly to PDFs
 * - Pagination: ?PGpagina=2&PGporPagina=15
 * - Format: "Diário Oficial Eletrônico de {day} de {month} de {year} — Edição - {number}"
 */
export class PrefeituraCamposDosGoytacazesSpider extends BaseSpider {
  protected camposConfig: PrefeituraCamposDosGoytacazesConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.camposConfig = spiderConfig.config as PrefeituraCamposDosGoytacazesConfig;
    
    if (!this.camposConfig.baseUrl) {
      throw new Error(`PrefeituraCamposDosGoytacazesSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraCamposDosGoytacazesSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.camposConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    
    try {
      let currentPage = 1;
      const maxPages = 50; // Safety limit
      let hasMorePages = true;
      let foundOlderThanRange = false;
      
      while (hasMorePages && currentPage <= maxPages && !foundOlderThanRange) {
        // Build URL with pagination
        const url = currentPage === 1 
          ? this.camposConfig.baseUrl 
          : `${this.camposConfig.baseUrl}?PGpagina=${currentPage}&PGporPagina=15`;
        
        logger.debug(`Fetching page ${currentPage}: ${url}`);
        
        const html = await this.fetch(url);
        
        // Parse HTML
        const root = parse(html);
        
        // Find all gazette items - they're in <ul class="ul-licitacoes"> with <li> items
        const gazetteLists = root.querySelectorAll('ul.ul-licitacoes');
        
        let pageGazettes: Array<{ date: Date; pdfUrl: string; edition?: string; isExtra?: boolean }> = [];
        
        for (const list of gazetteLists) {
          const items = list.querySelectorAll('li');
          
          for (const item of items) {
            try {
              // Extract title/heading
              const heading = item.querySelector('h4.item');
              if (!heading) continue;
              
              const titleText = heading.textContent.trim();
              
              // Check if it's a suplemento (extra edition)
              const isExtra = titleText.toLowerCase().includes('suplemento');
              
              // Extract date from title
              // Format: "Diário Oficial Eletrônico de 19 de Janeiro de 2026 — Edição - 1977"
              // Or: "Suplemento do Diário Oficial Eletrônico de 19 de Janeiro de 2025 - Edição - 1977"
              const dateMatch = titleText.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
              if (!dateMatch) {
                logger.debug(`Could not extract date from title: ${titleText}`);
                continue;
              }
              
              const [, day, monthName, year] = dateMatch;
              
              // Convert month name to number
              const monthNames = [
                'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
                'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
              ];
              
              const monthIndex = monthNames.findIndex(m => 
                m.toLowerCase() === monthName.toLowerCase()
              );
              
              if (monthIndex === -1) {
                logger.debug(`Invalid month name: ${monthName}`);
                continue;
              }
              
              const gazetteDate = new Date(
                parseInt(year),
                monthIndex,
                parseInt(day)
              );
              
              if (isNaN(gazetteDate.getTime())) {
                logger.debug(`Invalid date: ${day}/${monthIndex + 1}/${year}`);
                continue;
              }
              
              // Filter by date range
              if (!this.isInDateRange(gazetteDate)) {
                if (gazetteDate < new Date(this.dateRange.start)) {
                  foundOlderThanRange = true;
                }
                continue;
              }
              
              // Extract edition number
              const editionMatch = titleText.match(/[Ee]di[çc][ãa]o\s*[-–]\s*(\d+)/);
              const edition = editionMatch ? editionMatch[1] : undefined;
              
              // Extract PDF link
              const link = item.querySelector('a[href*="/app/assets/diario-oficial/link/"]');
              if (!link) {
                logger.debug(`No PDF link found for: ${titleText}`);
                continue;
              }
              
              const href = link.getAttribute('href');
              if (!href) continue;
              
              // Make URL absolute
              const baseUrlObj = new URL(this.camposConfig.baseUrl);
              const pdfUrl = href.startsWith('http') 
                ? href 
                : `${baseUrlObj.origin}${href.startsWith('/') ? '' : '/'}${href}`;
              
              pageGazettes.push({
                date: gazetteDate,
                pdfUrl,
                edition,
                isExtra,
              });
              
            } catch (error) {
              logger.error(`Error processing gazette item:`, error as Error);
            }
          }
        }
        
        if (pageGazettes.length === 0) {
          hasMorePages = false;
          logger.debug(`No gazettes found on page ${currentPage}, stopping pagination`);
        } else {
          // Process gazettes
          for (const item of pageGazettes) {
            try {
              const gazette = await this.createGazette(item.date, item.pdfUrl, {
                power: 'executive_legislative',
                editionNumber: item.edition,
                isExtraEdition: item.isExtra,
                sourceText: item.isExtra ? 'Suplemento' : undefined,
              });
              
              if (gazette) {
                gazettes.push(gazette);
                logger.debug(`Found gazette for ${toISODate(item.date)}: ${item.pdfUrl}`);
              }
            } catch (error) {
              logger.error(`Error creating gazette:`, error as Error);
            }
          }
          
          // Check if there's a next page
          const nextPageLink = root.querySelector('ul.pagination li:has(a[href*="PGpagina="])');
          if (!nextPageLink || currentPage >= maxPages) {
            hasMorePages = false;
          } else {
            currentPage++;
          }
        }
        
        // If we found older gazettes than our range, we can stop
        if (foundOlderThanRange) {
          logger.debug(`Found gazettes older than date range, stopping pagination`);
          hasMorePages = false;
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }
    
    return gazettes;
  }
}
