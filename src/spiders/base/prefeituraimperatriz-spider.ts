import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  PrefeituraImperatrizConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse } from "node-html-parser";
import { toISODate } from "../../utils/date-utils";

/**
 * Spider for Prefeitura de Imperatriz and similar platforms
 *
 * This platform is used by multiple municipalities in Maranhão:
 * - Imperatriz (diariooficial.imperatriz.ma.gov.br)
 * - Timon (transparencia.timon.ma.gov.br)
 *
 * HTML Structure:
 * - Edition cards: div.deprt-icon-box
 * - PDF links: a.rm with href pointing to /upload/diario_oficial/{hash}.pdf
 * - Edition info: Links with text "Vol X | Nº Y/YYYY"
 * - Date: Links with text "DD/MM/YYYY"
 * - Pagination: ?page=N
 */
export class PrefeituraImperatrizSpider extends BaseSpider {
  protected config: PrefeituraImperatrizConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeituraImperatrizConfig;

    if (!this.config.baseUrl) {
      throw new Error(
        `PrefeituraImperatrizSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeituraImperatrizSpider for ${spiderConfig.name} with URL: ${this.config.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let currentPage = 1;
    const maxPages = 200; // Safety limit
    let foundOlderThanRange = false;

    logger.info(
      `Crawling ${this.config.baseUrl} for ${this.spiderConfig.name}...`,
    );

    try {
      while (currentPage <= maxPages && !foundOlderThanRange) {
        const pageUrl =
          currentPage === 1
            ? this.config.baseUrl
            : `${this.config.baseUrl}?page=${currentPage}`;

        logger.debug(`Fetching page ${currentPage}: ${pageUrl}`);

        const response = await fetch(pageUrl, {
          method: "GET",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
          },
        });

        if (!response.ok) {
          logger.error(
            `Failed to fetch page ${currentPage}: ${response.status} ${response.statusText}`,
          );
          break;
        }

        const html = await response.text();
        const root = parse(html);

        // Find all edition cards
        const editionCards = root.querySelectorAll(".deprt-icon-box");

        if (editionCards.length === 0) {
          logger.debug(
            `No edition cards found on page ${currentPage}, stopping pagination`,
          );
          break;
        }

        logger.debug(
          `Found ${editionCards.length} edition cards on page ${currentPage}`,
        );

        for (const card of editionCards) {
          const gazette = this.parseEditionCard(card);

          if (!gazette) {
            continue;
          }

          const gazetteDate = new Date(gazette.date);

          // Check if older than range
          if (gazetteDate < new Date(this.dateRange.start)) {
            foundOlderThanRange = true;
            continue;
          }

          // Check if in range
          if (this.isInDateRange(gazetteDate)) {
            gazettes.push(gazette);
          }
        }

        logger.debug(
          `Found ${gazettes.length} gazettes so far after page ${currentPage}`,
        );

        // Stop if we found gazettes older than range
        if (foundOlderThanRange) {
          logger.info(
            `Found gazettes older than date range, stopping pagination`,
          );
          break;
        }

        // Check for next page
        const hasNextPage = html.includes(`?page=${currentPage + 1}`);
        if (!hasNextPage) {
          logger.debug(`No next page link found, stopping pagination`);
          break;
        }

        currentPage++;

        // Small delay between requests
        await new Promise((resolve) => setTimeout(resolve, 200));
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
   * Parse a single edition card
   *
   * HTML Structure:
   * <div class="deprt-icon-box" style="height: 300px;">
   *   <h6><a href="...pdf" target="_blank" style="...">DIÁRIO OFICIAL ELETRÔNICO</a></h6>
   *   <i class="fa fa-file-contract"></i>
   *   <h6><a href="...pdf" target="_blank">Vol 6 | Nº 1246/2026</a></h6>
   *   <h6><a href="...pdf" target="_blank">27/01/2026</a></h6>
   *   <a class="rm" href="...pdf" target="_blank">Baixar</a>
   * </div>
   */
  private parseEditionCard(card: any): Gazette | null {
    try {
      // Get PDF URL from the "Baixar" button (a.rm)
      const downloadLink = card.querySelector("a.rm");
      if (!downloadLink) {
        return null;
      }

      let pdfUrl = downloadLink.getAttribute("href");
      if (!pdfUrl) {
        return null;
      }

      // Make absolute URL if relative
      if (!pdfUrl.startsWith("http")) {
        const baseUrlObj = new URL(this.config.baseUrl);
        pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith("/") ? "" : "/"}${pdfUrl}`;
      }

      // Extract date and edition from links
      const allLinks = card.querySelectorAll("a");
      let gazetteDate: Date | null = null;
      let editionNumber: string | undefined;

      for (const link of allLinks) {
        const text = link.text?.trim() || "";

        // Check for date pattern DD/MM/YYYY
        const dateMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (dateMatch) {
          const [, day, month, year] = dateMatch;
          gazetteDate = new Date(`${year}-${month}-${day}`);
          continue;
        }

        // Check for edition pattern "Vol X | Nº Y/YYYY"
        const editionMatch = text.match(/N[ºo°]\s*(\d+)/i);
        if (editionMatch) {
          editionNumber = editionMatch[1];
        }
      }

      if (!gazetteDate) {
        logger.debug(`Could not parse date from edition card`);
        return null;
      }

      // Check if it's an extra edition (look for "Extra" in any text)
      const cardText = card.text || "";
      const isExtraEdition =
        cardText.toLowerCase().includes("extra") ||
        cardText.toLowerCase().includes("suplementar");

      return {
        date: toISODate(gazetteDate),
        fileUrl: pdfUrl,
        territoryId: this.spiderConfig.territoryId,
        editionNumber,
        isExtraEdition,
        power: "executive",
        scrapedAt: new Date().toISOString(),
      };
    } catch (error) {
      logger.error(`Error parsing edition card:`, error as Error);
      return null;
    }
  }
}
