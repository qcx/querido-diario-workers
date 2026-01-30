import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig, IOSEConfig } from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
import puppeteer from "@cloudflare/puppeteer";

/**
 * Spider for IOSE (Imprensa Oficial de Sergipe) platform
 *
 * This platform is used by municipalities in Sergipe state for publishing official gazettes.
 * URL pattern: https://iose.se.gov.br/{entitySlug}/
 * Download pattern: https://iose.se.gov.br/{entitySlug}/portal/edicoes/download/{id}
 *
 * Features:
 * - Search by date
 * - Search by name/subject
 * - Edition dropdown for selection
 * - PDF download links
 *
 * NOTE: This platform REQUIRES client-side rendering (browser mode) to work properly
 * due to JavaScript-dependent content loading.
 */
export class IOSESpider extends BaseSpider {
  private entitySlug: string;
  private cityName: string;
  private browser?: Fetcher;
  private ioseConfig: IOSEConfig;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as IOSEConfig;
    this.ioseConfig = platformConfig;
    this.entitySlug = platformConfig.entitySlug;
    this.cityName = platformConfig.cityName;

    logger.info(
      `Initializing IOSESpider for ${this.cityName} (${this.entitySlug})`,
    );
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  private buildUrl(): string {
    return `https://iose.se.gov.br/${this.entitySlug}/`;
  }

  async crawl(): Promise<Gazette[]> {
    const url = this.buildUrl();

    logger.info(`Starting IOSE crawl for ${this.cityName}`, {
      url,
      dateRange: {
        start: this.startDate.toISOString(),
        end: this.endDate.toISOString(),
      },
    });

    // IOSE always requires browser rendering
    if (this.browser) {
      return this.crawlWithBrowser(url);
    }

    logger.error(
      "IOSE spider requires browser binding but none is available. Configure BROWSER binding in wrangler.jsonc.",
    );
    return [];
  }

  /**
   * Crawl using Puppeteer browser (client-side rendering)
   */
  private async crawlWithBrowser(url: string): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();

      // Set a reasonable viewport
      await page.setViewport({ width: 1280, height: 800 });

      // Navigate to the diario page
      logger.debug(`Navigating to: ${url}`);
      await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });

      // Wait for page content to load
      await this.waitForPageLoad(page);

      // Iterate through dates in range
      const currentDate = new Date(this.startDate);
      const endDate = new Date(this.endDate);

      while (currentDate <= endDate) {
        const dateStr = this.formatDateBR(currentDate);
        logger.debug(`Checking date: ${dateStr}`);

        // Try to search by date and get editions
        const editions = await this.getEditionsForDate(
          page,
          dateStr,
          currentDate,
        );

        for (const edition of editions) {
          if (this.isInDateRange(edition.date)) {
            gazettes.push(edition);
            logger.info(
              `Found gazette: ${edition.date} - Edition ${edition.editionNumber || "N/A"}`,
            );
          }
        }

        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1);
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes from IOSE for ${this.cityName}`,
      );
    } catch (error) {
      logger.error(`Error crawling IOSE with browser:`, error as Error);
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
   * Wait for the IOSE page to fully load
   */
  private async waitForPageLoad(page: puppeteer.Page): Promise<void> {
    try {
      // Wait for the date search input to be present
      await page.waitForSelector('input[placeholder*="data"]', {
        timeout: 30000,
      });

      // Wait for the editions dropdown
      await page.waitForSelector("select", { timeout: 30000 });

      // Additional wait for any final rendering
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      logger.warn("Timeout waiting for IOSE page load, proceeding anyway");
    }
  }

  /**
   * Get all editions for a specific date
   *
   * The IOSE platform works as follows:
   * 1. Enter a date in the "Selecionar a data" input
   * 2. Click the BUSCAR button next to the date input
   * 3. The page updates to show the edition for that specific date
   * 4. The "Download Edição" link contains the download URL for that edition
   * 5. The "Últimas Edições" dropdown always shows recent editions (NOT filtered by date)
   *
   * IMPORTANT: We must NOT use the dropdown options as they contain ALL recent editions,
   * not just the one for the searched date.
   */
  private async getEditionsForDate(
    page: puppeteer.Page,
    dateStr: string,
    date: Date,
  ): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      // Find and fill the date input (placeholder contains "data")
      await page.evaluate((dateValue: string) => {
        const inputs = document.querySelectorAll("input");
        for (const input of inputs) {
          const placeholder = input.getAttribute("placeholder") || "";
          if (
            placeholder.toLowerCase().includes("data") ||
            placeholder.toLowerCase().includes("selecionar")
          ) {
            input.value = dateValue;
            // Trigger events
            const event = new Event("input", { bubbles: true });
            input.dispatchEvent(event);
            const changeEvent = new Event("change", { bubbles: true });
            input.dispatchEvent(changeEvent);
            break;
          }
        }
      }, dateStr);

      // Click the BUSCAR button that is next to the date input (not the one for name search)
      // The date search button is the first BUSCAR button after the date input
      await page.evaluate(() => {
        const dateInput = Array.from(document.querySelectorAll("input")).find(
          (input) => {
            const placeholder = input.getAttribute("placeholder") || "";
            return (
              placeholder.toLowerCase().includes("data") ||
              placeholder.toLowerCase().includes("selecionar")
            );
          },
        );

        if (dateInput) {
          // Find the parent container and look for the BUSCAR button within it
          let parent = dateInput.parentElement;
          while (parent) {
            const button = parent.querySelector("button");
            if (button && button.textContent?.includes("BUSCAR")) {
              button.click();
              return;
            }
            parent = parent.parentElement;
          }
        }

        // Fallback: click the first BUSCAR button (for date search)
        const buttons = Array.from(document.querySelectorAll("button"));
        const buscarButtons = buttons.filter((b) =>
          b.textContent?.includes("BUSCAR"),
        );
        if (buscarButtons.length > 0) {
          buscarButtons[0].click();
        }
      });

      // Wait for results to load
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Extract edition info from the page header (NOT from the dropdown!)
      // The page shows: "DIÁRIO OFICIAL N º {number}" and the date
      const editionInfo = await page.evaluate(() => {
        // Look for the edition number in the heading
        const headings = document.querySelectorAll("h2, h3");
        let editionNumber = "";
        let displayedDate = "";

        for (const heading of headings) {
          const text = heading.textContent || "";
          // Match "DIÁRIO OFICIAL N º 2.441" or similar
          const editionMatch = text.match(/DIÁRIO OFICIAL\s*N\s*º\s*([\d.]+)/i);
          if (editionMatch) {
            editionNumber = editionMatch[1].replace(/\./g, "");
          }
          // Match date format DD/MM/YYYY
          const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{4})/);
          if (dateMatch) {
            displayedDate = dateMatch[1];
          }
        }

        // Get the download link href
        const downloadLink = document.querySelector(
          'a[href*="download"]',
        ) as HTMLAnchorElement;
        let downloadUrl = "";
        if (downloadLink) {
          downloadUrl = downloadLink.href;
        }

        // Also check for onclick handlers that might contain the download URL
        const allLinks = document.querySelectorAll("a");
        for (const link of allLinks) {
          const text = link.textContent || "";
          if (text.toLowerCase().includes("download")) {
            const onclick = link.getAttribute("onclick") || "";
            const hrefAttr = link.getAttribute("href") || "";

            // Check if href contains the download path
            if (hrefAttr.includes("download") || hrefAttr.includes("edicoes")) {
              downloadUrl = hrefAttr.startsWith("http")
                ? hrefAttr
                : `https://iose.se.gov.br${hrefAttr}`;
            }

            // Check onclick for download function calls
            const downloadMatch = onclick.match(/download[^(]*\(['"]?(\d+)/i);
            if (downloadMatch) {
              // Note: entitySlug will be replaced by the caller
              downloadUrl = `__ENTITY_SLUG_PLACEHOLDER__${downloadMatch[1]}`;
            }
          }
        }

        // Check if there's actually content (edition number should be present)
        const hasContent =
          editionNumber !== "" ||
          displayedDate !== "" ||
          downloadUrl.includes("download");

        return {
          editionNumber,
          displayedDate,
          downloadUrl,
          hasContent,
        };
      });

      // Replace placeholder with actual entitySlug
      if (editionInfo.downloadUrl.includes("__ENTITY_SLUG_PLACEHOLDER__")) {
        editionInfo.downloadUrl = editionInfo.downloadUrl.replace(
          "__ENTITY_SLUG_PLACEHOLDER__",
          `https://iose.se.gov.br/${this.entitySlug}/portal/edicoes/download/`,
        );
      }

      logger.debug(`Edition info for ${dateStr}:`, editionInfo);

      // Only create gazette if we found valid content for this date
      if (!editionInfo.hasContent || !editionInfo.editionNumber) {
        logger.debug(`No gazette found for date ${dateStr}`);
        return gazettes;
      }

      // Verify the displayed date matches the searched date
      if (editionInfo.displayedDate && editionInfo.displayedDate !== dateStr) {
        logger.debug(
          `Date mismatch: searched for ${dateStr}, but page shows ${editionInfo.displayedDate}`,
        );
        return gazettes;
      }

      // Build the download URL if not found directly
      let pdfUrl = editionInfo.downloadUrl;
      if (!pdfUrl || !pdfUrl.includes("download")) {
        // Try to get the edition ID from the selected dropdown option
        const selectedEditionId = await page.evaluate(() => {
          const selects = document.querySelectorAll("select");
          for (const select of selects) {
            if (select.value && select.value !== "Selecione a Edição") {
              return select.value;
            }
          }
          return "";
        });

        if (selectedEditionId) {
          pdfUrl = `https://iose.se.gov.br/${this.entitySlug}/portal/edicoes/download/${selectedEditionId}`;
        }
      }

      if (!pdfUrl || !pdfUrl.includes("download")) {
        logger.debug(`Could not determine download URL for date ${dateStr}`);
        return gazettes;
      }

      const gazette = await this.createGazette(date, pdfUrl, {
        editionNumber: editionInfo.editionNumber,
        isExtraEdition: false,
        power: "executive",
      });

      if (gazette) {
        gazettes.push(gazette);
        logger.info(
          `Found gazette for ${dateStr}: Edition ${editionInfo.editionNumber}`,
        );
      }
    } catch (error) {
      logger.debug(
        `Error getting editions for date ${dateStr}:`,
        error as Error,
      );
    }

    return gazettes;
  }

  /**
   * Format date as DD/MM/YYYY
   */
  private formatDateBR(date: Date): string {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }
}
