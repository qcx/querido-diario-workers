import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  DiarioMunicipalALWordpressConfig,
} from "../../types";
import { logger } from "../../utils/logger";
import { getCurrentTimestamp } from "../../utils/date-utils";

/**
 * DiarioMunicipalALWordpressSpider implementation
 *
 * Crawls official gazettes from WordPress-based gazette portals in Alagoas
 * Example: https://www.diariomunicipal-al.com.br/uniao/
 *
 * These sites use WordPress with paginated blog posts containing gazette PDFs.
 */
export class DiarioMunicipalALWordpressSpider extends BaseSpider {
  protected wpConfig: DiarioMunicipalALWordpressConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.wpConfig = spiderConfig.config as DiarioMunicipalALWordpressConfig;

    logger.info(
      `Initializing DiarioMunicipalALWordpressSpider for ${spiderConfig.name}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    const baseUrl = this.wpConfig.baseUrl;
    logger.info(`Crawling ${baseUrl} for ${this.spiderConfig.name}...`);

    const gazettes: Gazette[] = [];
    let page = 1;
    let hasMore = true;
    const maxPages = 50; // Safety limit

    while (hasMore && page <= maxPages) {
      try {
        const pageUrl =
          page === 1 ? baseUrl : `${baseUrl.replace(/\/$/, "")}/page/${page}/`;
        logger.info(`Fetching page ${page}: ${pageUrl}`);

        const html = await this.fetch(pageUrl);

        if (!html || html.includes("Nada foi encontrado")) {
          hasMore = false;
          break;
        }

        const pageGazettes = await this.parseGazettesFromHtml(html, baseUrl);

        if (pageGazettes.length === 0) {
          hasMore = false;
          break;
        }

        // Check if any gazette is in range
        let foundInRange = false;
        let foundBeforeRange = false;

        for (const gazette of pageGazettes) {
          const dateObj = new Date(gazette.date);
          if (this.isInDateRange(dateObj)) {
            gazettes.push(gazette);
            foundInRange = true;
          } else if (dateObj < new Date(this.dateRange.start)) {
            foundBeforeRange = true;
          }
        }

        // If we're past the date range, stop
        if (foundBeforeRange && !foundInRange) {
          hasMore = false;
        }

        page++;
      } catch (error) {
        logger.warn(`Error fetching page ${page}: ${(error as Error).message}`);
        hasMore = false;
      }
    }

    logger.info(
      `Found ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
    );
    return gazettes;
  }

  /**
   * Parse gazettes from WordPress HTML page
   */
  private async parseGazettesFromHtml(
    html: string,
    baseUrl: string,
  ): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    // WordPress posts typically have article elements with dates
    // Pattern: <article ... <time datetime="2026-01-28T..."> ... <a href="...pdf">
    const articleRegex = /<article[^>]*>[\s\S]*?<\/article>/gi;
    const articles = html.match(articleRegex) || [];

    for (const article of articles) {
      try {
        // Extract date from <time datetime="...">
        const dateMatch = article.match(/datetime="(\d{4}-\d{2}-\d{2})[T\s]/i);
        if (!dateMatch) {
          // Try alternative date patterns
          const altDateMatch = article.match(
            /(\d{1,2})\s+de\s+(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})/i,
          );
          if (altDateMatch) {
            const day = altDateMatch[1].padStart(2, "0");
            const month = this.parseMonthName(altDateMatch[2]);
            const year = altDateMatch[3];
            const dateStr = `${year}-${month}-${day}`;

            const gazette = await this.extractGazetteFromArticle(
              article,
              dateStr,
              baseUrl,
            );
            if (gazette) {
              gazettes.push(gazette);
            }
          }
          continue;
        }

        const dateStr = dateMatch[1];
        const gazette = await this.extractGazetteFromArticle(
          article,
          dateStr,
          baseUrl,
        );
        if (gazette) {
          gazettes.push(gazette);
        }
      } catch (error) {
        logger.debug(`Error parsing article: ${(error as Error).message}`);
      }
    }

    return gazettes;
  }

  /**
   * Extract gazette info from an article HTML
   */
  private async extractGazetteFromArticle(
    article: string,
    dateStr: string,
    baseUrl: string,
  ): Promise<Gazette | null> {
    try {
      // Extract title
      const titleMatch = article.match(
        /<h[1-6][^>]*class="[^"]*entry-title[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/i,
      );

      if (!titleMatch) {
        // Try simpler pattern
        const simpleTitleMatch = article.match(
          /<a[^>]*href="([^"]+)"[^>]*>([^<]*(?:DIÁRIO|PORTARIA|DECRETO|LEI|EDITAL)[^<]*)<\/a>/i,
        );
        if (!simpleTitleMatch) {
          return null;
        }
      }

      const postUrl = titleMatch ? titleMatch[1] : "";
      const title = titleMatch ? titleMatch[2].trim() : "";

      // Check if there's a direct PDF link in the article
      const pdfMatch = article.match(/href="([^"]+\.pdf)"/i);

      let fileUrl: string;

      if (pdfMatch) {
        fileUrl = pdfMatch[1];
      } else if (postUrl) {
        // Need to fetch the post page to find PDF
        try {
          const postHtml = await this.fetch(postUrl);
          const postPdfMatch = postHtml.match(/href="([^"]+\.pdf)"/i);
          if (postPdfMatch) {
            fileUrl = postPdfMatch[1];
          } else {
            // Check for attachment links
            const attachmentMatch = postHtml.match(
              /href="([^"]+\/attachment\/[^"]+)"/i,
            );
            if (attachmentMatch) {
              fileUrl = attachmentMatch[1];
            } else {
              // No PDF found, skip this gazette
              logger.debug(`No PDF found for post: ${postUrl}`);
              return null;
            }
          }
        } catch (error) {
          logger.debug(
            `Error fetching post ${postUrl}: ${(error as Error).message}`,
          );
          return null;
        }
      } else {
        return null;
      }

      // Make URL absolute if needed
      if (!fileUrl.startsWith("http")) {
        const base = baseUrl.replace(/\/$/, "");
        fileUrl = fileUrl.startsWith("/")
          ? `${base}${fileUrl}`
          : `${base}/${fileUrl}`;
      }

      // Extract edition number from title
      const editionMatch = title.match(/(?:EDIÇÃO|EDICAO|Nº|N°)\s*(\d+)/i);
      const editionNumber = editionMatch ? editionMatch[1] : undefined;

      return {
        date: dateStr,
        fileUrl,
        territoryId: this.spiderConfig.territoryId,
        scrapedAt: getCurrentTimestamp(),
        isExtraEdition: false,
        power: "executive",
        editionNumber,
        sourceText: title || `Diário Oficial ${dateStr}`,
      };
    } catch (error) {
      logger.debug(`Error extracting gazette: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Parse Portuguese month name to number
   */
  private parseMonthName(monthName: string): string {
    const months: Record<string, string> = {
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
    return months[monthName.toLowerCase()] || "01";
  }
}
