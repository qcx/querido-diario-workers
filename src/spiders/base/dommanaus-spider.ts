import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  DomManausConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
import { getCurrentTimestamp } from "../../utils/date-utils";

/**
 * Spider for DOM Manaus - Diário Oficial do Município (Prefeitura, Plone)
 *
 * Site: https://dom.manaus.am.gov.br/?go=dom
 * Structure:
 * - Table "ÚLTIMOS POSTADOS" with columns: Data de efetivação, Título, Tamanho
 * - Pagination: Plone b_start=0,20,40,... (20 items per page)
 * - Title links to document; PDF often at /@@download/file
 *
 * May require browser when running in Worker (site can block datacenter IPs).
 */
export class DomManausSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;
  private readonly pageSize = 20;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as DomManausConfig;
    this.baseUrl = platformConfig.baseUrl.replace(/\?.*$/, "").replace(/\/$/, "");

    logger.info(
      `Initializing DomManausSpider for ${config.name} with URL: ${this.baseUrl}`,
    );
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  /**
   * Parse listing HTML: table with Data de efetivação, Título (link), Tamanho.
   * Returns items with dateStr and url (content page or direct PDF).
   */
  private parsePage(html: string, baseOrigin: string): { dateStr: string; url: string }[] {
    const $ = this.loadHTML(html);
    const items: { dateStr: string; url: string }[] = [];

    // Plone / table: look for rows with date and link
    $("table tbody tr, table tr").each((_, rowEl) => {
      const $row = $(rowEl);
      const cells = $row.find("td");
      if (cells.length < 2) return;

      // First column: Data de efetivação (DD/MM/YYYY)
      const dateText = $(cells[0]).text().trim();
      const dateMatch = dateText.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (!dateMatch) return;
      const [, d, m, y] = dateMatch;
      const dateStr = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;

      // Second column (Título): link to document or PDF
      const $link = $row.find("a[href]").first();
      let href = $link.attr("href")?.trim();
      if (!href) return;

      if (!href.startsWith("http")) {
        href = href.startsWith("/") ? `${baseOrigin}${href}` : `${baseOrigin}/${href}`;
      }

      // Plone: content page link; PDF often at same path + /@@download/file (or link may be direct)
      const pdfUrl = href.includes(".pdf")
        ? href
        : href.replace(/\/view\/?$/, "").replace(/\/?$/, "") + "/@@download/file";

      items.push({ dateStr, url: pdfUrl });
    });

    return items;
  }

  private async crawlWithFetch(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();
    const baseOrigin = new URL(this.baseUrl).origin;
    let bStart = 0;
    const maxPages = 500; // 500 * 20 = 10000 items max

    for (let p = 0; p < maxPages; p++) {
      const pageUrl = `${this.baseUrl}/?go=dom&b_start=${bStart}`;
      const html = await this.fetch(pageUrl);
      const items = this.parsePage(html, baseOrigin);

      if (items.length === 0) break;

      let inRange = 0;
      for (const { dateStr, url } of items) {
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);

        const date = new Date(dateStr + "T12:00:00.000Z");
        if (isNaN(date.getTime()) || !this.isInDateRange(date)) continue;

        gazettes.push({
          date: dateStr,
          fileUrl: url,
          territoryId: this.spiderConfig.territoryId,
          scrapedAt: getCurrentTimestamp(),
          isExtraEdition: false,
          power: "executive",
          sourceText: `DOM ${dateStr}`,
        });
        inRange++;
      }

      if (items.length < this.pageSize) break;
      bStart += this.pageSize;
    }

    logger.info(
      `DomManaus: found ${gazettes.length} gazettes for ${this.config.name}`,
    );
    return gazettes;
  }

  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();
    const baseOrigin = new URL(this.baseUrl).origin;
    let bStart = 0;
    const maxPages = 500;
    let browserInstance = null;
    let page = null;

    try {
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();

      logger.debug("DomManaus: using browser (site may block Worker IPs)");

      for (let p = 0; p < maxPages; p++) {
        const pageUrl = `${this.baseUrl}/?go=dom&b_start=${bStart}`;

        await page.goto(pageUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        this.requestCount++;

        const html = await page.content();
        const items = this.parsePage(html, baseOrigin);

        if (items.length === 0) break;

        for (const { dateStr, url } of items) {
          if (seenUrls.has(url)) continue;
          seenUrls.add(url);

          const date = new Date(dateStr + "T12:00:00.000Z");
          if (isNaN(date.getTime()) || !this.isInDateRange(date)) continue;

          gazettes.push({
            date: dateStr,
            fileUrl: url,
            territoryId: this.spiderConfig.territoryId,
            scrapedAt: getCurrentTimestamp(),
            isExtraEdition: false,
            power: "executive",
            sourceText: `DOM ${dateStr}`,
          });
        }

        if (items.length < this.pageSize) break;
        bStart += this.pageSize;
      }

      logger.info(
        `DomManaus: found ${gazettes.length} gazettes for ${this.config.name}`,
      );
    } finally {
      if (page) await page.close().catch(() => {});
      if (browserInstance) await browserInstance.close().catch(() => {});
    }

    return gazettes;
  }

  async crawl(): Promise<Gazette[]> {
    const platformConfig = this.config.config as DomManausConfig;

    logger.info(
      `Crawling DOM Manaus for ${this.config.name}... (${this.baseUrl})`,
    );

    try {
      if (platformConfig.requiresClientRendering === true && this.browser) {
        return await this.crawlWithBrowser();
      }
      if (platformConfig.requiresClientRendering === true && !this.browser) {
        logger.error(
          "Browser binding required for DOM Manaus. Configure BROWSER in wrangler.",
        );
        return [];
      }
      return await this.crawlWithFetch();
    } catch (error) {
      logger.error(`Error crawling DOM Manaus:`, error as Error);
      return [];
    }
  }
}
