import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeiturasantaluziamgConfig } from '../../types/spider-config';
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
 * Spider for Prefeitura de Santa Luzia - MG - Diário Oficial Eletrônico do Município (DOESL)
 * 
 * Site Structure:
 * - WordPress site with Modern Events Calendar and PDF Poster plugins
 * - REST API for listing editions: /index.php?rest_route=/wp/v2/posts
 * 
 * API Response format:
 * {
 *   "id": 40878,
 *   "date": "2026-01-06T21:01:28",
 *   "slug": "diario-oficial-do-municipio-no-1411-06-01-2026",
 *   "title": { "rendered": "Diário Oficial do Município nº 1411 – 06/01/2026" },
 *   "content": { "rendered": "<div ... data-attributes='...\"file\":\"https://dom.santaluzia.mg.gov.br/wp-content/uploads/2026/01/1411-DOM.pdf\"...'>" }
 * }
 * 
 * PDF URL pattern (extracted from data-attributes in content):
 * - https://dom.santaluzia.mg.gov.br/wp-content/uploads/{YYYY}/{MM}/{number}-DOM.pdf
 * - https://dom.santaluzia.mg.gov.br/wp-content/uploads/{YYYY}/{MM}/{number}-DOM-EDICAO-EXTRA.pdf
 */
export class PrefeiturasantaluziamgSpider extends BaseSpider {
  private baseUrl: string;
  private apiUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const santaLuziaConfig = config.config as PrefeiturasantaluziamgConfig;
    this.baseUrl = santaLuziaConfig.baseUrl || 'https://dom.santaluzia.mg.gov.br';
    this.apiUrl = `${this.baseUrl}/index.php?rest_route=/wp/v2/posts`;
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
    
    logger.info(`Crawling Santa Luzia - MG gazettes from ${this.startDate.toISOString()} to ${this.endDate.toISOString()}...`);

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
            const postGazettes = await this.parsePost(post);
            
            for (const gazette of postGazettes) {
              if (gazette && this.isInDateRange(new Date(gazette.date))) {
                gazettes.push(gazette);
              }
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
      logger.error(`Error crawling Santa Luzia - MG gazettes: ${error}`);
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

    const url = `${this.apiUrl}&${params.toString()}`;
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

  private async parsePost(post: WPPost): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Extract date from post
      const date = new Date(post.date);

      // Extract edition number from title (e.g., "Diário Oficial do Município nº 1411 – 06/01/2026" -> "1411")
      const editionMatch = post.title.rendered.match(/n[º°o]?\s*(\d+)/i);
      const editionNumber = editionMatch ? editionMatch[1] : undefined;

      // Check if it's an extra edition
      const isExtraEdition = post.title.rendered.toLowerCase().includes('extra');

      // Extract PDF URLs from content
      // The content contains embedded PDF blocks with data-attributes
      // Pattern: data-attributes='{..."file":"https://...pdf"...}'
      const pdfUrls = this.extractPdfUrls(post.content.rendered);

      if (pdfUrls.length === 0) {
        // Try alternative pattern: href="...pdf"
        const hrefMatch = post.content.rendered.match(/href="([^"]+\.pdf)"/gi);
        if (hrefMatch) {
          for (const match of hrefMatch) {
            const url = match.replace(/href="/i, '').replace(/"$/, '');
            if (url && !pdfUrls.includes(url)) {
              pdfUrls.push(url);
            }
          }
        }
      }

      if (pdfUrls.length === 0) {
        logger.warn(`No PDF URL found for post ${post.id}: ${post.title.rendered}`);
        return [];
      }

      // Create a gazette for each PDF found
      for (let i = 0; i < pdfUrls.length; i++) {
        const pdfUrl = pdfUrls[i];
        
        // Check if this specific PDF is extra edition (from filename)
        const pdfIsExtra = pdfUrl.toLowerCase().includes('extra') || isExtraEdition;
        
        // Extract edition number from PDF filename if not found in title
        let pdfEditionNumber = editionNumber;
        if (!pdfEditionNumber) {
          const filenameMatch = pdfUrl.match(/\/(\d+)-DOM/i);
          if (filenameMatch) {
            pdfEditionNumber = filenameMatch[1];
          }
        } else if (pdfUrls.length > 1 && i > 0) {
          // For multiple PDFs in the same post, try to extract edition from filename
          const filenameMatch = pdfUrl.match(/\/(\d+)-DOM/i);
          if (filenameMatch) {
            pdfEditionNumber = filenameMatch[1];
          }
        }

        const gazette = await this.createGazette(date, pdfUrl, {
          editionNumber: pdfEditionNumber,
          isExtraEdition: pdfIsExtra,
          power: 'executive_legislative',
          sourceText: post.title.rendered,
        });

        if (gazette) {
          gazettes.push(gazette);
        }
      }
    } catch (error) {
      logger.error(`Error parsing post ${post.id}: ${error}`);
    }

    return gazettes;
  }

  /**
   * Extract PDF URLs from the content HTML
   * The PDF poster plugin stores file URLs in data-attributes JSON
   */
  private extractPdfUrls(content: string): string[] {
    const urls: string[] = [];
    
    // First, decode HTML entities in the content
    const decodedContent = content
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#039;/g, "'")
      .replace(/\\\//g, '/'); // Handle escaped forward slashes from JSON
    
    // Method 1: Extract file URLs directly from decoded content
    // Pattern: "file":"https://...pdf"
    const fileRegex = /"file":"([^"]+\.pdf)"/gi;
    let match;
    
    while ((match = fileRegex.exec(decodedContent)) !== null) {
      const url = match[1];
      if (url && !urls.includes(url)) {
        urls.push(url);
      }
    }
    
    // Method 2: Try with single quotes if no matches found
    if (urls.length === 0) {
      const fileRegexSingleQuote = /'file':'([^']+\.pdf)'/gi;
      while ((match = fileRegexSingleQuote.exec(decodedContent)) !== null) {
        const url = match[1];
        if (url && !urls.includes(url)) {
          urls.push(url);
        }
      }
    }
    
    // Method 3: Try extracting from href attributes as fallback
    if (urls.length === 0) {
      const hrefRegex = /href=["']([^"']+\.pdf)["']/gi;
      while ((match = hrefRegex.exec(decodedContent)) !== null) {
        const url = match[1];
        if (url && !urls.includes(url)) {
          urls.push(url);
        }
      }
    }
    
    // Method 4: Try extracting from src attributes (iframes)
    if (urls.length === 0) {
      const srcRegex = /src=["']([^"']+\.pdf[^"']*)["']/gi;
      while ((match = srcRegex.exec(decodedContent)) !== null) {
        let url = match[1];
        // Clean up any viewer parameters
        if (url.includes('#')) {
          url = url.split('#')[0];
        }
        if (url.endsWith('.pdf') && !urls.includes(url)) {
          urls.push(url);
        }
      }
    }

    return urls;
  }
}

