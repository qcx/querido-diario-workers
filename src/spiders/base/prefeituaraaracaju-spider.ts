import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  PrefeituraAracajuConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
import puppeteer from "@cloudflare/puppeteer";

/**
 * Spider for Prefeitura de Aracaju (Capital de Sergipe) official gazette
 *
 * This is a legacy JSP system that requires browser rendering and session management.
 * URL: http://sga.aracaju.se.gov.br:5011/legislacao/faces/diario_form_pesq.jsp
 *
 * Features:
 * - Form-based search with radio buttons (Número or Mês/Ano)
 * - Month and year dropdowns
 * - Session-based navigation
 * - PDF download links
 *
 * NOTE: This platform REQUIRES client-side rendering (browser mode) to work properly
 * due to legacy JSP session requirements.
 */
export class PrefeituraAracajuSpider extends BaseSpider {
  private baseUrl: string;
  private cityName: string;
  private browser?: Fetcher;
  private aracajuConfig: PrefeituraAracajuConfig;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraAracajuConfig;
    this.aracajuConfig = platformConfig;
    this.baseUrl =
      platformConfig.baseUrl ||
      "http://sga.aracaju.se.gov.br:5011/legislacao/faces/diario_form_pesq.jsp";
    this.cityName = platformConfig.cityName || "Aracaju";

    logger.info(`Initializing PrefeituraAracajuSpider for ${this.cityName}`);
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Starting Aracaju crawl`, {
      url: this.baseUrl,
      dateRange: {
        start: this.startDate.toISOString(),
        end: this.endDate.toISOString(),
      },
    });

    // Aracaju JSP always requires browser rendering
    if (this.browser) {
      return this.crawlWithBrowser();
    }

    logger.error(
      "Aracaju spider requires browser binding but none is available. Configure BROWSER binding in wrangler.jsonc.",
    );
    return [];
  }

  /**
   * Crawl using Puppeteer browser (client-side rendering)
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();

      // Set a reasonable viewport
      await page.setViewport({ width: 1280, height: 800 });

      // Navigate to the search form
      logger.debug(`Navigating to: ${this.baseUrl}`);
      await page.goto(this.baseUrl, {
        waitUntil: "networkidle0",
        timeout: 60000,
      });

      // Wait for page content to load
      await this.waitForPageLoad(page);

      // Get unique months to search within the date range
      const months = this.getMonthsInRange();

      for (const { month, year } of months) {
        logger.debug(`Searching for month/year: ${month}/${year}`);

        try {
          const editionsForMonth = await this.searchByMonthYear(
            page,
            month,
            year,
          );

          for (const edition of editionsForMonth) {
            if (this.isInDateRange(edition.date)) {
              gazettes.push(edition);
              logger.info(
                `Found gazette: ${edition.date} - Edition ${edition.editionNumber || "N/A"}`,
              );
            }
          }
        } catch (error) {
          logger.warn(
            `Error searching month ${month}/${year}:`,
            error as Error,
          );
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes from Aracaju`,
      );
    } catch (error) {
      logger.error(`Error crawling Aracaju with browser:`, error as Error);
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
   * Wait for the Aracaju JSP page to fully load
   */
  private async waitForPageLoad(page: puppeteer.Page): Promise<void> {
    try {
      // Wait for the radio buttons to be present
      await page.waitForSelector('input[type="radio"]', { timeout: 30000 });

      // Wait for the dropdowns
      await page.waitForSelector("select", { timeout: 30000 });

      // Additional wait for any final rendering
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      logger.warn("Timeout waiting for Aracaju page load, proceeding anyway");
    }
  }

  /**
   * Get all months within the date range
   */
  private getMonthsInRange(): Array<{ month: number; year: number }> {
    const months: Array<{ month: number; year: number }> = [];
    const currentDate = new Date(this.startDate);
    const endDate = new Date(this.endDate);

    while (currentDate <= endDate) {
      const month = currentDate.getMonth() + 1;
      const year = currentDate.getFullYear();

      // Check if this month/year combo is already in the list
      const exists = months.some((m) => m.month === month && m.year === year);
      if (!exists) {
        months.push({ month, year });
      }

      // Move to next month
      currentDate.setMonth(currentDate.getMonth() + 1);
    }

    return months;
  }

  /**
   * Search for gazettes by month and year
   */
  private async searchByMonthYear(
    page: puppeteer.Page,
    month: number,
    year: number,
  ): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      // Navigate back to the search form
      await page.goto(this.baseUrl, {
        waitUntil: "networkidle0",
        timeout: 60000,
      });
      await this.waitForPageLoad(page);

      // Select "Mês/Ano" radio button (it's the second radio button)
      await page.evaluate(() => {
        const radios = document.querySelectorAll('input[type="radio"]');
        if (radios.length >= 2) {
          // The second radio is "Mês/Ano"
          (radios[1] as HTMLInputElement).click();
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Select month from dropdown - use the first select (month dropdown)
      const monthPadded = month.toString().padStart(2, "0");
      await page.evaluate((monthValue: string) => {
        const selects = document.querySelectorAll("select");
        if (selects.length >= 1) {
          const monthSelect = selects[0] as HTMLSelectElement;
          // Try to find option by value or text
          for (let i = 0; i < monthSelect.options.length; i++) {
            const opt = monthSelect.options[i];
            if (opt.value === monthValue || opt.text === monthValue) {
              monthSelect.selectedIndex = i;
              const event = new Event("change", { bubbles: true });
              monthSelect.dispatchEvent(event);
              break;
            }
          }
        }
      }, monthPadded);

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Select year from dropdown - use the second select (year dropdown)
      await page.evaluate((yearValue: string) => {
        const selects = document.querySelectorAll("select");
        if (selects.length >= 2) {
          const yearSelect = selects[1] as HTMLSelectElement;
          for (let i = 0; i < yearSelect.options.length; i++) {
            const opt = yearSelect.options[i];
            if (opt.value === yearValue || opt.text === yearValue) {
              yearSelect.selectedIndex = i;
              const event = new Event("change", { bubbles: true });
              yearSelect.dispatchEvent(event);
              break;
            }
          }
        }
      }, year.toString());

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Click the search/submit button
      await page.evaluate(() => {
        const links = document.querySelectorAll("a");
        for (const link of links) {
          if (link.textContent?.toLowerCase().includes("pesquisar")) {
            link.click();
            break;
          }
        }
      });

      // Wait for results to load
      await new Promise((resolve) => setTimeout(resolve, 4000));

      // Extract gazette data from the results page
      // The page shows cards with date, edition number, and download links
      const gazetteData = await page.evaluate(() => {
        const results: Array<{
          url: string;
          date: string;
          editionNumber: string;
        }> = [];

        // Look for "Baixar Regular" links which contain the PDF URLs
        const allLinks = document.querySelectorAll("a");
        for (const link of allLinks) {
          const text = link.textContent?.trim() || "";
          const href = link.getAttribute("href") || "";

          // "Baixar Regular" links contain the actual PDF download
          if (text.toLowerCase().includes("baixar regular") && href) {
            // Try to find the parent card to get date and edition info
            let parent = link.parentElement;
            let dateText = "";
            let editionNumber = "";

            // Walk up the DOM to find date and edition info
            while (parent && !dateText) {
              const parentText = parent.textContent || "";

              // Look for date pattern DD/MM/YYYY
              const dateMatch = parentText.match(/(\d{2}\/\d{2}\/\d{4})/);
              if (dateMatch) {
                dateText = dateMatch[1];
              }

              // Look for edition number after "Número:" text
              const editionMatch = parentText.match(/Número:\s*(\d+)/);
              if (editionMatch) {
                editionNumber = editionMatch[1];
              }

              parent = parent.parentElement;
            }

            if (href) {
              results.push({
                url: href,
                date: dateText,
                editionNumber: editionNumber,
              });
            }
          }
        }

        // Also check for download buttons/images that might have onclick or href
        const images = document.querySelectorAll(
          'img[src*="download"], input[type="image"]',
        );
        for (const img of images) {
          const parent = img.closest("a");
          if (parent) {
            const href = parent.getAttribute("href") || "";
            if (href && !results.some((r) => r.url === href)) {
              // Try to find date from nearby text
              let container = parent.parentElement;
              let dateText = "";
              let editionNumber = "";

              while (container && !dateText) {
                const containerText = container.textContent || "";
                const dateMatch = containerText.match(/(\d{2}\/\d{2}\/\d{4})/);
                if (dateMatch) {
                  dateText = dateMatch[1];
                }
                const editionMatch = containerText.match(/Número:\s*(\d+)/);
                if (editionMatch) {
                  editionNumber = editionMatch[1];
                }
                container = container.parentElement;
              }

              results.push({
                url: href,
                date: dateText,
                editionNumber: editionNumber,
              });
            }
          }
        }

        return results;
      });

      logger.debug(
        `Found ${gazetteData.length} gazette entries for ${month}/${year}`,
      );

      // Process each gazette
      for (const data of gazetteData) {
        let pdfUrl = data.url;

        // Make URL absolute if needed
        if (!pdfUrl.startsWith("http")) {
          const baseUrlObj = new URL(this.baseUrl);
          pdfUrl = `${baseUrlObj.protocol}//${baseUrlObj.host}${pdfUrl.startsWith("/") ? "" : "/"}${pdfUrl}`;
        }

        // Parse the date from DD/MM/YYYY format
        let gazetteDate: Date;
        if (data.date) {
          const [day, monthStr, yearStr] = data.date.split("/");
          gazetteDate = new Date(
            parseInt(yearStr),
            parseInt(monthStr) - 1,
            parseInt(day),
          );
        } else {
          // Fallback to middle of month
          gazetteDate = new Date(year, month - 1, 15);
        }

        const gazette = await this.createGazette(gazetteDate, pdfUrl, {
          editionNumber: data.editionNumber,
          isExtraEdition: false,
          power: "executive",
        });

        if (gazette) {
          gazettes.push(gazette);
        }
      }
    } catch (error) {
      logger.debug(`Error searching for ${month}/${year}:`, error as Error);
    }

    return gazettes;
  }
}
