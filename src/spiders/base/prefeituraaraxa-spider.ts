import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraAraxaConfig } from '../../types';
import { logger } from '../../utils/logger';
// @ts-ignore
import { parse } from 'node-html-parser';
import { toISODate } from '../../utils/date-utils';

/**
 * PrefeituraAraxaSpider implementation
 * 
 * Crawls Araxá's e.DOMA (Diário Oficial Municipal de Araxá) website which uses paginated pages
 * to display gazettes in reverse chronological order.
 * 
 * Site structure:
 * - Base URL: https://www.araxa.mg.gov.br/doma-listar
 * - Pagination: ?page=N
 * - PDFs: Links to viewer that contain PDF path in query parameter
 * - Link format: "e.DOMA - Ano X / YYYª EDIÇÃO Day, DD de mês de YYYY. DD-MM-YYYY"
 * - Viewer URL: https://municipiovirtual.com.br/araxa/pdfjs/web/viewer.html?file=../../dados/site_doma/{id}/arquivo/{filename}.pdf
 * - Real PDF URL: https://municipiovirtual.com.br/araxa/dados/site_doma/{id}/arquivo/{filename}.pdf
 * 
 * HTML Structure:
 * - Container: div with gazette items
 * - Link: a[href*="pdfjs/web/viewer.html"] with text containing date and edition
 * - Date format in link text: "DD-MM-YYYY" at the end
 * 
 * The spider:
 * 1. Starts with base URL (page 1)
 * 2. Handles pagination via ?page=N
 * 3. Extracts dates from link text and PDF URLs from viewer links
 * 4. Converts viewer URLs to direct PDF URLs
 * 5. Filters gazettes to match the requested date range
 * 6. Stops crawling when dates fall outside the requested range
 */
export class PrefeituraAraxaSpider extends BaseSpider {
  protected araxaConfig: PrefeituraAraxaConfig;

  // Month name mapping for Brazilian Portuguese
  private static readonly MONTH_MAP: { [key: string]: string } = {
    'janeiro': '01',
    'fevereiro': '02',
    'março': '03',
    'abril': '04',
    'maio': '05',
    'junho': '06',
    'julho': '07',
    'agosto': '08',
    'setembro': '09',
    'outubro': '10',
    'novembro': '11',
    'dezembro': '12',
  };

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.araxaConfig = spiderConfig.config as PrefeituraAraxaConfig;
    
    if (!this.araxaConfig.baseUrl) {
      throw new Error(`PrefeituraAraxaSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraAraxaSpider for ${spiderConfig.name}`);
  }

  /**
   * Parse date from link text like "e.DOMA - Ano 5 / 693ª EDIÇÃO Terça, 06 de janeiro de 2026. 06-01-2026"
   * The date is at the end in format "DD-MM-YYYY"
   */
  private parseDateFromLinkText(linkText: string): Date | null {
    // Match pattern: "DD-MM-YYYY" at the end of the text
    const match = linkText.match(/(\d{2})-(\d{2})-(\d{4})$/);
    if (!match) {
      return null;
    }
    
    const [, day, month, year] = match;
    return new Date(`${year}-${month}-${day}`);
  }

  /**
   * Convert viewer URL to direct PDF URL
   * Viewer: https://municipiovirtual.com.br/araxa/pdfjs/web/viewer.html?file=../../dados/site_doma/1139/arquivo/edoma-06-01-2026-5bano-05-n-c2-ba-693-5d-assinado.pdf
   * PDF: https://municipiovirtual.com.br/araxa/dados/site_doma/1139/arquivo/edoma-06-01-2026-5bano-05-n-c2-ba-693-5d-assinado.pdf
   */
  private convertViewerUrlToPdfUrl(viewerUrl: string): string | null {
    try {
      const url = new URL(viewerUrl);
      const fileParam = url.searchParams.get('file');
      
      if (!fileParam) {
        return null;
      }
      
      // Remove ../.. from the path
      const pdfPath = fileParam.replace(/^\.\.\/\.\.\//, '');
      
      // Build direct PDF URL
      const baseUrl = `${url.protocol}//${url.hostname}`;
      return `${baseUrl}/araxa/${pdfPath}`;
    } catch (error) {
      logger.warn(`Error converting viewer URL to PDF: ${viewerUrl}`, error as Error);
      return null;
    }
  }

  /**
   * Extract edition number from link text
   * Format: "e.DOMA - Ano 5 / 693ª EDIÇÃO ..."
   */
  private extractEditionNumber(linkText: string): string | undefined {
    const match = linkText.match(/(\d+)ª\s*EDIÇÃO/i);
    return match ? match[1] : undefined;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.araxaConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];
    const processedUrls = new Set<string>();

    try {
      let pageNumber = 1;
      let hasMorePages = true;
      let shouldStop = false;
      let consecutiveOldGazettes = 0;
      const maxConsecutiveOldGazettes = 5;

      while (hasMorePages && !shouldStop) {
        try {
          // Build page URL
          const pageUrl = pageNumber === 1 
            ? this.araxaConfig.baseUrl 
            : `${this.araxaConfig.baseUrl}?page=${pageNumber}`;
          logger.debug(`Fetching page ${pageNumber}: ${pageUrl}`);

          const html = await this.fetch(pageUrl);
          const root = parse(html);

          // Find all links to the PDF viewer
          const viewerLinks = root.querySelectorAll('a[href*="pdfjs/web/viewer.html"]');
          logger.debug(`Found ${viewerLinks.length} viewer links on page ${pageNumber}`);

          if (viewerLinks.length === 0) {
            logger.debug(`No viewer links found on page ${pageNumber}`);
            hasMorePages = false;
            break;
          }

          // Process each viewer link
          for (const link of viewerLinks) {
            if (shouldStop) break;
            
            try {
              const linkText = link.text.trim();
              const viewerUrl = link.getAttribute('href');
              
              if (!viewerUrl) {
                continue;
              }

              // Make absolute URL if relative
              let absoluteViewerUrl: string;
              if (viewerUrl.startsWith('http')) {
                absoluteViewerUrl = viewerUrl;
              } else {
                const baseUrlObj = new URL(this.araxaConfig.baseUrl);
                absoluteViewerUrl = `${baseUrlObj.origin}${viewerUrl.startsWith('/') ? '' : '/'}${viewerUrl}`;
              }

              // Parse date from link text
              const gazetteDate = this.parseDateFromLinkText(linkText);
              
              if (!gazetteDate || isNaN(gazetteDate.getTime())) {
                logger.warn(`Could not parse date from link text: ${linkText}`);
                continue;
              }

              // Check if date is in our crawl range
              if (!this.isInDateRange(gazetteDate)) {
                const dateISO = toISODate(gazetteDate);
                logger.debug(`Gazette date ${dateISO} is outside crawl range`);
                
                // Since results are in reverse chronological order (newest first),
                // if we encounter dates before our start date, count consecutive old gazettes
                if (dateISO < this.dateRange.start) {
                  consecutiveOldGazettes++;
                  if (consecutiveOldGazettes >= maxConsecutiveOldGazettes) {
                    logger.info(`Found ${maxConsecutiveOldGazettes} consecutive old gazettes, stopping crawl`);
                    shouldStop = true;
                  }
                }
                continue;
              }

              // Reset counter when we find a gazette in range
              consecutiveOldGazettes = 0;

              // Convert viewer URL to direct PDF URL
              const pdfUrl = this.convertViewerUrlToPdfUrl(absoluteViewerUrl);
              
              if (!pdfUrl) {
                logger.warn(`Could not convert viewer URL to PDF: ${absoluteViewerUrl}`);
                continue;
              }

              // Skip if already processed
              if (processedUrls.has(pdfUrl)) {
                logger.debug(`Skipping duplicate PDF URL: ${pdfUrl}`);
                continue;
              }

              // Mark URL as processed
              processedUrls.add(pdfUrl);

              // Extract edition number
              const editionNumber = this.extractEditionNumber(linkText);

              // Create the gazette
              const gazette = await this.createGazette(gazetteDate, pdfUrl, {
                editionNumber,
                power: 'executive',
                sourceText: linkText,
              });

              if (gazette) {
                gazettes.push(gazette);
                logger.debug(`Added gazette: ${linkText} - ${toISODate(gazetteDate)}`);
              }

            } catch (error) {
              logger.error(`Error processing viewer link:`, error as Error);
            }
          }

          // Check if there's a next page (look for pagination links)
          const paginationLinks = root.querySelectorAll('a[href*="page="], nav a[href*="page="]');
          const nextPageExists = Array.from(paginationLinks).some(link => {
            const href = link.getAttribute('href') || '';
            return href.includes(`page=${pageNumber + 1}`);
          });

          hasMorePages = nextPageExists && !shouldStop;
          pageNumber++;

          // Add delay between pages to avoid rate limiting
          if (hasMorePages && !shouldStop) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }

        } catch (error) {
          logger.error(`Error fetching page ${pageNumber}:`, error as Error);
          hasMorePages = false;
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }
}

