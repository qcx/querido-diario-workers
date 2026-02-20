import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  PrefeiturabarreirinhasConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
import type { Fetcher } from "@cloudflare/workers-types";

/**
 * Spider for WebService Sistemas (Adianti Framework) - used by multiple MA municipalities
 *
 * Sites: transparencia.*.ma.gov.br/engine.php?class=diario_home
 *
 * WebService Sistemas (Adianti Framework):
 * - Uses DomDiarioList endpoint for edition listings (no JavaScript required!)
 * - Editions have SHA-1 authentication codes
 * - PDFs hosted at: transparencia.webservicesistemas.com.br/app/output/{city}/diario/{hash}.pdf
 *
 * Municipalities using this system:
 * - Barreirinhas, Turiaçu, Rosário, and others in MA
 */
export class PrefeiturabarreirinhasSpider extends BaseSpider {
  protected config: PrefeiturabarreirinhasConfig;
  private readonly ITEMS_PER_PAGE = 100;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeiturabarreirinhasConfig;

    if (!this.config.baseUrl) {
      throw new Error(
        `PrefeiturabarreirinhasSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeiturabarreirinhasSpider for ${spiderConfig.name} with URL: ${this.config.baseUrl}`,
    );
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  /**
   * Get the base URL for the transparency portal (without the class parameter)
   */
  private getPortalBaseUrl(): string {
    // baseUrl is like: https://transparencia.turiacu.ma.gov.br/engine.php?class=diario_home
    // We need: https://transparencia.turiacu.ma.gov.br/engine.php
    const url = new URL(this.config.baseUrl);
    return `${url.origin}${url.pathname}`;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.config.baseUrl} for ${this.spiderConfig.name}...`,
    );

    const gazettes: Gazette[] = [];
    const baseUrl = this.getPortalBaseUrl();
    let offset = 0;
    let hasMore = true;
    let consecutiveEmptyPages = 0;
    const MAX_EMPTY_PAGES = 2;

    while (hasMore && consecutiveEmptyPages < MAX_EMPTY_PAGES) {
      try {
        // Fetch edition list page
        const listUrl = `${baseUrl}?class=DomDiarioList&method=onReload&offset=${offset}&limit=${this.ITEMS_PER_PAGE}&direction=desc&order=edicao`;
        logger.debug(`Fetching edition list: ${listUrl}`);

        const response = await fetch(listUrl);
        if (!response.ok) {
          logger.error(`Failed to fetch edition list: ${response.status}`);
          break;
        }

        const html = await response.text();
        const pageGazettes = await this.parseEditionList(html, baseUrl);

        if (pageGazettes.length === 0) {
          consecutiveEmptyPages++;
          logger.debug(
            `Empty page at offset ${offset}, consecutive: ${consecutiveEmptyPages}`,
          );
        } else {
          consecutiveEmptyPages = 0;

          // Check if all gazettes on this page are before our date range
          const allBeforeDateRange = pageGazettes.every((g) => {
            const gazetteDate = new Date(g.date);
            return gazetteDate < this.dateRange.start;
          });

          if (allBeforeDateRange) {
            logger.debug(
              `All gazettes on page before date range, stopping pagination`,
            );
            hasMore = false;
          }

          // Add gazettes that are within the date range
          for (const gazette of pageGazettes) {
            if (this.isInDateRange(new Date(gazette.date))) {
              gazettes.push(gazette);
            }
          }
        }

        offset += this.ITEMS_PER_PAGE;

        // Check if there are more pages (look for pagination info in HTML)
        if (!html.includes(`offset=${offset}`)) {
          hasMore = false;
        }
      } catch (error) {
        logger.error(
          `Error fetching page at offset ${offset}:`,
          error as Error,
        );
        break;
      }
    }

    logger.info(
      `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
    );

    return gazettes;
  }

  /**
   * Parse the edition list HTML and extract gazette info
   */
  private async parseEditionList(
    html: string,
    baseUrl: string,
  ): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    // Extract rows from the table
    // Pattern: <tr id="row_XXX">...<td>Vol. X - Nº XXX / YYYY</td><td>DD/MM/YYYY</td>...<a href="...token=XXX...">
    const rowRegex = /<tr[^>]*id="row_(\d+)"[^>]*>[\s\S]*?<\/tr>/gi;
    const rows = html.match(rowRegex) || [];

    for (const row of rows) {
      try {
        // Extract token from the PDF link
        const tokenMatch = row.match(/token=(\d+)/);
        if (!tokenMatch) continue;
        const token = tokenMatch[1];

        // Extract date (DD/MM/YYYY format)
        const dateMatch = row.match(/>(\d{2})\/(\d{2})\/(\d{4})</);
        if (!dateMatch) continue;
        const [, day, month, year] = dateMatch;
        const date = `${year}-${month}-${day}`;

        // Extract edition number from "Vol. X - Nº XXX / YYYY"
        const editionMatch = row.match(/Nº\s*(\d+)/i);
        const editionNumber = editionMatch ? editionMatch[1] : undefined;

        // Extract publication type (EXECUTIVO, TERCEIROS, EXTRAS, LEGISLATIVO)
        const typeMatch = row.match(
          />(EXECUTIVO|TERCEIROS|EXTRAS|LEGISLATIVO)</i,
        );
        const publicationType = typeMatch
          ? typeMatch[1].toUpperCase()
          : undefined;
        const power = this.mapPublicationType(publicationType);
        const isExtraEdition = publicationType === "EXTRAS";

        // Get the actual PDF URL by fetching the export page
        const pdfUrl = await this.fetchPdfUrl(baseUrl, token);
        if (!pdfUrl) {
          logger.debug(`Could not get PDF URL for token ${token}, skipping`);
          continue;
        }

        gazettes.push({
          date,
          fileUrl: pdfUrl,
          territoryId: this.spiderConfig.territoryId,
          editionNumber,
          power,
          isExtraEdition,
          scrapedAt: new Date().toISOString(),
        });
      } catch (error) {
        logger.debug(`Error parsing row: ${error}`);
      }
    }

    return gazettes;
  }

  /**
   * Fetch the actual PDF URL from the export page
   */
  private async fetchPdfUrl(
    baseUrl: string,
    token: string,
  ): Promise<string | null> {
    try {
      const exportUrl = `${baseUrl}?class=export_file&method=export_file_pdf&token=${token}&type=DocumentoDiario&extension=PDF`;
      const response = await fetch(exportUrl);
      if (!response.ok) {
        return null;
      }

      const html = await response.text();

      // Extract PDF URL from iframe src
      // Pattern: <iframe src="https://transparencia.webservicesistemas.com.br/app/output/.../...pdf"
      const pdfMatch = html.match(/src="(https:\/\/[^"]+\.pdf)"/i);

      return pdfMatch ? pdfMatch[1] : null;
    } catch (error) {
      logger.debug(`Error fetching PDF URL for token ${token}: ${error}`);
      return null;
    }
  }

  /**
   * Map publication type to gazette power
   */
  private mapPublicationType(
    type: string | undefined,
  ): "executive" | "legislative" | "executive_legislative" {
    if (!type) return "executive";

    switch (type.toUpperCase()) {
      case "LEGISLATIVO":
        return "legislative";
      case "EXECUTIVO":
      case "TERCEIROS":
      case "EXTRAS":
      default:
        return "executive";
    }
  }
}
