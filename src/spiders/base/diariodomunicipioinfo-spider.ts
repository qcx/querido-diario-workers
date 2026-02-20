import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  DiariodomunicipioinfoConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
import { getCurrentTimestamp } from "../../utils/date-utils";

/**
 * Spider for diariodomunicipio.info WordPress platform
 *
 * Platform: WordPress with WP File Download plugin
 *
 * Used by: Alto Alegre do Pindaré-MA (diariodomunicipio.info)
 *
 * The site uses a WordPress file manager to list gazette PDFs.
 * Files are organized in categories like "Diários - Geral".
 * Each file has a filename containing the date and edition info.
 *
 * Example file URL: https://diariodomunicipio.info/download/2/diarios-geral/1651/caderno-do-executivo-diario-de-12-de-fevereiro-d_caderno-do-executivo.pdf
 *
 * Pattern: /download/{categoryId}/{categorySlug}/{fileId}/{filename}.pdf
 */
export class DiariodomunicipioinfoSpider extends BaseSpider {
  protected config: DiariodomunicipioinfoConfig;

  // Map of Portuguese months to numbers
  private readonly MONTHS: Record<string, string> = {
    janeiro: "01",
    fevereiro: "02",
    março: "03",
    marco: "03",
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
    this.config = spiderConfig.config as DiariodomunicipioinfoConfig;

    if (!this.config.baseUrl) {
      throw new Error(
        `DiariodomunicipioinfoSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing DiariodomunicipioinfoSpider for ${spiderConfig.name} with URL: ${this.config.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.config.baseUrl} for ${this.spiderConfig.name}...`,
    );

    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();

    try {
      // Fetch each page until we find gazettes outside our date range
      let page = 1;
      let hasMore = true;
      let consecutiveOldPages = 0;
      const MAX_OLD_PAGES = 2;
      const MAX_PAGES = 150; // Safety limit

      while (
        hasMore &&
        page <= MAX_PAGES &&
        consecutiveOldPages < MAX_OLD_PAGES
      ) {
        const pageGazettes = await this.fetchPage(page, seenUrls);

        if (pageGazettes.length === 0) {
          // No more gazettes on this page
          hasMore = false;
        } else {
          // Check if all gazettes on this page are before our date range
          const validGazettes = pageGazettes.filter((g) =>
            this.isInDateRange(new Date(g.date)),
          );

          if (validGazettes.length === 0) {
            consecutiveOldPages++;
            logger.debug(
              `Page ${page}: all gazettes before date range (consecutive: ${consecutiveOldPages})`,
            );
          } else {
            consecutiveOldPages = 0;
            gazettes.push(...validGazettes);
          }

          page++;
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
      );
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
      throw error;
    }

    return gazettes;
  }

  /**
   * Fetch a single page of gazettes from the WordPress site
   */
  private async fetchPage(
    page: number,
    seenUrls: Set<string>,
  ): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      // The site uses pagination with page numbers
      const url =
        page === 1
          ? this.config.baseUrl
          : `${this.config.baseUrl}/page/${page}`;

      logger.debug(`Fetching page ${page}: ${url}`);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          // No more pages
          return [];
        }
        throw new Error(
          `Failed to fetch page ${page}: ${response.status} ${response.statusText}`,
        );
      }

      const html = await response.text();

      // Find all PDF download links
      // Pattern: href="https://diariodomunicipio.info/download/2/diarios-geral/1651/caderno-do-executivo-diario-de-12-de-fevereiro-d_caderno-do-executivo.pdf"
      const pdfLinkRegex =
        /href="(https?:\/\/diariodomunicipio\.info\/download\/[^"]+\.pdf)"/gi;

      let match;
      while ((match = pdfLinkRegex.exec(html)) !== null) {
        const pdfUrl = match[1];

        // Skip duplicates
        if (seenUrls.has(pdfUrl)) {
          continue;
        }
        seenUrls.add(pdfUrl);

        // Try to extract date from filename
        // Example: caderno-do-executivo-diario-de-12-de-fevereiro-d_caderno-do-executivo.pdf
        // Pattern: diario-de-{day}-de-{month}
        const gazette = this.parseGazetteFromUrl(pdfUrl);
        if (gazette) {
          gazettes.push(gazette);
        }
      }

      logger.debug(`Page ${page}: found ${gazettes.length} gazettes`);
    } catch (error) {
      logger.error(`Error fetching page ${page}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Parse gazette information from the PDF URL and filename
   */
  private parseGazetteFromUrl(pdfUrl: string): Gazette | null {
    try {
      // Extract filename from URL
      const urlParts = pdfUrl.split("/");
      const filename = urlParts[urlParts.length - 1].toLowerCase();

      // Try to extract date from filename
      // Pattern 1: diario-de-{day}-de-{month}-d (truncated year)
      // Pattern 2: diario-de-{day}-de-{month}-de-{year}
      const dateMatch = filename.match(
        /diario-de-(\d{1,2})-de-([a-z]+)(?:-de?-?(\d{4})?)?/i,
      );

      if (!dateMatch) {
        logger.debug(`Could not parse date from filename: ${filename}`);
        return null;
      }

      const [, dayStr, monthStr, yearStr] = dateMatch;
      const day = dayStr.padStart(2, "0");
      const month = this.MONTHS[monthStr.toLowerCase()];

      if (!month) {
        logger.debug(`Unknown month: ${monthStr}`);
        return null;
      }

      // If year is not in filename, assume current year or derive from context
      // The file ID in the URL can help determine the year (newer files have higher IDs)
      let year = yearStr;
      if (!year) {
        // Try to get year from the current date or assume recent
        const currentYear = new Date().getFullYear();
        year = String(currentYear);
      }

      const date = `${year}-${month}-${day}`;

      // Determine power from filename
      let power: "executive" | "legislative" | "executive_legislative" =
        "executive";
      if (filename.includes("legislativo")) {
        power = "legislative";
      } else if (
        filename.includes("executivo") &&
        filename.includes("legislativo")
      ) {
        power = "executive_legislative";
      }

      // Check for extra editions
      const isExtraEdition =
        filename.includes("extra") || filename.includes("suplemento");

      return {
        date,
        fileUrl: pdfUrl,
        territoryId: this.spiderConfig.territoryId,
        power,
        isExtraEdition,
        scrapedAt: getCurrentTimestamp(),
      };
    } catch (error) {
      logger.debug(`Error parsing gazette from URL ${pdfUrl}: ${error}`);
      return null;
    }
  }
}
