import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraIbiunaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for Prefeitura de Ibiúna official gazette
 * 
 * Site uses WordPress Download Manager plugin
 * - List page: https://ibiuna.sp.gov.br/diario-oficial/
 * - Download page: https://ibiuna.sp.gov.br/download/ed-XXXX-DD-MM-YYYY/
 * - Direct download: ?wpdmdl={ID}&refresh={token}
 * 
 * Structure:
 * - Each gazette is listed with format "Ed. XXXX - DD/MM/YYYY"
 * - Links point to download pages which contain the actual PDF download button
 */
export class PrefeituraIbiunaSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraIbiunaConfig;
    this.baseUrl = platformConfig.baseUrl || 'https://ibiuna.sp.gov.br';
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura Ibiúna for ${this.config.name}...`);

    try {
      // Fetch the gazette list page
      const listUrl = `${this.baseUrl}/diario-oficial/`;
      logger.debug(`Fetching list page: ${listUrl}`);
      
      const response = await fetch(listUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch list page: ${response.status}`);
      }

      const html = await response.text();
      
      // Extract all gazette links from the page
      // Pattern: href="https://ibiuna.sp.gov.br/download/ed-XXXX-DD-MM-YYYY/"
      const linkPattern = /href="(https?:\/\/ibiuna\.sp\.gov\.br\/download\/ed-(\d+)-(\d{2})-(\d{2})-(\d{4})\/)"/g;
      const matches = [...html.matchAll(linkPattern)];
      
      logger.debug(`Found ${matches.length} gazette links`);
      
      // Process unique links (there are duplicates in the HTML)
      const seenUrls = new Set<string>();
      
      for (const match of matches) {
        const downloadUrl = match[1];
        const editionNumber = match[2];
        const day = match[3];
        const month = match[4];
        const year = match[5];
        
        // Skip duplicates
        if (seenUrls.has(downloadUrl)) {
          continue;
        }
        seenUrls.add(downloadUrl);
        
        // Parse date (format: DD-MM-YYYY in URL)
        const dateStr = `${year}-${month}-${day}`;
        const gazetteDate = new Date(dateStr);
        
        // Check if within date range
        const startDate = new Date(this.dateRange.start);
        const endDate = new Date(this.dateRange.end);
        
        if (gazetteDate < startDate || gazetteDate > endDate) {
          logger.debug(`Skipping gazette ${editionNumber} - ${dateStr}: out of date range`);
          continue;
        }
        
        logger.debug(`Processing gazette Ed. ${editionNumber} - ${dateStr}`);
        
        try {
          // Fetch the download page to get the actual PDF URL
          const downloadPageResponse = await fetch(downloadUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            }
          });
          
          if (!downloadPageResponse.ok) {
            logger.warn(`Failed to fetch download page: ${downloadUrl}`);
            continue;
          }
          
          const downloadPageHtml = await downloadPageResponse.text();
          
          // Extract the wpdmdl download link
          // Pattern: data-downloadurl="https://ibiuna.sp.gov.br/download/ed-XXXX-DD-MM-YYYY/?wpdmdl=XXXXX&refresh=..."
          const wpdmPattern = /data-downloadurl="([^"]+\?wpdmdl=\d+[^"]*)"/;
          const wpdmMatch = downloadPageHtml.match(wpdmPattern);
          
          if (!wpdmMatch) {
            // Try alternative pattern - direct link in table
            const altPattern = /href='([^']+\?ind=\d+[^']*)'\s*class='[^']*btn[^']*'/;
            const altMatch = downloadPageHtml.match(altPattern);
            
            if (altMatch) {
              const fileUrl = altMatch[1];
              gazettes.push({
                date: dateStr,
                editionNumber,
                fileUrl,
                territoryId: this.config.territoryId,
                isExtraEdition: false,
                power: 'executive',
                scrapedAt: new Date().toISOString(),
              });
              logger.debug(`Found gazette via alt pattern: Ed. ${editionNumber} - ${dateStr}`);
            } else {
              logger.warn(`Could not find download link on page: ${downloadUrl}`);
            }
            continue;
          }
          
          const fileUrl = wpdmMatch[1];
          
          gazettes.push({
            date: dateStr,
            editionNumber,
            fileUrl,
            territoryId: this.config.territoryId,
            isExtraEdition: false,
            power: 'executive',
            scrapedAt: new Date().toISOString(),
          });
          
          logger.debug(`Found gazette: Ed. ${editionNumber} - ${dateStr} - ${fileUrl}`);
          
        } catch (error) {
          logger.warn(`Failed to process gazette ${editionNumber}: ${error}`);
        }
        
        // Add delay between requests to avoid overloading the server
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from Prefeitura Ibiúna`);
    } catch (error) {
      logger.error(`Error crawling Prefeitura Ibiúna: ${error}`);
      throw error;
    }

    return gazettes;
  }
}

