import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange, PortalIopConfig } from "../../types";
import { logger } from "../../utils/logger";
import { getCurrentTimestamp } from "../../utils/date-utils";
import puppeteer from "@cloudflare/puppeteer";

/**
 * PortalIopSpider implementation
 *
 * Crawls gazette data from Portal IOP (portaliop.org.br) platform.
 * Used by municipalities in Bahia.
 *
 * URL Structure:
 * - Main page: https://diario.portaliop.org.br/{UF}/prefeitura/{CityName}
 *
 * The site uses Vue.js and requires client-side rendering.
 * Data is paginated and includes:
 * - Date (DD/MM/YYYY)
 * - Edition number
 * - Year
 * - Download button for PDF
 *
 * Note: Some municipalities may have historical data only as they may have
 * migrated to different platforms.
 */
export class PortalIopSpider extends BaseSpider {
  protected config: PortalIopConfig;
  private browser?: Fetcher;
  private readonly DEFAULT_BASE_URL = "https://diario.portaliop.org.br";

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PortalIopConfig;

    if (!this.config.citySlug) {
      throw new Error(
        `PortalIopSpider requires citySlug in config for ${spiderConfig.name}`,
      );
    }

    if (!this.config.stateCode) {
      throw new Error(
        `PortalIopSpider requires stateCode in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PortalIopSpider for ${spiderConfig.name} with city: ${this.config.citySlug}`,
    );
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    const baseUrl = this.config.baseUrl || this.DEFAULT_BASE_URL;
    const pageUrl = `${baseUrl}/${this.config.stateCode}/prefeitura/${this.config.citySlug}`;

    logger.info(`Crawling ${pageUrl} for ${this.spiderConfig.name}...`);

    // Portal IOP requires client-side rendering (Vue.js based)
    if (this.browser && this.config.requiresClientRendering !== false) {
      return this.crawlWithBrowser(pageUrl);
    }

    // If no browser is available, log warning and return empty
    logger.warn(
      `PortalIopSpider requires browser for client-side rendering. No gazettes extracted.`,
    );
    return [];
  }

  /**
   * Crawl using Puppeteer browser (client-side rendering)
   */
  private async crawlWithBrowser(pageUrl: string): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();

      // Set viewport
      await page.setViewport({ width: 1280, height: 800 });

      // Navigate to the page
      logger.debug(`Navigating to: ${pageUrl}`);
      await page.goto(pageUrl, { waitUntil: "networkidle0", timeout: 60000 });

      // Wait for Vue.js to render the content
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Check if we have gazettes on the page
      const totalResults = await page.evaluate(() => {
        // Look for the results count text like "Mostrando 1 até 10 de 371 resultados"
        const resultText = document.body.innerText;
        const match = resultText.match(/de (\d+) resultados/);
        return match ? parseInt(match[1], 10) : 0;
      });

      if (totalResults === 0) {
        logger.warn(`No gazettes found on page for ${this.spiderConfig.name}`);
        return gazettes;
      }

      logger.info(`Found ${totalResults} total gazettes on page`);

      // Extract gazettes from the current page and paginate
      let currentPage = 1;
      let hasMore = true;
      const maxPages = Math.ceil(totalResults / 10) + 1; // Safety limit

      while (hasMore && currentPage <= maxPages) {
        logger.debug(`Processing page ${currentPage}...`);

        // Extract gazette data from the page
        const pageGazettes = await page.evaluate(() => {
          const results: Array<{
            date: string;
            edition: string;
            year: string;
            downloadUrl: string | null;
            viewUrl: string | null;
          }> = [];

          // Find all gazette entries - they appear as rows in a table or cards
          // The structure shows headings with dates like "31/08/2022"
          const dateHeadings = document.querySelectorAll("h3");

          dateHeadings.forEach((heading) => {
            const dateText = heading.textContent?.trim();
            if (!dateText || !/^\d{2}\/\d{2}\/\d{4}$/.test(dateText)) return;

            // Find the parent container that has the gazette info
            const container = heading.closest(
              '.card, div[class*="gazette"], tr, .item',
            );
            if (!container) return;

            // Extract edition number - look for "Edição Nº" or just number
            const containerText = container.textContent || "";
            const editionMatch =
              containerText.match(/Edi[çã]o[:\s]*N?[ºo]?\s*(\d+)/i) ||
              containerText.match(/(\d+)/);
            const edition = editionMatch ? editionMatch[1] : "";

            // Extract year - look for "Ano:"
            const yearMatch = containerText.match(/Ano[:\s]*(\d+)/i);
            const year = yearMatch ? yearMatch[1] : "";

            // Find download button/link
            const downloadBtn = container.querySelector(
              'a[href*=".pdf"], button[data-tip*="Baixar"], a[download]',
            );
            const downloadUrl = downloadBtn?.getAttribute("href") || null;

            // Find view button/link
            const viewBtn = container.querySelector(
              'a[href*="view"], a[href*="visualizar"], button[data-tip*="Ver"]',
            );
            const viewUrl = viewBtn?.getAttribute("href") || null;

            results.push({
              date: dateText,
              edition,
              year,
              downloadUrl,
              viewUrl,
            });
          });

          // If headings approach didn't work, try table rows
          if (results.length === 0) {
            const tableRows = document.querySelectorAll("tr");
            tableRows.forEach((row) => {
              const cells = row.querySelectorAll("td");
              if (cells.length >= 3) {
                const dateText = cells[0]?.textContent?.trim();
                if (!dateText || !/^\d{2}\/\d{2}\/\d{4}$/.test(dateText))
                  return;

                const edition = cells[1]?.textContent?.trim() || "";
                const year = cells[2]?.textContent?.trim() || "";

                // Find download link in the row
                const downloadLink = row.querySelector(
                  'a[href*=".pdf"], a[download]',
                );
                const downloadUrl = downloadLink?.getAttribute("href") || null;

                results.push({
                  date: dateText,
                  edition,
                  year,
                  downloadUrl,
                  viewUrl: null,
                });
              }
            });
          }

          return results;
        });

        logger.debug(
          `Found ${pageGazettes.length} gazettes on page ${currentPage}`,
        );

        // Process extracted gazettes
        for (const item of pageGazettes) {
          const gazette = this.parseGazetteItem(item);

          if (gazette && !seenUrls.has(gazette.fileUrl)) {
            const dateObj = new Date(gazette.date);
            if (this.isInDateRange(dateObj)) {
              seenUrls.add(gazette.fileUrl);
              gazettes.push(gazette);
              logger.debug(
                `Found gazette: ${gazette.date} - Edition ${gazette.editionNumber}`,
              );
            }
          }
        }

        // Check if we should continue to next page
        const nextPageButton = await page.$(
          'button[name*="Próximo"], button:has-text("Próximo")',
        );
        if (nextPageButton) {
          try {
            await nextPageButton.click();
            await new Promise((resolve) => setTimeout(resolve, 2000));
            currentPage++;
          } catch {
            hasMore = false;
          }
        } else {
          hasMore = false;
        }

        // Stop if we've found no gazettes in date range for 3 consecutive pages
        if (
          pageGazettes.length > 0 &&
          gazettes.length === 0 &&
          currentPage > 3
        ) {
          logger.debug(
            "No gazettes in date range found in recent pages, stopping pagination",
          );
          hasMore = false;
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
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
   * Parse gazette item from page data
   */
  private parseGazetteItem(item: {
    date: string;
    edition: string;
    year: string;
    downloadUrl: string | null;
    viewUrl: string | null;
  }): Gazette | null {
    try {
      // Parse date from DD/MM/YYYY to YYYY-MM-DD
      const dateParts = item.date.split("/");
      if (dateParts.length !== 3) return null;

      const [day, month, year] = dateParts;
      const gazetteDate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;

      // Get the file URL
      let fileUrl = item.downloadUrl || item.viewUrl;

      if (!fileUrl) {
        // Generate URL based on pattern if no direct link found
        // Pattern might be like: /download/{citySlug}/{edition}.pdf
        logger.debug(`No direct URL found for gazette ${gazetteDate}`);
        return null;
      }

      // Make URL absolute if needed
      const baseUrl = this.config.baseUrl || this.DEFAULT_BASE_URL;
      if (fileUrl.startsWith("/")) {
        fileUrl = `${baseUrl}${fileUrl}`;
      } else if (!fileUrl.startsWith("http")) {
        fileUrl = `${baseUrl}/${fileUrl}`;
      }

      return {
        date: gazetteDate,
        fileUrl,
        territoryId: this.spiderConfig.territoryId,
        scrapedAt: getCurrentTimestamp(),
        isExtraEdition: false,
        power: "executive_legislative",
        editionNumber: item.edition,
        sourceText: `Diário Oficial - Edição ${item.edition}`,
      };
    } catch (error) {
      logger.warn(`Error parsing gazette item:`, {
        error: (error as Error).message,
      });
      return null;
    }
  }
}
