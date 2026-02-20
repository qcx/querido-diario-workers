import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  PrefeturaSaoLuisConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse } from "node-html-parser";
import { toISODate } from "../../utils/date-utils";

/**
 * Mapping of Portuguese month names to month numbers
 */
const MONTH_MAP: Record<string, number> = {
  janeiro: 0,
  fevereiro: 1,
  março: 2,
  marco: 2,
  abril: 3,
  maio: 4,
  junho: 5,
  julho: 6,
  agosto: 7,
  setembro: 8,
  outubro: 9,
  novembro: 10,
  dezembro: 11,
};

/**
 * Spider for Prefeitura de São Luís - MA
 *
 * Site: diariooficial.saoluis.ma.gov.br
 *
 * HTML Structure:
 * - Edition cards: div.box-publicacao with data-key="ID"
 * - Edition title: h4 (e.g., "Edição nº 022/XLVI")
 * - Date: Text after h4 (e.g., "Terça-feira, 27 de janeiro de 2026")
 * - PDF link: /diario-oficial/versao-pdf/ID
 * - Publications link: /diario-oficial/view/ID
 *
 * Pagination: Uses pjax, may need to check for next page button
 *
 * NOTE: This site requires browser rendering because:
 * 1. The server blocks direct fetch requests from Cloudflare Workers
 * 2. SSL certificate issues prevent regular HTTP requests
 */
export class PrefeturaSaoLuisSpider extends BaseSpider {
  protected config: PrefeturaSaoLuisConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeturaSaoLuisConfig;

    if (!this.config.baseUrl) {
      throw new Error(
        `PrefeturaSaoLuisSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeturaSaoLuisSpider for ${spiderConfig.name} with URL: ${this.config.baseUrl}`,
    );
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.config.baseUrl} for ${this.spiderConfig.name}...`,
    );

    // This site requires browser rendering due to SSL/fetch issues
    if (this.browser && this.config.requiresClientRendering) {
      return this.crawlWithBrowser();
    }

    // Fallback to direct fetch (will likely fail for this site)
    logger.info(
      "Browser not available or not required, trying direct fetch...",
    );
    return this.crawlWithFetch();
  }

  /**
   * Crawl using Puppeteer browser
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let currentPage = 1;
    const maxPages = 100; // Safety limit
    let foundOlderThanRange = false;

    try {
      // @ts-expect-error - Cloudflare Puppeteer has different API
      const browserInstance = await puppeteer.launch(this.browser);
      const page = await browserInstance.newPage();

      // Set viewport
      await page.setViewport({ width: 1280, height: 800 });

      while (currentPage <= maxPages && !foundOlderThanRange) {
        const pageUrl =
          currentPage === 1
            ? this.config.baseUrl
            : `${this.config.baseUrl}?page=${currentPage}`;

        logger.debug(`Fetching page ${currentPage}: ${pageUrl}`);

        try {
          await page.goto(pageUrl, {
            waitUntil: "networkidle0",
            timeout: 30000,
          });

          // Wait for the content to load
          await page.waitForSelector(".box-publicacao", { timeout: 10000 });

          // Extract gazette data from the rendered page
          const pageGazettes = await page.evaluate(() => {
            const items: Array<{
              editionId: string;
              editionNumber: string | undefined;
              dateText: string;
              isExtraEdition: boolean;
            }> = [];

            // Find all edition cards
            const editionCards = document.querySelectorAll(".box-publicacao");

            for (const card of editionCards) {
              try {
                // Get edition ID from data-key
                const editionId = card.getAttribute("data-key");
                if (!editionId) continue;

                // Get edition title from h4
                const titleElement = card.querySelector("h4");
                const titleText = titleElement?.textContent?.trim() || "";

                // Extract edition number from title (e.g., "Edição nº 022/XLVI")
                const editionMatch = titleText.match(/nº\s*(\d+)/i);
                const editionNumber = editionMatch
                  ? editionMatch[1]
                  : undefined;

                // Check if it's an extra edition
                const isExtraEdition = titleText
                  .toLowerCase()
                  .includes("extra");

                // Get date from the text after h4
                const paddingBox = card.querySelector(".padding-box, .col-12");
                let dateText = "";

                if (paddingBox) {
                  const fullText = paddingBox.textContent || "";
                  // Look for date pattern: "DD de MONTH de YYYY"
                  const dateMatch = fullText.match(
                    /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i,
                  );
                  if (dateMatch) {
                    dateText = dateMatch[0];
                  }
                }

                items.push({
                  editionId,
                  editionNumber,
                  dateText,
                  isExtraEdition,
                });
              } catch (e) {
                // Skip items that fail to parse
              }
            }

            return items;
          });

          logger.debug(
            `Found ${pageGazettes.length} edition cards on page ${currentPage}`,
          );

          for (const item of pageGazettes) {
            // Before creating the gazette, resolve the PDF URL to get the actual PDF location
            const baseUrlObj = new URL(this.config.baseUrl);
            const pdfRedirectUrl = `${baseUrlObj.origin}/diario-oficial/versao-pdf/${item.editionId}`;

            let actualPdfUrl = pdfRedirectUrl;
            try {
              // Navigate to the PDF URL to get the redirect
              const pdfPage = await browserInstance.newPage();
              await pdfPage.goto(pdfRedirectUrl, {
                waitUntil: "load",
                timeout: 15000,
              });
              actualPdfUrl = pdfPage.url();
              await pdfPage.close();
              logger.debug(
                `Resolved PDF URL: ${pdfRedirectUrl} -> ${actualPdfUrl}`,
              );
            } catch (error) {
              logger.debug(
                `Failed to resolve PDF URL ${pdfRedirectUrl}, using original`,
              );
            }

            const gazette = this.parseEditionFromBrowserWithUrl(
              item,
              actualPdfUrl,
            );

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

          // Get page HTML to check for pagination
          const html = await page.content();
          const hasNextPage =
            html.includes(`?page=${currentPage + 1}`) ||
            html.includes(`page=${currentPage + 1}`);
          if (!hasNextPage) {
            logger.debug(`No next page link found, stopping pagination`);
            break;
          }

          currentPage++;
        } catch (error) {
          logger.debug(
            `Error fetching page ${currentPage}: ${error instanceof Error ? error.message : String(error)}`,
          );
          break;
        }
      }

      await browserInstance.close();

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name} using browser`,
      );
    } catch (error) {
      logger.error(
        `Error crawling ${this.spiderConfig.name} with browser:`,
        error as Error,
      );
      throw error;
    }

    return gazettes;
  }

  /**
   * Parse edition data from browser evaluate result (legacy - for fetch fallback)
   */
  private parseEditionFromBrowser(item: {
    editionId: string;
    editionNumber: string | undefined;
    dateText: string;
    isExtraEdition: boolean;
  }): Gazette | null {
    const baseUrlObj = new URL(this.config.baseUrl);
    const pdfUrl = `${baseUrlObj.origin}/diario-oficial/versao-pdf/${item.editionId}`;
    return this.parseEditionFromBrowserWithUrl(item, pdfUrl);
  }

  /**
   * Parse edition data from browser evaluate result with a resolved PDF URL
   */
  private parseEditionFromBrowserWithUrl(
    item: {
      editionId: string;
      editionNumber: string | undefined;
      dateText: string;
      isExtraEdition: boolean;
    },
    pdfUrl: string,
  ): Gazette | null {
    try {
      // Parse date from text (e.g., "27 de janeiro de 2026")
      const dateMatch = item.dateText.match(
        /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i,
      );

      if (!dateMatch) {
        logger.debug(
          `Could not parse date from edition card with ID ${item.editionId}`,
        );
        return null;
      }

      const [, day, monthName, year] = dateMatch;
      const month = MONTH_MAP[monthName.toLowerCase()];

      if (month === undefined) {
        logger.debug(`Unknown month name: ${monthName}`);
        return null;
      }

      const gazetteDate = new Date(parseInt(year), month, parseInt(day));

      return {
        date: toISODate(gazetteDate),
        fileUrl: pdfUrl,
        territoryId: this.spiderConfig.territoryId,
        editionNumber: item.editionNumber,
        isExtraEdition: item.isExtraEdition,
        power: "executive",
        scrapedAt: new Date().toISOString(),
        // This site requires browser for PDF download due to SSL/blocking issues
        requiresClientRendering: true,
      };
    } catch (error) {
      logger.error(`Error parsing edition from browser:`, error as Error);
      return null;
    }
  }

  /**
   * Crawl using direct HTTP fetch (fallback - will likely fail for this site)
   */
  private async crawlWithFetch(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let currentPage = 1;
    const maxPages = 100; // Safety limit
    let foundOlderThanRange = false;

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
        const editionCards = root.querySelectorAll(".box-publicacao");

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

        // Check for next page - look for pagination links
        const hasNextPage =
          html.includes(`?page=${currentPage + 1}`) ||
          html.includes(`page=${currentPage + 1}`);
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
   * Parse a single edition card (for fetch fallback)
   *
   * HTML Structure:
   * <div class="box-publicacao" data-key="28506">
   *   <div class="row justify-content-between">
   *     <div class="col-12 padding-box">
   *       <h4>Edição nº 022/XLVI </h4>
   *       Terça-feira, 27 de janeiro de 2026
   *     </div>
   *     <a class="col col-link" href="/diario-oficial/view/28506">PUBLICAÇÕES</a>
   *     <a class="col col-link" href="/diario-oficial/versao-pdf/28506">EDIÇÃO COMPLETA</a>
   *   </div>
   * </div>
   */
  private parseEditionCard(card: any): Gazette | null {
    try {
      // Get edition ID from data-key
      const editionId = card.getAttribute("data-key");
      if (!editionId) {
        return null;
      }

      // Construct PDF URL
      const baseUrlObj = new URL(this.config.baseUrl);
      const pdfUrl = `${baseUrlObj.origin}/diario-oficial/versao-pdf/${editionId}`;

      // Get edition title from h4
      const titleElement = card.querySelector("h4");
      const titleText = titleElement?.text?.trim() || "";

      // Extract edition number from title (e.g., "Edição nº 022/XLVI")
      const editionMatch = titleText.match(/nº\s*(\d+)/i);
      const editionNumber = editionMatch ? editionMatch[1] : undefined;

      // Check if it's an extra edition
      const isExtraEdition = titleText.toLowerCase().includes("extra");

      // Get date from the text after h4
      // The card content has the date after the h4 element
      const paddingBox = card.querySelector(".padding-box, .col-12");
      let gazetteDate: Date | null = null;

      if (paddingBox) {
        const fullText = paddingBox.text || "";
        // Look for date pattern: "DD de MONTH de YYYY"
        const dateMatch = fullText.match(
          /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i,
        );

        if (dateMatch) {
          const [, day, monthName, year] = dateMatch;
          const month = MONTH_MAP[monthName.toLowerCase()];

          if (month !== undefined) {
            gazetteDate = new Date(parseInt(year), month, parseInt(day));
          }
        }
      }

      if (!gazetteDate) {
        logger.debug(
          `Could not parse date from edition card with ID ${editionId}`,
        );
        return null;
      }

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
