import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, AirdocConfig } from '../../types';
import { logger } from '../../utils/logger';
import { getCurrentTimestamp } from '../../utils/date-utils';

/**
 * AirdocSpider implementation for Cloudflare Workers
 * 
 * AIRDOC/Portal do Município is a platform used by municipalities in Brazil.
 * The platform requires POST requests to render content.
 * 
 * The system is hosted at portalmunicipio.airdoc.com.br and used by municipalities
 * like Presidente Tancredo Neves (BA).
 * 
 * The HTML structure contains:
 * - Table with publication rows containing dates, descriptions
 * - Links to view files (showArquivosPublicacao)
 * - Date in format DD/MM/YYYY
 * - Pagination with page numbers
 */
export class AirdocSpider extends BaseSpider {
  protected airdocConfig: AirdocConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.airdocConfig = spiderConfig.config as AirdocConfig;
    
    if (!this.airdocConfig.baseUrl) {
      throw new Error(`AirdocSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing AirdocSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    const baseUrl = this.airdocConfig.baseUrl.replace(/\/$/, '');
    const diarioUrl = `${baseUrl}/diario`;
    
    logger.info(`Crawling ${diarioUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();

    try {
      let currentPage = 1;
      let hasMorePages = true;
      const maxPages = 20; // Safety limit

      while (hasMorePages && currentPage <= maxPages) {
        logger.info(`Fetching page ${currentPage}: ${diarioUrl}`);
        
        try {
          // Use POST request to get the content
          const response = await fetch(diarioUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            body: `action=listarPublicacoes&codCategoria=1&page=${currentPage}`,
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const html = await response.text();
          const $ = this.loadHTML(html);
          
          // Find all publication rows in the table
          const rows = $('table tbody tr').toArray();
          
          if (rows.length === 0) {
            if (currentPage > 1) {
              logger.info(`No rows found on page ${currentPage}, stopping pagination`);
            }
            hasMorePages = false;
            break;
          }

          let foundGazettesOnPage = 0;
          let foundInDateRange = false;
          
          for (const row of rows) {
            try {
              const $row = $(row);
              const cells = $row.find('td');
              
              if (cells.length < 3) continue;
              
              // First cell contains the date
              const dateText = $(cells[0]).text().trim();
              const dateMatch = dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
              
              if (!dateMatch) {
                continue;
              }

              const [, day, month, year] = dateMatch;
              const dateStr = `${year}-${month}-${day}`;
              const gazetteDate = new Date(dateStr);

              // Check if date is in range
              if (!this.isInDateRange(gazetteDate)) {
                // If we've already found some in range and now we're out of range,
                // we may have passed the date range (assuming descending order)
                if (foundInDateRange && gazetteDate < this.startDate) {
                  logger.info(`Passed date range at ${dateStr}, stopping`);
                  hasMorePages = false;
                  break;
                }
                continue;
              }
              
              foundInDateRange = true;

              // Third cell contains the description/ementa
              const ementaText = $(cells[2]).text().trim();
              
              // The publication code is often in a script tag that uses document.write()
              // Look for codPublicacao in the row's HTML
              const rowHtml = $.html($row);
              
              let publicationCode: string | undefined;
              
              // Try to extract publication code from JavaScript in the row
              const codeMatch = rowHtml.match(/codPublicacao[='](\d+)/);
              if (codeMatch) {
                publicationCode = codeMatch[1];
              }
              
              // Also try to find it in regular links
              if (!publicationCode) {
                const filesLink = $row.find('a[href*="showArquivosPublicacao"]').first();
                const detailsLink = $row.find('a[href*="showDetalhesPublicacao"]').first();
                
                if (filesLink.length > 0) {
                  const href = filesLink.attr('href') || '';
                  const match = href.match(/codPublicacao=(\d+)/);
                  if (match) {
                    publicationCode = match[1];
                  }
                } else if (detailsLink.length > 0) {
                  const href = detailsLink.attr('href') || '';
                  const match = href.match(/codPublicacao=(\d+)/);
                  if (match) {
                    publicationCode = match[1];
                  }
                }
              }
              
              if (!publicationCode) {
                logger.debug(`Could not find publication code for: ${dateStr} - ${ementaText.substring(0, 50)}`);
                continue;
              }

              // Build file URL - we'll need to fetch the actual PDF from the publication page
              const filesUrl = `${baseUrl}/diario?action=showArquivosPublicacao&codPublicacao=${publicationCode}`;
              
              // Skip if already seen
              if (seenUrls.has(filesUrl)) {
                continue;
              }
              seenUrls.add(filesUrl);

              // Try to extract edition number from description
              const editionMatch = ementaText.match(/(?:Edição|Ed\.?|Nº)\s*(\d+)/i);
              const editionNumber = editionMatch ? editionMatch[1] : undefined;

              // Create gazette with the files URL as the file URL
              // The actual PDF will need to be fetched by following the link
              const gazette: Gazette = {
                date: dateStr,
                fileUrl: filesUrl,
                territoryId: this.spiderConfig.territoryId,
                scrapedAt: getCurrentTimestamp(),
                isExtraEdition: false,
                power: 'executive_legislative',
                editionNumber,
                sourceText: ementaText.substring(0, 200), // Limit description length
              };

              gazettes.push(gazette);
              foundGazettesOnPage++;
              logger.debug(`Found gazette: ${dateStr} - ${ementaText.substring(0, 50)}...`);
            } catch (error) {
              logger.warn(`Error processing row:`, { error: (error as Error).message });
            }
          }

          logger.info(`Found ${foundGazettesOnPage} gazettes on page ${currentPage}`);

          // Check for next page - look for pagination
          const nextPageLink = $(`ul.pagination a:contains("${currentPage + 1}")`).first();
          
          if (nextPageLink.length === 0 && foundGazettesOnPage === 0) {
            hasMorePages = false;
          } else if (hasMorePages) {
            currentPage++;
          }

          // Small delay between pages
          if (hasMorePages) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }

        } catch (error) {
          logger.error(`Error fetching page ${currentPage}:`, error as Error);
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
