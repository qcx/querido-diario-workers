import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraItanhaemConfig } from '../../types';
import { logger } from '../../utils/logger';

/**
 * WordPress REST API response type for boletim_oficial posts
 */
interface WPBoletimOficial {
  id: number;
  date: string;  // ISO format: "2025-12-30T17:12:26"
  date_gmt: string;
  slug: string;  // e.g., "edicao-957"
  title: {
    rendered: string;  // e.g., "Edição 957"
  };
  content: {
    rendered: string;  // Contains iframe with PDF src
    protected: boolean;
  };
  link: string;
}

/**
 * PrefeituraItanhaemSpider for Itanhaém municipality gazette collection
 * 
 * Site uses WordPress REST API with custom post type 'boletim_oficial'
 * 
 * API Structure:
 * - Endpoint: /wp-json/wp/v2/boletim_oficial?per_page=100
 * - Response: Array of posts with date, title.rendered, content.rendered
 * - PDF URL: Extracted from iframe src in content.rendered
 * - PDFs: /wp-content/uploads/YYYY/MM/{edition}.pdf
 * 
 * Example content.rendered:
 * <p><iframe id="boletim" src="https://www.itanhaem.sp.gov.br/wp-content/uploads/2025/12/957.pdf" ...></iframe></p>
 */
export class PrefeituraItanhaemSpider extends BaseSpider {
  protected itanhaemConfig: PrefeituraItanhaemConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.itanhaemConfig = spiderConfig.config as PrefeituraItanhaemConfig;
    
    if (!this.itanhaemConfig.baseUrl) {
      throw new Error(`PrefeituraItanhaemSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraItanhaemSpider for ${spiderConfig.name} with URL: ${this.itanhaemConfig.baseUrl}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.itanhaemConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    let currentPage = 1;
    let hasMorePages = true;
    let foundOlderThanRange = false;
    const perPage = 100;
    const maxPages = 50;

    while (hasMorePages && currentPage <= maxPages && !foundOlderThanRange) {
      try {
        // Build API URL with pagination
        const apiUrl = `${this.itanhaemConfig.baseUrl}/wp-json/wp/v2/boletim_oficial?per_page=${perPage}&page=${currentPage}&orderby=date&order=desc`;
        
        logger.debug(`Fetching API page ${currentPage}: ${apiUrl}`);
        
        const response = await this.fetch(apiUrl);
        
        let posts: WPBoletimOficial[];
        try {
          posts = JSON.parse(response);
        } catch (parseError) {
          logger.error(`Failed to parse API response as JSON: ${response.substring(0, 200)}`);
          hasMorePages = false;
          continue;
        }
        
        if (!Array.isArray(posts) || posts.length === 0) {
          logger.info(`No posts found on page ${currentPage}, stopping pagination`);
          hasMorePages = false;
          continue;
        }
        
        logger.debug(`Found ${posts.length} posts on page ${currentPage}`);
        
        for (const post of posts) {
          try {
            const gazette = await this.parsePost(post);
            
            if (gazette) {
              const gazetteDate = new Date(gazette.date);
              
              // Check if older than date range
              if (gazetteDate < new Date(this.dateRange.start)) {
                foundOlderThanRange = true;
                continue;
              }
              
              // Check if in date range
              if (this.isInDateRange(gazetteDate)) {
                gazettes.push(gazette);
              }
            }
          } catch (error) {
            logger.error(`Error parsing post ${post.id}:`, error as Error);
          }
        }
        
        // Check for more pages
        if (posts.length < perPage) {
          hasMorePages = false;
        } else if (!foundOlderThanRange) {
          currentPage++;
        } else {
          hasMorePages = false;
        }
        
      } catch (error) {
        // Check if it's a 400 error (page out of range)
        const errorMessage = (error as Error).message || '';
        if (errorMessage.includes('400') || errorMessage.includes('rest_post_invalid_page_number')) {
          logger.debug(`Reached end of posts at page ${currentPage}`);
          hasMorePages = false;
        } else {
          logger.error(`Error fetching page ${currentPage}:`, error as Error);
          hasMorePages = false;
        }
      }
    }
    
    logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    return gazettes;
  }

  /**
   * Parse a single WordPress post into a Gazette
   */
  private async parsePost(post: WPBoletimOficial): Promise<Gazette | null> {
    try {
      // Extract date from post
      const gazetteDate = new Date(post.date);
      
      if (isNaN(gazetteDate.getTime())) {
        logger.warn(`Invalid date for post ${post.id}: ${post.date}`);
        return null;
      }
      
      // Extract PDF URL from content.rendered
      // Pattern: <iframe ... src="https://www.itanhaem.sp.gov.br/wp-content/uploads/2025/12/957.pdf" ...>
      const pdfUrl = this.extractPdfUrl(post.content.rendered);
      
      if (!pdfUrl) {
        logger.warn(`No PDF URL found for post ${post.id}: ${post.title.rendered}`);
        return null;
      }
      
      // Extract title
      const titleText = this.decodeHtmlEntities(post.title.rendered);
      
      // Extract edition number from title (e.g., "Edição 957")
      const editionMatch = titleText.match(/[Ee]di[çc][ãa]o\s*(\d+)/i);
      const editionNumber = editionMatch ? editionMatch[1] : undefined;
      
      // Check if it's an extra edition
      const isExtraEdition = titleText.toLowerCase().includes('extra') || 
                             titleText.toLowerCase().includes('extraordin');
      
      return await this.createGazette(gazetteDate, pdfUrl, {
        editionNumber,
        isExtraEdition,
        power: 'executive_legislative',
        sourceText: titleText,
      });
      
    } catch (error) {
      logger.error(`Error parsing post ${post.id}:`, error as Error);
      return null;
    }
  }

  /**
   * Extract PDF URL from WordPress content
   * Looks for iframe src or direct PDF links
   */
  private extractPdfUrl(content: string): string | null {
    // Try iframe src first (most common pattern)
    // Pattern: <iframe ... src="URL.pdf" ...>
    const iframeMatch = content.match(/<iframe[^>]+src=["']([^"']+\.pdf)["']/i);
    if (iframeMatch) {
      return iframeMatch[1];
    }
    
    // Try direct link with .pdf
    // Pattern: <a ... href="URL.pdf" ...>
    const linkMatch = content.match(/<a[^>]+href=["']([^"']+\.pdf)["']/i);
    if (linkMatch) {
      return linkMatch[1];
    }
    
    // Try any URL ending in .pdf
    const anyPdfMatch = content.match(/(https?:\/\/[^\s"'<>]+\.pdf)/i);
    if (anyPdfMatch) {
      return anyPdfMatch[1];
    }
    
    return null;
  }

  /**
   * Decode HTML entities in text
   */
  private decodeHtmlEntities(text: string): string {
    return text
      .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&nbsp;/g, ' ');
  }
}

