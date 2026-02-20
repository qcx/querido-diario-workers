import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraItaquaquecetubaConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';
import { fetchHTML } from '../../utils/http-client';

/**
 * PrefeituraItaquaquecetubaSpider implementation
 * 
 * Crawls Itaquaquecetuba's official gazette website.
 * 
 * The site uses Joomla with the edocman component:
 * - Documents are listed in a table structure
 * - Dates are in Portuguese format: "Quinta 13 de Novembro de 2025"
 * - PDF links are accessed via /viewdocument URLs
 * 
 * The spider:
 * 1. Fetches the main page HTML
 * 2. Parses table rows to find document listings
 * 3. Extracts publication dates from dateinformation divs
 * 4. Uses viewdocument links to get PDF URLs
 * 5. Filters gazettes to match the requested date range
 */
export class PrefeituraItaquaquecetubaSpider extends BaseSpider {
  protected itaquaquecetubaConfig: PrefeituraItaquaquecetubaConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.itaquaquecetubaConfig = spiderConfig.config as PrefeituraItaquaquecetubaConfig;
    
    if (!this.itaquaquecetubaConfig.url) {
      throw new Error(`PrefeituraItaquaquecetubaSpider requires url in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraItaquaquecetubaSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.itaquaquecetubaConfig.url} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];
    const processedUrls = new Set<string>(); // Track processed PDF URLs to avoid duplicates

    try {
      let currentUrl = this.itaquaquecetubaConfig.url;
      let hasMorePages = true;
      let pageNumber = 1;
      let shouldStop = false;

      // Portuguese month names mapping
      const monthMap: { [key: string]: number } = {
        'janeiro': 0, 'fevereiro': 1, 'março': 2, 'marco': 2,
        'abril': 3, 'maio': 4, 'junho': 5, 'julho': 6,
        'agosto': 7, 'setembro': 8, 'outubro': 9,
        'novembro': 10, 'dezembro': 11
      };

      while (hasMorePages && !shouldStop) {
        try {
          logger.debug(`Fetching page ${pageNumber}: ${currentUrl}`);
          const html = await fetchHTML(currentUrl);
          this.requestCount++;
          
          const $ = this.loadHTML(html);

          // Find all table rows with documents
          const rows = $('table.table-document tbody tr');
          logger.debug(`Found ${rows.length} table rows on page ${pageNumber}`);

          if (rows.length === 0) {
            logger.debug('No rows found, stopping pagination');
            break;
          }

          // Process each row
          let foundInRange = false;
          for (let i = 0; i < rows.length; i++) {
            try {
              const row = $(rows[i]);
              
              // Check if this row has a PDF icon (skip folders)
              const hasPdfIcon = row.find('i.edicon-file-pdf').length > 0;
              if (!hasPdfIcon) {
                continue;
              }

              // Get the title cell
              const titleCell = row.find('td.edocman-document-title-td');
              if (titleCell.length === 0) {
                continue;
              }

              // Extract title link (first link in title cell)
              const titleLink = titleCell.find('a').first();
              if (titleLink.length === 0) {
                continue;
              }

              const linkText = titleLink.text().trim();
              
              // Extract viewdocument link (for PDF access)
              const viewDocLink = titleCell.find('a.documents_table_view');
              if (viewDocLink.length === 0) {
                continue;
              }

              let viewDocUrl = viewDocLink.attr('href');
              if (!viewDocUrl) {
                continue;
              }

              // Make URL absolute if relative
              if (!viewDocUrl.startsWith('http')) {
                const baseUrlObj = new URL(this.itaquaquecetubaConfig.url);
                const baseDomain = `${baseUrlObj.protocol}//${baseUrlObj.host}`;
                const normalizedPath = viewDocUrl.startsWith('/') ? viewDocUrl : `/${viewDocUrl}`;
                viewDocUrl = `${baseDomain}${normalizedPath}`;
              }

              // Extract date from dateinformation div
              const dateInfo = titleCell.find('div.dateinformation');
              if (dateInfo.length === 0) {
                continue;
              }

              let dateText = dateInfo.text().trim();
              // Remove the calendar icon text if present
              dateText = dateText.replace(/^\s*[^\d]+\s*/, '').trim();
              
              let gazetteDate: Date | null = null;

              // Parse Portuguese date format: "Quinta 13 de Novembro de 2025"
              const portugueseDateMatch = dateText.match(/(\d{1,2})\s+de\s+(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})/i);
              if (portugueseDateMatch) {
                const day = parseInt(portugueseDateMatch[1], 10);
                const monthName = portugueseDateMatch[2].toLowerCase();
                const year = parseInt(portugueseDateMatch[3], 10);
                const month = monthMap[monthName];
                if (month !== undefined) {
                  gazetteDate = new Date(year, month, day);
                }
              }

              // Try alternative format: DD.MM.YYYY (e.g., "13.11.2025")
              if (!gazetteDate) {
                const dotDateMatch = dateText.match(/(\d{2})\.(\d{2})\.(\d{4})/);
                if (dotDateMatch) {
                  const day = parseInt(dotDateMatch[1], 10);
                  const month = parseInt(dotDateMatch[2], 10) - 1;
                  const year = parseInt(dotDateMatch[3], 10);
                  gazetteDate = new Date(year, month, day);
                }
              }

              // Try DD/MM/YYYY format
              if (!gazetteDate) {
                const slashDateMatch = dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                if (slashDateMatch) {
                  const day = parseInt(slashDateMatch[1], 10);
                  const month = parseInt(slashDateMatch[2], 10) - 1;
                  const year = parseInt(slashDateMatch[3], 10);
                  gazetteDate = new Date(year, month, day);
                }
              }

              if (!gazetteDate) {
                continue;
              }

              // Check if date is in our crawl range
              if (!this.isInDateRange(gazetteDate)) {
                const dateISO = toISODate(gazetteDate);
                // Since results appear to be newest first, if we encounter a date before our start date,
                // we can stop crawling
                if (dateISO < this.dateRange.start) {
                  logger.info(`Reached dates before start date (${this.dateRange.start}), stopping crawl`);
                  shouldStop = true;
                }
                continue;
              }

              foundInRange = true;

              // Skip if we've already processed this URL
              if (processedUrls.has(viewDocUrl)) {
                continue;
              }

              // The viewdocument URL serves the PDF directly
              const pdfUrl = viewDocUrl;

              // Mark URL as processed
              processedUrls.add(pdfUrl);

              // Extract edition number from link text if available
              const editionMatch = linkText.match(/[Ee]di[çc][ãa]o\s*(?:n[º°]?|N[º°]?)?\s*(\d+)/i);
              const editionNumber = editionMatch ? editionMatch[1] : undefined;

              // Determine power based on URL path
              let power: 'executive' | 'legislative' | 'executive_legislative' = 'executive_legislative';
              if (viewDocUrl.includes('/prefeitura/') && !viewDocUrl.includes('/camara/')) {
                power = 'executive';
              } else if (viewDocUrl.includes('/camara/')) {
                power = 'legislative';
              }

              // Create the gazette object
              const gazette = await this.createGazette(gazetteDate, pdfUrl, {
                editionNumber,
                power,
                sourceText: linkText,
                requiresClientRendering: false,
              });

              if (gazette) {
                gazettes.push(gazette);
                logger.debug(`Created gazette: ${toISODate(gazetteDate)} - ${pdfUrl}`);
              }

            } catch (error) {
              logger.error(`Error processing gazette row ${i} on page ${pageNumber}:`, error as Error);
            }
          }

          logger.debug(`Page ${pageNumber}: Found ${gazettes.length} total gazettes (${foundInRange ? 'found in range' : 'none in range'})`);

          // Check for next page
          const nextPageLink = $('.pagination-list a.pagenav[title="Próximo"]');
          if (nextPageLink.length > 0) {
            // Check if parent li is disabled
            const parentLi = nextPageLink.closest('li');
            const isDisabled = parentLi.hasClass('disabled') || !nextPageLink.attr('href');
            
            if (!isDisabled) {
              const nextHref = nextPageLink.attr('href');
              if (nextHref) {
                // Make URL absolute if relative
                if (!nextHref.startsWith('http')) {
                  const baseUrlObj = new URL(this.itaquaquecetubaConfig.url);
                  const baseDomain = `${baseUrlObj.protocol}//${baseUrlObj.host}`;
                  const normalizedPath = nextHref.startsWith('/') ? nextHref : `/${nextHref}`;
                  currentUrl = `${baseDomain}${normalizedPath}`;
                } else {
                  currentUrl = nextHref;
                }
                pageNumber++;
                
                // Add small delay between pages to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 500));
              } else {
                hasMorePages = false;
              }
            } else {
              hasMorePages = false;
            }
          } else {
            hasMorePages = false;
          }

        } catch (error) {
          logger.error(`Error fetching page ${pageNumber}:`, error as Error);
          hasMorePages = false;
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name} across ${pageNumber} page(s)`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }
}

