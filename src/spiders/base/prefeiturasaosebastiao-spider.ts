import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeiturasaosebastiaoeConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for Prefeitura de São Sebastião official gazette (DOEM)
 * 
 * Site: https://www.saosebastiao.sp.gov.br/doem.asp
 * 
 * Structure:
 * - Simple HTML page with list of gazette links
 * - Each gazette is a direct link to PDF in format: doem/DOEM_{edition}_{YYYYMMDD}_{HHMMSS}.pdf
 * - Example: doem/DOEM_2136_20260105_233316.pdf (Edition 2136 from 2026-01-05)
 * - Has a date filter field but all editions are listed on the page
 */
export class PrefeiturasaosebastiaoeSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeiturasaosebastiaoeConfig;
    this.baseUrl = platformConfig.baseUrl || 'https://www.saosebastiao.sp.gov.br';
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura São Sebastião for ${this.config.name}...`);

    try {
      // Fetch the gazette list page
      const listUrl = `${this.baseUrl}/doem.asp`;
      logger.debug(`Fetching list page: ${listUrl}`);
      
      const response = await fetch(listUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch list page: ${response.status}`);
      }

      const html = await response.text();
      
      // Extract all gazette PDF links from the page
      // Pattern: href="doem/DOEM_{edition}_{YYYYMMDD}_{HHMMSS}.pdf"
      // Also handles "DOEM/DOEM_..." (case variations in path)
      const linkPattern = /href="((?:doem|DOEM)\/DOEM_(\d+)_(\d{8})_\d+\.pdf)"/gi;
      const matches = [...html.matchAll(linkPattern)];
      
      logger.debug(`Found ${matches.length} gazette links`);
      
      // Process unique links
      const seenUrls = new Set<string>();
      
      for (const match of matches) {
        const relativePath = match[1];
        const editionNumber = match[2];
        const dateStr = match[3]; // YYYYMMDD format
        
        // Skip duplicates
        if (seenUrls.has(relativePath)) {
          continue;
        }
        seenUrls.add(relativePath);
        
        // Parse date from filename
        const year = parseInt(dateStr.substring(0, 4));
        const month = parseInt(dateStr.substring(4, 6)) - 1; // 0-indexed for Date
        const day = parseInt(dateStr.substring(6, 8));
        
        const gazetteDate = new Date(Date.UTC(year, month, day));
        
        // Check if within date range
        if (!this.isInDateRange(gazetteDate)) {
          const isoDate = gazetteDate.toISOString().split('T')[0];
          logger.debug(`Skipping gazette ${editionNumber} - ${isoDate}: out of date range`);
          continue;
        }
        
        // Construct full URL
        const fileUrl = `${this.baseUrl}/${relativePath}`;
        const isoDate = gazetteDate.toISOString().split('T')[0];
        
        logger.debug(`Found gazette: Ed. ${editionNumber} - ${isoDate} - ${fileUrl}`);
        
        const gazette: Gazette = {
          date: isoDate,
          editionNumber,
          fileUrl,
          territoryId: this.config.territoryId,
          isExtraEdition: false,
          power: 'executive',
          scrapedAt: new Date().toISOString(),
        };
        
        gazettes.push(gazette);
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from Prefeitura São Sebastião`);
    } catch (error) {
      logger.error(`Error crawling Prefeitura São Sebastião: ${error}`);
      throw error;
    }

    return gazettes;
  }
}

