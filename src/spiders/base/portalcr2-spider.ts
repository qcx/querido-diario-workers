import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange, PortalCr2Config } from "../../types";
import { logger } from "../../utils/logger";
import { parseBrazilianDate } from "../../utils/date-utils";

/**
 * Spider for Portal CR2 (portalcr2.com.br): Leis e Atos + Concursos e Processos Seletivos.
 * Used by Portel-PA and other municipalities on the same platform.
 *
 * - Leis e Atos: table with columns Tipo, Data de Publicação, Número, Ementa, Documento (download link).
 * - Concursos: table with Detalhes link per row; detail page may contain document/PDF links.
 */
export class PortalCr2Spider extends BaseSpider {
  private platformConfig: PortalCr2Config;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    this.platformConfig = config.config as PortalCr2Config;
    this.browser = browser ?? null;
    if (
      !this.platformConfig.leisEAtosUrl ||
      !this.platformConfig.concursosUrl
    ) {
      throw new Error(
        `PortalCr2Spider requires leisEAtosUrl and concursosUrl for ${config.name}`,
      );
    }
    logger.info(
      `PortalCr2Spider for ${config.name}: leis=${this.platformConfig.leisEAtosUrl}, concursos=${this.platformConfig.concursosUrl}`,
    );
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(
        `PortalCr2Spider for ${this.config.name} requires browser binding`,
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
      // Desktop viewport so the "Lista Detalhada" table is rendered (not a different mobile layout)
      await page.setViewport({ width: 1280, height: 800 });

      // 1) Leis e Atos: paginated table, each row has Data de Publicação + link in Documento column
      const leisGazettes = await this.crawlLeisEAtos(page, seenUrls);
      gazettes.push(...leisGazettes);

      // 2) Concursos: table with Detalhes; follow each detail page and collect document links
      const concursosGazettes = await this.crawlConcursos(page, seenUrls);
      gazettes.push(...concursosGazettes);

      logger.info(
        `PortalCr2Spider found ${gazettes.length} gazettes for ${this.config.name}`,
      );
    } catch (err) {
      logger.error(`PortalCr2Spider crawl error:`, err as Error);
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
   * Crawl "Leis e Atos" page(s): table with Data de Publicação and Documento (download) link.
   */
  private async crawlLeisEAtos(
    page: Awaited<
      ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>["newPage"]>
    >,
    seenUrls: Set<string>,
  ): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const baseUrl = this.platformConfig.leisEAtosUrl;
    let currentPage = 1;
    let hasMore = true;

    while (hasMore) {
      const url =
        currentPage === 1
          ? baseUrl
          : `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}page=${currentPage}`;
      logger.debug(`PortalCr2 Leis e Atos: fetching ${url}`);

      await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
      this.requestCount++;

      // Wait for table to exist (SPA may render shell first, then fill data)
      try {
        await page.waitForSelector("table", { timeout: 15000 });
      } catch {
        logger.debug(`PortalCr2 Leis e Atos: no table found at ${url}`);
      }
      // Give time for client to fetch and render rows
      await new Promise((r) => setTimeout(r, 4000));

      let rows = await page.evaluate(() => {
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
                !href.startsWith("javascript:") &&
                (href.includes(".pdf") ||
                  link?.getAttribute("download") != null ||
                  link?.querySelector("svg") != null ||
                  /documento|download|baixar/i.test(link?.textContent ?? ""))
              ) {
                docHref = href;
              }
            }
            // Fallback: Leis e Atos table has columns Tipo, Data, Número, Ementa, Documento; use last cell link
            if (dateStr && !docHref && cells.length >= 5) {
              const lastCell = cells[cells.length - 1];
              const lastLink = lastCell.querySelector(
                "a[href]",
              ) as HTMLAnchorElement | null;
              const lastHref = lastLink?.href ?? "";
              if (lastHref && !lastHref.startsWith("javascript:"))
                docHref = lastHref;
            }
            if (dateStr && docHref) result.push({ dateStr, docHref });
          }
        }
        return result;
      });

      // Retry once after extra delay if SPA loaded data late
      if (rows.length === 0) {
        await new Promise((r) => setTimeout(r, 5000));
        rows = await page.evaluate(() => {
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
                  !href.startsWith("javascript:") &&
                  (href.includes(".pdf") ||
                    link?.getAttribute("download") != null ||
                    link?.querySelector("svg") != null ||
                    /documento|download|baixar/i.test(link?.textContent ?? ""))
                ) {
                  docHref = href;
                }
              }
              if (dateStr && !docHref && cells.length >= 5) {
                const lastCell = cells[cells.length - 1];
                const lastLink = lastCell.querySelector(
                  "a[href]",
                ) as HTMLAnchorElement | null;
                const lastHref = lastLink?.href ?? "";
                if (lastHref && !lastHref.startsWith("javascript:"))
                  docHref = lastHref;
              }
              if (dateStr && docHref) result.push({ dateStr, docHref });
            }
          }
          return result;
        });
      }

      for (const { dateStr, docHref } of rows) {
        if (seenUrls.has(docHref)) continue;
        const date = parseBrazilianDate(dateStr);
        if (isNaN(date.getTime()) || !this.isInDateRange(date)) continue;
        seenUrls.add(docHref);
        const g = await this.createGazette(date, docHref, {
          power: "executive",
          skipUrlResolution: true, // PDFs may require session/cookies
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

  /**
   * Crawl "Concursos e Processos Seletivos": table rows with Detalhes link; detail page may have document links.
   */
  private async crawlConcursos(
    page: Awaited<
      ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>["newPage"]>
    >,
    seenUrls: Set<string>,
  ): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const baseUrl = this.platformConfig.concursosUrl;
    let currentPage = 1;
    let hasMore = true;

    while (hasMore) {
      const url =
        currentPage === 1
          ? baseUrl
          : `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}page=${currentPage}`;
      logger.debug(`PortalCr2 Concursos: fetching ${url}`);

      await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
      this.requestCount++;
      await new Promise((r) => setTimeout(r, 1500));

      const detailLinks = await page.evaluate(() => {
        const links: string[] = [];
        document.querySelectorAll('a[href*="detalhe"]').forEach((a) => {
          const href = (a as HTMLAnchorElement).href;
          if (href && !links.includes(href)) links.push(href);
        });
        document.querySelectorAll("table a").forEach((a) => {
          const el = a as HTMLAnchorElement;
          if (
            (el.textContent ?? "").trim().toLowerCase() === "detalhes" &&
            el.href
          ) {
            if (!links.includes(el.href)) links.push(el.href);
          }
        });
        return links;
      });

      for (const detailUrl of detailLinks) {
        try {
          await page.goto(detailUrl, {
            waitUntil: "networkidle0",
            timeout: 15000,
          });
          this.requestCount++;
          await new Promise((r) => setTimeout(r, 1000));

          const { docLinks, dateStr } = await page.evaluate(() => {
            const links: string[] = [];
            document.querySelectorAll('a[href*=".pdf"]').forEach((a) => {
              const href = (a as HTMLAnchorElement).href;
              if (href) links.push(href);
            });
            const dateEl = document.querySelector(
              '[class*="data"], [class*="date"], td:nth-child(2)',
            );
            const dateStr =
              (dateEl?.textContent ?? "")
                .trim()
                .match(/\d{1,2}\/\d{1,2}\/\d{4}/)?.[0] ?? "";
            return { docLinks: links, dateStr };
          });

          const date = dateStr
            ? parseBrazilianDate(dateStr)
            : new Date(new Date().getFullYear(), 0, 1);
          const useDate =
            !isNaN(date.getTime()) && this.isInDateRange(date)
              ? date
              : new Date(new Date().getFullYear(), 0, 1);

          for (const docHref of docLinks) {
            if (seenUrls.has(docHref)) continue;
            seenUrls.add(docHref);
            if (!this.isInDateRange(useDate)) continue;
            const g = await this.createGazette(useDate, docHref, {
              power: "executive",
              skipUrlResolution: true,
            });
            if (g) gazettes.push(g);
          }
        } catch (e) {
          logger.debug(
            `Failed to fetch concursos detail ${detailUrl}: ${(e as Error).message}`,
          );
        }
      }

      const nextExists = await page.evaluate(() => {
        const next = document.querySelector(
          'a[href*="page="], .pagination a.next, [aria-label="Próxima"]',
        );
        return !!next;
      });
      if (!nextExists || detailLinks.length === 0) hasMore = false;
      else currentPage++;
    }

    return gazettes;
  }
}
