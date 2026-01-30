import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  PrefeituracaxiasConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse } from "node-html-parser";

/**
 * Spider for Prefeitura de Caxias - MA
 *
 * Site: caxias.ma.gov.br/dom/
 *
 * WordPress-based DOM archive with:
 * - Paginated edition listing at /dom/ and /dom/page/{n}/
 * - Date filters (data inicial, data final, termo)
 * - Detail pages at /dom/{numero}-{ano}/ with PDF download links
 * - PDF pattern: /wp-content/uploads/dom-files/{ano}/dom_{id}_{x}.pdf
 *
 * Structure:
 * - List page: Cards with "Edição XXXX/YYYY" and "De DD/MM/YYYY" and "Visualizar" link
 * - Detail page: Contains "Download desta Edição" link to PDF
 * - Pagination: /dom/page/2/, /dom/page/3/, etc. (up to 85+ pages)
 */
export class PrefeituracaxiasSpider extends BaseSpider {
  protected config: PrefeituracaxiasConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeituracaxiasConfig;

    if (!this.config.baseUrl) {
      throw new Error(
        `PrefeituracaxiasSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeituracaxiasSpider for ${spiderConfig.name} with URL: ${this.config.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.config.baseUrl} for ${this.spiderConfig.name}...`,
    );

    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();
    let currentPage = 1;
    let hasMorePages = true;

    try {
      while (hasMorePages) {
        const pageUrl =
          currentPage === 1
            ? this.config.baseUrl
            : `${this.config.baseUrl}page/${currentPage}/`;

        logger.debug(`Fetching page ${currentPage}: ${pageUrl}`);

        const response = await fetch(pageUrl, {
          method: "GET",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
          },
        });

        if (!response.ok) {
          if (response.status === 404 && currentPage > 1) {
            // End of pagination
            hasMorePages = false;
            continue;
          }
          logger.error(
            `Failed to fetch page ${currentPage}: ${response.status} ${response.statusText}`,
          );
          break;
        }

        const html = await response.text();
        const root = parse(html);
        const baseUrl = new URL(this.config.baseUrl);

        // Find all edition cards/entries
        // Each edition has: heading "Edição XXXX/YYYY", text "De DD/MM/YYYY", link "Visualizar"
        const editionLinks = root.querySelectorAll('a[href*="/dom/"]');

        let foundEditionsOnPage = 0;
        let foundInRangeBefore = gazettes.length;

        for (const link of editionLinks) {
          const href = link.getAttribute("href");
          if (!href) continue;

          // Skip pagination links and non-detail page links
          if (href.includes("/page/") || href === this.config.baseUrl) continue;

          // Match detail page pattern: /dom/{numero}-{ano}/
          const detailMatch = href.match(/\/dom\/(\d+)-(\d{4})\/?$/);
          if (!detailMatch) continue;

          const [, editionNumber, editionYear] = detailMatch;

          // Skip if already processed
          if (seenUrls.has(href)) continue;
          seenUrls.add(href);

          foundEditionsOnPage++;

          // Try to extract date from parent/sibling elements
          let date: string | null = null;
          let parent = link.parentNode;

          // Traverse up looking for date
          for (let i = 0; i < 5 && parent; i++) {
            const parentText = parent.text || "";
            const dateMatch = parentText.match(
              /De\s+(\d{2})\/(\d{2})\/(\d{4})/i,
            );
            if (dateMatch) {
              const [, day, month, year] = dateMatch;
              date = `${year}-${month}-${day}`;
              break;
            }
            parent = parent.parentNode;
          }

          // If date not found in parent, try to fetch it from the text
          if (!date) {
            // Alternative: look for date in sibling elements
            const container = link.closest("article, .entry, .card, div");
            if (container) {
              const containerText = container.text || "";
              const dateMatch = containerText.match(
                /De\s+(\d{2})\/(\d{2})\/(\d{4})/i,
              );
              if (dateMatch) {
                const [, day, month, year] = dateMatch;
                date = `${year}-${month}-${day}`;
              }
            }
          }

          if (!date) {
            logger.debug(
              `Could not find date for edition ${editionNumber}/${editionYear}, fetching detail page...`,
            );
            // Fetch detail page to get date and PDF URL
            const gazette = await this.fetchDetailPage(
              href,
              editionNumber,
              baseUrl.origin,
            );
            if (gazette && this.isInDateRange(new Date(gazette.date))) {
              gazettes.push(gazette);
            }
          } else {
            // Check date range before fetching detail page
            if (!this.isInDateRange(new Date(date))) {
              continue;
            }

            // Fetch detail page to get PDF URL
            const gazette = await this.fetchDetailPage(
              href,
              editionNumber,
              baseUrl.origin,
              date,
            );
            if (gazette) {
              gazettes.push(gazette);
            }
          }
        }

        logger.debug(
          `Page ${currentPage}: Found ${foundEditionsOnPage} editions, ${gazettes.length - foundInRangeBefore} in range`,
        );

        // Check if we should continue pagination
        // Stop if no editions found on page or if all found editions are outside date range
        if (foundEditionsOnPage === 0) {
          hasMorePages = false;
        } else {
          // Check for "Próximo" link to confirm more pages
          const nextLink = root.querySelector('a[href*="/page/"]');
          const hasNextPage =
            nextLink &&
            root.querySelectorAll('a[href*="Próximo"], a.next').length > 0;

          // Also check if all editions on this page are before our start date
          // If so, we can stop early since editions are sorted newest first
          const startDate = this.dateRange.startDate;
          if (startDate) {
            const oldestEditionOnPage =
              gazettes.length > 0 ? gazettes[gazettes.length - 1].date : null;

            if (
              oldestEditionOnPage &&
              new Date(oldestEditionOnPage) < new Date(startDate)
            ) {
              // Editions getting older, might have more in range on next pages
              // Continue for a bit more
            }
          }

          currentPage++;

          // Safety limit to prevent infinite loops
          if (currentPage > 100) {
            logger.warn("Reached page limit of 100, stopping pagination");
            hasMorePages = false;
          }
        }

        // Small delay between page requests
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name} from ${currentPage} pages`,
      );
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
      throw error;
    }

    return gazettes;
  }

  /**
   * Fetch detail page to extract PDF URL and date
   */
  private async fetchDetailPage(
    detailUrl: string,
    editionNumber: string,
    origin: string,
    knownDate?: string,
  ): Promise<Gazette | null> {
    try {
      const fullUrl = detailUrl.startsWith("http")
        ? detailUrl
        : `${origin}${detailUrl}`;

      const response = await fetch(fullUrl, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      });

      if (!response.ok) {
        logger.debug(
          `Failed to fetch detail page ${fullUrl}: ${response.status}`,
        );
        return null;
      }

      const html = await response.text();
      const root = parse(html);

      // Find PDF download link
      // Pattern: <a href="...dom_XXXXX_X.pdf">Download desta Edição</a>
      const pdfLink = root.querySelector('a[href*=".pdf"]');
      if (!pdfLink) {
        logger.debug(`No PDF link found on detail page ${fullUrl}`);
        return null;
      }

      const pdfHref = pdfLink.getAttribute("href");
      if (!pdfHref) {
        return null;
      }

      const pdfUrl = pdfHref.startsWith("http")
        ? pdfHref
        : `${origin}${pdfHref.startsWith("/") ? "" : "/"}${pdfHref}`;

      // Extract date if not provided
      let date = knownDate;
      if (!date) {
        // Try to find date in page content
        // Pattern: "Edição XXXX/YYYY, de DD/MM/YYYY"
        const pageText = root.text || "";
        const dateMatch = pageText.match(
          /(?:de|De)\s+(\d{2})\/(\d{2})\/(\d{4})/,
        );
        if (dateMatch) {
          const [, day, month, year] = dateMatch;
          date = `${year}-${month}-${day}`;
        }
      }

      if (!date) {
        // Try to extract from URL or edition number
        // Edition URLs don't typically contain date, so we may need to skip
        logger.debug(`Could not determine date for edition ${editionNumber}`);
        return null;
      }

      return {
        date,
        fileUrl: pdfUrl,
        territoryId: this.spiderConfig.territoryId,
        editionNumber,
        power: "executive",
        scrapedAt: new Date().toISOString(),
        isExtraEdition: false,
      };
    } catch (error) {
      logger.debug(`Error fetching detail page ${detailUrl}: ${error}`);
      return null;
    }
  }
}
