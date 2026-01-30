import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeiturasousaConfig,
} from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse, HTMLElement } from "node-html-parser";
import { toISODate } from "../../utils/date-utils";

/**
 * Prefeitura de Sousa Spider
 *
 * Spider for the municipality of Sousa - PB.
 * https://www.sousa.pb.gov.br/jornais-oficiais.php
 *
 * HTML Structure (listing page):
 * - Each edition in a block with:
 *   <h3><strong>Edição XXXX - Description</strong></h3>
 *   <p>DD/MM/YYYY</p>
 *   <a href="g.php?id=XXX">Ler Mais</a>
 *
 * Detail page (g.php?id=XXX):
 * - PDF embedded in iframe: <iframe src="https://sousa.pb.gov.br/uploads/files/XXX.pdf">
 *
 * Pagination: ?pagina=N (1-based, default is page 1)
 */
export class PrefeiturasousaSpider extends BaseSpider {
  protected platformConfig: PrefeiturasousaConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.platformConfig = spiderConfig.config as PrefeiturasousaConfig;

    if (!this.platformConfig.baseUrl) {
      throw new Error(
        `PrefeiturasousaSpider requires a baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeiturasousaSpider for ${spiderConfig.name} with URL: ${this.platformConfig.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.platformConfig.baseUrl} for ${this.spiderConfig.name}...`,
    );

    const gazettes: Gazette[] = [];
    let page = 1; // 1-based pagination
    let hasMorePages = true;
    let foundOlderThanRange = false;
    const maxPages = 200; // Safety limit (159 pages as of 2026)

    while (hasMorePages && page <= maxPages && !foundOlderThanRange) {
      const pageUrl = this.buildPageUrl(page);

      try {
        logger.debug(`Fetching page ${page}: ${pageUrl}`);
        const html = await this.fetch(pageUrl);
        const root = parse(html);

        const pageGazettes = await this.extractGazettesFromPage(root);

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
      return `${baseUrl}&pagina=${page}`;
    }

    return `${baseUrl}?pagina=${page}`;
  }

  /**
   * Extract gazettes from a single listing page
   */
  private async extractGazettesFromPage(root: HTMLElement): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    // Find all "Ler Mais" links that point to g.php?id=XXX
    const readMoreLinks = root.querySelectorAll(
      'a.read-more[href*="g.php?id="]',
    );

    for (const link of readMoreLinks) {
      try {
        const href = link.getAttribute("href") || "";
        const idMatch = href.match(/id=(\d+)/);
        if (!idMatch) {
          continue;
        }

        const editionId = idMatch[1];

        // Navigate up to find the parent container with date and title
        let container = link.parentNode?.parentNode;
        if (!container) {
          continue;
        }

        // Look for h3 with edition info
        const h3 = (container as HTMLElement).querySelector("h3 strong");
        let editionNumber: string | undefined;
        let sourceText = "";

        if (h3) {
          sourceText = h3.text.trim();
          // Extract edition number from "Edição XXXX - ..."
          const editionMatch = sourceText.match(/Edição\s*(\d+)/i);
          if (editionMatch) {
            editionNumber = editionMatch[1];
          }
        }

        // Look for date in p tag
        const paragraphs = (container as HTMLElement).querySelectorAll("p");
        let gazetteDate: Date | null = null;

        for (const p of paragraphs) {
          const text = p.text.trim();
          const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (dateMatch) {
            const [, day, month, year] = dateMatch;
            gazetteDate = new Date(`${year}-${month}-${day}`);
            break;
          }
        }

        if (!gazetteDate || isNaN(gazetteDate.getTime())) {
          logger.debug(`Could not parse date for edition ${editionId}`);
          continue;
        }

        // Fetch detail page to get PDF URL
        const pdfUrl = await this.fetchPdfUrl(editionId);
        if (!pdfUrl) {
          logger.debug(`Could not find PDF URL for edition ${editionId}`);
          continue;
        }

        // Create gazette
        const gazette = this.createGazetteSync(gazetteDate, pdfUrl, {
          editionNumber,
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
   * Fetch the detail page and extract PDF URL from iframe
   */
  private async fetchPdfUrl(editionId: string): Promise<string | null> {
    try {
      const baseUrlObj = new URL(this.platformConfig.baseUrl);
      const detailUrl = `${baseUrlObj.origin}/g.php?id=${editionId}`;

      logger.debug(`Fetching detail page: ${detailUrl}`);
      const html = await this.fetch(detailUrl);
      const root = parse(html);

      // Look for iframe with PDF source
      const iframe = root.querySelector('iframe[src*=".pdf"]');
      if (iframe) {
        const pdfUrl = iframe.getAttribute("src");
        if (pdfUrl) {
          // Ensure absolute URL
          if (pdfUrl.startsWith("http")) {
            return pdfUrl;
          }
          return `${baseUrlObj.origin}${pdfUrl.startsWith("/") ? "" : "/"}${pdfUrl}`;
        }
      }

      // Alternative: look for direct PDF links
      const pdfLinks = root.querySelectorAll('a[href*=".pdf"]');
      for (const link of pdfLinks) {
        const href = link.getAttribute("href");
        if (href) {
          if (href.startsWith("http")) {
            return href;
          }
          return `${baseUrlObj.origin}${href.startsWith("/") ? "" : "/"}${href}`;
        }
      }

      return null;
    } catch (error) {
      logger.debug(
        `Error fetching detail page for edition ${editionId}: ${error}`,
      );
      return null;
    }
  }

  /**
   * Check if there's a next page
   */
  private hasNextPage(root: HTMLElement, currentPage: number): boolean {
    // Look for "Próximo" link
    const nextLink = root.querySelector('a[href*="pagina="]');
    if (nextLink) {
      const href = nextLink.getAttribute("href") || "";
      const pageMatch = href.match(/pagina=(\d+)/);
      if (pageMatch) {
        const linkedPage = parseInt(pageMatch[1], 10);
        if (linkedPage > currentPage) {
          return true;
        }
      }
    }

    // Also check for specific next page link pattern
    const pageNavLinks = root.querySelectorAll('.page-nav a[href*="pagina="]');
    for (const link of pageNavLinks) {
      const text = link.text.toLowerCase();
      if (text.includes("próximo") || text.includes("proximo")) {
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
        scraped_at: new Date().toISOString(),
        gazette_source: "official_website",
        file_checksum: "",
        state_code: this.spiderConfig.stateCode,
        highlighted_excerpts: [],
        txt_url: "",
        processed: false,
        file_urls: [],
      };

      return gazette;
    } catch (error) {
      logger.debug(`Error creating gazette: ${error}`);
      return null;
    }
  }
}
