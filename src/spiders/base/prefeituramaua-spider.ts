import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituramauaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

interface Publication {
  pdfUrl: string;
  date: string; // DD/MM/YYYY format
}

/**
 * Spider for Prefeitura de Mauá - Diário Oficial
 * 
 * Site Structure:
 * - URL: https://dom.maua.sp.gov.br/
 * - Contains a search form with filters (poder executivo/legislativo, categories)
 * - Publications are individual acts with PDF attachments
 * - PDFs are at: /public/docs/{hash}.pdf
 * - Each publication card shows the date in "p-date" class
 * - Pagination available via /DOM/Index/{offset}
 * 
 * Note: This site publishes individual acts, not a consolidated daily gazette PDF.
 * Each act has its own PDF file. The filter is JavaScript-based, so we scrape
 * the paginated list and filter by date on our side.
 */
export class PrefeituramauaSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const mauaConfig = config.config as PrefeituramauaConfig;
    this.baseUrl = mauaConfig.baseUrl || 'https://dom.maua.sp.gov.br';
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const seenPdfUrls = new Set<string>();

    logger.info(`Crawling Mauá gazettes from ${this.baseUrl}...`);

    try {
      let offset = 0;
      let hasMore = true;
      let consecutiveEmptyPages = 0;
      const maxConsecutiveEmpty = 3;

      while (hasMore && consecutiveEmptyPages < maxConsecutiveEmpty) {
        const pageUrl = offset === 0 ? this.baseUrl : `${this.baseUrl}/DOM/Index/${offset}`;
        
        logger.debug(`Fetching page at offset ${offset}`);

        const response = await fetch(pageUrl, {
          headers: {
            'Accept': 'text/html',
            'User-Agent': 'Mozilla/5.0 (compatible; QDSpider/1.0)',
          }
        });

        if (!response.ok) {
          logger.warn(`Failed to fetch ${pageUrl}: ${response.status}`);
          break;
        }

        const html = await response.text();
        const publications = this.extractPublications(html);

        if (publications.length === 0) {
          consecutiveEmptyPages++;
          offset += 10;
          continue;
        }

        consecutiveEmptyPages = 0;
        let foundInRange = false;
        let allBeforeRange = true;

        for (const pub of publications) {
          // Parse date from DD/MM/YYYY format
          const [day, month, year] = pub.date.split('/');
          const pubDate = new Date(`${year}-${month}-${day}`);

          // Check if publication is within date range
          if (pubDate >= this.startDate && pubDate <= this.endDate) {
            foundInRange = true;
            allBeforeRange = false;

            if (!seenPdfUrls.has(pub.pdfUrl)) {
              seenPdfUrls.add(pub.pdfUrl);

              const gazette: Gazette = {
                date: `${year}-${month}-${day}`,
                fileUrl: pub.pdfUrl,
                territoryId: this.config.territoryId,
                scrapedAt: new Date().toISOString(),
                power: 'executive',
              };

              gazettes.push(gazette);
            }
          } else if (pubDate < this.startDate) {
            // Publication is before our date range
            allBeforeRange = allBeforeRange && true;
          } else {
            allBeforeRange = false;
          }
        }

        // If all publications on this page are before our date range, stop
        if (allBeforeRange && !foundInRange) {
          logger.debug(`All publications before date range, stopping pagination`);
          hasMore = false;
          break;
        }

        // Move to next page
        offset += 10;

        // Small delay between requests to be respectful
        await new Promise(resolve => setTimeout(resolve, 300));

        // Safety limit to prevent infinite loops
        if (offset > 500) {
          logger.warn(`Reached maximum pagination offset, stopping`);
          hasMore = false;
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`);
      return gazettes;
    } catch (error) {
      logger.error(`Error crawling Mauá gazettes: ${error}`);
      return gazettes;
    }
  }

  private extractPublications(html: string): Publication[] {
    const publications: Publication[] = [];
    
    // Extract dates from p-date class
    // Format: <p class="p-date">Terça-feira, 30/12/2025</p>
    const datePattern = /<p[^>]*class="p-date"[^>]*>\s*[^,]+,\s*(\d{2}\/\d{2}\/\d{4})\s*<\/p>/gi;
    const pdfPattern = /href="((?:https:\/\/dom\.maua\.sp\.gov\.br)?\/public\/docs\/[a-f0-9]+\.pdf)"/gi;

    // Find all dates
    const dates: string[] = [];
    let match;
    while ((match = datePattern.exec(html)) !== null) {
      dates.push(match[1]);
    }

    // Find all PDF URLs
    const pdfUrls: string[] = [];
    while ((match = pdfPattern.exec(html)) !== null) {
      let url = match[1];
      if (url.startsWith('/')) {
        url = `${this.baseUrl}${url}`;
      }
      pdfUrls.push(url);
    }

    // Match PDFs with dates based on position in the document
    // Each publication card should have a date and a PDF link
    // We need to be smarter about matching - look for publication blocks
    
    // Alternative approach: extract publication blocks
    const blockPattern = /<div[^>]*class="[^"]*card[^"]*"[^>]*>[\s\S]*?<p[^>]*class="p-date"[^>]*>\s*[^,]+,\s*(\d{2}\/\d{2}\/\d{4})\s*<\/p>[\s\S]*?href="((?:https:\/\/dom\.maua\.sp\.gov\.br)?\/public\/docs\/[a-f0-9]+\.pdf)"[\s\S]*?<\/div>/gi;

    while ((match = blockPattern.exec(html)) !== null) {
      const date = match[1];
      let pdfUrl = match[2];
      if (pdfUrl.startsWith('/')) {
        pdfUrl = `${this.baseUrl}${pdfUrl}`;
      }
      publications.push({ pdfUrl, date });
    }

    // If block pattern didn't find anything, try simpler approach
    if (publications.length === 0 && dates.length > 0 && pdfUrls.length > 0) {
      // Use the most common date on the page (likely today's publications)
      const dateCount: Record<string, number> = {};
      for (const d of dates) {
        dateCount[d] = (dateCount[d] || 0) + 1;
      }
      const mostCommonDate = Object.entries(dateCount).sort((a, b) => b[1] - a[1])[0]?.[0];
      
      if (mostCommonDate) {
        // Remove duplicates from pdfUrls
        const uniquePdfs = [...new Set(pdfUrls)];
        for (const pdfUrl of uniquePdfs) {
          publications.push({ pdfUrl, date: mostCommonDate });
        }
      }
    }

    return publications;
  }
}


