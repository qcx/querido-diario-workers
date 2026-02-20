import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeituraNovaAndradinaConfig,
} from "../../types";
import { logger } from "../../utils/logger";
import { toISODate } from "../../utils/date-utils";
// @ts-ignore
import { parse } from "node-html-parser";

/**
 * Prefeitura Nova Andradina MS - Diário Oficial
 *
 * URL: https://publicacoesmunicipais.inf.br/transparencia/nova-andradina/diario-oficial
 * Plataforma publicacoesmunicipais.inf.br - tabela com PDFs e datas; suporta paginação (?page=2).
 * Conteúdo pode ser carregado via JS (requiresClientRendering).
 */
export class PrefeituraNovaAndradinaSpider extends BaseSpider {
  private readonly config: PrefeituraNovaAndradinaConfig;
  private readonly baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeituraNovaAndradinaConfig;
    this.baseUrl = (this.config.baseUrl || "").replace(/\/$/, "");

    logger.info(
      `Initializing PrefeituraNovaAndradinaSpider for ${spiderConfig.name}`,
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

  /** Extrai data ISO do texto (DD/MM/YYYY ou DD-MM-YYYY). */
  private parseDateFromText(text: string): string | null {
    const m = text.match(
      /(\d{2})[\/\-](\d{2})[\/\-](\d{4})|(\d{4})[\/\-](\d{2})[\/\-](\d{2})/,
    );
    if (!m) return null;
    return m[4]
      ? `${m[4]}-${m[5]}-${m[6]}`
      : `${m[3]}-${m[2]}-${m[1]}`;
  }

  /** Extrai data ISO do nome do arquivo PDF (ex: Edição_2192_DE_17-11-2025.pdf). */
  private parseDateFromHref(href: string): string | null {
    const m = href.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
    if (!m) return null;
    return `${m[3]}-${m[2]}-${m[1]}`;
  }

  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();
    let browserInstance = null;
    let page = null;

    try {
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();

      await page.setViewport({ width: 1280, height: 800 });

      const startStr = toISODate(this.startDate);
      const endStr = toISODate(this.endDate);
      let pageNum = 1;
      const maxPages = 50;

      while (pageNum <= maxPages) {
        const url =
          pageNum === 1
            ? this.baseUrl
            : `${this.baseUrl}${this.baseUrl.includes("?") ? "&" : "?"}page=${pageNum}`;

        await page.goto(url, {
          waitUntil: "networkidle0",
          timeout: 30000,
        });
        this.requestCount++;

        await page
          .waitForSelector('a[href*=".pdf"]', { timeout: 8000 })
          .catch(() => null);

        await new Promise((r) => setTimeout(r, 1500));

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
              const ddmmmyyyy = fullUrl.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
              if (ddmmmyyyy)
                isoDate = `${ddmmmyyyy[3]}-${ddmmmyyyy[2]}-${ddmmmyyyy[1]}`;
            }
            if (!isoDate) {
              let parent = link.parentElement;
              for (let i = 0; i < 5 && parent; i++) {
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

            results.push({ href: fullUrl, isoDate });
          }
          return results;
        }, this.baseUrl);

        if (items.length === 0) break;

        let inRangeCount = 0;
        for (const item of items) {
          const isoDate =
            item.isoDate || this.parseDateFromHref(item.href);
          if (!isoDate || isoDate < startStr || isoDate > endStr) continue;
          if (seenUrls.has(item.href)) continue;
          seenUrls.add(item.href);
          inRangeCount++;
          gazettes.push({
            date: isoDate,
            fileUrl: item.href,
            territoryId: this.spiderConfig.territoryId,
            scrapedAt: new Date().toISOString(),
            power: "executive",
          });
        }

        if (inRangeCount === 0 && items.length > 0) {
          const oldestDate = items
            .map((i) => i.isoDate || this.parseDateFromHref(i.href))
            .filter(Boolean)
            .sort()[0];
          if (oldestDate && oldestDate < startStr) break;
        }

        pageNum++;
      }

      logger.info(
        `PrefeituraNovaAndradinaSpider found ${gazettes.length} gazettes (browser)`,
      );
    } catch (error) {
      logger.error(`Error crawling Nova Andradina with browser:`, error as Error);
    } finally {
      if (page) await page.close().catch(() => {});
      if (browserInstance) await browserInstance.close().catch(() => {});
    }

    return gazettes;
  }

  private async crawlWithFetch(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();
    const startStr = toISODate(this.startDate);
    const endStr = toISODate(this.endDate);

    try {
      let pageNum = 1;
      const maxPages = 50;

      while (pageNum <= maxPages) {
        const url =
          pageNum === 1
            ? this.baseUrl
            : `${this.baseUrl}${this.baseUrl.includes("?") ? "&" : "?"}page=${pageNum}`;

        const html = await this.fetch(url);
        const root = parse(html);

        const links = root.querySelectorAll('a[href*=".pdf"], a[href*="download"]');
        if (links.length === 0) break;

        let inRangeCount = 0;
        for (const link of links) {
          const href = link.getAttribute("href");
          if (!href || !href.toLowerCase().includes(".pdf")) continue;

          const fullUrl = href.startsWith("http")
            ? href
            : href.startsWith("/")
              ? new URL(href, this.baseUrl).href
              : `${this.baseUrl}/${href}`;

          if (seenUrls.has(fullUrl)) continue;

          const text =
            link.parentNode?.toString() ||
            link.textContent ||
            "";
          const isoDate =
            this.parseDateFromText(text) || this.parseDateFromHref(fullUrl);
          if (!isoDate || isoDate < startStr || isoDate > endStr) continue;

          seenUrls.add(fullUrl);
          inRangeCount++;
          gazettes.push({
            date: isoDate,
            fileUrl: fullUrl,
            territoryId: this.spiderConfig.territoryId,
            scrapedAt: new Date().toISOString(),
            power: "executive",
          });
        }

        if (inRangeCount === 0 && links.length > 0) break;
        pageNum++;
      }

      logger.info(
        `PrefeituraNovaAndradinaSpider found ${gazettes.length} gazettes`,
      );
    } catch (error) {
      logger.error(`Error crawling Nova Andradina:`, error as Error);
    }

    return gazettes;
  }
}
