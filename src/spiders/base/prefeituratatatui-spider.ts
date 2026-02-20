import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraTatuiConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * PrefeituraTatuiSpider implementation
 * 
 * Crawls Tatuí's official gazette website (tatui.sp.gov.br/diario-oficial).
 * 
 * IMPORTANT: Tatuí's site contains primarily fiscal reports (RREO, RGF) and 
 * bidding documents (pregões), NOT traditional official gazettes. The only 
 * "Edições Impressas" available are from 2019 and marked as "meramente ilustrativas".
 * 
 * Site structure:
 * - Main page: http://tatui.sp.gov.br/diario-oficial
 * - Edições Impressas: /diario-oficial/edicoes_impressas (only 2019 editions)
 * - Downloads at: /diario-oficial/download/{id}
 * 
 * The spider:
 * 1. Fetches the edições impressas page
 * 2. Extracts download links matching /diario-oficial/download/
 * 3. Filters by date range
 * 
 * Note: Most publications on the main page are fiscal reports and bidding
 * documents, which are excluded from gazette extraction.
 */
export class PrefeituraTatuiSpider extends BaseSpider {
  protected tatuiConfig: PrefeituraTatuiConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.tatuiConfig = spiderConfig.config as PrefeituraTatuiConfig;
    
    if (!this.tatuiConfig.baseUrl) {
      throw new Error(`PrefeituraTatuiSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraTatuiSpider for ${spiderConfig.name}`);
  }

  /**
   * Fetch with desktop User-Agent to get full version of site
   */
  private async fetchWithDesktopUA(url: string): Promise<string> {
    logger.debug(`Fetching URL: ${url}`);
    this.requestCount++;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    
    return response.text();
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.tatuiConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];
    const processedUrls = new Set<string>();

    try {
      // Tatuí's main page contains fiscal reports and bidding documents, NOT official gazettes.
      // We only crawl the "edições impressas" page which has actual gazette editions.
      // Note: As of Jan 2026, only 2019 editions exist and they are marked as "meramente ilustrativas".
      
      await this.crawlEdicoesImpressas(gazettes, processedUrls);
      
      // Also check main page for gazette download links (not fiscal reports)
      await this.crawlMainPage(gazettes, processedUrls);
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Crawl main page for gazette download links only (not fiscal reports/bidding docs)
   */
  private async crawlMainPage(gazettes: Gazette[], processedUrls: Set<string>): Promise<void> {
    try {
      const html = await this.fetchWithDesktopUA(this.tatuiConfig.baseUrl);
      const $ = this.loadHTML(html);
      
      // Only look for links that are actual gazette downloads, not fiscal reports
      // Pattern: /diario-oficial/download/ links on the main page
      const gazetteLinks = $('a[href*="/diario-oficial/download/"]');
      logger.debug(`Found ${gazetteLinks.length} gazette download links on main page`);
      
      const gazettePromises: Promise<Gazette | null>[] = [];
      
      gazetteLinks.each((_, linkElement) => {
        const $link = $(linkElement);
        const href = $link.attr('href');
        
        if (!href || processedUrls.has(href)) return;
        
        const title = $link.attr('title') || $link.text().trim();
        const dateMatch = title.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        
        if (dateMatch) {
          const [, day, month, year] = dateMatch;
          const gazetteDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
          
          if (this.isInDateRange(gazetteDate)) {
            processedUrls.add(href);
            const absoluteUrl = this.makeAbsoluteUrl(href);
            
            const editionMatch = title.match(/EDI[ÇC][ÃA]O\s+(\d+)/i);
            const editionNumber = editionMatch ? editionMatch[1] : undefined;
            
            logger.debug(`Found gazette: ${absoluteUrl}, date: ${toISODate(gazetteDate)}`);
            
            gazettePromises.push(
              this.createGazette(gazetteDate, absoluteUrl, {
                editionNumber,
                isExtraEdition: title.toLowerCase().includes('extra'),
                power: 'executive_legislative',
                sourceText: title,
              })
            );
          }
        }
      });
      
      const results = await Promise.all(gazettePromises);
      for (const g of results) {
        if (g) gazettes.push(g);
      }
      
    } catch (error) {
      logger.debug('Error crawling main page:', error as Error);
    }
  }

  /**
   * Crawl edições impressas page
   */
  private async crawlEdicoesImpressas(gazettes: Gazette[], processedUrls: Set<string>): Promise<void> {
    try {
      const edicoesUrl = `${this.tatuiConfig.baseUrl}/edicoes_impressas`;
      logger.debug(`Fetching edições impressas: ${edicoesUrl}`);
      
      const html = await this.fetchWithDesktopUA(edicoesUrl);
      
      const $ = this.loadHTML(html);
      
      // Find all gazette links (pattern: /diario-oficial/download/{id})
      const downloadLinks = $('a[href*="/diario-oficial/download/"]');
      logger.debug(`Found ${downloadLinks.length} download links`);
      
      downloadLinks.each((_, linkElement) => {
        try {
          const $link = $(linkElement);
          const href = $link.attr('href');
          
          if (!href || processedUrls.has(href)) return;
          
          // Get both title attribute and link text - date is usually in text, not title
          const titleAttr = $link.attr('title') || '';
          const linkText = $link.text().trim();
          
          // Extract date from link text first (pattern: DD/MM/YYYY), fall back to title
          let dateMatch = linkText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) {
            dateMatch = titleAttr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          }
          
          const sourceText = linkText || titleAttr;
          
          if (dateMatch) {
            const [, day, month, year] = dateMatch;
            const gazetteDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
            
            if (this.isInDateRange(gazetteDate)) {
              processedUrls.add(href);
              const absoluteUrl = this.makeAbsoluteUrl(href);
              
              // Extract edition number from title or text
              const editionMatch = sourceText.match(/EDI[ÇC][ÃA]O\s+(\d+)/i);
              const editionNumber = editionMatch ? editionMatch[1] : undefined;
              
              logger.debug(`Found gazette edition: ${absoluteUrl}, date: ${toISODate(gazetteDate)}, edition: ${editionNumber || 'N/A'}`);
              
              this.createGazette(gazetteDate, absoluteUrl, {
                editionNumber,
                isExtraEdition: sourceText.toLowerCase().includes('extra'),
                power: 'executive_legislative',
                sourceText,
              }).then(gazette => {
                if (gazette) {
                  gazettes.push(gazette);
                }
              }).catch(err => {
                logger.error('Error creating gazette from edição impressa:', err);
              });
            }
          }
          
        } catch (error) {
          logger.error('Error processing edição impressa link:', error as Error);
        }
      });
      
    } catch (error) {
      logger.debug('Could not fetch edições impressas page (may not exist):', error as Error);
    }
  }

  /**
   * Make a URL absolute if it's relative
   */
  private makeAbsoluteUrl(url: string): string {
    if (url.startsWith('http')) {
      return url;
    }
    
    const baseUrlObj = new URL(this.tatuiConfig.baseUrl);
    const baseDomain = `${baseUrlObj.protocol}//${baseUrlObj.host}`;
    const normalizedPath = url.startsWith('/') ? url : `/${url}`;
    return `${baseDomain}${normalizedPath}`;
  }
}

