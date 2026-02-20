import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';
// @ts-ignore
import { parse } from 'node-html-parser';
import { toISODate } from '../../utils/date-utils';

/**
 * Configuration for PrefeituraAlvaresMachado spider
 */
export interface PrefeituraAlvaresMachadoConfig {
  type: 'prefeituralvaresmachado';
  url: string;
  /** Map of year to category ID for Diário Oficial */
  yearCategories?: Record<number, number>;
}

/**
 * Spider for Álvares Machado - SP
 * 
 * This spider extracts gazettes from the "Câmaras e Prefeituras" CMS used by Álvares Machado.
 * 
 * The CMS uses an AJAX API at /publicacoes_json.php that accepts:
 * - id: Category ID (each year has its own category ID)
 * - busca: Search term (optional)
 * - mais: Offset for pagination
 * - status: Status filter (optional)
 * 
 * The response is HTML with gazette listings. Each gazette has:
 * - Link to content page: /conteudo/Publicações/{id}
 * - Date in format DD/MM/YYYY
 * - Edition number
 * 
 * The content page contains the PDF download link at /arquivos/downloads/{hash}.pdf
 */
export class PrefeituraAlvaresMachadoSpider extends BaseSpider {
  protected config: PrefeituraAlvaresMachadoConfig;
  
  // Category IDs for Diário Oficial by year
  private readonly defaultYearCategories: Record<number, number> = {
    2018: 199,
    2019: 238,
    2020: 268,
    2021: 315,
    2022: 390,
    2023: 439,
    2024: 492,
    2025: 538,
    2026: 608,
  };

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeituraAlvaresMachadoConfig;
    
    if (!this.config.url) {
      throw new Error(`PrefeituraAlvaresMachadoSpider requires a url in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraAlvaresMachadoSpider for ${spiderConfig.name} with URL: ${this.config.url}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.config.url} for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    const processedUrls = new Set<string>();
    
    try {
      // Determine which years we need to fetch based on date range
      const startYear = new Date(this.dateRange.start).getFullYear();
      const endYear = new Date(this.dateRange.end).getFullYear();
      
      const yearCategories = this.config.yearCategories || this.defaultYearCategories;
      
      // Fetch gazettes for each year in range
      for (let year = endYear; year >= startYear; year--) {
        const categoryId = yearCategories[year];
        
        if (!categoryId) {
          logger.warn(`No category ID found for year ${year}, skipping`);
          continue;
        }
        
        logger.info(`Fetching gazettes for year ${year} (category ID: ${categoryId})`);
        
        let offset = 0;
        let hasMore = true;
        let foundOlderThanRange = false;
        
        while (hasMore && !foundOlderThanRange) {
          // Fetch gazette listing via AJAX API
          const apiUrl = `${this.config.url.replace('/diariooficial', '')}/publicacoes_json.php`;
          const params = new URLSearchParams({
            id: categoryId.toString(),
            busca: '',
            mais: offset.toString(),
            status: '',
          });
          
          logger.debug(`Fetching API: ${apiUrl} with offset ${offset}`);
          
          const fetchResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: params.toString(),
          });
          
          if (!fetchResponse.ok) {
            logger.warn(`API request failed with status: ${fetchResponse.status}`);
            hasMore = false;
            continue;
          }
          
          const response = await fetchResponse.text();
          this.requestCount++;
          
          if (!response || response.trim() === '' || response.trim() === '<li></li>') {
            logger.debug(`No more results for year ${year}`);
            hasMore = false;
            continue;
          }
          
          // Parse the HTML response
          const root = parse(response);
          const gazetteLinks = root.querySelectorAll('a[href*="/conteudo/"]');
          
          if (gazetteLinks.length === 0) {
            logger.debug(`No gazette links found at offset ${offset}`);
            hasMore = false;
            continue;
          }
          
          logger.debug(`Found ${gazetteLinks.length} gazette links at offset ${offset}`);
          
          for (const link of gazetteLinks) {
            try {
              const href = link.getAttribute('href');
              if (!href || !href.includes('/conteudo/')) continue;
              
              // Extract date from the listing
              const listItem = link.closest('li') || link;
              const text = listItem.textContent || '';
              
              // Look for date pattern DD/MM/YYYY
              const dateMatch = text.match(/Data Publicação:\s*(\d{2})\/(\d{2})\/(\d{4})/);
              if (!dateMatch) {
                logger.debug(`Could not extract date from: ${text.substring(0, 100)}`);
                continue;
              }
              
              const [, day, month, yearStr] = dateMatch;
              const gazetteDate = new Date(`${yearStr}-${month}-${day}`);
              
              // Check if date is in range
              if (!this.isInDateRange(gazetteDate)) {
                if (gazetteDate < new Date(this.dateRange.start)) {
                  foundOlderThanRange = true;
                }
                continue;
              }
              
              // Extract edition number
              const editionMatch = text.match(/Edição\s+[Nn]?[°º]?\s*(\d+(?:\.\d+)?)/i);
              const editionNumber = editionMatch ? editionMatch[1].replace('.', '') : undefined;
              
              // Construct full content URL
              let contentUrl = href;
              if (!contentUrl.startsWith('http')) {
                const baseUrl = new URL(this.config.url);
                contentUrl = `${baseUrl.origin}${href.startsWith('/') ? '' : '/'}${href}`;
              }
              
              // Skip if already processed
              if (processedUrls.has(contentUrl)) continue;
              processedUrls.add(contentUrl);
              
              // Fetch the content page to get PDF URL
              logger.debug(`Fetching content page: ${contentUrl}`);
              const contentHtml = await this.fetch(contentUrl);
              const contentRoot = parse(contentHtml);
              
              // Look for PDF download link
              const pdfLink = contentRoot.querySelector('a[href*="/arquivos/downloads/"][href$=".pdf"]') ||
                              contentRoot.querySelector('a[href*=".pdf"]');
              
              if (!pdfLink) {
                logger.warn(`No PDF link found in content page: ${contentUrl}`);
                continue;
              }
              
              let pdfUrl = pdfLink.getAttribute('href');
              if (!pdfUrl) continue;
              
              // Construct full PDF URL
              if (!pdfUrl.startsWith('http')) {
                const baseUrl = new URL(this.config.url);
                pdfUrl = `${baseUrl.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
              }
              
              // Create gazette
              const gazette = await this.createGazette(gazetteDate, pdfUrl, {
                editionNumber,
                power: 'executive_legislative',
                sourceText: `Edição ${editionNumber || 'N/A'} - ${toISODate(gazetteDate)}`,
              });
              
              if (gazette) {
                gazettes.push(gazette);
                logger.debug(`Created gazette: ${toISODate(gazetteDate)} - Edição ${editionNumber} - ${pdfUrl}`);
              }
              
            } catch (error) {
              logger.error(`Error processing gazette link:`, error as Error);
            }
          }
          
          // Increment offset for next page (typically 10 items per page)
          offset += 10;
          
          // Safety limit
          if (offset > 500) {
            logger.warn('Reached maximum offset limit (500), stopping pagination');
            hasMore = false;
          }
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }
    
    return gazettes;
  }
}

