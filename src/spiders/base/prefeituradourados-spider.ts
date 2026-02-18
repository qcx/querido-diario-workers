import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeituraDouradosConfig,
} from "../../types";
import { logger } from "../../utils/logger";
import { toISODate } from "../../utils/date-utils";
// @ts-ignore
import { parse } from "node-html-parser";

/**
 * Prefeitura Dourados MS - Diário Oficial
 *
 * URL: https://do.dourados.ms.gov.br
 * Estrutura: WordPress com lista de edições (index.php/edicao-*).
 * Cada edição tem link para PDF. Páginas de edição podem exigir JS (requiresClientRendering).
 * Data: texto "EDIÇÃO X – DIA – DD/MM/YYYY" ou da URL edicao-*-dd-mm-yyyy(-suplementar).
 */
const DATE_FROM_TEXT =
  /(\d{2})[\/\-\u2013](\d{2})[\/\-\u2013](\d{4})|EDIÇÃO.*?(\d{1,2})[\/\-\u2013](\d{1,2})[\/\-\u2013](\d{4})/i;
/** Extrai dd-mm-yyyy da URL (ex: edicao-6-365-sexta-feira-25-04-2025 ou ...-24-05-2025-suplementar) */
const DATE_FROM_HREF = /(\d{1,2})-(\d{1,2})-(\d{4})(?:-suplementar)?\/?$/i;

export class PrefeituraDouradosSpider extends BaseSpider {
  private readonly config: PrefeituraDouradosConfig;
  private readonly baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(
    spiderConfig: SpiderConfig,
    dateRange: DateRange,
    browser?: Fetcher,
  ) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeituraDouradosConfig;
    this.baseUrl = (this.config.baseUrl || "").replace(/\/$/, "");
    this.browser = browser || null;

    logger.info(
      `Initializing PrefeituraDouradosSpider for ${spiderConfig.name}`,
    );
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  /** Extrai data ISO da URL da edição (ex: .../edicao-6-365-...-25-04-2025/ ou ...-24-05-2025-suplementar) */
  private parseDateFromEditionUrl(editionUrl: string): string | null {
    const m = editionUrl.match(DATE_FROM_HREF);
    if (!m) return null;
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }

  async crawl(): Promise<Gazette[]> {
    if (
      this.browser &&
      this.config.requiresClientRendering === true
    ) {
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

      await page.goto(this.baseUrl, {
        waitUntil: "networkidle0",
        timeout: 60000,
      });
      this.requestCount++;

      await new Promise((r) => setTimeout(r, 2000));

      const startStr = toISODate(this.startDate);
      const endStr = toISODate(this.endDate);

      const editionItems = await page.evaluate(() => {
        const results: { isoDate: string | null; editionUrl: string }[] = [];
        const dateRegex = /(\d{2})[\/\-\u2013](\d{2})[\/\-\u2013](\d{4})|EDIÇÃO.*?(\d{1,2})[\/\-\u2013](\d{1,2})[\/\-\u2013](\d{4})/i;
        const links = document.querySelectorAll('a[href*="edicao"]');
        for (const a of Array.from(links)) {
          const href = (a as HTMLAnchorElement).href;
          if (!href || href.includes("categoria") || href.includes("todos")) continue;
          const text = (a as HTMLElement).textContent || "";
          const dateMatch = text.match(dateRegex);
          let iso: string | null = null;
          if (dateMatch) {
            if (dateMatch[4] !== undefined) {
              iso = `${dateMatch[6]}-${dateMatch[5].padStart(2, "0")}-${dateMatch[4].padStart(2, "0")}`;
            } else {
              iso = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
            }
          } else {
            const urlMatch = href.match(/(\d{1,2})-(\d{1,2})-(\d{4})(?:-suplementar)?\/?$/);
            if (urlMatch)
              iso = `${urlMatch[3]}-${urlMatch[2].padStart(2, "0")}-${urlMatch[1].padStart(2, "0")}`;
          }
          if (iso) results.push({ isoDate: iso, editionUrl: href });
        }
        return results;
      });

      for (const item of editionItems) {
        const isoDate = item.isoDate ?? this.parseDateFromEditionUrl(item.editionUrl);
        if (!isoDate || isoDate < startStr || isoDate > endStr) continue;

        try {
          await page!.goto(item.editionUrl, {
            waitUntil: "networkidle0",
            timeout: 20000,
          });
          this.requestCount++;
          await new Promise((r) => setTimeout(r, 1500));

          const pdfUrl = await page!.evaluate((baseUrl: string) => {
            const a = document.querySelector('a[href*=".pdf"]') as HTMLAnchorElement;
            if (a?.href) return a.href;
            const embed = document.querySelector('embed[src*=".pdf"], object[data*=".pdf"]') as HTMLEmbedElement | HTMLObjectElement;
            const src = embed?.getAttribute?.("src") || embed?.getAttribute?.("data");
            if (src?.includes(".pdf"))
              return src.startsWith("http") ? src : new URL(src, baseUrl).href;
            const iframe = document.querySelector('iframe[src*=".pdf"]') as HTMLIFrameElement;
            if (iframe?.src?.includes(".pdf"))
              return iframe.src.startsWith("http") ? iframe.src : new URL(iframe.src, baseUrl).href;
            return null;
          }, this.baseUrl);

          if (pdfUrl) {
            gazettes.push({
              date: isoDate,
              fileUrl: pdfUrl,
              territoryId: this.spiderConfig.territoryId,
              scrapedAt: new Date().toISOString(),
              power: "executive",
              isExtraEdition: pdfUrl.toUpperCase().includes("SUPLEMENTAR") || pdfUrl.toUpperCase().includes("EXTRA"),
            });
          }
        } catch {
          continue;
        }
      }

      logger.info(`PrefeituraDouradosSpider found ${gazettes.length} gazettes`);
    } catch (error) {
      logger.error(`Error crawling Dourados (browser):`, error as Error);
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

      const links = root.querySelectorAll('a[href*="edicao"]');
      const startStr = toISODate(this.startDate);
      const endStr = toISODate(this.endDate);

      for (const link of links) {
        const href = link.getAttribute("href");
        if (!href || href.includes("categoria") || href.includes("todos")) continue;

        const text = link.textContent || "";
        const dateMatch = text.match(DATE_FROM_TEXT);
        let isoDate: string | null = null;
        if (dateMatch) {
          if (dateMatch[4] !== undefined)
            isoDate = `${dateMatch[6]}-${dateMatch[5].padStart(2, "0")}-${dateMatch[4].padStart(2, "0")}`;
          else
            isoDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
        }
        if (!isoDate) isoDate = this.parseDateFromEditionUrl(
          href.startsWith("http") ? href : new URL(href, this.baseUrl).href,
        );
        if (!isoDate || isoDate < startStr || isoDate > endStr) continue;

        const editionUrl = href.startsWith("http")
          ? href
          : href.startsWith("/")
            ? new URL(href, this.baseUrl).href
            : `${this.baseUrl}/${href}`;

        let pdfUrl: string | null = null;
        try {
          const pageHtml = await this.fetch(editionUrl);
          const pageRoot = parse(pageHtml);
          const pdfLink = pageRoot.querySelector('a[href*=".pdf"]');
          const embedPdf = pageRoot.querySelector('embed[src*=".pdf"], object[data*=".pdf"]');
          const iframePdf = pageRoot.querySelector('iframe[src*=".pdf"]');
          if (pdfLink) {
            const src = pdfLink.getAttribute("href");
            if (src)
              pdfUrl = src.startsWith("http") ? src : new URL(src, this.baseUrl).href;
          }
          if (!pdfUrl && embedPdf) {
            const src =
              embedPdf.getAttribute("src") || embedPdf.getAttribute("data");
            if (src && src.includes(".pdf"))
              pdfUrl = src.startsWith("http") ? src : new URL(src, this.baseUrl).href;
          }
          if (!pdfUrl && iframePdf) {
            const src = iframePdf.getAttribute("src");
            if (src?.includes(".pdf"))
              pdfUrl = src.startsWith("http") ? src : new URL(src, this.baseUrl).href;
          }
          if (!pdfUrl) {
            const allLinks = pageRoot.querySelectorAll("a[href*='.pdf']");
            if (allLinks.length) {
              const first = allLinks[0].getAttribute("href");
              if (first)
                pdfUrl = first.startsWith("http") ? first : new URL(first, this.baseUrl).href;
            }
          }
        } catch {
          continue;
        }
        if (!pdfUrl) continue;

        gazettes.push({
          date: isoDate,
          fileUrl: pdfUrl,
          territoryId: this.spiderConfig.territoryId,
          scrapedAt: new Date().toISOString(),
          power: "executive",
          isExtraEdition: pdfUrl.toUpperCase().includes("SUPLEMENTAR") || pdfUrl.toUpperCase().includes("EXTRA"),
        });
      }

      logger.info(`PrefeituraDouradosSpider found ${gazettes.length} gazettes`);
    } catch (error) {
      logger.error(`Error crawling Dourados:`, error as Error);
    }

    return gazettes;
  }
}
