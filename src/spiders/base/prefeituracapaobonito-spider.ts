import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraCapaoBonitoConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

interface WPPost {
  id: number;
  date: string;
  date_gmt: string;
  slug: string;
  title: { rendered: string };
  content: { rendered: string };
}

/**
 * Spider for Prefeitura de Capão Bonito - Imprensa Oficial
 * 
 * Site Structure:
 * - WordPress site with WP-FileBase plugin
 * - REST API for listing editions: /wp-json/wp/v2/posts
 * 
 * API Response format:
 * {
 *   "id": 4170,
 *   "date": "2026-01-05T18:08:50",
 *   "slug": "edicao-1772",
 *   "title": { "rendered": "Edição 1772" },
 *   "content": { "rendered": "<a href=\"...pdf\">...</a>" }
 * }
 * 
 * PDF URL pattern (extracted from content or constructed):
 * - https://imprensaoficial.capaobonito.sp.gov.br/wp-content/uploads/filebase/imprensa_oficial/{YYYY}/edicao-{numero}.pdf
 */
export class PrefeituraCapaoBonitoSpider extends BaseSpider {
  private baseUrl: string;
  private apiUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const capaoBonitoConfig = config.config as PrefeituraCapaoBonitoConfig;
    this.baseUrl = capaoBonitoConfig.baseUrl || 'https://imprensaoficial.capaobonito.sp.gov.br';
    this.apiUrl = `${this.baseUrl}/wp-json/wp/v2/posts`;
  }

  /**
   * Set browser instance (for queue consumer context)
   * Note: This spider doesn't require browser automation
   */
  setBrowser(_browser: Fetcher): void {
    // Not needed - this spider uses HTTP requests to WP REST API
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    logger.info(`Crawling Capão Bonito gazettes from ${this.startDate.toISOString()} to ${this.endDate.toISOString()}...`);

    try {
      // Fetch posts from WordPress REST API with pagination
      let page = 1;
      let hasMore = true;
      const perPage = 100;

      while (hasMore) {
        const posts = await this.fetchPosts(page, perPage);
        
        if (!posts || posts.length === 0) {
          hasMore = false;
          break;
        }

        for (const post of posts) {
          try {
            const gazette = await this.parsePost(post);
            
            if (gazette && this.isInDateRange(new Date(gazette.date))) {
              gazettes.push(gazette);
            }
            
            // Check if we've gone past the start date range
            const postDate = new Date(post.date);
            if (postDate < this.startDate) {
              hasMore = false;
              break;
            }
          } catch (error) {
            logger.error(`Error parsing post ${post.id}: ${error}`);
          }
        }

        // If the last post is before our date range, stop
        if (posts.length > 0) {
          const lastPost = posts[posts.length - 1];
          const lastDate = new Date(lastPost.date);
          if (lastDate < this.startDate) {
            hasMore = false;
          }
        }

        // Check if we got less than a full page (means no more posts)
        if (posts.length < perPage) {
          hasMore = false;
        }

        page++;

        // Safety limit to prevent infinite loops
        if (page > 50) {
          logger.warn('Reached maximum page limit (50), stopping pagination');
          hasMore = false;
        }

        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`);
    } catch (error) {
      logger.error(`Error crawling Capão Bonito gazettes: ${error}`);
    }

    return gazettes;
  }

  private async fetchPosts(page: number, perPage: number): Promise<WPPost[]> {
    // Build URL with date filtering
    const params = new URLSearchParams({
      per_page: perPage.toString(),
      page: page.toString(),
      orderby: 'date',
      order: 'desc',
    });

    // Add date filters if we have them
    // WordPress uses ISO 8601 format for after/before parameters
    if (this.startDate) {
      params.append('after', this.startDate.toISOString());
    }
    if (this.endDate) {
      // Add 1 day to endDate since 'before' is exclusive
      const endDatePlusOne = new Date(this.endDate);
      endDatePlusOne.setDate(endDatePlusOne.getDate() + 1);
      params.append('before', endDatePlusOne.toISOString());
    }

    const url = `${this.apiUrl}?${params.toString()}`;
    logger.debug(`Fetching posts from: ${url}`);

    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; QDSpider/1.0)',
        },
      });

      if (!response.ok) {
        if (response.status === 400) {
          // No more pages
          return [];
        }
        logger.warn(`Failed to fetch posts page ${page}: ${response.status}`);
        return [];
      }

      return await response.json();
    } catch (error) {
      logger.error(`Error fetching posts page ${page}: ${error}`);
      return [];
    }
  }

  private async parsePost(post: WPPost): Promise<Gazette | null> {
    try {
      // Extract date from post
      const date = new Date(post.date);
      const isoDate = date.toISOString().split('T')[0];

      // Extract edition number from title (e.g., "Edição 1772" -> "1772")
      const editionMatch = post.title.rendered.match(/[Ee]di[çc][ãa]o\s*(\d+)/);
      const editionNumber = editionMatch ? editionMatch[1] : undefined;

      // Extract PDF URL from content
      // The content contains HTML like: <a href="...pdf">Clique aqui para ver o PDF</a>
      let pdfUrl: string | null = null;

      // Try to find PDF link in content
      const contentPdfMatch = post.content.rendered.match(/href="([^"]+\.pdf)"/i);
      if (contentPdfMatch) {
        pdfUrl = contentPdfMatch[1];
      }

      // If no PDF in content, try to construct URL from slug and date
      if (!pdfUrl && editionNumber) {
        const year = date.getFullYear();
        pdfUrl = `${this.baseUrl}/wp-content/uploads/filebase/imprensa_oficial/${year}/edicao-${editionNumber}.pdf`;
      }

      if (!pdfUrl) {
        logger.warn(`No PDF URL found for post ${post.id}: ${post.title.rendered}`);
        return null;
      }

      // Check if it's an extra edition
      const isExtraEdition = post.title.rendered.toLowerCase().includes('extra');

      return await this.createGazette(date, pdfUrl, {
        editionNumber,
        isExtraEdition,
        power: 'executive_legislative',
        sourceText: post.title.rendered,
      });
    } catch (error) {
      logger.error(`Error parsing post ${post.id}: ${error}`);
      return null;
    }
  }
}



