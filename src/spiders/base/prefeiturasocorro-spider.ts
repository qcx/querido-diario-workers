import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeiturasocorroConfig } from '../../types';
import { logger } from '../../utils/logger';
// @ts-ignore
import { parse } from 'node-html-parser';

/**
 * PrefeiturasocorroSpider for Socorro, SP WordPress blog-based gazette site
 * 
 * Site Structure:
 * - WordPress blog with posts for each gazette edition
 * - Listing page: https://socorro.sp.gov.br/jornal/ with pagination /page/N/
 * - Each article has title "Edição XXX – DD/MM/YYYY" linking to detail page
 * - Detail page: /jornal/edicao/edicao-{EDITION}-{DD}-{MM}-{YYYY}/
 * - PDF download link: a[href$=".pdf"] on detail page
 * 
 * HTML Structure (listing page):
 * <article id="post-XXXXX" class="post">
 *   <div class="article-content-col">
 *     <div class="nv-post-thumbnail-wrap img-wrap">
 *       <a href="/jornal/edicao/edicao-XXXX-DD-MM-YYYY/" title="Edição XXX – DD/MM/YYYY">...</a>
 *     </div>
 *     <h2 class="blog-entry-title entry-title">
 *       <a href="/jornal/edicao/edicao-XXXX-DD-MM-YYYY/">Edição XXX – DD/MM/YYYY</a>
 *     </h2>
 *   </div>
 * </article>
 * 
 * Pagination: https://socorro.sp.gov.br/jornal/page/2/
 */
export class PrefeiturasocorroSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    const config = spiderConfig.config as PrefeiturasocorroConfig;
    this.baseUrl = config.url || config.baseUrl || 'https://socorro.sp.gov.br/jornal/';
    this.browser = browser || null;
    
    // Ensure base URL ends with /
    if (!this.baseUrl.endsWith('/')) {
      this.baseUrl += '/';
    }
    
    logger.info(`Initializing PrefeiturasocorroSpider for ${spiderConfig.name} with URL: ${this.baseUrl}`);
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
        
        // Find all article elements
        const articles = root.querySelectorAll('article');
        
        if (articles.length === 0) {
          logger.info(`No articles found on page ${pageNum}, stopping`);
          break;
        }
        
        logger.debug(`Found ${articles.length} articles on page ${pageNum}`);
        
        for (const article of articles) {
          try {
            // Extract title from entry-title link
            const titleLink = article.querySelector('.entry-title a, h2 a');
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
            
            // Parse date from title "Edição XXX – DD/MM/YYYY" or "Edição XXX - DD/MM/YYYY"
            const dateMatch = titleText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (!dateMatch) {
              logger.debug(`Could not parse date from: ${titleText}`);
              continue;
            }
            
            const [, day, month, year] = dateMatch;
            const gazetteDate = new Date(`${year}-${month}-${day}`);
            
            // Check if older than range - stop pagination early
            if (gazetteDate < new Date(this.dateRange.start)) {
              foundOlderThanRange = true;
              continue;
            }
            
            // Skip if not in range
            if (!this.isInDateRange(gazetteDate)) {
              continue;
            }
            
            // Navigate to detail page to get PDF URL
            const pdfUrl = await this.getPdfUrlFromDetailPage(detailUrl);
            
            if (!pdfUrl) {
              logger.warn(`No PDF URL found for: ${titleText}`);
              continue;
            }
            
            // Extract edition number from title
            const editionMatch = titleText.match(/[Ee]di[çc][ãa]o\s*(\d+)/i);
            const editionNumber = editionMatch ? editionMatch[1] : undefined;
            
            // Check if it's an extra edition
            const isExtraEdition = titleText.toLowerCase().includes('extra');
            
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
        const nextPageLink = root.querySelector('a.next, a[rel="next"], .pagination-next a');
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
        '.entry-content a[href*="uploads"]'
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



