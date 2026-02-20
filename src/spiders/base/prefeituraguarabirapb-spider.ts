import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  PrefeituraguarabirapbConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
import { toISODate } from "../../utils/date-utils";

/**
 * Spider for Prefeitura de Guarabira - PB
 *
 * Uses Cloudflare Browser Rendering (Puppeteer) to handle:
 * - JavaScript-rendered gazette listings (Livewire/Laravel)
 * - Paginated results
 * - Date filtering
 *
 * The site structure:
 * 1. Main page loads with Livewire component that renders gazette list
 * 2. Each gazette card has:
 *    - "Data da Publicação: DD/MM/YYYY"
 *    - "Baixar" link to PDF in /storage/diariooficial/
 * 3. Pagination at the bottom (210+ pages)
 */
export class PrefeituraguarabirapbSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraguarabirapbConfig;
    this.baseUrl =
      platformConfig.baseUrl || "https://guarabira.online/diariooficial";
    logger.debug(
      `PrefeituraguarabirapbSpider initialized with baseUrl: ${this.baseUrl} for ${config.name}`,
    );
    this.browser = browser || null;
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(
        `PrefeituraguarabirapbSpider for ${this.config.name} requires browser binding`,
      );
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling Guarabira-PB official gazette...`);

    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();

      // Navigate to the main page
      logger.info(`Navigating to: ${this.baseUrl}`);
      await page.goto(this.baseUrl, {
        waitUntil: "networkidle0",
        timeout: 60000,
      });
      this.requestCount++;

      // Wait for the page content to load
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Set 80 items per page to reduce pagination
      try {
        await page.select("select", "80");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (e) {
        logger.debug(
          "Could not change items per page, continuing with default",
        );
      }

      // Collect gazettes from the current page and navigate through pages
      let hasMorePages = true;
      let currentPage = 1;
      const maxPages = 250; // Safety limit
      const seenUrls = new Set<string>();
      let consecutiveEmptyPages = 0;
      const startDateObj = new Date(this.startDate);
      const endDateObj = new Date(this.endDate);

      while (hasMorePages && currentPage <= maxPages) {
        logger.info(`Processing page ${currentPage}...`);

        // Extract gazette data from the current page
        const pageGazettes = await this.extractGazettesFromPage(page);

        let gazettesAddedThisPage = 0;
        let oldestDateOnPage: Date | null = null;

        for (const gazette of pageGazettes) {
          // Check if already seen
          if (seenUrls.has(gazette.fileUrl)) {
            continue;
          }
          seenUrls.add(gazette.fileUrl);

          // Parse the gazette date
          const gazetteDate = new Date(gazette.date);

          // Track oldest date on page for early termination
          if (!oldestDateOnPage || gazetteDate < oldestDateOnPage) {
            oldestDateOnPage = gazetteDate;
          }

          // Filter by date range
          if (gazetteDate >= startDateObj && gazetteDate <= endDateObj) {
            gazettes.push(gazette);
            gazettesAddedThisPage++;
            logger.debug(
              `Found gazette: ${gazette.date} - ${gazette.fileUrl.split("/").pop()}`,
            );
          }
        }

        if (gazettesAddedThisPage > 0) {
          logger.info(
            `Added ${gazettesAddedThisPage} gazette(s) from page ${currentPage}`,
          );
          consecutiveEmptyPages = 0;
        } else {
          consecutiveEmptyPages++;
        }

        // Early termination: if all gazettes on this page are older than our start date
        if (oldestDateOnPage && oldestDateOnPage < startDateObj) {
          logger.info(
            `All gazettes on page ${currentPage} are older than start date. Stopping.`,
          );
          break;
        }

        // Try to go to the next page
        try {
          const nextButton = await page.$('button[aria-label="Próximo"]');
          if (!nextButton) {
            const nextButtonAlt = await page.$('button:has-text("Próximo")');
            if (!nextButtonAlt) {
              logger.info("No more pages available (no next button found)");
              hasMorePages = false;
              continue;
            }
            await nextButtonAlt.click();
          } else {
            const isDisabled = await page.evaluate(
              (btn: Element) => btn.hasAttribute("disabled"),
              nextButton,
            );
            if (isDisabled) {
              logger.info("No more pages available (next button disabled)");
              hasMorePages = false;
              continue;
            }
            await nextButton.click();
          }

          currentPage++;
          this.requestCount++;

          // Wait for page to load
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } catch (error) {
          logger.warn(`Error navigating to next page: ${error}`);
          hasMorePages = false;
        }

        // Safety: stop if too many empty pages in a row
        if (consecutiveEmptyPages >= 5) {
          logger.info(
            "5 consecutive pages with no matching gazettes. Stopping.",
          );
          break;
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes from Guarabira-PB`,
      );
    } catch (error) {
      logger.error(`Error crawling Guarabira-PB:`, error as Error);
      throw error;
    } finally {
      // Clean up
      if (page) {
        try {
          await page.close();
        } catch (e) {
          logger.warn("Error closing page", e as Error);
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (e) {
          logger.warn("Error closing browser", e as Error);
        }
      }
    }

    return gazettes;
  }

  /**
   * Extract gazette data from the current page
   */
  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      // Extract all gazette cards from the page
      const gazetteData = await page.evaluate((baseUrl: string) => {
        const results: { date: string; pdfUrl: string }[] = [];

        // Find all <time> elements with datetime attribute
        const timeElements = document.querySelectorAll("time[datetime]");

        for (const timeEl of timeElements) {
          const datetime = timeEl.getAttribute("datetime"); // Format: 2026-01-28
          if (!datetime) continue;

          // Look for PDF link in parent elements
          let parent = timeEl.parentElement;
          let pdfLink: string | null = null;

          // Search up the DOM tree for a PDF link
          for (let i = 0; i < 10 && parent; i++) {
            const link = parent.querySelector(
              'a[href*="/storage/diariooficial/"]',
            );
            if (link) {
              let href = (link as HTMLAnchorElement).getAttribute("href") || "";
              // Convert relative URL to absolute
              if (href.startsWith("/")) {
                href = baseUrl.replace(/\/diariooficial$/, "") + href;
              }
              pdfLink = href;
              break;
            }
            parent = parent.parentElement;
          }

          if (datetime && pdfLink) {
            results.push({ date: datetime, pdfUrl: pdfLink });
          }
        }

        return results;
      }, this.baseUrl);

      // Create gazette objects
      for (const item of gazetteData) {
        try {
          // Date is already in ISO format (YYYY-MM-DD) from datetime attribute
          const isoDate = item.date;
          const dateObj = new Date(isoDate);

          if (isNaN(dateObj.getTime())) {
            logger.warn(`Invalid date format: ${item.date}`);
            continue;
          }

          gazettes.push({
            date: isoDate,
            fileUrl: item.pdfUrl,
            territoryId: this.config.territoryId,
            power: "executive",
            scrapedAt: new Date().toISOString(),
          });
        } catch (error) {
          logger.warn(`Error processing gazette item: ${error}`);
        }
      }

      logger.debug(`Extracted ${gazettes.length} gazettes from page`);
    } catch (error) {
      logger.error("Error extracting gazettes from page:", error as Error);
    }

    return gazettes;
  }
}
