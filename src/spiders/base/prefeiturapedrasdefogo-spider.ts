import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeiturapedrasdefogoConfig,
} from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse, HTMLElement } from "node-html-parser";
import { toISODate } from "../../utils/date-utils";

/**
 * Prefeitura de Pedras de Fogo - PB Spider
 *
 * Spider for the municipality of Pedras de Fogo - PB.
 * https://pedrasdefogo.pb.gov.br/transparencia-inicio/semanario
 *
 * HTML Structure (listing page):
 * - Table with rows, each row contains:
 *   <tr>
 *     <td>
 *       <h6 class="mb-0">Semanário Oficial ANO XXX – nº 04</h6>
 *     </td>
 *     <td>23/01/2026</td>
 *     <td>...</td>
 *     <td>
 *       <a href="/transparencia-inicio/semanario/{slug}">Visualizar</a>
 *       <a href="/storage/instituicao/semanarios/...pdf">Download</a>
 *     </td>
 *   </tr>
 *
 * PDFs are directly linked in download buttons
 * Pagination: ?page=N (1-based)
 * 459 editions as of January 2026 across 39 pages
 */
export class PrefeiturapedrasdefogoSpider extends BaseSpider {
  protected platformConfig: PrefeiturapedrasdefogoConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.platformConfig = spiderConfig.config as PrefeiturapedrasdefogoConfig;

    if (!this.platformConfig.baseUrl) {
      throw new Error(
        `PrefeiturapedrasdefogoSpider requires a baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeiturapedrasdefogoSpider for ${spiderConfig.name} with URL: ${this.platformConfig.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.platformConfig.baseUrl} for ${this.spiderConfig.name}...`,
    );

    const gazettes: Gazette[] = [];
    let page = 1;
    let hasMorePages = true;
    let foundOlderThanRange = false;
    const maxPages = 50; // Safety limit (39 pages as of 2026)

    while (hasMorePages && page <= maxPages && !foundOlderThanRange) {
      const pageUrl = this.buildPageUrl(page);

      try {
        logger.debug(`Fetching page ${page}: ${pageUrl}`);
        const html = await this.fetch(pageUrl);
        const root = parse(html);

        const pageGazettes = this.extractGazettesFromPage(root);

        if (pageGazettes.length === 0) {
          logger.debug(`No gazettes found on page ${page}, stopping`);
          hasMorePages = false;
          continue;
        }

        // Filter by date range and add to results
        for (const gazette of pageGazettes) {
          const gazetteDate = new Date(gazette.date);

          if (this.isInDateRange(gazetteDate)) {
            gazettes.push(gazette);
          } else if (gazetteDate < new Date(this.dateRange.start)) {
            foundOlderThanRange = true;
            logger.debug(
              `Found gazette from ${gazette.date} older than start date, stopping`,
            );
            break;
          }
        }

        // Check for next page
        hasMorePages = this.hasNextPage(root, page);
        page++;
      } catch (error) {
        if ((error as any)?.message?.includes("404")) {
          logger.debug(`Page ${page} not found (404), stopping`);
          hasMorePages = false;
        } else {
          logger.error(`Error fetching page ${page}:`, error as Error);
          hasMorePages = false;
        }
      }
    }

    logger.info(
      `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
    );

    return gazettes;
  }

  /**
   * Build page URL for pagination
   */
  private buildPageUrl(page: number): string {
    const baseUrl = this.platformConfig.baseUrl.replace(/\/$/, "");

    if (page === 1) {
      return baseUrl;
    }

    // Check if URL already has query params
    if (baseUrl.includes("?")) {
      return `${baseUrl}&page=${page}`;
    }

    return `${baseUrl}?page=${page}`;
  }

  /**
   * Extract gazettes from a single listing page
   * The page uses a table layout with PDF download links directly available
   */
  private extractGazettesFromPage(root: HTMLElement): Gazette[] {
    const gazettes: Gazette[] = [];

    // Find all table rows in the gazette listing
    const rows = root.querySelectorAll("table tbody tr");

    // If no table rows found, try finding the list structure
    if (rows.length === 0) {
      return this.extractGazettesFromCardLayout(root);
    }

    for (const row of rows) {
      try {
        // Get title from h6
        const titleElement = row.querySelector("h6");
        const title = titleElement?.text?.trim() || "";

        // Get date from second td (format: DD/MM/YYYY)
        const tds = row.querySelectorAll("td");
        let gazetteDate: Date | null = null;
        let dateText = "";

        // The date is in the second td, directly as text
        if (tds.length >= 2) {
          dateText = tds[1].text.trim();
          const dateMatch = dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (dateMatch) {
            const [, day, month, year] = dateMatch;
            gazetteDate = new Date(`${year}-${month}-${day}`);
          }
        }

        if (!gazetteDate || isNaN(gazetteDate.getTime())) {
          logger.debug(`Could not parse date for gazette: ${title}`);
          continue;
        }

        // Find PDF download link
        const pdfLink = row.querySelector('a[href*=".pdf"]');
        let pdfUrl = pdfLink?.getAttribute("href") || "";

        if (!pdfUrl) {
          logger.debug(`No PDF link found for gazette: ${title}`);
          continue;
        }

        // Make sure URL is absolute
        if (!pdfUrl.startsWith("http")) {
          const baseUrlObj = new URL(this.platformConfig.baseUrl);
          pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith("/") ? "" : "/"}${pdfUrl}`;
        }

        // Check if it's an extra edition
        const isExtraEdition =
          title.toLowerCase().includes("especial") ||
          title.toLowerCase().includes("extra");

        // Extract edition number
        let editionNumber: string | undefined;
        const editionMatch = title.match(/nº?\s*(\d+)/i);
        if (editionMatch) {
          editionNumber = editionMatch[1];
        }

        // Create gazette
        const gazette = this.createGazetteSync(gazetteDate, pdfUrl, {
          editionNumber,
          isExtraEdition,
          sourceText: title,
        });

        if (gazette) {
          gazettes.push(gazette);
        }
      } catch (error) {
        logger.debug(`Error processing table row: ${error}`);
      }
    }

    return gazettes;
  }

  /**
   * Alternative extraction for card-based layout
   */
  private extractGazettesFromCardLayout(root: HTMLElement): Gazette[] {
    const gazettes: Gazette[] = [];

    // Find all card items - they contain both view and download links
    const cards = root.querySelectorAll(".card");

    for (const card of cards) {
      try {
        // Get title from heading
        const titleElement = card.querySelector("h5, h6");
        const title = titleElement?.text?.trim() || "";

        if (!title.toLowerCase().includes("semanário")) {
          continue;
        }

        // Find date - look for DD/MM/YYYY pattern in card text
        const cardText = card.text;
        const dateMatch = cardText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        let gazetteDate: Date | null = null;

        if (dateMatch) {
          const [, day, month, year] = dateMatch;
          gazetteDate = new Date(`${year}-${month}-${day}`);
        }

        if (!gazetteDate || isNaN(gazetteDate.getTime())) {
          logger.debug(`Could not parse date for gazette: ${title}`);
          continue;
        }

        // Find PDF download link
        const pdfLink = card.querySelector('a[href*=".pdf"]');
        let pdfUrl = pdfLink?.getAttribute("href") || "";

        if (!pdfUrl) {
          logger.debug(`No PDF link found for gazette: ${title}`);
          continue;
        }

        // Make sure URL is absolute
        if (!pdfUrl.startsWith("http")) {
          const baseUrlObj = new URL(this.platformConfig.baseUrl);
          pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith("/") ? "" : "/"}${pdfUrl}`;
        }

        // Check if it's an extra edition
        const isExtraEdition =
          title.toLowerCase().includes("especial") ||
          title.toLowerCase().includes("extra");

        // Extract edition number
        let editionNumber: string | undefined;
        const editionMatch = title.match(/nº?\s*(\d+)/i);
        if (editionMatch) {
          editionNumber = editionMatch[1];
        }

        // Create gazette
        const gazette = this.createGazetteSync(gazetteDate, pdfUrl, {
          editionNumber,
          isExtraEdition,
          sourceText: title,
        });

        if (gazette) {
          gazettes.push(gazette);
        }
      } catch (error) {
        logger.debug(`Error processing card: ${error}`);
      }
    }

    return gazettes;
  }

  /**
   * Check if there's a next page
   */
  private hasNextPage(root: HTMLElement, currentPage: number): boolean {
    // Look for next page link with ?page=N pattern
    const nextPageLinks = root.querySelectorAll('a.page-link[href*="page="]');
    for (const link of nextPageLinks) {
      const href = link.getAttribute("href") || "";
      const pageMatch = href.match(/page=(\d+)/);
      if (pageMatch) {
        const linkedPage = parseInt(pageMatch[1], 10);
        if (linkedPage > currentPage) {
          return true;
        }
      }
    }

    // Also check for "Próximo" or "Próxima" link
    const allPageLinks = root.querySelectorAll('a[href*="page="]');
    for (const link of allPageLinks) {
      const text = link.text.toLowerCase();
      if (
        text.includes("próximo") ||
        text.includes("proximo") ||
        text.includes("próxima") ||
        text.includes("proxima")
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Synchronous version of createGazette for simpler logic
   */
  private createGazetteSync(
    date: Date,
    pdfUrl: string,
    options?: {
      editionNumber?: string;
      isExtraEdition?: boolean;
      power?: string;
      sourceText?: string;
    },
  ): Gazette | null {
    try {
      const gazette: Gazette = {
        date: toISODate(date),
        fileUrl: pdfUrl,
        territoryId: this.spiderConfig.territoryId,
        power: (options?.power as any) || "executive_legislative",
        isExtraEdition: options?.isExtraEdition || false,
        editionNumber: options?.editionNumber,
        scrapedAt: new Date().toISOString(),
        sourceText: options?.sourceText,
      };

      return gazette;
    } catch (error) {
      logger.debug(`Error creating gazette: ${error}`);
      return null;
    }
  }
}
