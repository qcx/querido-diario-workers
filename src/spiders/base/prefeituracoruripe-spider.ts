import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";
import { toISODate } from "../../utils/date-utils";

/**
 * Configuration for Prefeitura Coruripe spider
 */
export interface PrefeituraCoruripeeConfig {
  type: "prefeituracoruripe";
  /** Base URL for the Prefeitura Coruripe diário oficial (e.g., "https://diario.coruripe.al.gov.br") */
  baseUrl: string;
  /** City name for display */
  cityName?: string;
}

/**
 * PrefeituraCoruripeeSpider implementation
 *
 * Crawls Coruripe's Diário Oficial website which displays gazettes
 * in a paginated list on the main page.
 *
 * Site structure:
 * - Base URL: https://diario.coruripe.al.gov.br/
 * - Pagination: Not clear, main page lists recent editions
 * - PDF Download: https://diario.coruripe.al.gov.br/diarios/{id}/download
 * - Titles: "Diário Oficial nº {edition}/{year}"
 * - Dates: "Publicado no dia DD/MM/YYYY"
 *
 * The spider:
 * 1. Fetches the main page
 * 2. Parses each gazette entry (edition number, date, download URL)
 * 3. Filters gazettes to match the requested date range
 */
export class PrefeituraCoruripeeSpider extends BaseSpider {
  protected coruripeeConfig: PrefeituraCoruripeeConfig;

  private static readonly MONTHS_PT: { [key: string]: string } = {
    janeiro: "01",
    fevereiro: "02",
    março: "03",
    abril: "04",
    maio: "05",
    junho: "06",
    julho: "07",
    agosto: "08",
    setembro: "09",
    outubro: "10",
    novembro: "11",
    dezembro: "12",
  };

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.coruripeeConfig = spiderConfig.config as PrefeituraCoruripeeConfig;

    if (!this.coruripeeConfig.baseUrl) {
      throw new Error(
        `PrefeituraCoruripeeSpider requires baseUrl in config for ${spiderConfig.name}`
      );
    }

    logger.info(
      `Initializing PrefeituraCoruripeeSpider for ${spiderConfig.name}`
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.coruripeeConfig.baseUrl} for ${this.spiderConfig.name}...`
    );
    const gazettes: Gazette[] = [];
    const processedUrls = new Set<string>();

    try {
      let pageNumber = 1;
      let hasMorePages = true;
      let shouldStop = false;
      let consecutiveOldGazettes = 0;
      const maxConsecutiveOldGazettes = 10;

      while (hasMorePages && !shouldStop && pageNumber <= 20) {
        try {
          // Build page URL
          const baseUrl = this.coruripeeConfig.baseUrl.replace(/\/$/, "");
          const pageUrl =
            pageNumber === 1 ? baseUrl : `${baseUrl}?page=${pageNumber}`;
          logger.debug(`Fetching page ${pageNumber}: ${pageUrl}`);

          const html = await this.fetch(pageUrl);
          const $ = this.loadHTML(html);

          // Find all gazette entries - looking for h2 headings containing "Diário Oficial"
          const gazetteHeadings = $('h2:contains("Diário Oficial nº")');
          logger.debug(
            `Found ${gazetteHeadings.length} gazette headings on page ${pageNumber}`
          );

          if (gazetteHeadings.length === 0) {
            logger.debug(`No gazette headings found on page ${pageNumber}`);
            hasMorePages = false;
            break;
          }

          let foundInPage = 0;

          // Process each gazette heading
          for (let i = 0; i < gazetteHeadings.length; i++) {
            if (shouldStop) break;

            try {
              const $heading = $(gazetteHeadings[i]);
              const headingText = $heading.text().trim();

              // Extract edition number: "Diário Oficial nº 1250/2026"
              const editionMatch = headingText.match(
                /Diário Oficial nº\s*(\d+)\/(\d+)/i
              );
              if (!editionMatch) {
                logger.debug(`Could not extract edition from: ${headingText}`);
                continue;
              }

              const editionNumber = editionMatch[1];
              const editionYear = editionMatch[2];
              const isExtraEdition = /extra/i.test(headingText);

              // Find the parent container to get date and download link
              const $container = $heading.parent();
              const containerText = $container.text();

              // Extract date: "Publicado no dia DD/MM/YYYY"
              const dateMatch = containerText.match(
                /Publicado no dia\s*(\d{2})\/(\d{2})\/(\d{4})/i
              );
              if (!dateMatch) {
                logger.debug(
                  `Could not extract date from container for edition ${editionNumber}`
                );
                continue;
              }

              const day = dateMatch[1];
              const month = dateMatch[2];
              const year = dateMatch[3];
              const dateStr = `${year}-${month}-${day}`;
              const gazetteDate = new Date(dateStr);

              // Check if date is in our crawl range
              if (!this.isInDateRange(gazetteDate)) {
                logger.debug(`Gazette date ${dateStr} is outside crawl range`);

                // Since results are in reverse chronological order (newest first),
                // if we encounter dates before our start date, count consecutive old gazettes
                if (dateStr < this.dateRange.start) {
                  consecutiveOldGazettes++;
                  if (consecutiveOldGazettes >= maxConsecutiveOldGazettes) {
                    logger.info(
                      `Found ${maxConsecutiveOldGazettes} consecutive old gazettes, stopping crawl`
                    );
                    shouldStop = true;
                  }
                }
                continue;
              }

              // Reset counter when we find a gazette in range
              consecutiveOldGazettes = 0;

              // Find download link
              const $downloadLink = $container.find('a:contains("Baixar")');
              if ($downloadLink.length === 0) {
                logger.debug(
                  `Could not find download link for edition ${editionNumber}`
                );
                continue;
              }

              const downloadUrl = $downloadLink.attr("href");
              if (!downloadUrl) {
                logger.debug(
                  `Download link has no href for edition ${editionNumber}`
                );
                continue;
              }

              // Make URL absolute
              let absolutePdfUrl: string;
              if (downloadUrl.startsWith("http")) {
                absolutePdfUrl = downloadUrl;
              } else {
                const baseUrlObj = new URL(this.coruripeeConfig.baseUrl);
                absolutePdfUrl = `${baseUrlObj.origin}${downloadUrl.startsWith("/") ? "" : "/"}${downloadUrl}`;
              }

              // Skip if already processed
              if (processedUrls.has(absolutePdfUrl)) {
                logger.debug(`Skipping duplicate PDF URL: ${absolutePdfUrl}`);
                continue;
              }

              // Mark URL as processed
              processedUrls.add(absolutePdfUrl);

              // Create the gazette
              const gazette = await this.createGazette(gazetteDate, absolutePdfUrl, {
                editionNumber: `${editionNumber}/${editionYear}`,
                isExtraEdition,
                power: "executive",
                sourceText: headingText,
              });

              if (gazette) {
                gazettes.push(gazette);
                foundInPage++;
                logger.debug(
                  `Added gazette: Edition ${editionNumber}/${editionYear} - ${dateStr}`
                );
              }
            } catch (error) {
              logger.error(`Error processing gazette entry:`, error as Error);
            }
          }

          // Check if there's pagination
          const paginationLinks = $('a[href*="page="]');
          const nextPageExists =
            paginationLinks.filter((_, el) => {
              const href = $(el).attr("href");
              return href?.includes(`page=${pageNumber + 1}`);
            }).length > 0;

          // Also check numbered pagination links
          const hasNextPage = nextPageExists || foundInPage > 0;

          hasMorePages = hasNextPage && !shouldStop;
          pageNumber++;

          // Add delay between pages
          if (hasMorePages && !shouldStop) {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        } catch (error) {
          logger.error(`Error fetching page ${pageNumber}:`, error as Error);
          hasMorePages = false;
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`
      );
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }
}
