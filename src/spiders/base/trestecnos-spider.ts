import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig, TresTecnosConfig } from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
import puppeteer from "@cloudflare/puppeteer";

/**
 * Spider for 3Tecnos/MunicipioOnline V2 platform (municipioonline.com.br)
 *
 * This version of MunicipioOnline uses:
 * - AngularJS for dynamic content loading
 * - Google Drive for PDF storage
 * - Date-based selection with edition dropdown
 *
 * The platform stores PDFs in Google Drive and references them by ID.
 * URL pattern: https://www.municipioonline.com.br/{uf}/prefeitura/{city}/cidadao/diariooficial
 *
 * NOTE: This platform REQUIRES client-side rendering (browser mode) to work properly.
 */
export class TresTecnosSpider extends BaseSpider {
  private urlUf: string;
  private urlCity: string;
  private browser?: Fetcher;
  private tresTecnosConfig: TresTecnosConfig;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as TresTecnosConfig;
    this.tresTecnosConfig = platformConfig;
    this.urlUf = platformConfig.urlUf;
    this.urlCity = platformConfig.urlCity;

    logger.info(
      `Initializing TresTecnosSpider for ${this.urlCity}/${this.urlUf}`,
    );
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  private buildUrl(): string {
    return `https://www.municipioonline.com.br/${this.urlUf}/prefeitura/${this.urlCity}/cidadao/diariooficial`;
  }

  async crawl(): Promise<Gazette[]> {
    const url = this.buildUrl();

    logger.info(`Starting 3Tecnos crawl for ${this.urlCity}/${this.urlUf}`, {
      url,
      dateRange: {
        start: this.startDate.toISOString(),
        end: this.endDate.toISOString(),
      },
    });

    // 3Tecnos always requires browser rendering
    if (this.browser) {
      return this.crawlWithBrowser(url);
    }

    logger.error(
      "3Tecnos spider requires browser binding but none is available. Configure BROWSER binding in wrangler.jsonc.",
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

        // Try to set the date and get editions
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
        `Successfully crawled ${gazettes.length} gazettes from 3Tecnos for ${this.urlCity}/${this.urlUf}`,
      );
    } catch (error) {
      logger.error(`Error crawling 3Tecnos with browser:`, error as Error);
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
   * Wait for the 3Tecnos page to fully load
   */
  private async waitForPageLoad(page: puppeteer.Page): Promise<void> {
    try {
      // Wait for loading overlay to disappear
      await page.waitForFunction(
        () => {
          const loader = document.querySelector("#msg");
          if (!loader) return true;
          const style = window.getComputedStyle(loader);
          return style.display === "none" || style.visibility === "hidden";
        },
        { timeout: 30000 },
      );

      // Wait for main content elements
      await page.waitForSelector('input[name="txtDtPesquisa"]', {
        timeout: 30000,
      });

      // Additional wait for any final rendering
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      logger.warn("Timeout waiting for 3Tecnos page load, proceeding anyway");
    }
  }

  /**
   * Get all editions for a specific date
   */
  private async getEditionsForDate(
    page: puppeteer.Page,
    dateStr: string,
    date: Date,
  ): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      // Fill the date input
      await page.evaluate((dateValue: string) => {
        const input = document.querySelector(
          'input[name="txtDtPesquisa"]',
        ) as HTMLInputElement;
        if (input) {
          input.value = dateValue;
          // Trigger angular update
          const event = new Event("input", { bubbles: true });
          input.dispatchEvent(event);
          const changeEvent = new Event("change", { bubbles: true });
          input.dispatchEvent(changeEvent);
        }
      }, dateStr);

      // Wait for editions to load
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Extract edition info from the dropdown
      const editionData = await page.evaluate(() => {
        const select = document.querySelector(
          'select[name="ddlEdicaoData"]',
        ) as HTMLSelectElement;
        if (!select) return [];

        const options: Array<{ editionNumber: string; fileId: string }> = [];
        for (const option of select.options) {
          if (option.value && option.value !== "") {
            // Extract edition number from text (e.g., "118/2026")
            const match = option.text.match(/(\d+)\/\d+/);
            const editionNumber = match ? match[1] : option.text;

            // The value is the Google Drive file ID
            const fileId = option.value.replace(".pdf", "");

            if (fileId) {
              options.push({ editionNumber, fileId });
            }
          }
        }
        return options;
      });

      // Create gazette entries for each edition
      for (const edition of editionData) {
        const pdfUrl = `https://drive.google.com/uc?export=download&id=${edition.fileId}`;

        const gazette = await this.createGazette(date, pdfUrl, {
          editionNumber: edition.editionNumber,
          isExtraEdition: false,
          power: "executive",
        });

        if (gazette) {
          gazettes.push(gazette);
        }
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
