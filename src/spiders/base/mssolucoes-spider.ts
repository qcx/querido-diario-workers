import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  MsSolucoesConfig,
} from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse, HTMLElement } from "node-html-parser";
import { toISODate } from "../../utils/date-utils";

/**
 * Ms Soluções Platform Spider
 *
 * Generic spider for municipalities using the Ms Soluções platform.
 * This platform is common in Paraíba and other northeastern states.
 *
 * URL pattern: /diariooficial.php with pagination via ?pagina=N
 * PDF pattern: /arquivos_download.php?id={ID}&pg=diariooficial
 *
 * HTML Structure:
 * - Each edition in div.list-group-item with id="diario_lista":
 *   <strong>Diário Oficial: XXX/YYYY</strong> - Description - EXECUTIVO/LEGISLATIVO
 *   <a href='diariooficial.php?id=XXX'>Visualizar edição</a>
 *   <span class="calendarioIcon"><i class='fa fa-calendar'></i> DD/MM/YYYY</span>
 *
 * Examples:
 * - https://www.cajazeiras.pb.gov.br/diariooficial.php
 * - https://www.solanea.pb.gov.br/diariooficial.php
 * - https://www.alagoagrande.pb.gov.br/diariooficial.php
 */
export class MsSolucoesSpider extends BaseSpider {
  protected platformConfig: MsSolucoesConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.platformConfig = spiderConfig.config as MsSolucoesConfig;

    if (!this.platformConfig.baseUrl) {
      throw new Error(
        `MsSolucoesSpider requires a baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing MsSolucoesSpider for ${spiderConfig.name} with URL: ${this.platformConfig.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.platformConfig.baseUrl} for ${this.spiderConfig.name}...`,
    );

    const gazettes: Gazette[] = [];
    let page = 0; // 0-based pagination (pagina=0 is first, pagina=1 is second)
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

    if (page === 0) {
      return baseUrl;
    }

    // Check if URL already has query params
    if (baseUrl.includes("?")) {
      return `${baseUrl}&pagina=${page}`;
    }

    return `${baseUrl}?pagina=${page}`;
  }

  /**
   * Extract gazettes from a single page
   */
  private extractGazettesFromPage(root: HTMLElement): Gazette[] {
    const gazettes: Gazette[] = [];

    // Find all edition entries - they are in div.list-group-item with id="diario_lista"
    const entries = root.querySelectorAll(
      '.list-group-item[id="diario_lista"]',
    );

    for (const entry of entries) {
      try {
        // Get the view edition link to extract ID
        const viewLink = entry.querySelector(
          'a[href*="diariooficial.php?id="]',
        );
        if (!viewLink) {
          continue;
        }

        const linkHref = viewLink.getAttribute("href") || "";
        const idMatch = linkHref.match(/id=(\d+)/);
        if (!idMatch) {
          continue;
        }

        const editionId = idMatch[1];

        // Get date from calendarioIcon span
        const dateSpan = entry.querySelector(".calendarioIcon");
        if (!dateSpan) {
          continue;
        }

        const dateText = dateSpan.text.trim();
        const dateMatch = dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (!dateMatch) {
          logger.debug(`Could not parse date from: ${dateText}`);
          continue;
        }

        const [, day, month, year] = dateMatch;
        const gazetteDate = new Date(`${year}-${month}-${day}`);

        if (isNaN(gazetteDate.getTime())) {
          logger.debug(`Invalid date parsed from: ${dateText}`);
          continue;
        }

        // Extract edition number and sphere from strong tag
        const strongTag = entry.querySelector("strong");
        let editionNumber: string | undefined;
        let power: "executive" | "legislative" | "executive_legislative" =
          "executive_legislative";
        let sourceText = "";

        if (strongTag) {
          sourceText = entry.text.trim();
          const editionMatch = strongTag.text.match(
            /Diário\s+Oficial:\s*(\d+)\/(\d{4})/i,
          );
          if (editionMatch) {
            editionNumber = editionMatch[1];
          }

          // Determine power from entry text
          if (
            sourceText.includes("EXECUTIVO") &&
            sourceText.includes("LEGISLATIVO")
          ) {
            power = "executive_legislative";
          } else if (sourceText.includes("LEGISLATIVO")) {
            power = "legislative";
          } else if (sourceText.includes("EXECUTIVO")) {
            power = "executive";
          }
        }

        // Build PDF download URL
        const baseUrlObj = new URL(this.platformConfig.baseUrl);
        const pdfUrl = `${baseUrlObj.origin}/arquivos_download.php?id=${editionId}&pg=diariooficial`;

        // Create gazette
        const gazette = this.createGazetteSync(gazetteDate, pdfUrl, {
          editionNumber,
          power: power as any,
          sourceText,
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
    const paginationLinks = root.querySelectorAll(".pagination a");

    for (const link of paginationLinks) {
      const href = link.getAttribute("href") || "";
      // Check if there's a link to the next page
      if (href.includes(`pagina=${currentPage + 1}`)) {
        return true;
      }
    }

    // Also check for "Next" arrow link
    const nextArrow = root.querySelector('a[aria-label="Next"]');
    if (nextArrow) {
      const href = nextArrow.getAttribute("href") || "";
      // Make sure it's not the same page
      if (href && !href.includes(`pagina=${currentPage}`)) {
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
