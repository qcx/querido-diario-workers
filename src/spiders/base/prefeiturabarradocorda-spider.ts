import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  PrefeiturabarradocordaConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
import { toISODate } from "../../utils/date-utils";

/**
 * Spider for Prefeitura de Barra do Corda - MA
 *
 * Site: dom.barradocorda.ma.gov.br
 *
 * React SPA requiring JavaScript rendering:
 * - Editions listed in dynamic interface
 * - PDF pattern: /uploads/editions/13/{timestamp}_signature.pdf
 * - ISSN: 2764-6572
 */
export class PrefeiturabarradocordaSpider extends BaseSpider {
  protected config: PrefeiturabarradocordaConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeiturabarradocordaConfig;

    if (!this.config.baseUrl) {
      throw new Error(
        `PrefeiturabarradocordaSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeiturabarradocordaSpider for ${spiderConfig.name} with URL: ${this.config.baseUrl}`,
    );
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.config.baseUrl} for ${this.spiderConfig.name}...`,
    );

    if (!this.browser) {
      logger.warn("Browser not available for React SPA site, crawl may fail");
      return [];
    }

    return this.crawlWithBrowser();
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

      // Wait for React app to render
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Wait for edition list to appear
      await page
        .waitForSelector(
          '[class*="edition"], [class*="card"], a[href*=".pdf"]',
          {
            timeout: 15000,
          },
        )
        .catch(() => {
          logger.debug(
            "No edition elements found, page might need more time to load...",
          );
        });

      // Extract gazette data from rendered page
      const pageGazettes = await page.evaluate(() => {
        const items: Array<{
          href: string;
          dateText: string;
          editionNumber: string | undefined;
        }> = [];

        // Try to find PDF links
        const pdfLinks = document.querySelectorAll('a[href*=".pdf"]');

        for (const link of pdfLinks) {
          const href = link.getAttribute("href");
          if (!href) continue;

          // Get text from link or parent
          let dateText = "";
          let parent = link.parentElement;
          for (let i = 0; i < 5 && parent; i++) {
            const text = parent.textContent || "";
            // Look for date pattern DD/MM/YYYY
            const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (dateMatch) {
              dateText = dateMatch[0];
              break;
            }
            parent = parent.parentElement;
          }

          // Try to get edition number
          let editionNumber: string | undefined;
          const parentText = link.parentElement?.textContent || "";
          const editionMatch = parentText.match(
            /Edi[çc][ãa]o\s*(?:n[°º.]?\s*)?(\d+)/i,
          );
          if (editionMatch) {
            editionNumber = editionMatch[1];
          }

          items.push({ href, dateText, editionNumber });
        }

        // Also look for edition cards that might contain links
        const editionCards = document.querySelectorAll(
          '[class*="edition"], [class*="card"], [class*="item"]',
        );

        for (const card of editionCards) {
          const link = card.querySelector('a[href*=".pdf"]');
          const href = link?.getAttribute("href");
          if (!href || items.some((i) => i.href === href)) continue;

          const cardText = card.textContent || "";
          const dateMatch = cardText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          const editionMatch = cardText.match(
            /Edi[çc][ãa]o\s*(?:n[°º.]?\s*)?(\d+)/i,
          );

          items.push({
            href,
            dateText: dateMatch ? dateMatch[0] : "",
            editionNumber: editionMatch ? editionMatch[1] : undefined,
          });
        }

        return items;
      });

      const baseUrl = new URL(this.config.baseUrl);

      for (const item of pageGazettes) {
        let date: string | null = null;

        // Try to extract date from dateText
        if (item.dateText) {
          const dateMatch = item.dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (dateMatch) {
            const [, day, month, year] = dateMatch;
            date = `${year}-${month}-${day}`;
          }
        }

        // Try to extract date from URL timestamp
        if (!date) {
          // Pattern: /uploads/editions/13/{timestamp}_signature.pdf
          const timestampMatch = item.href.match(/\/(\d{10,13})_/);
          if (timestampMatch) {
            const timestamp = parseInt(timestampMatch[1]);
            // If timestamp is in seconds (10 digits), convert to milliseconds
            const ms = timestamp > 9999999999 ? timestamp : timestamp * 1000;
            const dateObj = new Date(ms);
            date = toISODate(dateObj);
          }
        }

        if (!date) continue;

        if (!this.isInDateRange(new Date(date))) continue;

        const fullUrl = item.href.startsWith("http")
          ? item.href
          : `${baseUrl.origin}${item.href.startsWith("/") ? "" : "/"}${item.href}`;

        gazettes.push({
          date,
          fileUrl: fullUrl,
          territoryId: this.spiderConfig.territoryId,
          editionNumber: item.editionNumber,
          power: "executive",
          scrapedAt: new Date().toISOString(),
          requiresClientRendering: true,
        });
      }

      await browserInstance.close();

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
      );
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
      throw error;
    }

    return gazettes;
  }
}
