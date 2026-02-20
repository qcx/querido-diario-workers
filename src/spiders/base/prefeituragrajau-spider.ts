import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  PrefeituragrajauConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
import { toISODate } from "../../utils/date-utils";

/**
 * Spider for Prefeitura de Grajaú - MA
 *
 * Site: grajau.ma.gov.br/diario-oficial
 *
 * Workcenter SPA requiring JavaScript rendering
 */
export class PrefeituragrajauSpider extends BaseSpider {
  protected config: PrefeituragrajauConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeituragrajauConfig;

    if (!this.config.baseUrl) {
      throw new Error(
        `PrefeituragrajauSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeituragrajauSpider for ${spiderConfig.name} with URL: ${this.config.baseUrl}`,
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
      logger.warn("Browser not available for SPA site, crawl may fail");
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

      // Wait for page content to load
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Wait for content elements
      await page
        .waitForSelector(
          'a[href*=".pdf"], [class*="publicacao"], [class*="diario"]',
          {
            timeout: 15000,
          },
        )
        .catch(() => {
          logger.debug("No content elements found immediately...");
        });

      // Extract gazette data
      const pageGazettes = await page.evaluate(() => {
        const items: Array<{
          href: string;
          dateText: string;
          editionNumber: string | undefined;
        }> = [];

        // Find PDF links
        const pdfLinks = document.querySelectorAll('a[href*=".pdf"]');

        for (const link of pdfLinks) {
          const href = link.getAttribute("href");
          if (!href) continue;

          // Get date from context
          let dateText = "";
          let parent = link.parentElement;
          for (let i = 0; i < 5 && parent; i++) {
            const text = parent.textContent || "";
            const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (dateMatch) {
              dateText = dateMatch[0];
              break;
            }
            parent = parent.parentElement;
          }

          // Get edition number
          let editionNumber: string | undefined;
          const contextText =
            link.closest('[class*="item"], [class*="card"], tr, li')
              ?.textContent || "";
          const editionMatch = contextText.match(
            /Edi[çc][ãa]o\s*(?:n[°º.]?\s*)?(\d+)/i,
          );
          if (editionMatch) {
            editionNumber = editionMatch[1];
          }

          items.push({ href, dateText, editionNumber });
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

        // Try URL date patterns
        if (!date) {
          const urlDateMatch =
            item.href.match(/(\d{4})-(\d{2})-(\d{2})/) ||
            item.href.match(/(\d{4})(\d{2})(\d{2})/);
          if (urlDateMatch) {
            date = `${urlDateMatch[1]}-${urlDateMatch[2]}-${urlDateMatch[3]}`;
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
