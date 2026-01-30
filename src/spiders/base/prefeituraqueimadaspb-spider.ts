import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeituraQueimadasPBConfig,
} from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse, HTMLElement } from "node-html-parser";
import { toISODate } from "../../utils/date-utils";

/**
 * Prefeitura de Queimadas - PB Spider
 *
 * Spider for the municipality of Queimadas - PB.
 * https://www.queimadas.pb.gov.br/publicacoes/mensario-oficial-do-municipio
 *
 * HTML Structure (listing page):
 * - Each edition in a list item with:
 *   <li class='list-group-item'>
 *     <a href='/publicacoes/mensario-oficial-do-municipio/{slug}'>
 *       <h6><span>DD/MM/YYYY -</span>TITLE</h6>
 *       <div class='content-pub'>DESCRIPTION</div>
 *     </a>
 *   </li>
 *
 * Detail page (/publicacoes/mensario-oficial-do-municipio/{slug}):
 * - PDF link: <a href="https://www.queimadas.pb.gov.br/storage/content/publicacoes/mensario-oficial-do-municipio/{id}/arquivos/{hash}.pdf">
 *
 * Pagination: ?page=N (1-based, default is page 1)
 * Filters: ?ano={YYYY}&mes={MM}&texto={search}
 */
export class PrefeituraQueimadasPBSpider extends BaseSpider {
  protected platformConfig: PrefeituraQueimadasPBConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.platformConfig = spiderConfig.config as PrefeituraQueimadasPBConfig;

    if (!this.platformConfig.baseUrl) {
      throw new Error(
        `PrefeituraQueimadasPBSpider requires a baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeituraQueimadasPBSpider for ${spiderConfig.name} with URL: ${this.platformConfig.baseUrl}`,
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
    const maxPages = 100; // Safety limit (44 pages as of 2026)

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
      return `${baseUrl}&page=${page}`;
    }

    return `${baseUrl}?page=${page}`;
  }

  /**
   * Extract gazettes from a single listing page
   */
  private async extractGazettesFromPage(root: HTMLElement): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    // Find all gazette links in the listing
    const gazetteLinks = root.querySelectorAll(
      'a[href*="/publicacoes/mensario-oficial-do-municipio/"]',
    );

    for (const link of gazetteLinks) {
      try {
        const href = link.getAttribute("href") || "";

        // Skip links that are just the category URL (no slug after the base path)
        if (
          href.endsWith("/mensario-oficial-do-municipio") ||
          href.endsWith("/mensario-oficial-do-municipio/")
        ) {
          continue;
        }

        // Skip pagination links
        if (href.includes("?page=")) {
          continue;
        }

        // Look for date in the link content
        const h6 = link.querySelector("h6");
        const spanElement = link.querySelector("span");
        let gazetteDate: Date | null = null;
        let title = "";
        let isExtraEdition = false;

        if (h6) {
          const fullText = h6.text.trim();
          title = fullText;

          // Check if it's an extra edition
          if (fullText.toLowerCase().includes("extra")) {
            isExtraEdition = true;
          }
        }

        if (spanElement) {
          const spanText = spanElement.text.trim();
          const dateMatch = spanText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (dateMatch) {
            const [, day, month, year] = dateMatch;
            gazetteDate = new Date(`${year}-${month}-${day}`);
          }
        }

        // If no date found in span, try the h6 text
        if (!gazetteDate && h6) {
          const h6Text = h6.text.trim();
          const dateMatch = h6Text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (dateMatch) {
            const [, day, month, year] = dateMatch;
            gazetteDate = new Date(`${year}-${month}-${day}`);
          }
        }

        if (!gazetteDate || isNaN(gazetteDate.getTime())) {
          logger.debug(`Could not parse date for gazette: ${href}`);
          continue;
        }

        // Build the full detail URL
        let detailUrl = href;
        if (!href.startsWith("http")) {
          const baseUrlObj = new URL(this.platformConfig.baseUrl);
          detailUrl = `${baseUrlObj.origin}${href.startsWith("/") ? "" : "/"}${href}`;
        }

        // Fetch detail page to get PDF URL
        const pdfUrl = await this.fetchPdfUrl(detailUrl);
        if (!pdfUrl) {
          logger.debug(`Could not find PDF URL for gazette: ${detailUrl}`);
          continue;
        }

        // Create gazette
        const gazette = this.createGazetteSync(gazetteDate, pdfUrl, {
          isExtraEdition,
          sourceText: title,
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
   * Fetch the detail page and extract PDF URL
   */
  private async fetchPdfUrl(detailUrl: string): Promise<string | null> {
    try {
      logger.debug(`Fetching detail page: ${detailUrl}`);
      const html = await this.fetch(detailUrl);
      const root = parse(html);

      // Look for PDF links - they are in anchor tags with .pdf in href
      const pdfLinks = root.querySelectorAll('a[href*=".pdf"]');
      for (const link of pdfLinks) {
        const href = link.getAttribute("href");
        if (href && href.includes("/storage/content/")) {
          // This is the actual PDF link
          if (href.startsWith("http")) {
            return href;
          }
          const baseUrlObj = new URL(this.platformConfig.baseUrl);
          return `${baseUrlObj.origin}${href.startsWith("/") ? "" : "/"}${href}`;
        }
      }

      // Fallback: look for any PDF link
      for (const link of pdfLinks) {
        const href = link.getAttribute("href");
        if (href) {
          if (href.startsWith("http")) {
            return href;
          }
          const baseUrlObj = new URL(this.platformConfig.baseUrl);
          return `${baseUrlObj.origin}${href.startsWith("/") ? "" : "/"}${href}`;
        }
      }

      return null;
    } catch (error) {
      logger.debug(`Error fetching detail page ${detailUrl}: ${error}`);
      return null;
    }
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

    // Also check for "Próximo" link
    const allPageLinks = root.querySelectorAll('a[href*="page="]');
    for (const link of allPageLinks) {
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
