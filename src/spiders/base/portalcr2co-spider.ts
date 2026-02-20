import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PortalCr2CoConfig,
} from "../../types";
import { logger } from "../../utils/logger";
import { parseBrazilianDate } from "../../utils/date-utils";

/**
 * Spider for Portal CR2 (portal.cr2.co): single URL for "Leis e Atos Normativos" (diários oficiais).
 * Used by Vigia-PA: https://portal.cr2.co/informacao_institucional/...?entidade=vigia&modulo=Leis%20e%20Atos%20Normativos
 *
 * - Single list page: table with Data de Publicação + link in Documento column (or similar).
 */
export class PortalCr2CoSpider extends BaseSpider {
  private platformConfig: PortalCr2CoConfig;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    this.platformConfig = config.config as PortalCr2CoConfig;
    this.browser = browser ?? null;
    if (!this.platformConfig.diariosUrl) {
      throw new Error(
        `PortalCr2CoSpider requires diariosUrl for ${config.name}`,
      );
    }
    logger.info(
      `PortalCr2CoSpider for ${config.name}: diariosUrl=${this.platformConfig.diariosUrl}`,
    );
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(
        `PortalCr2CoSpider for ${this.config.name} requires browser binding`,
      );
      return [];
    }

    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();
    let browserInstance: Awaited<ReturnType<typeof puppeteer.launch>> | null =
      null;
    let page: Awaited<
      ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>["newPage"]>
    > | null = null;

    try {
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();

      const listGazettes = await this.crawlDiarios(page, seenUrls);
      gazettes.push(...listGazettes);

      if (this.platformConfig.concursosUrl) {
        const concursosGazettes = await this.crawlDiarios(
          page,
          seenUrls,
          this.platformConfig.concursosUrl,
        );
        gazettes.push(...concursosGazettes);
      }

      logger.info(
        `PortalCr2CoSpider found ${gazettes.length} gazettes for ${this.config.name}`,
      );
    } catch (err) {
      logger.error(`PortalCr2CoSpider crawl error:`, err as Error);
      throw err;
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (e) {
          logger.warn("Error closing page", e as Error);
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (e) {
          logger.warn("Error closing browser", e as Error);
        }
      }
    }

    return gazettes;
  }

  /**
   * Crawl the single "Leis e Atos Normativos" / diários page(s): table with Data de Publicação and Documento (download) link.
   * Also used for Concursos when concursosUrl is provided (same table structure).
   */
  private async crawlDiarios(
    page: Awaited<
      ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>["newPage"]>
    >,
    seenUrls: Set<string>,
    urlOverride?: string,
  ): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const baseUrl = urlOverride ?? this.platformConfig.diariosUrl;
    let currentPage = 1;
    let hasMore = true;

    while (hasMore) {
      const url =
        currentPage === 1
          ? baseUrl
          : `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}page=${currentPage}`;
      logger.debug(`PortalCr2Co Diários: fetching ${url}`);

      await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
      this.requestCount++;
      await new Promise((r) => setTimeout(r, 1500));

      const rows = await page.evaluate(() => {
        const result: { dateStr: string; docHref: string }[] = [];
        const tables = document.querySelectorAll("table");
        for (const table of tables) {
          const tbody = table.querySelector("tbody") ?? table;
          const trs = tbody.querySelectorAll("tr");
          for (const tr of trs) {
            const cells = tr.querySelectorAll("td");
            if (cells.length < 2) continue;
            let dateStr = "";
            let docHref = "";
            for (let i = 0; i < cells.length; i++) {
              const cell = cells[i];
              const text = (cell.textContent ?? "").trim();
              const link = cell.querySelector(
                "a[href]",
              ) as HTMLAnchorElement | null;
              const href = link?.href ?? "";
              if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text)) dateStr = text;
              if (
                href &&
                (href.includes(".pdf") ||
                  link?.getAttribute("download") != null ||
                  link?.querySelector("svg") != null ||
                  /documento|download|baixar|visualizar/i.test(
                    link?.textContent ?? "",
                  ))
              ) {
                docHref = href;
              }
            }
            if (dateStr && docHref) result.push({ dateStr, docHref });
          }
        }
        return result;
      });

      for (const { dateStr, docHref } of rows) {
        if (seenUrls.has(docHref)) continue;
        const date = parseBrazilianDate(dateStr);
        if (isNaN(date.getTime()) || !this.isInDateRange(date)) continue;
        seenUrls.add(docHref);
        const g = await this.createGazette(date, docHref, {
          power: "executive",
        });
        if (g) gazettes.push(g);
      }

      const nextExists = await page.evaluate(() => {
        const next = document.querySelector(
          'a[href*="page="], .pagination a.next, button.next, [aria-label="Próxima"], .page-link',
        );
        return !!next && !(next as HTMLElement).classList?.contains("disabled");
      });
      if (!nextExists || rows.length === 0) hasMore = false;
      else currentPage++;
    }

    return gazettes;
  }
}
