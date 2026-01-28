import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeiturateixeiraDeFreitasConfig } from '../../types';
import { logger } from '../../utils/logger';
import { getCurrentTimestamp } from '../../utils/date-utils';

/**
 * PrefeiturateixeiradefreitasSpider implementation
 * 
 * Crawls the official gazette from Teixeira de Freitas, BA
 * Site: https://diario.teixeiradefreitas.ba.gov.br
 * 
 * The site is a WordPress blog where each post is an edition of the official gazette.
 * Each edition contains multiple "Cadernos" (sections) with PDF links.
 * PDFs are stored at: http://diario.teixeiradefreitas.ba.gov.br/wp-content/uploads/YYYY/MM/domtdfXXXXXXcXXXXXXXX.pdf
 * 
 * Pagination: /page/N/
 */
export class PrefeiturateixeiradefreitasSpider extends BaseSpider {
  protected teixeiraConfig: PrefeiturateixeiraDeFreitasConfig;
  private maxPages = 50; // Maximum pages to crawl to avoid infinite loops

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.teixeiraConfig = spiderConfig.config as PrefeiturateixeiraDeFreitasConfig;
    
    if (!this.teixeiraConfig.baseUrl) {
      throw new Error(`PrefeiturateixeiradefreitasSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeiturateixeiradefreitasSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.teixeiraConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();
    
    let page = 1;
    let hasMorePages = true;
    let foundGazettesInDateRange = false;
    let consecutiveOutOfRangePages = 0;

    while (hasMorePages && page <= this.maxPages) {
      try {
        const pageUrl = page === 1 
          ? this.teixeiraConfig.baseUrl 
          : `${this.teixeiraConfig.baseUrl}/page/${page}/`;
        
        logger.info(`Fetching page ${page}: ${pageUrl}`);
        
        const html = await this.fetch(pageUrl);
        const $ = this.loadHTML(html);
        
        // Check if page exists (WordPress returns 404 page or empty content for non-existent pages)
        const articles = $('article').toArray();
        
        if (articles.length === 0) {
          logger.info(`No articles found on page ${page}, stopping pagination`);
          break;
        }

        let pageHasGazettesInRange = false;

        for (const article of articles) {
          try {
            const $article = $(article);
            
            // Extract date from the <time datetime="..."> element
            const timeElement = $article.find('time.article-time[datetime]');
            const dateTimeAttr = timeElement.attr('datetime');
            
            if (!dateTimeAttr) {
              logger.debug('Article without datetime, skipping');
              continue;
            }

            // Parse ISO datetime (e.g., "2022-07-25T14:58:18-03:00")
            const date = dateTimeAttr.split('T')[0];
            const dateObj = new Date(date);
            
            // Check if date is in range
            if (!this.isInDateRange(dateObj)) {
              // If we've found gazettes in range before and now we're out of range,
              // we might be past the date range (older gazettes)
              if (foundGazettesInDateRange) {
                consecutiveOutOfRangePages++;
                if (consecutiveOutOfRangePages >= 3) {
                  logger.info(`Found ${consecutiveOutOfRangePages} consecutive out-of-range pages, stopping`);
                  hasMorePages = false;
                  break;
                }
              }
              continue;
            }

            foundGazettesInDateRange = true;
            pageHasGazettesInRange = true;
            consecutiveOutOfRangePages = 0;

            // Extract edition info from title
            const titleElement = $article.find('h3.entry-title');
            const titleText = titleElement.text().trim();
            
            // Extract edition number from title (e.g., "Edição nº. 4002 – Ano XVI")
            const editionMatch = titleText.match(/Edição\s*n[º°o]?\.\s*(\d+)/i);
            const editionNumber = editionMatch ? editionMatch[1] : undefined;

            // Find all PDF links in this article
            const pdfLinks = $article.find('a[href*=".pdf"]').toArray();
            
            for (const link of pdfLinks) {
              try {
                const $link = $(link);
                let href = $link.attr('href');
                
                if (!href?.includes('.pdf')) {
                  continue;
                }

                // Fix protocol-relative URLs or relative URLs
                if (href.startsWith('//')) {
                  href = `https:${href}`;
                } else if (href.startsWith('/')) {
                  href = `https://diario.teixeiradefreitas.ba.gov.br${href}`;
                } else if (!href.startsWith('http')) {
                  href = `https://diario.teixeiradefreitas.ba.gov.br/${href}`;
                }

                // Skip if we've already seen this URL
                if (seenUrls.has(href)) {
                  continue;
                }
                seenUrls.add(href);

                // Extract caderno number from the context (h6 element text)
                const h6Parent = $link.closest('h6');
                const h6Text = h6Parent.text() || '';
                const cadernoMatch = h6Text.match(/Caderno\s*n[º°o]?\.\s*(\d+)/i);
                const cadernoNumber = cadernoMatch ? cadernoMatch[1] : undefined;

                // Build source text
                let sourceText = titleText;
                if (cadernoNumber) {
                  sourceText += ` - Caderno ${cadernoNumber}`;
                }

                const gazette: Gazette = {
                  date,
                  fileUrl: href,
                  territoryId: this.spiderConfig.territoryId,
                  scrapedAt: getCurrentTimestamp(),
                  isExtraEdition: false,
                  power: 'executive_legislative',
                  editionNumber,
                  sourceText,
                };

                gazettes.push(gazette);
                logger.info(`Found gazette: ${date} - Edition ${editionNumber || 'N/A'} - Caderno ${cadernoNumber || 'N/A'}`);
              } catch (linkError) {
                logger.warn(`Error processing PDF link:`, { error: (linkError as Error).message });
              }
            }
          } catch (articleError) {
            logger.warn(`Error processing article:`, { error: (articleError as Error).message });
          }
        }

        // Reset consecutive counter if we found gazettes in range on this page
        if (pageHasGazettesInRange) {
          consecutiveOutOfRangePages = 0;
        }

        page++;
        
      } catch (error) {
        // 404 or other errors indicate end of pagination
        if ((error as Error).message.includes('404') || (error as Error).message.includes('Not Found')) {
          logger.info(`Page ${page} not found, stopping pagination`);
          break;
        }
        logger.error(`Error fetching page ${page}:`, error as Error);
        break;
      }
    }

    logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    
    return gazettes;
  }
}
