import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeituraAquidauanaConfig,
} from "../../types";
import { logger } from "../../utils/logger";
import { toISODate } from "../../utils/date-utils";
// @ts-ignore
import { parse } from "node-html-parser";

/**
 * Prefeitura Aquidauana MS - Diário Oficial Eletrônico (EDOEM)
 *
 * URL: https://legado.aquidauana.ms.gov.br/edoem
 * Portal próprio com edições; conteúdo carregado via JavaScript (requiresClientRendering).
 */
export class PrefeituraAquidauanaSpider extends BaseSpider {
  private readonly config: PrefeituraAquidauanaConfig;
  private readonly baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeituraAquidauanaConfig;
    this.baseUrl = (this.config.baseUrl || "").replace(/\/$/, "");

    logger.info(
      `Initializing PrefeituraAquidauanaSpider for ${spiderConfig.name}`,
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
    const startStr = toISODate(this.startDate);
    const endStr = toISODate(this.endDate);
    const seenUrls = new Set<string>();

    try {
      // @ts-expect-error - Cloudflare Puppeteer has different API
      const browserInstance = await puppeteer.launch(this.browser!);
      const page = await browserInstance.newPage();

      await page.setViewport({ width: 1280, height: 800 });

      await page.goto(this.baseUrl, {
        waitUntil: "networkidle0",
        timeout: 30000,
      });

      await page
        .waitForSelector('a[href*=".pdf"]', { timeout: 15000 })
        .catch(() => {
          logger.debug(
            "PrefeituraAquidauanaSpider: no PDF links found within timeout",
          );
        });

      await new Promise((r) => setTimeout(r, 2000));

      const items = await page.evaluate((baseUrl: string) => {
        const results: Array<{ href: string; isoDate: string | null }> = [];
        const pdfLinks = document.querySelectorAll('a[href*=".pdf"]');

        for (const link of Array.from(pdfLinks)) {
          const href = (link as HTMLAnchorElement).getAttribute("href");
          if (!href || !href.toLowerCase().includes(".pdf")) continue;

          const fullUrl = href.startsWith("http")
            ? href
            : href.startsWith("/")
              ? new URL(href, baseUrl).href
              : `${baseUrl}/${href}`;

          let isoDate: string | null = null;
          const linkText = (link as HTMLAnchorElement).textContent || "";
          const dateFromLink = linkText.match(
            /(\d{2})[\/\-](\d{2})[\/\-](\d{4})|(\d{4})[\/\-](\d{2})[\/\-](\d{2})/,
          );
          if (dateFromLink) {
            isoDate = dateFromLink[4]
              ? `${dateFromLink[4]}-${dateFromLink[5]}-${dateFromLink[6]}`
              : `${dateFromLink[3]}-${dateFromLink[2]}-${dateFromLink[1]}`;
          }
          if (!isoDate) {
            let parent = link.parentElement;
            for (let i = 0; i < 6 && parent; i++) {
              const parentText = parent.textContent || "";
              const dateMatch = parentText.match(
                /(\d{2})[\/\-](\d{2})[\/\-](\d{4})|(\d{4})[\/\-](\d{2})[\/\-](\d{2})/,
              );
              if (dateMatch) {
                isoDate = dateMatch[4]
                  ? `${dateMatch[4]}-${dateMatch[5]}-${dateMatch[6]}`
                  : `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
                break;
              }
              parent = parent.parentElement;
            }
          }
          if (!isoDate) {
            const urlDate = fullUrl.match(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})/);
            if (urlDate) isoDate = `${urlDate[1]}-${urlDate[2]}-${urlDate[3]}`;
          }

          results.push({ href: fullUrl, isoDate });
        }
        return results;
      }, this.baseUrl);

      for (const item of items) {
        if (seenUrls.has(item.href)) continue;
        if (!item.isoDate || item.isoDate < startStr || item.isoDate > endStr)
          continue;
        seenUrls.add(item.href);
        gazettes.push({
          date: item.isoDate,
          fileUrl: item.href,
          territoryId: this.spiderConfig.territoryId,
          scrapedAt: new Date().toISOString(),
          power: "executive",
        });
      }

      await browserInstance.close();

      logger.info(
        `PrefeituraAquidauanaSpider found ${gazettes.length} gazettes (browser)`,
      );
    } catch (error) {
      logger.error(`Error crawling Aquidauana with browser:`, error as Error);
    }

    return gazettes;
  }

  private async crawlWithFetch(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      const html = await this.fetch(this.baseUrl);
      const root = parse(html);

      const links = root.querySelectorAll(
        'a[href*=".pdf"], a[href*="download"], a[href*="arquivo"]',
      );
      const startStr = toISODate(this.startDate);
      const endStr = toISODate(this.endDate);

      for (const link of links) {
        const href = link.getAttribute("href");
        if (!href || !href.toLowerCase().includes(".pdf")) continue;

        const fullUrl = href.startsWith("http")
          ? href
          : href.startsWith("/")
            ? new URL(href, this.baseUrl).href
            : `${this.baseUrl}/${href}`;

        const text = (link.parentNode?.toString() || link.textContent) || "";
        const dateMatch = text.match(
          /(\d{2})[\/\-](\d{2})[\/\-](\d{4})|(\d{4})[\/\-](\d{2})[\/\-](\d{2})/,
        );
        let isoDate: string | null = null;
        if (dateMatch) {
          isoDate = dateMatch[4]
            ? `${dateMatch[4]}-${dateMatch[5]}-${dateMatch[6]}`
            : `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
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
        `PrefeituraAquidauanaSpider found ${gazettes.length} gazettes (fetch)`,
      );
    } catch (error) {
      logger.error(`Error crawling Aquidauana:`, error as Error);
    }

    return gazettes;
  }
}
