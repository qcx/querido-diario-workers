import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraCoronelFabricianoConfig } from '../../types';
import { logger } from '../../utils/logger';
// @ts-ignore
import { parse } from 'node-html-parser';
import { toISODate } from '../../utils/date-utils';

/**
 * PrefeituraCoronelFabricianoSpider implementation
 * 
 * Crawls Coronel Fabriciano's Diário Oficial website which uses paginated pages
 * to display gazettes in reverse chronological order.
 * 
 * Site structure:
 * - Base URL: https://diario.fabriciano.mg.gov.br/todas-publicações
 * - Pagination: ?page=N
 * - PDFs: Links with onclick="openPdfFile(`/storage/diario/{filename}.pdf`,1)"
 * - Date format: "Diário Oficial do dia DD de Mês de YYYY" (e.g., "Diário Oficial do dia 07 de Janeiro de 2026")
 * 
 * HTML Structure:
 * - Container: div with gazette items
 * - Heading: h2, h3, h4, h5, h6 with "Diário Oficial do dia DD de Mês de YYYY"
 * - PDF link: a[onclick*="openPdfFile"] with onclick containing PDF path
 * 
 * The spider:
 * 1. Starts with base URL (page 1)
 * 2. Handles pagination via ?page=N
 * 3. Extracts dates from headings and PDF URLs from onclick attributes
 * 4. Filters gazettes to match the requested date range
 * 5. Stops crawling when dates fall outside the requested range
 */
export class PrefeituraCoronelFabricianoSpider extends BaseSpider {
  protected fabricianoConfig: PrefeituraCoronelFabricianoConfig;

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
    this.fabricianoConfig = spiderConfig.config as PrefeituraCoronelFabricianoConfig;
    
    if (!this.fabricianoConfig.baseUrl) {
      throw new Error(`PrefeituraCoronelFabricianoSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraCoronelFabricianoSpider for ${spiderConfig.name}`);
  }

  /**
   * Parse date from heading text like "Diário Oficial do dia 07 de Janeiro de 2026"
   */
  private parseDateFromHeading(headingText: string): Date | null {
    // Match pattern: "Diário Oficial do dia DD de Mês de YYYY"
    const match = headingText.match(/Diário Oficial do dia (\d+) de (\w+) de (\d{4})/i);
    if (!match) {
      return null;
    }
    
    const [, day, monthName, year] = match;
    const month = PrefeituraCoronelFabricianoSpider.MONTH_MAP[monthName.toLowerCase()];
    
    if (!month) {
      logger.warn(`Unknown month name: ${monthName}`);
      return null;
    }
    
    return new Date(`${year}-${month}-${day.padStart(2, '0')}`);
  }

  /**
   * Extract PDF URL from onclick attribute
   * onclick="openPdfFile(`/storage/diario/16085720260107695eaf4968acc-2600.pdf`,1)"
   */
  private extractPdfUrl(onclickAttr: string): string | null {
    // Match pattern: openPdfFile(`/storage/diario/{filename}.pdf`,1)
    const match = onclickAttr.match(/openPdfFile\(`([^`]+\.pdf)`/);
    if (!match) {
      return null;
    }
    
    const pdfPath = match[1];
    const baseUrlObj = new URL(this.fabricianoConfig.baseUrl);
    return `${baseUrlObj.origin}${pdfPath}`;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.fabricianoConfig.baseUrl} for ${this.spiderConfig.name}...`);
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
            ? this.fabricianoConfig.baseUrl 
            : `${this.fabricianoConfig.baseUrl}?page=${pageNumber}`;
          logger.debug(`Fetching page ${pageNumber}: ${pageUrl}`);

          const html = await this.fetch(pageUrl);
          const root = parse(html);

          // Find all headings that contain "Diário Oficial do dia"
          const headings = root.querySelectorAll('h1, h2, h3, h4, h5, h6');
          logger.debug(`Found ${headings.length} headings on page ${pageNumber}`);

          if (headings.length === 0) {
            logger.debug(`No headings found on page ${pageNumber}`);
            hasMorePages = false;
            break;
          }

          // Process each heading to find gazettes
          for (const heading of headings) {
            if (shouldStop) break;
            
            try {
              const headingText = heading.text.trim();
              
              // Check if this heading contains a date
              if (!headingText.includes('Diário Oficial do dia')) {
                continue;
              }

              // Parse date from heading
              const gazetteDate = this.parseDateFromHeading(headingText);
              
              if (!gazetteDate || isNaN(gazetteDate.getTime())) {
                logger.warn(`Could not parse date from heading: ${headingText}`);
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

              // Find PDF link near this heading
              // Look for links with onclick containing openPdfFile in the same container or nearby
              let pdfUrl: string | null = null;
              
              // First, try to find link in parent container
              const parent = heading.parentNode;
              if (parent) {
                const pdfLinks = parent.querySelectorAll('a[onclick*="openPdfFile"]');
                if (pdfLinks.length > 0) {
                  const onclickAttr = pdfLinks[0].getAttribute('onclick') || '';
                  pdfUrl = this.extractPdfUrl(onclickAttr);
                }
              }
              
              // If not found, search in next sibling elements
              if (!pdfUrl) {
                let current: any = heading.nextSibling;
                let searchCount = 0;
                while (current && searchCount < 5) {
                  if (current.nodeType === 1) { // Element node
                    const pdfLinks = current.querySelectorAll?.('a[onclick*="openPdfFile"]');
                    if (pdfLinks && pdfLinks.length > 0) {
                      const onclickAttr = pdfLinks[0].getAttribute('onclick') || '';
                      pdfUrl = this.extractPdfUrl(onclickAttr);
                      if (pdfUrl) break;
                    }
                  }
                  current = current.nextSibling;
                  searchCount++;
                }
              }

              if (!pdfUrl) {
                logger.warn(`Could not find PDF URL for heading: ${headingText}`);
                continue;
              }

              // Skip if already processed
              if (processedUrls.has(pdfUrl)) {
                logger.debug(`Skipping duplicate PDF URL: ${pdfUrl}`);
                continue;
              }

              // Mark URL as processed
              processedUrls.add(pdfUrl);

              // Extract edition number from filename if possible
              // Filename format: {timestamp}{date}{hash}-{edition}.pdf
              const editionMatch = pdfUrl.match(/-(\d+)\.pdf$/);
              const editionNumber = editionMatch ? editionMatch[1] : undefined;

              // Create the gazette
              const gazette = await this.createGazette(gazetteDate, pdfUrl, {
                editionNumber,
                power: 'executive',
                sourceText: headingText,
              });

              if (gazette) {
                gazettes.push(gazette);
                logger.debug(`Added gazette: ${headingText} - ${toISODate(gazetteDate)}`);
              }

            } catch (error) {
              logger.error(`Error processing heading:`, error as Error);
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

