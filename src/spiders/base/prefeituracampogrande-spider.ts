import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeituraCampoGrandeConfig,
} from "../../types";
import { logger } from "../../utils/logger";
import { toISODate } from "../../utils/date-utils";
// @ts-ignore
import { parse } from "node-html-parser";

/**
 * Prefeitura Campo Grande MS - Diogrande
 *
 * URL: https://diogrande.campogrande.ms.gov.br
 * Estrutura: WordPress com "EDIÇÕES POR MÊS", "ÚLTIMAS EDIÇÕES", "Busca Avançada".
 * Lista de edições/PDFs é carregada via JavaScript (requiresClientRendering).
 */
export class PrefeituraCampoGrandeSpider extends BaseSpider {
  private readonly config: PrefeituraCampoGrandeConfig;
  private readonly baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeituraCampoGrandeConfig;
    this.baseUrl = (this.config.baseUrl || "").replace(/\/$/, "");

    logger.info(
      `Initializing PrefeituraCampoGrandeSpider for ${spiderConfig.name}`,
    );
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    if (this.browser && this.config.requiresClientRendering === true) {
      return this.crawlWithBrowser();
    }
    return this.crawlWithFetch();
  }

  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();

      await page.setViewport({ width: 1280, height: 800 });
      await page.goto(this.baseUrl, {
        waitUntil: "networkidle0",
        timeout: 30000,
      });
      this.requestCount++;

      await page
        .waitForSelector('a[href*=".pdf"]', { timeout: 10000 })
        .catch(() => {
          logger.debug(
            "PrefeituraCampoGrande: no PDF links found immediately, continuing...",
          );
        });

      await new Promise((r) => setTimeout(r, 2000));

      const startStr = toISODate(this.startDate);
      const endStr = toISODate(this.endDate);

      const items = await page.evaluate((baseUrl: string) => {
        const results: { href: string; isoDate: string | null }[] = [];
        const pdfLinks = document.querySelectorAll('a[href*=".pdf"]');

        for (const link of Array.from(pdfLinks)) {
          const href = (link as HTMLAnchorElement).getAttribute("href");
          if (!href || !href.includes(".pdf")) continue;

          const fullUrl = href.startsWith("http")
            ? href
            : href.startsWith("/")
              ? new URL(href, baseUrl).href
              : `${baseUrl}/${href}`;

          let isoDate: string | null = null;
          let parent = link.parentElement;
          for (let i = 0; i < 5 && parent; i++) {
            const parentText = parent.textContent || "";
            const dateMatch = parentText.match(
              /(\d{2})[\/\-](\d{2})[\/\-](\d{4})|(\d{4})[\/\-](\d{2})[\/\-](\d{2})/,
            );
            if (dateMatch) {
              if (dateMatch[4]) {
                isoDate = `${dateMatch[4]}-${dateMatch[5]}-${dateMatch[6]}`;
              } else {
                isoDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
              }
              break;
            }
            parent = parent.parentElement;
          }

          results.push({ href: fullUrl, isoDate });
        }
        return results;
      }, this.baseUrl);

      for (const item of items) {
        if (!item.isoDate || item.isoDate < startStr || item.isoDate > endStr)
          continue;
        gazettes.push({
          date: item.isoDate,
          fileUrl: item.href,
          territoryId: this.spiderConfig.territoryId,
          scrapedAt: new Date().toISOString(),
          power: "executive",
        });
      }

      logger.info(
        `PrefeituraCampoGrandeSpider found ${gazettes.length} gazettes (browser)`,
      );
    } catch (error) {
      logger.error(`Error crawling Campo Grande with browser:`, error as Error);
    } finally {
      if (page) await page.close().catch(() => {});
      if (browserInstance) await browserInstance.close().catch(() => {});
    }

    return gazettes;
  }

  private async crawlWithFetch(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      const html = await this.fetch(this.baseUrl);
      const root = parse(html);

      const pdfLinks = root.querySelectorAll(
        'a[href*=".pdf"], a[href*="wp-content/uploads"]',
      );
      const startStr = toISODate(this.startDate);
      const endStr = toISODate(this.endDate);

      for (const link of pdfLinks) {
        const href = link.getAttribute("href");
        if (!href || !href.includes(".pdf")) continue;

        const fullUrl = href.startsWith("http")
          ? href
          : href.startsWith("/")
            ? new URL(href, this.baseUrl).href
            : `${this.baseUrl}/${href}`;

        const parentText = link.parentNode?.toString() || "";
        const dateMatch = parentText.match(
          /(\d{2})[\/\-](\d{2})[\/\-](\d{4})|(\d{4})[\/\-](\d{2})[\/\-](\d{2})/,
        );
        let isoDate: string | null = null;
        if (dateMatch) {
          if (dateMatch[4])
            isoDate = `${dateMatch[4]}-${dateMatch[5]}-${dateMatch[6]}`;
          else isoDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
        }
        if (!isoDate || isoDate < startStr || isoDate > endStr) continue;

        gazettes.push({
          date: isoDate,
          fileUrl: fullUrl,
          territoryId: this.spiderConfig.territoryId,
          scrapedAt: new Date().toISOString(),
          power: "executive",
        });
      }

      logger.info(
        `PrefeituraCampoGrandeSpider found ${gazettes.length} gazettes`,
      );
    } catch (error) {
      logger.error(`Error crawling Campo Grande:`, error as Error);
    }

    return gazettes;
  }
}
