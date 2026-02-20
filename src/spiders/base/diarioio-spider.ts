import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange, DiarioIOConfig } from "../../types";
import { logger } from "../../utils/logger";
import { getCurrentTimestamp, toISODate } from "../../utils/date-utils";
import puppeteer from "@cloudflare/puppeteer";

/**
 * DiarioIOSpider implementation
 *
 * Crawls official gazettes from diario.io.org.br platform (IMAP)
 * Examples:
 *   - Palmeira dos Índios: https://diario.io.org.br/11052
 *   - Penedo: https://diario.io.org.br/11064
 *
 * This platform is an Angular SPA and requires browser rendering to work properly.
 */
export class DiarioIOSpider extends BaseSpider {
  protected diarioConfig: DiarioIOConfig;
  private browser?: any;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.diarioConfig = spiderConfig.config as DiarioIOConfig;

    logger.info(
      `Initializing DiarioIOSpider for ${spiderConfig.name} with clientId: ${this.diarioConfig.clientId}`,
    );
  }

  setBrowser(browser: any): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    const clientId = this.diarioConfig.clientId;
    const baseUrl = `https://diario.io.org.br/${clientId}`;

    logger.info(`Crawling ${baseUrl} for ${this.spiderConfig.name}...`);

    // If browser is available and requiresClientRendering is true, use Puppeteer
    if (this.browser && this.diarioConfig.requiresClientRendering === true) {
      return this.crawlWithBrowser(baseUrl);
    }

    // Fallback - try to fetch data without browser
    logger.warn(
      `Browser not available for DiarioIO. Platform requires client rendering.`,
    );
    return [];
  }

  /**
   * Crawl using Puppeteer browser (client-side rendering)
   */
  private async crawlWithBrowser(baseUrl: string): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();

      // Navigate to the diario page
      logger.debug(`Navigating to: ${baseUrl}`);
      await page.goto(baseUrl, { waitUntil: "networkidle0", timeout: 60000 });

      // Wait for Angular app to load
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Get pagination info and extract gazettes
      let currentPage = 1;
      let hasMore = true;
      const maxPages = 100;
      const seenDates = new Set<string>();

      while (hasMore && currentPage <= maxPages) {
        logger.info(`Processing page ${currentPage}...`);

        // Extract gazettes from current page
        const pageGazettes = await page.evaluate(() => {
          const results: Array<{
            date: string;
            edition: string;
            downloadUrl: string;
          }> = [];

          // Look for table rows with gazette data
          const rows = document.querySelectorAll(
            "table tbody tr, .gazette-item, [class*='diario']",
          );

          rows.forEach((row) => {
            const text = row.textContent || "";

            // Extract date - look for DD/MM/YYYY pattern
            const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (!dateMatch) return;

            const day = dateMatch[1];
            const month = dateMatch[2];
            const year = dateMatch[3];
            const dateStr = `${year}-${month}-${day}`;

            // Extract edition number
            const editionMatch = text.match(
              /(?:Edição|Ed\.?)\s*(?:N[°º]?\s*)?(\d+)/i,
            );
            const edition = editionMatch ? editionMatch[1] : "";

            // Find download link
            const downloadLink = row.querySelector(
              'a[href*="download"], a[href*=".pdf"], button[class*="download"]',
            );
            let downloadUrl = "";

            if (downloadLink) {
              downloadUrl = downloadLink.getAttribute("href") || "";
            }

            if (dateStr) {
              results.push({ date: dateStr, edition, downloadUrl });
            }
          });

          return results;
        });

        if (pageGazettes.length === 0) {
          // Try alternative extraction method
          const altGazettes = await this.extractGazettesAlternative(page);
          if (altGazettes.length === 0) {
            hasMore = false;
            break;
          }

          for (const g of altGazettes) {
            if (seenDates.has(g.date)) continue;
            seenDates.add(g.date);

            const dateObj = new Date(g.date);
            if (this.isInDateRange(dateObj)) {
              const gazette: Gazette = {
                date: g.date,
                fileUrl:
                  g.downloadUrl ||
                  (await this.buildDownloadUrl(page, g.date, g.edition)),
                territoryId: this.spiderConfig.territoryId,
                scrapedAt: getCurrentTimestamp(),
                isExtraEdition: false,
                power: "executive",
                editionNumber: g.edition,
                sourceText: `Diário Oficial - Edição ${g.edition || "N/A"} - ${g.date}`,
              };
              gazettes.push(gazette);
            }
          }
        } else {
          let foundInRange = false;
          let foundBeforeRange = false;

          for (const g of pageGazettes) {
            if (seenDates.has(g.date)) continue;
            seenDates.add(g.date);

            const dateObj = new Date(g.date);
            if (this.isInDateRange(dateObj)) {
              foundInRange = true;
              const gazette: Gazette = {
                date: g.date,
                fileUrl:
                  g.downloadUrl ||
                  (await this.buildDownloadUrl(page, g.date, g.edition)),
                territoryId: this.spiderConfig.territoryId,
                scrapedAt: getCurrentTimestamp(),
                isExtraEdition: false,
                power: "executive",
                editionNumber: g.edition,
                sourceText: `Diário Oficial - Edição ${g.edition || "N/A"} - ${g.date}`,
              };
              gazettes.push(gazette);
            } else if (dateObj < new Date(this.dateRange.start)) {
              foundBeforeRange = true;
            }
          }

          if (foundBeforeRange && !foundInRange) {
            hasMore = false;
          }
        }

        // Try to go to next page
        if (hasMore) {
          const nextButton = await page.$(
            'button:has-text("Próximo"), [class*="next"], [aria-label*="next"]',
          );
          if (nextButton) {
            await nextButton.click();
            await new Promise((resolve) => setTimeout(resolve, 2000));
            currentPage++;
          } else {
            hasMore = false;
          }
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes from browser for ${this.spiderConfig.name}`,
      );
    } catch (error) {
      logger.error(`Error crawling with browser:`, error as Error);
    } finally {
      // Clean up
      if (page) {
        try {
          await page.close();
        } catch (e) {
          // Ignore close errors
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (e) {
          // Ignore close errors
        }
      }
    }

    return gazettes;
  }

  /**
   * Alternative method to extract gazettes from page
   */
  private async extractGazettesAlternative(
    page: any,
  ): Promise<Array<{ date: string; edition: string; downloadUrl: string }>> {
    try {
      return await page.evaluate(() => {
        const results: Array<{
          date: string;
          edition: string;
          downloadUrl: string;
        }> = [];

        // Look for any element containing date patterns
        const allElements = document.querySelectorAll("*");
        const processedDates = new Set<string>();

        allElements.forEach((el) => {
          const text = el.textContent || "";
          const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);

          if (dateMatch && !processedDates.has(dateMatch[0])) {
            processedDates.add(dateMatch[0]);

            const day = dateMatch[1];
            const month = dateMatch[2];
            const year = dateMatch[3];
            const dateStr = `${year}-${month}-${day}`;

            // Find closest download button
            const parent = el.closest("div, tr, li, article");
            const downloadBtn = parent?.querySelector(
              'a[href*="download"], a[href*=".pdf"], button',
            );
            const downloadUrl = downloadBtn?.getAttribute("href") || "";

            // Extract edition
            const editionMatch = text.match(/(\d{4,})/);
            const edition = editionMatch ? editionMatch[1] : "";

            results.push({ date: dateStr, edition, downloadUrl });
          }
        });

        return results.slice(0, 50); // Limit results
      });
    } catch (error) {
      logger.debug(
        `Alternative extraction failed: ${(error as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Build download URL for a gazette
   */
  private async buildDownloadUrl(
    page: any,
    date: string,
    edition: string,
  ): Promise<string> {
    // The download URL pattern for diario.io.org.br
    // Based on the Handler.ashx pattern: https://sai.io.org.br/Handler.ashx?c={clientId}&f=diario&m=0&query={editionId}
    const clientId = this.diarioConfig.clientId;

    // Try to find the actual download link by clicking on the gazette
    try {
      const downloadUrl = await page.evaluate((targetDate: string) => {
        const rows = Array.from(document.querySelectorAll("tr, .gazette-item"));
        for (const row of rows) {
          if (row.textContent?.includes(targetDate.replace(/-/g, "/"))) {
            const link = row.querySelector(
              'a[href*="download"], a[href*=".pdf"]',
            );
            return link?.getAttribute("href") || "";
          }
        }
        return "";
      }, date);

      if (downloadUrl) {
        return downloadUrl;
      }
    } catch (e) {
      // Ignore
    }

    // Fallback: construct URL using known pattern
    return `https://sai.io.org.br/Handler.ashx?c=${clientId}&f=diario&m=0&query=${edition}`;
  }
}
