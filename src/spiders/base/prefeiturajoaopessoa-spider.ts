import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse, HTMLElement } from "node-html-parser";
import { toISODate } from "../../utils/date-utils";

/**
 * Configuration for Prefeitura de João Pessoa spider
 */
export interface PrefeituraJoaoPessoaConfig {
  type: "prefeiturajoaopessoa";
  /** Base URL of the gazette page (e.g., "https://www.joaopessoa.pb.gov.br/doe-jp/") */
  baseUrl: string;
  /** Whether the site requires client-side JavaScript rendering */
  requiresClientRendering?: boolean;
}

/**
 * Prefeitura de João Pessoa Spider
 *
 * Capital da Paraíba - Portal WordPress com Diário Oficial Eletrônico (DOE-JP)
 *
 * URL pattern: /doe-jp/ with pagination at /doe-jp/page/{N}/
 * PDF pattern: /wp-content/uploads/{YYYY}/{MM}/{filename}.pdf
 *
 * HTML Structure:
 * - "Exibindo X de Y registro(s)" shows total count
 * - Each gazette entry has:
 *   <div class="d-flex justify-content-between my-2">
 *     <h4 class="card-title"><a href="...">DD/MM/YYYY | Edição XXX/YYYY</a></h4>
 *     <a href=".../wp-content/uploads/YYYY/MM/filename.pdf" class="btn btn-danger">download</a>
 *   </div>
 * - Pagination: .pagination with links to /doe-jp/page/{N}/
 *
 * Example: https://www.joaopessoa.pb.gov.br/doe-jp/
 */
export class PrefeituraJoaoPessoaSpider extends BaseSpider {
  protected platformConfig: PrefeituraJoaoPessoaConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.platformConfig = spiderConfig.config as PrefeituraJoaoPessoaConfig;

    if (!this.platformConfig.baseUrl) {
      throw new Error(
        `PrefeituraJoaoPessoaSpider requires a baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeituraJoaoPessoaSpider for ${spiderConfig.name} with URL: ${this.platformConfig.baseUrl}`,
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
    const maxPages = 200; // Safety limit (1234 records / 10 per page ≈ 124 pages)

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
            // Found gazette older than our range, we can stop
            foundOlderThanRange = true;
            logger.debug(
              `Found gazette from ${gazette.date} older than start date, stopping`,
            );
            break;
          }
        }

        // Check for next page via pagination
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

    // Find all gazette entries - they are in div.d-flex containers
    // with h4.card-title containing the date/edition and a[href*=".pdf"] for download
    const entries = root.querySelectorAll(".d-flex.justify-content-between");

    for (const entry of entries) {
      try {
        // Get the title link (contains date and edition)
        const titleLink = entry.querySelector("h4.card-title a");
        // Get the PDF download link
        const pdfLink = entry.querySelector('a[href*=".pdf"]');

        if (!titleLink || !pdfLink) {
          continue;
        }

        const titleText = titleLink.text?.trim() || "";
        const pdfUrl = pdfLink.getAttribute("href") || "";

        if (!pdfUrl) {
          continue;
        }

        // Parse date and edition from title
        // Format: "DD/MM/YYYY | Edição XXX/YYYY" or "DD/MM/YYYY | Edição XXX/YYYY(SUPLEMENTO)"
        const dateMatch = titleText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        const editionMatch = titleText.match(/Edição\s+(\d+)\/(\d{4})/i);
        const isSupplemento = titleText.toLowerCase().includes("suplemento");

        if (!dateMatch) {
          logger.debug(`Could not parse date from title: ${titleText}`);
          continue;
        }

        const [, day, month, year] = dateMatch;
        const gazetteDate = new Date(`${year}-${month}-${day}`);

        if (isNaN(gazetteDate.getTime())) {
          logger.debug(`Invalid date parsed from: ${titleText}`);
          continue;
        }

        const editionNumber = editionMatch ? editionMatch[1] : undefined;

        // Build full PDF URL if needed
        let fullPdfUrl = pdfUrl;
        if (!pdfUrl.startsWith("http")) {
          const baseUrlObj = new URL(this.platformConfig.baseUrl);
          fullPdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith("/") ? "" : "/"}${pdfUrl}`;
        }

        // Create gazette
        const gazette = this.createGazetteSync(gazetteDate, fullPdfUrl, {
          editionNumber,
          isExtraEdition: isSupplemento,
          power: "executive_legislative",
          sourceText: titleText,
        });

        if (gazette) {
          gazettes.push(gazette);
        }
      } catch (error) {
        logger.debug(`Error processing entry: ${error}`);
      }
    }

    return gazettes;
  }

  /**
   * Check if there's a next page
   */
  private hasNextPage(root: HTMLElement, currentPage: number): boolean {
    // Look for pagination links
    const paginationLinks = root.querySelectorAll(".pagination a.page-link");

    for (const link of paginationLinks) {
      const href = link.getAttribute("href") || "";
      if (href.includes(`/page/${currentPage + 1}/`)) {
        return true;
      }
    }

    // Also check for "Próxima" link
    const nextLink = root.querySelector("a.next.page-link");
    if (nextLink) {
      return true;
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
