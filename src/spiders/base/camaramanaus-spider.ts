import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  CamaraManausConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
import { getCurrentTimestamp } from "../../utils/date-utils";

/**
 * Spider for Câmara Municipal de Manaus - Diário Oficial (e-DOLM)
 *
 * Site: https://www.cmm.am.gov.br/diario-oficial/
 * Structure (HTML):
 * - Each edition in <article class="diario-cont"> with:
 *   - <a class="edicao-diario" href="...pdf">e-DOLM NNNN</a>
 *   - <div class="cont-header-date"><span>Data:</span> DD/MM/YYYY</div>
 * - Pagination: ?cpage=2, ?cpage=3, ...
 *
 * NOTE: Site blocks Cloudflare Workers IPs for direct fetch. Use browser
 * binding (requiresClientRendering: true) when running in the worker.
 */
export class CamaraManausSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as CamaraManausConfig;
    this.baseUrl = platformConfig.baseUrl.replace(/\/$/, "");

    logger.info(
      `Initializing CamaraManausSpider for ${config.name} with URL: ${this.baseUrl}`,
    );
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  private parsePage(html: string): { pdfUrl: string; dateStr: string }[] {
    const $ = this.loadHTML(html);
    const items: { pdfUrl: string; dateStr: string }[] = [];

    $("article.diario-cont").each((_, el) => {
      const $art = $(el);
      const $link = $art.find('a.edicao-diario[href$=".pdf"], a[href*="DIARIO-"][href$=".pdf"]').first();
      const pdfUrl = $link.attr("href")?.trim();
      if (!pdfUrl) return;

      const $dateDiv = $art.find(".cont-header-date");
      const dateText = $dateDiv.text().replace(/Data:\s*/i, "").trim();
      const dateMatch = dateText.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (!dateMatch) return;

      const [, day, month, year] = dateMatch;
      const dateStr = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
      items.push({ pdfUrl, dateStr });
    });

    return items;
  }

  private processItemsIntoGazettes(
    items: { pdfUrl: string; dateStr: string }[],
    seenDates: Set<string>,
    gazettes: Gazette[],
  ): number {
    let found = 0;
    for (const { pdfUrl, dateStr } of items) {
      if (seenDates.has(dateStr)) continue;
      seenDates.add(dateStr);

      const gazetteDate = new Date(dateStr + "T12:00:00.000Z");
      if (isNaN(gazetteDate.getTime())) continue;
      if (!this.isInDateRange(gazetteDate)) continue;

      gazettes.push({
        date: dateStr,
        fileUrl: pdfUrl,
        territoryId: this.spiderConfig.territoryId,
        scrapedAt: getCurrentTimestamp(),
        isExtraEdition: false,
        power: "executive",
        sourceText: `e-DOLM ${dateStr}`,
      });
      found++;
      logger.debug(`Found gazette ${dateStr}: ${pdfUrl}`);
    }
    return found;
  }

  private async crawlWithFetch(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const seenDates = new Set<string>();
    let page = 1;
    const maxPages = 50;

    while (page <= maxPages) {
      const pageUrl =
        page === 1 ? `${this.baseUrl}/` : `${this.baseUrl}/?cpage=${page}`;
      const html = await this.fetch(pageUrl);
      const items = this.parsePage(html);
      const foundInPage = this.processItemsIntoGazettes(items, seenDates, gazettes);

      const oldestInPage = items
        .map((i) => i.dateStr)
        .sort()
        .shift();
      if (foundInPage === 0 && page > 1) break;
      if (
        oldestInPage &&
        new Date(oldestInPage + "T12:00:00.000Z") < this.startDate
      ) {
        break;
      }
      page++;
    }

    return gazettes;
  }

  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const seenDates = new Set<string>();
    let page = 1;
    const maxPages = 50;
    let browserInstance = null;
    let browserPage = null;

    try {
      browserInstance = await puppeteer.launch(this.browser!);
      browserPage = await browserInstance.newPage();

      logger.debug("Câmara Manaus: using browser to fetch (site blocks Worker IPs)");

      while (page <= maxPages) {
        const pageUrl =
          page === 1 ? `${this.baseUrl}/` : `${this.baseUrl}/?cpage=${page}`;

        await browserPage.goto(pageUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        this.requestCount++;

        const html = await browserPage.content();
        const items = this.parsePage(html);
        const foundInPage = this.processItemsIntoGazettes(items, seenDates, gazettes);

        const oldestInPage = items
          .map((i) => i.dateStr)
          .sort()
          .shift();
        if (foundInPage === 0 && page > 1) break;
        if (
          oldestInPage &&
          new Date(oldestInPage + "T12:00:00.000Z") < this.startDate
        ) {
          break;
        }
        page++;
      }

      logger.info(
        `Câmara Manaus: found ${gazettes.length} gazettes for ${this.config.name}`,
      );
    } finally {
      if (browserPage) await browserPage.close().catch(() => {});
      if (browserInstance) await browserInstance.close().catch(() => {});
    }

    return gazettes;
  }

  async crawl(): Promise<Gazette[]> {
    const platformConfig = this.config.config as CamaraManausConfig;

    logger.info(
      `Crawling Câmara Manaus for ${this.config.name}... (${this.baseUrl})`,
    );

    try {
      if (
        platformConfig.requiresClientRendering === true &&
        this.browser
      ) {
        return await this.crawlWithBrowser();
      }

      if (
        platformConfig.requiresClientRendering === true &&
        !this.browser
      ) {
        logger.error(
          "Browser binding required for Câmara Manaus (site blocks Worker IPs). Configure BROWSER in wrangler.",
        );
        return [];
      }

      return await this.crawlWithFetch();
    } catch (error) {
      logger.error(`Error crawling Câmara Manaus:`, error as Error);
      return [];
    }
  }
}
