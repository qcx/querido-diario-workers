import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituramauaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for Prefeitura de Mauá - Diário Oficial
 * 
 * Site Structure:
 * - URL: https://dom.maua.sp.gov.br/
 * - Contains a search form with filters (poder executivo/legislativo, categories)
 * - List of publications with "Leia mais" links
 * - Pagination available
 * 
 * The site loads publications dynamically via API calls.
 * We'll intercept or simulate the API to get publication data.
 */
export class PrefeituramauaSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const mauaConfig = config.config as PrefeituramauaConfig;
    this.baseUrl = mauaConfig.baseUrl || 'https://dom.maua.sp.gov.br';
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    logger.info(`Crawling Mauá gazettes from ${this.baseUrl}...`);

    try {
      // The site uses an API endpoint for fetching publications
      // Based on analysis, the API returns paginated results
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const response = await fetch(`${this.baseUrl}/api/publicacoes?page=${page}`, {
          headers: {
            'Accept': 'application/json',
          }
        });

        if (!response.ok) {
          // Try alternative endpoint structure
          const altResponse = await fetch(this.baseUrl);
          if (altResponse.ok) {
            const html = await altResponse.text();
            const extracted = this.extractFromHtml(html);
            gazettes.push(...extracted);
          }
          break;
        }

        const data = await response.json() as {
          data: Array<{
            id: number;
            titulo: string;
            data_publicacao: string;
            arquivo_url: string;
          }>;
          last_page: number;
          current_page: number;
        };

        for (const pub of data.data) {
          const documentDate = new Date(pub.data_publicacao);

          if (documentDate > this.endDate) continue;
          if (documentDate < this.startDate) continue;

          const gazette: Gazette = {
            date: pub.data_publicacao,
            fileUrl: pub.arquivo_url,
            territoryId: this.config.territoryId,
            scrapedAt: new Date().toISOString(),
            power: 'executive',
          };

          gazettes.push(gazette);
        }

        hasMore = data.current_page < data.last_page;
        page++;
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`);
      return gazettes;
    } catch (error) {
      logger.error(`Error crawling Mauá gazettes: ${error}`);
      return gazettes;
    }
  }

  private extractFromHtml(html: string): Gazette[] {
    const gazettes: Gazette[] = [];
    
    // Extract publications from HTML using regex patterns
    // Pattern for links to publications
    const linkPattern = /<a[^>]*href="([^"]*)"[^>]*>.*?Leia mais.*?<\/a>/gi;
    const matches = html.matchAll(linkPattern);

    for (const match of matches) {
      const url = match[1];
      if (url && url.includes('pdf')) {
        gazettes.push({
          date: new Date().toISOString().split('T')[0],
          fileUrl: url.startsWith('http') ? url : `${this.baseUrl}${url}`,
          territoryId: this.config.territoryId,
          scrapedAt: new Date().toISOString(),
          power: 'executive',
        });
      }
    }

    return gazettes;
  }
}

