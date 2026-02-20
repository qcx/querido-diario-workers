import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";
import { toISODate, getCurrentTimestamp } from "../../utils/date-utils";

/**
 * Configuration for Santa Cruz do Capibaribe spider
 */
export interface PrefeiturasantacruzdocapibaribeConfig {
  type: "prefeiturasantacruzdocapibaribe";
  /** Base URL for the diário oficial portal */
  baseUrl: string;
}

/**
 * PrefeiturasantacruzdocapibaribeSpider implementation
 *
 * Crawls the official gazette from santacruzdocapibaribe.pe.gov.br
 *
 * Structure:
 * - List page: /artigos/diariooficial/pagina/{page_number}
 * - Article page: /artigos/diariooficial/id/{id}
 * - PDFs: /public/files/{filename}.pdf
 *
 * The spider crawls the list pages to find articles, then visits each article
 * to extract the PDF links.
 */
export class PrefeiturasantacruzdocapibaribeSpider extends BaseSpider {
  private readonly sccConfig: PrefeiturasantacruzdocapibaribeConfig;
  private readonly baseUrl: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.sccConfig =
      spiderConfig.config as PrefeiturasantacruzdocapibaribeConfig;
    this.baseUrl =
      this.sccConfig.baseUrl ||
      "https://www.santacruzdocapibaribe.pe.gov.br";

    logger.info(
      `Initializing PrefeiturasantacruzdocapibaribeSpider for ${spiderConfig.name}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling Santa Cruz do Capibaribe from ${toISODate(this.startDate)} to ${toISODate(this.endDate)}...`,
    );
    const gazettes: Gazette[] = [];
    const processedArticleIds = new Set<string>();

    try {
      let page = 1;
      let hasMorePages = true;

      while (hasMorePages) {
        const pageUrl = `${this.baseUrl}/artigos/diariooficial/pagina/${page}`;
        logger.debug(`Fetching list page: ${pageUrl}`);

        const response = await fetch(pageUrl, {
          method: "GET",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          },
        });

        if (!response.ok) {
          logger.warn(
            `Failed to fetch page ${page}: ${response.status} ${response.statusText}`,
          );
          break;
        }

        const html = await response.text();

        // Extract article links from the page
        // Pattern: /artigos/diariooficial/id/{id}
        const articleLinkPattern =
          /href="[^"]*\/artigos\/diariooficial\/id\/(\d+)"[^>]*>([^<]*(?:<[^>]+>[^<]*)*)/gi;
        const datePattern = /(\d{1,2})\s+de\s+(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})/gi;

        let match;
        const articleIdsOnPage: string[] = [];
        const articleDates: Map<string, string> = new Map();

        // Extract all article IDs and their dates from this page
        const linkMatches = html.matchAll(articleLinkPattern);
        for (const linkMatch of linkMatches) {
          const articleId = linkMatch[1];
          if (!processedArticleIds.has(articleId)) {
            articleIdsOnPage.push(articleId);
          }
        }

        // Also extract dates from the page HTML to associate with articles
        // The page shows date like "25 de janeiro de 2026"
        const articleBlocks =
          html.split(/href="[^"]*\/artigos\/diariooficial\/id\//);

        for (let i = 1; i < articleBlocks.length; i++) {
          const block = articleBlocks[i];
          const idMatch = block.match(/^(\d+)/);
          if (idMatch) {
            const articleId = idMatch[1];
            const dateMatch = block.match(datePattern);
            if (dateMatch) {
              const dateStr = dateMatch[0];
              const isoDate = this.parseBrazilianDate(dateStr);
              if (isoDate) {
                articleDates.set(articleId, isoDate);
              }
            }
          }
        }

        // Check if any article is within our date range
        let foundArticlesInRange = false;
        let foundArticlesBeforeRange = false;

        for (const articleId of articleIdsOnPage) {
          const articleDate = articleDates.get(articleId);

          if (articleDate) {
            const startDateStr = toISODate(this.startDate);
            const endDateStr = toISODate(this.endDate);

            if (articleDate < startDateStr) {
              foundArticlesBeforeRange = true;
              continue;
            }

            if (articleDate > endDateStr) {
              continue;
            }

            foundArticlesInRange = true;
          }

          // Fetch the article page to get PDFs
          processedArticleIds.add(articleId);
          const articleGazettes = await this.fetchArticle(
            articleId,
            articleDate,
          );
          gazettes.push(...articleGazettes);
        }

        // Check if there's a "Próxima Página" link
        hasMorePages = html.includes("Próxima Página");

        // Stop if we've gone past our date range (all articles are before startDate)
        if (foundArticlesBeforeRange && !foundArticlesInRange) {
          logger.debug(
            "All articles on this page are before the start date, stopping pagination",
          );
          break;
        }

        // Also stop if no article IDs were found (empty page or error)
        if (articleIdsOnPage.length === 0) {
          break;
        }

        page++;

        // Safety limit to prevent infinite loops
        if (page > 100) {
          logger.warn("Reached maximum page limit (100), stopping pagination");
          break;
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes from Santa Cruz do Capibaribe`,
      );
    } catch (error) {
      logger.error(`Error crawling Santa Cruz do Capibaribe:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Fetch an article page and extract PDF links
   */
  private async fetchArticle(
    articleId: string,
    knownDate?: string,
  ): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      const articleUrl = `${this.baseUrl}/artigos/diariooficial/id/${articleId}`;
      logger.debug(`Fetching article: ${articleUrl}`);

      const response = await fetch(articleUrl, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        },
      });

      if (!response.ok) {
        logger.warn(
          `Failed to fetch article ${articleId}: ${response.status} ${response.statusText}`,
        );
        return gazettes;
      }

      const html = await response.text();

      // Extract date from the article page if not known
      let articleDate = knownDate;
      if (!articleDate) {
        const datePattern =
          /(\d{1,2})\s+de\s+(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})/i;
        const dateMatch = html.match(datePattern);
        if (dateMatch) {
          articleDate = this.parseBrazilianDate(dateMatch[0]);
        }
      }

      if (!articleDate) {
        logger.warn(`Could not determine date for article ${articleId}`);
        return gazettes;
      }

      // Check if date is in range
      const startDateStr = toISODate(this.startDate);
      const endDateStr = toISODate(this.endDate);

      if (articleDate < startDateStr || articleDate > endDateStr) {
        return gazettes;
      }

      // Extract PDF links
      // Pattern: /public/files/{filename}.pdf or full URL
      const pdfPattern = /href="([^"]*\.pdf)"/gi;
      let pdfMatch;
      const pdfUrls = new Set<string>();

      while ((pdfMatch = pdfPattern.exec(html)) !== null) {
        let pdfUrl = pdfMatch[1];

        // Make URL absolute
        if (!pdfUrl.startsWith("http")) {
          if (pdfUrl.startsWith("/")) {
            pdfUrl = `${this.baseUrl}${pdfUrl}`;
          } else {
            pdfUrl = `${this.baseUrl}/${pdfUrl}`;
          }
        }

        pdfUrls.add(pdfUrl);
      }

      // Extract article title
      const titlePattern = /<h2[^>]*class="[^"]*titulo[^"]*"[^>]*>([^<]+)<\/h2>/i;
      const titleMatch = html.match(titlePattern);
      const title = titleMatch
        ? titleMatch[1].trim()
        : `Diário Oficial - ${articleDate}`;

      // Create gazette entries for each PDF
      for (const pdfUrl of pdfUrls) {
        const gazette: Gazette = {
          date: articleDate,
          fileUrl: pdfUrl,
          territoryId: this.spiderConfig.territoryId,
          scrapedAt: getCurrentTimestamp(),
          isExtraEdition:
            title.toLowerCase().includes("extra") ||
            title.toLowerCase().includes("extraordin"),
          power: "executive_legislative",
          sourceText: title,
        };

        gazettes.push(gazette);
      }

      if (pdfUrls.size === 0) {
        // If no PDF found, the article text itself might be the gazette content
        // Create a gazette pointing to the article URL itself (HTML gazette)
        const gazette: Gazette = {
          date: articleDate,
          fileUrl: articleUrl,
          territoryId: this.spiderConfig.territoryId,
          scrapedAt: getCurrentTimestamp(),
          isExtraEdition:
            title.toLowerCase().includes("extra") ||
            title.toLowerCase().includes("extraordin"),
          power: "executive_legislative",
          sourceText: title,
        };

        gazettes.push(gazette);
      }
    } catch (error) {
      logger.error(`Error fetching article ${articleId}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Parse Brazilian date format like "25 de janeiro de 2026" to ISO format "2026-01-25"
   */
  private parseBrazilianDate(dateStr: string): string | null {
    const months: Record<string, string> = {
      janeiro: "01",
      fevereiro: "02",
      março: "03",
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

    const pattern =
      /(\d{1,2})\s+de\s+(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})/i;
    const match = dateStr.match(pattern);

    if (!match) {
      return null;
    }

    const day = match[1].padStart(2, "0");
    const month = months[match[2].toLowerCase()];
    const year = match[3];

    if (!month) {
      return null;
    }

    return `${year}-${month}-${day}`;
  }
}
