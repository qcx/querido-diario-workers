import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, WordPressPublicacoesConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp } from '../../utils/date-utils';

interface WordPressPost {
  id: number;
  date: string;
  date_gmt: string;
  title: {
    rendered: string;
  };
  link: string;
  slug: string;
}

interface WordPressMedia {
  id: number;
  date: string;
  date_gmt: string;
  guid: {
    rendered: string;
  };
  title: {
    rendered: string;
  };
  source_url: string;
  mime_type: string;
  post: number;
}

/**
 * WordPressPublicacoesSpider implementation
 * 
 * Crawls WordPress sites with custom post type "publicacoes" using the REST API.
 * Each publication may have PDF attachments that are fetched via the media endpoint.
 * 
 * API endpoints:
 * - Publications list: /wp-json/wp/v2/{postType}
 * - Media for a post: /wp-json/wp/v2/media?parent={post_id}
 * 
 * Example site: https://camocim.ce.gov.br/publicacoes/
 */
export class WordPressPublicacoesSpider extends BaseSpider {
  protected wpConfig: WordPressPublicacoesConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.wpConfig = spiderConfig.config as WordPressPublicacoesConfig;
    
    if (!this.wpConfig.baseUrl) {
      throw new Error(`WordPressPublicacoesSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing WordPressPublicacoesSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.wpConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Fetch all posts from the WordPress API
      const posts = await this.fetchAllPosts();
      
      if (posts.length === 0) {
        logger.warn(`No publications found for ${this.spiderConfig.name}`);
        return gazettes;
      }
      
      logger.info(`Found ${posts.length} publications, filtering by date range...`);
      
      // Filter by date range
      const startDateStr = toISODate(this.startDate);
      const endDateStr = toISODate(this.endDate);
      
      const filteredPosts = posts.filter(post => {
        const postDate = post.date_gmt.split('T')[0];
        return postDate >= startDateStr && postDate <= endDateStr;
      });
      
      logger.info(`${filteredPosts.length} publications match the date range`, {
        startDate: startDateStr,
        endDate: endDateStr,
      });
      
      // For each post, fetch media (PDF attachments)
      for (const post of filteredPosts) {
        try {
          const media = await this.fetchMediaForPost(post.id);
          const pdfMedia = media.filter(m => m.mime_type === 'application/pdf');
          
          if (pdfMedia.length === 0) {
            logger.debug(`No PDF attachments found for post ${post.id}: ${post.title.rendered}`);
            continue;
          }
          
          // Create a gazette for each PDF attachment
          for (const pdf of pdfMedia) {
            const gazette: Gazette = {
              date: post.date_gmt.split('T')[0],
              fileUrl: pdf.source_url,
              territoryId: this.spiderConfig.territoryId,
              scrapedAt: getCurrentTimestamp(),
              isExtraEdition: false,
              power: 'executive_legislative',
              sourceText: this.decodeHtmlEntities(post.title.rendered),
            };

            gazettes.push(gazette);
            logger.info(`Found gazette for ${gazette.date}: ${gazette.sourceText} - ${pdf.source_url}`);
          }
        } catch (error) {
          logger.error(`Error processing post ${post.id}:`, error as Error);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Fetch all posts from the WordPress API with pagination
   */
  private async fetchAllPosts(): Promise<WordPressPost[]> {
    const allPosts: WordPressPost[] = [];
    const postType = this.wpConfig.postType || 'publicacoes';
    const perPage = this.wpConfig.perPage || 100;
    let page = 1;
    const maxPages = 100; // Safety limit
    
    // Calculate date range for API filtering
    const afterDate = new Date(this.startDate);
    afterDate.setDate(afterDate.getDate() - 1); // Include start date
    const beforeDate = new Date(this.endDate);
    beforeDate.setDate(beforeDate.getDate() + 1); // Include end date
    
    while (page <= maxPages) {
      const apiUrl = new URL(`${this.wpConfig.baseUrl}/wp-json/wp/v2/${postType}`);
      apiUrl.searchParams.set('per_page', perPage.toString());
      apiUrl.searchParams.set('page', page.toString());
      apiUrl.searchParams.set('orderby', 'date');
      apiUrl.searchParams.set('order', 'desc');
      // Use date filtering to reduce API calls
      apiUrl.searchParams.set('after', afterDate.toISOString());
      apiUrl.searchParams.set('before', beforeDate.toISOString());
      
      logger.debug(`Fetching page ${page}: ${apiUrl.toString()}`);
      
      try {
        const response = await fetch(apiUrl.toString(), {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json',
          },
        });
        
        if (!response.ok) {
          if (response.status === 400) {
            // Invalid page - no more results
            logger.debug(`No more pages available (status 400)`);
            break;
          }
          logger.error(`Failed to fetch page ${page}: ${response.status} ${response.statusText}`);
          break;
        }
        
        const posts: WordPressPost[] = await response.json();
        
        if (posts.length === 0) {
          logger.debug(`No posts found on page ${page}, stopping pagination`);
          break;
        }
        
        allPosts.push(...posts);
        logger.debug(`Found ${posts.length} posts on page ${page}`);
        
        // Check if we've reached the last page
        const totalPages = parseInt(response.headers.get('X-WP-TotalPages') || '1');
        if (page >= totalPages) {
          logger.debug(`Reached last page (${totalPages})`);
          break;
        }
        
        page++;
      } catch (error) {
        logger.error(`Error fetching page ${page}:`, error as Error);
        break;
      }
    }
    
    logger.info(`Fetched ${allPosts.length} posts from ${page} page(s)`);
    return allPosts;
  }

  /**
   * Fetch media attachments for a specific post
   */
  private async fetchMediaForPost(postId: number): Promise<WordPressMedia[]> {
    const apiUrl = `${this.wpConfig.baseUrl}/wp-json/wp/v2/media?parent=${postId}`;
    
    try {
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
        },
      });
      
      if (!response.ok) {
        logger.warn(`Failed to fetch media for post ${postId}: ${response.status}`);
        return [];
      }
      
      const media: WordPressMedia[] = await response.json();
      return media;
    } catch (error) {
      logger.error(`Error fetching media for post ${postId}:`, error as Error);
      return [];
    }
  }

  /**
   * Decode HTML entities in text
   */
  private decodeHtmlEntities(text: string): string {
    return text
      .replace(/&#8211;/g, '-')
      .replace(/&#8212;/g, '-')
      .replace(/&#8216;/g, "'")
      .replace(/&#8217;/g, "'")
      .replace(/&#8220;/g, '"')
      .replace(/&#8221;/g, '"')
      .replace(/&#038;/g, '&')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&nbsp;/g, ' ');
  }
}
