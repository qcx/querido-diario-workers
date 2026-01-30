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

    // Try browser rendering first if available, otherwise fallback to HTTP
    if (this.browser) {
      return this.crawlWithBrowser(url);
    }

    // Fallback to HTTP-based crawling (works without browser)
    logger.info("Browser not available, using HTTP fallback for 3Tecnos");
    return this.crawlWithHttp(url);
  }

  /**
   * Crawl using HTTP requests (fallback when browser is not available)
   * This method uses ASP.NET ViewState and postbacks to fetch gazette data
   */
  private async crawlWithHttp(url: string): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      // Fetch initial page to get ViewState
      logger.debug(`Fetching initial page: ${url}`);
      const initialHtml = await this.fetch(url);
      const $ = this.loadHTML(initialHtml);

      // Extract ASP.NET form fields
      const viewState = $('input[name="__VIEWSTATE"]').val() as string;
      const viewStateGenerator = $(
        'input[name="__VIEWSTATEGENERATOR"]',
      ).val() as string;
      const eventValidation = $(
        'input[name="__EVENTVALIDATION"]',
      ).val() as string;

      if (!viewState) {
        logger.warn("Could not extract ViewState from initial page");
        return gazettes;
      }

      // Get the current date shown on the page
      const currentDateStr = $(
        'input[name="ctl00$body$txtDataEdicao"]',
      ).val() as string;
      logger.debug(`Current date on page: ${currentDateStr}`);

      // Extract editions from the dropdown on the initial page
      const $select = $('select[name="ctl00$body$ddlEdicao"]');
      if ($select.length > 0) {
        const options = $select.find("option").toArray();
        for (const option of options) {
          const $option = $(option);
          const value = $option.val() as string;
          const text = $option.text().trim();

          if (value && value !== "") {
            // Extract edition number (e.g., "1974/2026")
            const match = text.match(/(\d+)\/(\d+)/);
            const editionNumber = match ? `${match[1]}/${match[2]}` : text;

            // The value is the Google Drive file ID
            const fileId = value.replace(".pdf", "");

            if (fileId) {
              // Parse the date from the page
              const dateMatch = currentDateStr?.match(
                /(\d{2})\/(\d{2})\/(\d{4})/,
              );
              if (dateMatch) {
                const day = parseInt(dateMatch[1]);
                const month = parseInt(dateMatch[2]) - 1;
                const year = parseInt(dateMatch[3]);
                const gazetteDate = new Date(year, month, day);

                if (this.isInDateRange(gazetteDate)) {
                  // Use direct Google Drive download URL - don't follow redirects
                  const pdfUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

                  const gazette = await this.createGazette(
                    gazetteDate,
                    pdfUrl,
                    {
                      editionNumber,
                      isExtraEdition: false,
                      power: "executive",
                      skipUrlResolution: true, // Don't resolve Google Drive URLs
                    },
                  );

                  if (gazette) {
                    gazettes.push(gazette);
                    logger.info(
                      `Found gazette: ${gazetteDate.toISOString().split("T")[0]} - Edition ${editionNumber}`,
                    );
                  }
                }
              }
            }
          }
        }
      }

      // For date range crawling, we need to iterate through dates
      // This requires making POST requests with different dates
      const currentDate = new Date(this.startDate);
      const endDate = new Date(this.endDate);
      const processedDates = new Set<string>();

      // Mark the initial date as processed
      if (currentDateStr) {
        processedDates.add(currentDateStr);
      }

      while (currentDate <= endDate) {
        const dateStr = this.formatDateBR(currentDate);

        // Skip if already processed
        if (processedDates.has(dateStr)) {
          currentDate.setDate(currentDate.getDate() + 1);
          continue;
        }
        processedDates.add(dateStr);

        try {
          // Make POST request to change the date
          const formData = new URLSearchParams();
          formData.append("__EVENTTARGET", "");
          formData.append("__EVENTARGUMENT", "");
          formData.append("__VIEWSTATE", viewState);
          if (viewStateGenerator) {
            formData.append("__VIEWSTATEGENERATOR", viewStateGenerator);
          }
          if (eventValidation) {
            formData.append("__EVENTVALIDATION", eventValidation);
          }
          formData.append("ctl00$body$rbPesquisa", "rbPesquisaData");
          formData.append("ctl00$body$txtDataEdicao", dateStr);
          formData.append("ctl00$body$ddlTipoPublicacao", "");
          formData.append("ctl00$body$txtPesquisa", "");
          formData.append("ctl00$body$txtDtPeriodo", "");

          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formData.toString(),
          });

          if (!response.ok) {
            logger.debug(`Failed to fetch date ${dateStr}: ${response.status}`);
            currentDate.setDate(currentDate.getDate() + 1);
            continue;
          }

          const html = await response.text();
          const $page = this.loadHTML(html);

          // Extract editions from the dropdown
          const $selectPage = $page('select[name="ctl00$body$ddlEdicao"]');
          if ($selectPage.length > 0) {
            const pageOptions = $selectPage.find("option").toArray();
            for (const option of pageOptions) {
              const $option = $page(option);
              const value = $option.val() as string;
              const text = $option.text().trim();

              if (value && value !== "") {
                const match = text.match(/(\d+)\/(\d+)/);
                const editionNumber = match ? `${match[1]}/${match[2]}` : text;
                const fileId = value.replace(".pdf", "");

                if (fileId && this.isInDateRange(currentDate)) {
                  // Use direct Google Drive download URL - don't follow redirects
                  const pdfUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

                  const gazette = await this.createGazette(
                    new Date(currentDate),
                    pdfUrl,
                    {
                      editionNumber,
                      isExtraEdition: false,
                      power: "executive",
                      skipUrlResolution: true, // Don't resolve Google Drive URLs
                    },
                  );

                  if (gazette) {
                    gazettes.push(gazette);
                    logger.info(
                      `Found gazette: ${currentDate.toISOString().split("T")[0]} - Edition ${editionNumber}`,
                    );
                  }
                }
              }
            }
          }

          // Add delay between requests
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (error) {
          logger.debug(`Error fetching date ${dateStr}:`, error as Error);
        }

        currentDate.setDate(currentDate.getDate() + 1);
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes from 3Tecnos (HTTP) for ${this.urlCity}/${this.urlUf}`,
      );
    } catch (error) {
      logger.error(`Error crawling 3Tecnos with HTTP:`, error as Error);
    }

    return gazettes;
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

      // Wait for main content elements - try multiple selectors for compatibility
      // New format: ctl00$body$txtDataEdicao, Old format: txtDtPesquisa
      await page.waitForFunction(
        () => {
          return (
            document.querySelector('input[name="ctl00$body$txtDataEdicao"]') ||
            document.querySelector('input[id="body_txtDataEdicao"]') ||
            document.querySelector('input[name="txtDtPesquisa"]')
          );
        },
        { timeout: 30000 },
      );

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
      // Fill the date input - try multiple selectors for compatibility
      await page.evaluate((dateValue: string) => {
        // Try new format first (ctl00$body$txtDataEdicao), then old format (txtDtPesquisa)
        const input = (document.querySelector(
          'input[name="ctl00$body$txtDataEdicao"]',
        ) ||
          document.querySelector('input[id="body_txtDataEdicao"]') ||
          document.querySelector(
            'input[name="txtDtPesquisa"]',
          )) as HTMLInputElement;

        if (input) {
          input.value = dateValue;
          // Trigger events for both Angular and ASP.NET
          const event = new Event("input", { bubbles: true });
          input.dispatchEvent(event);
          const changeEvent = new Event("change", { bubbles: true });
          input.dispatchEvent(changeEvent);
          // Also trigger blur for ASP.NET postback
          const blurEvent = new Event("blur", { bubbles: true });
          input.dispatchEvent(blurEvent);
        }
      }, dateStr);

      // Wait for editions to load (ASP.NET postback)
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Extract edition info from the dropdown - try multiple selectors
      const editionData = await page.evaluate(() => {
        // Try new format first (ctl00$body$ddlEdicao), then old format (ddlEdicaoData)
        const select = (document.querySelector(
          'select[name="ctl00$body$ddlEdicao"]',
        ) ||
          document.querySelector('select[id="body_ddlEdicao"]') ||
          document.querySelector(
            'select[name="ddlEdicaoData"]',
          )) as HTMLSelectElement;

        if (!select) return [];

        const options: Array<{ editionNumber: string; fileId: string }> = [];
        for (const option of select.options) {
          if (option.value && option.value !== "") {
            // Extract edition number from text (e.g., "1974/2026")
            const match = option.text.match(/(\d+)\/(\d+)/);
            const editionNumber = match
              ? `${match[1]}/${match[2]}`
              : option.text;

            // The value is the Google Drive file ID (e.g., "15coNQ-le1CjiYFkUvuSiAnqYSXvQxw7u.pdf")
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
