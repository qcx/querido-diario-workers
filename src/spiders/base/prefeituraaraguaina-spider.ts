import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse } from "node-html-parser";

/**
 * Configuration for Prefeitura de Araguaína spider
 */
export interface PrefeituraaraguainaConfig {
  type: "prefeituraaraguaina";
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/**
 * Spider for Diário Oficial de Araguaína - TO
 *
 * URL: https://diariooficial.araguaina.to.gov.br/diario-oficial
 *
 * This site uses a modern interface with calendar navigation and search filters.
 * It may require browser rendering for full functionality.
 *
 * Features:
 * - Search by content, edition number, date range
 * - Calendar navigation
 * - PDF downloads
 */
export class PrefeituraaraguainaSpider extends BaseSpider {
  protected config: PrefeituraaraguainaConfig;
  private browser: Fetcher | null = null;

  constructor(
    spiderConfig: SpiderConfig,
    dateRange: DateRange,
    browser?: Fetcher,
  ) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeituraaraguainaConfig;
    this.browser = browser || null;

    if (!this.config.baseUrl) {
      throw new Error(
        `PrefeituraaraguainaSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeituraaraguainaSpider for ${spiderConfig.name} with URL: ${this.config.baseUrl}`,
    );
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    // Try browser-based crawling if available and required
    if (this.browser && this.config.requiresClientRendering === true) {
      return this.crawlWithBrowser();
    }

    // Use HTTP-based crawling
    return this.crawlWithFetch();
  }

  /**
   * Browser-based crawling
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();

      // Navigate to the diário oficial page
      const url = `${this.config.baseUrl}/diario-oficial`;
      logger.debug(`Navigating to: ${url}`);
      await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
      this.requestCount++;

      // Wait for page to load
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Set date filters if available
      const startDate = new Date(this.dateRange.start);
      const endDate = new Date(this.dateRange.end);

      // Try to fill date inputs
      try {
        const startInput = await page.$(
          'input[name*="inicio"], input[name*="start"]',
        );
        const endInput = await page.$('input[name*="fim"], input[name*="end"]');

        if (startInput) {
          const startStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-${String(startDate.getDate()).padStart(2, "0")}`;
          await startInput.type(startStr);
        }

        if (endInput) {
          const endStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
          await endInput.type(endStr);
        }

        // Click search button
        const searchButton = await page.$(
          'button[type="submit"], button:has-text("Pesquisar")',
        );
        if (searchButton) {
          await searchButton.click();
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } catch (error) {
        logger.warn(`Could not set date filters: ${error}`);
      }

      // Extract gazette information
      const gazetteData = await page.evaluate(() => {
        const results: {
          editionNumber?: string;
          date?: string;
          pdfUrl?: string;
          title?: string;
        }[] = [];

        // Look for edition cards/rows
        const cards = document.querySelectorAll(
          '[class*="edition"], [class*="diario"], [class*="card"], tr, li',
        );

        for (const card of Array.from(cards)) {
          const text = card.textContent || "";

          // Check if this looks like a gazette entry
          if (!text.match(/[Ee]di[çc][ãa]o|[Dd]i[áa]rio/i)) continue;

          // Extract edition number
          const editionMatch = text.match(
            /[Ee]di[çc][ãa]o\s+[nN]?[°º]?\s*(\d+)/i,
          );
          const editionNumber = editionMatch ? editionMatch[1] : undefined;

          // Extract date
          const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          const date = dateMatch
            ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
            : undefined;

          // Find PDF link
          const pdfLink = card.querySelector(
            'a[href*=".pdf"], a[href*="download"], a[href*="visualizar"]',
          );
          const pdfUrl = pdfLink?.getAttribute("href") || undefined;

          if (date || pdfUrl) {
            results.push({
              editionNumber,
              date,
              pdfUrl,
              title: text.substring(0, 200),
            });
          }
        }

        return results;
      });

      // Process extracted data
      for (const data of gazetteData) {
        if (!data.date || !data.pdfUrl) continue;

        const gazetteDate = new Date(data.date);
        if (!this.isInDateRange(gazetteDate)) continue;

        let pdfUrl = data.pdfUrl;
        if (!pdfUrl.startsWith("http")) {
          pdfUrl = `${this.config.baseUrl}${pdfUrl.startsWith("/") ? "" : "/"}${pdfUrl}`;
        }

        const gazette = await this.createGazette(gazetteDate, pdfUrl, {
          editionNumber: data.editionNumber,
          isExtraEdition: data.title?.toLowerCase().includes("extra") || false,
          power: "executive_legislative",
          sourceText: data.title,
        });

        if (gazette) {
          gazettes.push(gazette);
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes from browser`,
      );
    } catch (error) {
      logger.error(`Error crawling with browser:`, error as Error);
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (e) {
          logger.warn("Error closing page");
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (e) {
          logger.warn("Error closing browser");
        }
      }
    }

    return gazettes;
  }

  /**
   * HTTP-based crawling
   */
  private async crawlWithFetch(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      // Try to access the API or main page
      const url = `${this.config.baseUrl}/diario-oficial`;
      const html = await this.fetch(url);
      const root = parse(html);

      // Look for gazette entries
      const entries = root.querySelectorAll(
        '[class*="edition"], [class*="diario"], a[href*=".pdf"]',
      );

      for (const entry of entries) {
        const text = entry.text?.trim() || "";
        const href = entry.getAttribute("href");

        // Extract date
        const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (!dateMatch && !href) continue;

        let gazetteDate: Date | null = null;
        if (dateMatch) {
          const [, day, month, year] = dateMatch;
          gazetteDate = new Date(`${year}-${month}-${day}`);
        }

        if (!gazetteDate || !this.isInDateRange(gazetteDate)) continue;

        // Get PDF URL
        let pdfUrl = href || "";
        if (!pdfUrl) {
          const pdfLink = entry.querySelector(
            'a[href*=".pdf"], a[href*="download"]',
          );
          pdfUrl = pdfLink?.getAttribute("href") || "";
        }

        if (!pdfUrl) continue;

        if (!pdfUrl.startsWith("http")) {
          pdfUrl = `${this.config.baseUrl}${pdfUrl.startsWith("/") ? "" : "/"}${pdfUrl}`;
        }

        // Extract edition number
        const editionMatch = text.match(
          /[Ee]di[çc][ãa]o\s+[nN]?[°º]?\s*(\d+)/i,
        );
        const editionNumber = editionMatch ? editionMatch[1] : undefined;

        const gazette = await this.createGazette(gazetteDate, pdfUrl, {
          editionNumber,
          isExtraEdition: text.toLowerCase().includes("extra"),
          power: "executive_legislative",
          sourceText: text.substring(0, 200),
        });

        if (gazette) {
          gazettes.push(gazette);
        }
      }
    } catch (error) {
      logger.error(`Error crawling with fetch:`, error as Error);
    }

    return gazettes;
  }
}
