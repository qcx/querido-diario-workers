import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  PrefeituraAmaranteConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";

/**
 * Spider for Prefeitura de Amarante do Maranhão - MA
 *
 * Site: https://www.amarante.ma.gov.br/edicoes
 *
 * The site displays a paginated grid of gazette editions.
 * Each edition card contains:
 * - PDF link in href attribute
 * - Volume and edition number (e.g., "Vol 7 | Nº 1239/2026")
 * - Date in DD/MM/YYYY format
 *
 * PDFs follow patterns:
 * - /upload/diario_oficial/{HASH}.pdf
 * - /upload/diario_oficial/diario_ofical_YYYY-MM-DDHHMMSS.pdf
 *
 * Total editions: 1239+ (as of Jan 2026)
 * ISSN: 2764-6653
 */
export class PrefeituraAmaranteSpider extends BaseSpider {
  protected config: PrefeituraAmaranteConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeituraAmaranteConfig;

    if (!this.config.baseUrl) {
      throw new Error(
        `PrefeituraAmaranteSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeituraAmaranteSpider for ${spiderConfig.name} with URL: ${this.config.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.config.baseUrl} for ${this.spiderConfig.name}...`,
    );

    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();
    let currentPage = 1;
    const maxPages = this.config.maxPages || 200; // Default to 200 pages max
    let hasMorePages = true;
    let consecutiveEmptyPages = 0;
    const MAX_CONSECUTIVE_EMPTY = 3;

    try {
      while (
        hasMorePages &&
        currentPage <= maxPages &&
        consecutiveEmptyPages < MAX_CONSECUTIVE_EMPTY
      ) {
        const pageUrl =
          currentPage === 1
            ? this.config.baseUrl
            : `${this.config.baseUrl}?page=${currentPage}`;

        logger.info(`Fetching page ${currentPage}: ${pageUrl}`);

        const response = await fetch(pageUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const html = await response.text();
        const baseUrl = new URL(this.config.baseUrl);
        const origin = baseUrl.origin;

        // Parse gazette cards from the page
        // Pattern: <div class="deprt-icon-box"> containing PDF links and dates
        const pageGazettes = this.parseGazettesFromHtml(html, origin, seenUrls);

        if (pageGazettes.length === 0) {
          consecutiveEmptyPages++;
          logger.info(
            `Page ${currentPage} has no gazettes in date range. Consecutive empty: ${consecutiveEmptyPages}`,
          );
        } else {
          consecutiveEmptyPages = 0;
          gazettes.push(...pageGazettes);
          logger.info(
            `Page ${currentPage}: Found ${pageGazettes.length} gazettes in date range`,
          );
        }

        // Check if there's a next page
        hasMorePages = html.includes(`?page=${currentPage + 1}`);
        currentPage++;

        // Small delay between requests to be respectful
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name} (${currentPage - 1} pages)`,
      );
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
      throw error;
    }

    return gazettes;
  }

  private parseGazettesFromHtml(
    html: string,
    origin: string,
    seenUrls: Set<string>,
  ): Gazette[] {
    const gazettes: Gazette[] = [];

    // Extract all PDF URLs and their associated dates from the HTML
    // Pattern: href="...upload/diario_oficial/...pdf" followed by date in nearby h6 tag

    // Match each deprt-icon-box block
    const boxRegex =
      /<div class="deprt-icon-box"[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi;
    const boxes = html.match(boxRegex) || [];

    for (const box of boxes) {
      // Extract PDF URL
      const pdfMatch = box.match(
        /href=["']([^"']*\/upload\/diario_oficial\/[^"']+\.pdf)["']/i,
      );
      if (!pdfMatch) continue;

      let pdfPath = pdfMatch[1];
      let pdfUrl: string;
      if (pdfPath.startsWith("http")) {
        pdfUrl = pdfPath;
      } else {
        pdfUrl = `${origin}${pdfPath}`;
      }

      // Skip if already processed
      if (seenUrls.has(pdfUrl)) continue;
      seenUrls.add(pdfUrl);

      // Extract date from the box (DD/MM/YYYY format in h6 tags)
      // The date is typically in the last h6 tag that contains a date pattern
      const dateMatches = box.match(/>(\d{2})\/(\d{2})\/(\d{4})</g);
      if (!dateMatches || dateMatches.length === 0) continue;

      // Get the last date match (most reliable)
      const lastDateMatch = dateMatches[dateMatches.length - 1];
      const dateParseMatch = lastDateMatch.match(/>(\d{2})\/(\d{2})\/(\d{4})</);
      if (!dateParseMatch) continue;

      const [, day, month, year] = dateParseMatch;
      const date = `${year}-${month}-${day}`;

      // Check if date is in range
      if (!this.isInDateRange(new Date(date))) continue;

      // Extract edition number if available (e.g., "Nº 1239/2026")
      let editionNumber: string | undefined;
      const editionMatch = box.match(/Nº\s*(\d+)\/\d{4}/i);
      if (editionMatch) {
        editionNumber = editionMatch[1];
      }

      gazettes.push({
        date,
        fileUrl: pdfUrl,
        territoryId: this.spiderConfig.territoryId,
        editionNumber,
        power: "executive",
        isExtraEdition: false,
        scrapedAt: new Date().toISOString(),
      });
    }

    return gazettes;
  }
}
