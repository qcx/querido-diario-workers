import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituradiademaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for Prefeitura de Diadema - Diário Oficial
 * 
 * Site Structure:
 * - URL: https://diariooficial.diadema.sp.gov.br/
 * - Search form with tipo, secretaria, date range
 * - Grid of edition cards with links
 * 
 * The site provides a list of gazette editions that can be filtered.
 */
export class PrefeituradiademaSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const diademaConfig = config.config as PrefeituradiademaConfig;
    this.baseUrl = diademaConfig.baseUrl || 'https://diariooficial.diadema.sp.gov.br';
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    logger.info(`Crawling Diadema gazettes from ${this.baseUrl}...`);

    try {
      const response = await fetch(this.baseUrl);
      
      if (!response.ok) {
        logger.error(`Failed to fetch ${this.baseUrl}: ${response.status}`);
        return gazettes;
      }

      const html = await response.text();
      
      // Extract gazette links from the page
      // Pattern matches PDF links and gazette edition pages
      const gazettePattern = /<a[^>]*href="([^"]*(?:diario|edicao|pdf)[^"]*)"[^>]*>/gi;
      const datePattern = /(\d{2})\/(\d{2})\/(\d{4})/g;
      
      let match;
      while ((match = gazettePattern.exec(html)) !== null) {
        const url = match[1];
        
        // Try to extract date from URL or nearby text
        const urlDateMatch = url.match(/(\d{4})-(\d{2})-(\d{2})/);
        let dateStr: string;
        
        if (urlDateMatch) {
          dateStr = `${urlDateMatch[1]}-${urlDateMatch[2]}-${urlDateMatch[3]}`;
        } else {
          // Use current context to find date
          const contextStart = Math.max(0, match.index - 100);
          const contextEnd = Math.min(html.length, match.index + 200);
          const context = html.substring(contextStart, contextEnd);
          
          const dateMatch = context.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (dateMatch) {
            dateStr = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
          } else {
            continue;
          }
        }

        const documentDate = new Date(dateStr);

        if (documentDate > this.endDate) continue;
        if (documentDate < this.startDate) continue;

        const gazette: Gazette = {
          date: dateStr,
          fileUrl: url.startsWith('http') ? url : `${this.baseUrl}${url}`,
          territoryId: this.config.territoryId,
          scrapedAt: new Date().toISOString(),
          power: 'executive',
        };

        gazettes.push(gazette);
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`);
      return gazettes;
    } catch (error) {
      logger.error(`Error crawling Diadema gazettes: ${error}`);
      return gazettes;
    }
  }
}

