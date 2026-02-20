import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraEspinosaConfig } from '../../types';
import { logger } from '../../utils/logger';
import { parse } from 'node-html-parser';

/**
 * PrefeituraEspinosaSpider for Espinosa, MG WordPress category-based gazette site
 * 
 * Site Structure:
 * - WordPress category page with posts for each gazette edition
 * - Listing page: https://espinosa.mg.gov.br/category/diario-oficial-espinosa-mg/
 * - Pagination: /category/diario-oficial-espinosa-mg/page/{N}/
 * - Each post contains a PDF link to the gazette
 * - Posts have dates in the post metadata
 */
export class PrefeituraEspinosaSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    const config = spiderConfig.config as PrefeituraEspinosaConfig;
    this.baseUrl = config.url || 'https://espinosa.mg.gov.br/category/diario-oficial-espinosa-mg/';
    this.browser = browser || null;
    
    // Ensure base URL ends with /
    if (!this.baseUrl.endsWith('/')) {
      this.baseUrl += '/';
    }
    
    logger.info(`Initializing PrefeituraEspinosaSpider for ${spiderConfig.name} with URL: ${this.baseUrl}`);
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.baseUrl} for ${this.spiderConfig.name}...`);
    
    // This site works without browser rendering
    return this.crawlWithFetch();
  }

  /**
   * Crawl using fetch (no browser needed for this site)
   */
  private async crawlWithFetch(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let pageNum = 1;
    const maxPages = 100;
    let foundOlderThanRange = false;

    while (pageNum <= maxPages && !foundOlderThanRange) {
      const pageUrl = pageNum === 1 
        ? this.baseUrl 
        : `${this.baseUrl}page/${pageNum}/`;
      
      logger.debug(`Fetching page ${pageNum}: ${pageUrl}`);
      
      try {
        const html = await this.fetch(pageUrl);
        const root = parse(html);
        
        // Find all article/post elements
        // WordPress typically uses article, .post, or .entry classes
        const articles = root.querySelectorAll('article, .post, .entry, .post-item');
        
        if (articles.length === 0) {
          logger.info(`No articles found on page ${pageNum}, stopping`);
          break;
        }
        
        logger.debug(`Found ${articles.length} articles on page ${pageNum}`);
        
        for (const article of articles) {
          try {
            // Extract title and link
            const titleLink = article.querySelector('h2 a, h3 a, .entry-title a, .post-title a, a[rel="bookmark"]');
            if (!titleLink) {
              logger.debug(`No title link found in article`);
              continue;
            }
            
            const titleText = titleLink.text?.trim() || '';
            const detailUrl = titleLink.getAttribute('href');
            
            if (!detailUrl) {
              logger.debug(`No detail URL found for article: ${titleText}`);
              continue;
            }
            
            // Extract date from post metadata
            // WordPress posts typically have date in time element or .entry-date, .post-date
            const dateElement = article.querySelector('time[datetime], .entry-date, .post-date, .published');
            let gazetteDate: Date | null = null;
            
            if (dateElement) {
              // Try to get date from datetime attribute
              const datetime = dateElement.getAttribute('datetime');
              if (datetime) {
                gazetteDate = new Date(datetime);
              } else {
                // Try to parse from text content
                const dateText = dateElement.textContent?.trim() || '';
                const dateMatch = dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/) || 
                                 dateText.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
                if (dateMatch) {
                  if (dateMatch[2]) {
                    // Portuguese format: "DD de mês de YYYY"
                    const monthMap: Record<string, string> = {
                      'janeiro': '01', 'fevereiro': '02', 'março': '03', 'marco': '03',
                      'abril': '04', 'maio': '05', 'junho': '06',
                      'julho': '07', 'agosto': '08', 'setembro': '09',
                      'outubro': '10', 'novembro': '11', 'dezembro': '12'
                    };
                    const month = monthMap[dateMatch[2].toLowerCase()];
                    if (month) {
                      const day = dateMatch[1].padStart(2, '0');
                      gazetteDate = new Date(`${dateMatch[3]}-${month}-${day}`);
                    }
                  } else {
                    // DD/MM/YYYY format
                    const [, day, month, year] = dateMatch;
                    gazetteDate = new Date(`${year}-${month}-${day}`);
                  }
                }
              }
            }
            
            // If no date found in metadata, try to extract from title
            if (!gazetteDate || isNaN(gazetteDate.getTime())) {
              const dateMatch = titleText.match(/(\d{2})\/(\d{2})\/(\d{4})/) ||
                               titleText.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
              if (dateMatch) {
                if (dateMatch[2]) {
                  // Portuguese format
                  const monthMap: Record<string, string> = {
                    'janeiro': '01', 'fevereiro': '02', 'março': '03', 'marco': '03',
                    'abril': '04', 'maio': '05', 'junho': '06',
                    'julho': '07', 'agosto': '08', 'setembro': '09',
                    'outubro': '10', 'novembro': '11', 'dezembro': '12'
                  };
                  const month = monthMap[dateMatch[2].toLowerCase()];
                  if (month) {
                    const day = dateMatch[1].padStart(2, '0');
                    gazetteDate = new Date(`${dateMatch[3]}-${month}-${day}`);
                  }
                } else {
                  // DD/MM/YYYY format
                  const [, day, month, year] = dateMatch;
                  gazetteDate = new Date(`${year}-${month}-${day}`);
                }
              }
            }
            
            if (!gazetteDate || isNaN(gazetteDate.getTime())) {
              logger.debug(`Could not parse date from article: ${titleText}`);
              continue;
            }
            
            // Check if older than range - stop pagination early
            if (gazetteDate < new Date(this.dateRange.start)) {
              foundOlderThanRange = true;
              continue;
            }
            
            // Skip if not in range
            if (!this.isInDateRange(gazetteDate)) {
              continue;
            }
            
            // Try to get PDF URL from article directly first
            let pdfUrl = this.extractPdfFromArticle(article);
            
            // If not found, navigate to detail page
            if (!pdfUrl) {
              pdfUrl = await this.getPdfUrlFromDetailPage(detailUrl);
            }
            
            if (!pdfUrl) {
              logger.warn(`No PDF URL found for: ${titleText}`);
              continue;
            }
            
            // Extract edition number from title
            const editionMatch = titleText.match(/[Ee]di[çc][ãa]o\s*[nN]?[°º]?\s*(\d+)/i) ||
                                titleText.match(/[Nn]°\s*(\d+)/i) ||
                                titleText.match(/(\d+)/);
            const editionNumber = editionMatch ? editionMatch[1] : undefined;
            
            // Check if it's an extra edition
            const isExtraEdition = titleText.toLowerCase().includes('extra') || 
                                   titleText.toLowerCase().includes('extraordinária');
            
            // Create gazette
            const gazette = await this.createGazette(gazetteDate, pdfUrl, {
              editionNumber,
              isExtraEdition,
              power: 'executive_legislative',
              sourceText: titleText,
            });
            
            if (gazette) {
              gazettes.push(gazette);
            }
            
          } catch (error) {
            logger.error(`Error processing article:`, error as Error);
          }
        }
        
        logger.debug(`Found ${gazettes.length} gazettes so far after page ${pageNum}`);
        
        // Check for next page link
        const nextPageLink = root.querySelector('a.next, a[rel="next"], .pagination-next a, .nav-next a');
        if (!nextPageLink && !foundOlderThanRange) {
          // Try checking if there's a page/N+1/ link
          const nextNum = pageNum + 1;
          const possibleNextLink = root.querySelector(`a[href*="/page/${nextNum}/"]`);
          if (!possibleNextLink) {
            logger.debug(`No next page link found, stopping pagination`);
            break;
          }
        }
        
        pageNum++;
        
      } catch (error) {
        if ((error as any).message?.includes('404') || (error as any).message?.includes('Not Found')) {
          logger.debug(`Page ${pageNum} returned 404, stopping pagination`);
          break;
        }
        logger.error(`Error fetching page ${pageNum}:`, error as Error);
        break;
      }
    }
    
    logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    return gazettes;
  }

  /**
   * Extract PDF URL directly from article element (if available)
   */
  private extractPdfFromArticle(article: any): string | null {
    // Look for PDF links in the article
    const pdfLink = article.querySelector('a[href$=".pdf"], a[href*=".pdf"]');
    if (pdfLink) {
      let pdfUrl = pdfLink.getAttribute('href');
      if (pdfUrl) {
        // Make absolute URL if relative
        if (!pdfUrl.startsWith('http')) {
          const baseUrlObj = new URL(this.baseUrl);
          pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
        }
        return pdfUrl;
      }
    }
    return null;
  }

  /**
   * Navigate to detail page and extract PDF URL
   */
  private async getPdfUrlFromDetailPage(detailUrl: string): Promise<string | null> {
    try {
      // Make absolute URL if relative
      let fullUrl = detailUrl;
      if (!detailUrl.startsWith('http')) {
        const baseUrlObj = new URL(this.baseUrl);
        fullUrl = `${baseUrlObj.origin}${detailUrl.startsWith('/') ? '' : '/'}${detailUrl}`;
      }
      
      logger.debug(`Fetching detail page: ${fullUrl}`);
      const html = await this.fetch(fullUrl);
      const root = parse(html);
      
      // Look for PDF download link
      // Try multiple selectors in order of specificity
      const pdfSelectors = [
        'a[href$=".pdf"]',
        'a[title*="download"]',
        'a[title*="Download"]',
        '.wp-block-file a',
        '.entry-content a[href*="uploads"]',
        '.post-content a[href*=".pdf"]',
        'article a[href*=".pdf"]'
      ];
      
      for (const selector of pdfSelectors) {
        const pdfLink = root.querySelector(selector);
        if (pdfLink) {
          let pdfUrl = pdfLink.getAttribute('href');
          if (pdfUrl) {
            // Make absolute URL if relative
            if (!pdfUrl.startsWith('http')) {
              const baseUrlObj = new URL(fullUrl);
              pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
            }
            return pdfUrl;
          }
        }
      }
      
      logger.debug(`No PDF link found on detail page: ${fullUrl}`);
      return null;
      
    } catch (error) {
      logger.warn(`Error getting PDF URL from ${detailUrl}`, error as Error);
      return null;
    }
  }
}
