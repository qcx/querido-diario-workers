import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituracarapicuibaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for Prefeitura de Carapicuíba - Diário Oficial
 * 
 * Site Structure:
 * - URL: https://diario.carapicuiba.sp.gov.br/
 * - Search by keyword, assunto, date range
 * - List of editions with links: "Edição nº XXX - Ano Y"
 * - Clear date display and edition numbers
 * 
 * The site displays recent editions on the homepage and has search functionality.
 */
export class PrefeituracarapicuibaSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const carapicuibaConfig = config.config as PrefeituracarapicuibaConfig;
    this.baseUrl = carapicuibaConfig.baseUrl || 'https://diario.carapicuiba.sp.gov.br';
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    logger.info(`Crawling Carapicuíba gazettes from ${this.baseUrl}...`);

    try {
      // First, fetch the main page to get recent editions
      const response = await fetch(this.baseUrl);
      
      if (!response.ok) {
        logger.error(`Failed to fetch ${this.baseUrl}: ${response.status}`);
        return gazettes;
      }

      const html = await response.text();
      
      // Extract edition links from the page
      // Pattern matches links like "Edição nº 743 - EXTRA - Ano 8"
      const editionPattern = /<a[^>]*href="([^"]*)"[^>]*>\s*Edição\s+n[º°]\s*(\d+)(?:\s*-\s*(EXTRA))?\s*(?:-\s*Ano\s*\d+)?/gi;
      
      let match;
      const seenUrls = new Set<string>();
      
      while ((match = editionPattern.exec(html)) !== null) {
        const url = match[1];
        const editionNumber = match[2];
        const isExtra = match[3] !== undefined;
        
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);

        // Try to extract date from the page or edition URL
        const fullUrl = url.startsWith('http') ? url : `${this.baseUrl}${url}`;
        
        // Fetch the edition page to get the date and PDF link
        try {
          const editionResponse = await fetch(fullUrl);
          if (!editionResponse.ok) continue;
          
          const editionHtml = await editionResponse.text();
          
          // Extract date from edition page
          const dateMatch = editionHtml.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) continue;
          
          const dateStr = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
          const documentDate = new Date(dateStr);

          if (documentDate > this.endDate) continue;
          if (documentDate < this.startDate) continue;

          // Extract PDF link
          const pdfMatch = editionHtml.match(/href="([^"]*\.pdf)"/i);
          const pdfUrl = pdfMatch ? 
            (pdfMatch[1].startsWith('http') ? pdfMatch[1] : `${this.baseUrl}${pdfMatch[1]}`) : 
            fullUrl;

          const gazette: Gazette = {
            date: dateStr,
            fileUrl: pdfUrl,
            territoryId: this.config.territoryId,
            scrapedAt: new Date().toISOString(),
            editionNumber: editionNumber,
            isExtraEdition: isExtra,
            power: 'executive',
          };

          gazettes.push(gazette);
        } catch (e) {
          logger.warn(`Failed to fetch edition page ${fullUrl}: ${e}`);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`);
      return gazettes;
    } catch (error) {
      logger.error(`Error crawling Carapicuíba gazettes: ${error}`);
      return gazettes;
    }
  }
}

