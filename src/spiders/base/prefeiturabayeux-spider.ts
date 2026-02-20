import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse, HTMLElement } from "node-html-parser";
import { toISODate } from "../../utils/date-utils";

/**
 * Configuration for Prefeitura de Bayeux spider
 */
export interface PrefeiturabayeuxConfig {
  type: "prefeiturabayeux";
  /** Base URL of the gazette page */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Prefeitura de Bayeux Spider
 *
 * Paraíba state - WordPress-based official gazette portal
 *
 * URL pattern: /diario-oficial/ with wp-pagenavi pagination
 * PDF pattern: /wp-content/uploads/{YYYY}/{MM}/DIARIO-OFICIAL-DD-MM-YYYY.pdf
 *
 * HTML Structure:
 * - Each gazette in div.row with:
 *   <span class="font-w-bold">Diário Oficial - Bayeux, DAY_NAME DD de MÊS de YYYY</span>
 *   <small><i class="fa-regular fa-calendar"></i> DD/MM/YYYY</small>
 *   <a href=".../wp-content/uploads/YYYY/MM/DIARIO-OFICIAL-DD-MM-YYYY.pdf">download</a>
 *
 * Example: https://bayeux.pb.gov.br/diario-oficial/
 */
export class PrefeiturabayeuxSpider extends BaseSpider {
  protected platformConfig: PrefeiturabayeuxConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.platformConfig = spiderConfig.config as PrefeiturabayeuxConfig;

    if (!this.platformConfig.baseUrl) {
      throw new Error(
        `PrefeiturabayeuxSpider requires a baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeiturabayeuxSpider for ${spiderConfig.name} with URL: ${this.platformConfig.baseUrl}`,
    );
  }

  /**
   * Month names in Portuguese
   */
  private readonly monthNames: Record<string, number> = {
    janeiro: 1,
    fevereiro: 2,
    março: 3,
    marco: 3,
    abril: 4,
    maio: 5,
    junho: 6,
    julho: 7,
    agosto: 8,
    setembro: 9,
    outubro: 10,
    novembro: 11,
    dezembro: 12,
  };

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.platformConfig.baseUrl} for ${this.spiderConfig.name}...`,
    );

    const gazettes: Gazette[] = [];
    let page = 1;
    let hasMorePages = true;
    let foundOlderThanRange = false;
    const maxPages = 100; // Safety limit

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

        // Check for next page via wp-pagenavi
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
      return `${baseUrl}/`;
    }

    return `${baseUrl}/page/${page}/`;
  }

  /**
   * Extract gazettes from a single page
   */
  private extractGazettesFromPage(root: HTMLElement): Gazette[] {
    const gazettes: Gazette[] = [];

    // Find all PDF download links
    const pdfLinks = root.querySelectorAll('a[href*=".pdf"]');

    for (const link of pdfLinks) {
      try {
        const pdfUrl = link.getAttribute("href") || "";

        if (!pdfUrl || !pdfUrl.includes("wp-content/uploads")) {
          continue;
        }

        // Build full PDF URL if needed
        let fullPdfUrl = pdfUrl;
        if (!pdfUrl.startsWith("http")) {
          const baseUrlObj = new URL(this.platformConfig.baseUrl);
          fullPdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith("/") ? "" : "/"}${pdfUrl}`;
        }

        // Try to extract date from the parent container
        const parentRow = this.findParentWithClass(link, "row");
        let gazetteDate: Date | null = null;
        let sourceText = "";

        if (parentRow) {
          // Look for small tag with date in DD/MM/YYYY format
          const smallTag = parentRow.querySelector("small");
          if (smallTag) {
            const dateMatch = smallTag.text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (dateMatch) {
              const [, day, month, year] = dateMatch;
              gazetteDate = new Date(`${year}-${month}-${day}`);
            }
          }

          // Get title text
          const titleSpan = parentRow.querySelector("span.font-w-bold");
          if (titleSpan) {
            sourceText = titleSpan.text.trim();
          }
        }

        // If no date from small tag, try to extract from PDF filename
        if (!gazetteDate || isNaN(gazetteDate.getTime())) {
          // Pattern: DIARIO-OFICIAL-DD-MM-YYYY.pdf
          const filenameMatch = pdfUrl.match(
            /DIARIO[_-]OFICIAL[_-](\d{2})[_-](\d{2})[_-](\d{4})/i,
          );
          if (filenameMatch) {
            const [, day, month, year] = filenameMatch;
            gazetteDate = new Date(`${year}-${month}-${day}`);
          }
        }

        // Try extracting date from title using Portuguese month names
        if (!gazetteDate || isNaN(gazetteDate.getTime())) {
          if (sourceText) {
            const dateMatch = sourceText.match(
              /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i,
            );
            if (dateMatch) {
              const [, day, monthName, year] = dateMatch;
              const month = this.monthNames[monthName.toLowerCase()];
              if (month) {
                gazetteDate = new Date(
                  `${year}-${String(month).padStart(2, "0")}-${day.padStart(2, "0")}`,
                );
              }
            }
          }
        }

        if (!gazetteDate || isNaN(gazetteDate.getTime())) {
          logger.debug(`Could not parse date for PDF: ${pdfUrl}`);
          continue;
        }

        // Create gazette
        const gazette = this.createGazetteSync(gazetteDate, fullPdfUrl, {
          power: "executive_legislative",
          sourceText,
        });

        if (gazette) {
          gazettes.push(gazette);
        }
      } catch (error) {
        logger.debug(`Error processing link: ${error}`);
      }
    }

    // Deduplicate by PDF URL
    const uniqueGazettes = gazettes.reduce((acc, gazette) => {
      const existing = acc.find((g) => g.fileUrl === gazette.fileUrl);
      if (!existing) {
        acc.push(gazette);
      }
      return acc;
    }, [] as Gazette[]);

    return uniqueGazettes;
  }

  /**
   * Find parent element with specific class
   */
  private findParentWithClass(
    element: HTMLElement,
    className: string,
  ): HTMLElement | null {
    let current = element.parentNode as HTMLElement | null;
    let depth = 0;
    const maxDepth = 10;

    while (current && depth < maxDepth) {
      const classList = current.getAttribute?.("class") || "";
      if (classList.includes(className)) {
        return current;
      }
      current = current.parentNode as HTMLElement | null;
      depth++;
    }

    return null;
  }

  /**
   * Check if there's a next page using wp-pagenavi
   */
  private hasNextPage(root: HTMLElement, currentPage: number): boolean {
    // Look for wp-pagenavi next link
    const nextLink = root.querySelector(".wp-pagenavi .nextpostslink");
    if (nextLink) {
      return true;
    }

    // Also check for generic pagination links
    const paginationLinks = root.querySelectorAll(
      'a[href*="/page/"], .pagination a',
    );
    for (const link of paginationLinks) {
      const href = link.getAttribute("href") || "";
      if (href.includes(`/page/${currentPage + 1}`)) {
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
      };

      return gazette;
    } catch (error) {
      logger.debug(`Error creating gazette: ${error}`);
      return null;
    }
  }
}
