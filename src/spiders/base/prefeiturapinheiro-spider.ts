import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  PrefeiturapinheiroConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse } from "node-html-parser";
import { toISODate } from "../../utils/date-utils";

/**
 * Spider for Prefeitura de Pinheiro - MA
 *
 * Site: diariooficial.pinheiro.ma.gov.br
 *
 * WordPress (WebAtiva) with:
 * - Edition listing with signed PDFs
 * - Dropdown for edition selection
 * - AJAX loading for dynamic content
 *
 * PDF pattern: /wp-content/uploads/YYYY/MM/diario-oficial-YYYY-MM-DD-assinado.pdf
 */
export class PrefeiturapinheiroSpider extends BaseSpider {
  protected config: PrefeiturapinheiroConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeiturapinheiroConfig;

    if (!this.config.baseUrl) {
      throw new Error(
        `PrefeiturapinheiroSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeiturapinheiroSpider for ${spiderConfig.name} with URL: ${this.config.baseUrl}`,
    );
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.config.baseUrl} for ${this.spiderConfig.name}...`,
    );

    // This site requires browser rendering due to AJAX content
    if (this.browser && this.config.requiresClientRendering) {
      return this.crawlWithBrowser();
    }

    // Fallback to direct fetch
    return this.crawlWithFetch();
  }

  /**
   * Crawl using Puppeteer browser
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      // @ts-expect-error - Cloudflare Puppeteer has different API
      const browserInstance = await puppeteer.launch(this.browser);
      const page = await browserInstance.newPage();

      await page.setViewport({ width: 1280, height: 800 });

      await page.goto(this.config.baseUrl, {
        waitUntil: "networkidle0",
        timeout: 30000,
      });

      // Wait for content to load
      await page
        .waitForSelector('a[href*=".pdf"]', { timeout: 10000 })
        .catch(() => {
          logger.debug(
            "No PDF links found immediately, page might be loading...",
          );
        });

      // Extract gazette data
      const pageGazettes = await page.evaluate(() => {
        const items: Array<{
          href: string;
          text: string;
          dateText: string;
        }> = [];

        const pdfLinks = document.querySelectorAll('a[href*=".pdf"]');

        for (const link of pdfLinks) {
          const href = link.getAttribute("href");
          if (!href) continue;

          const text = link.textContent?.trim() || "";

          // Try to find date in parent container
          let dateText = "";
          let parent = link.parentElement;
          for (let i = 0; i < 5 && parent; i++) {
            const parentText = parent.textContent || "";
            const dateMatch = parentText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (dateMatch) {
              dateText = dateMatch[0];
              break;
            }
            parent = parent.parentElement;
          }

          items.push({ href, text, dateText });
        }

        return items;
      });

      const baseUrl = new URL(this.config.baseUrl);

      for (const item of pageGazettes) {
        const gazette = this.parseGazetteItem(item, baseUrl.origin);
        if (gazette && this.isInDateRange(new Date(gazette.date))) {
          gazettes.push(gazette);
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
   * Crawl using direct HTTP fetch (fallback)
   */
  private async crawlWithFetch(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      const response = await fetch(this.config.baseUrl, {
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
          `Failed to fetch page: ${response.status} ${response.statusText}`,
        );
        return gazettes;
      }

      const html = await response.text();
      const root = parse(html);
      const baseUrl = new URL(this.config.baseUrl);

      // Find PDF links
      const pdfLinks = root.querySelectorAll('a[href*=".pdf"]');

      for (const link of pdfLinks) {
        const href = link.getAttribute("href");
        if (!href) continue;

        const text = link.text?.trim() || "";
        const parentText = link.parentNode?.text || "";

        const gazette = this.parseGazetteItem(
          { href, text, dateText: parentText },
          baseUrl.origin,
        );

        if (gazette && this.isInDateRange(new Date(gazette.date))) {
          gazettes.push(gazette);
        }
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
   * Parse a gazette item from extracted data
   */
  private parseGazetteItem(
    item: { href: string; text: string; dateText: string },
    origin: string,
  ): Gazette | null {
    try {
      let date: string | null = null;

      // Try to extract date from URL
      // Pattern: diario-oficial-YYYY-MM-DD-assinado.pdf
      const urlDateMatch = item.href.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (urlDateMatch) {
        date = urlDateMatch[0];
      }

      // Try to extract from dateText
      if (!date && item.dateText) {
        const dateMatch = item.dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (dateMatch) {
          const [, day, month, year] = dateMatch;
          date = `${year}-${month}-${day}`;
        }
      }

      // Try to extract from text
      if (!date && item.text) {
        const dateMatch = item.text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (dateMatch) {
          const [, day, month, year] = dateMatch;
          date = `${year}-${month}-${day}`;
        }
      }

      if (!date) return null;

      // Extract edition number if present
      const editionMatch =
        item.text.match(/Edi[çc][ãa]o\s*(?:n[°º.]?\s*)?(\d+)/i) ||
        item.href.match(/edicao[_-]?(\d+)/i);
      const editionNumber = editionMatch ? editionMatch[1] : undefined;

      const fullUrl = item.href.startsWith("http")
        ? item.href
        : `${origin}${item.href.startsWith("/") ? "" : "/"}${item.href}`;

      return {
        date,
        fileUrl: fullUrl,
        territoryId: this.spiderConfig.territoryId,
        editionNumber,
        power: "executive",
        scrapedAt: new Date().toISOString(),
        requiresClientRendering: this.config.requiresClientRendering,
      };
    } catch (error) {
      logger.debug(`Error parsing gazette item: ${error}`);
      return null;
    }
  }
}
