import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeituraBelemConfig,
} from "../../types";
import { logger } from "../../utils/logger";

/**
 * Spider for Diário Oficial do Município de Belém-PA (PGM).
 * Site: https://pgm.belem.pa.gov.br/diario-oficial-do-municipio/
 *
 * The site's date filters are buggy. We click "Limpar Filtros" to load ALL gazettes,
 * then paginate page by page and extract each row (Número, Publicação, Tamanho, Opções).
 * We stop when we've passed the requested date range (list is newest-first).
 * Requires browser rendering (requiresClientRendering: true).
 */
export class PrefeituraBelemSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(
    spiderConfig: SpiderConfig,
    dateRange: DateRange,
    browser?: Fetcher,
  ) {
    super(spiderConfig, dateRange);
    const cfg = spiderConfig.config as PrefeituraBelemConfig;
    this.baseUrl = cfg.baseUrl.replace(/\/$/, "");
    if (!this.baseUrl) {
      throw new Error(
        `PrefeituraBelemSpider requires baseUrl for ${spiderConfig.name}`,
      );
    }
    this.browser = browser || null;
    logger.info(
      `Initializing PrefeituraBelemSpider for ${spiderConfig.name} with baseUrl ${this.baseUrl}`,
    );
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  private formatDateDDMMYYYY(date: Date): string {
    const d = String(date.getDate()).padStart(2, "0");
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const y = date.getFullYear();
    return `${d}/${m}/${y}`;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.warn(
        `PrefeituraBelemSpider for ${this.config.name} requires browser binding; returning empty list`,
      );
      return [];
    }

    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page: Awaited<
      ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>["newPage"]>
    > | null = null;

    try {
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();

      logger.info(`Navigating to ${this.baseUrl}`);
      await page.goto(this.baseUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      this.requestCount++;

      await new Promise((r) => setTimeout(r, 3000));

      // Work in the frame that contains the form (main page or iframe)
      let targetFrame = page.mainFrame();
      const frames = page.frames();
      for (const frame of frames) {
        try {
          const info = await frame.evaluate(() => {
            const inputs = document.querySelectorAll(
              "input:not([type=hidden])",
            );
            const hasPesquisar = Array.from(
              document.querySelectorAll(
                "button, input[type=submit], input[type=button], a",
              ),
            ).some(
              (el) =>
                /pesquisar/i.test((el.textContent || "").trim()) ||
                /pesquisar/i.test((el as HTMLInputElement).value || ""),
            );
            const hasDataLabel = Array.from(
              document.querySelectorAll("label, .form-label, [class*='label']"),
            ).some((l) =>
              /data\s+inicial|data\s+final|filtro/i.test(
                (l.textContent || "").toLowerCase(),
              ),
            );
            return {
              inputCount: inputs.length,
              hasPesquisar,
              hasDataLabel,
            };
          });
          if (
            (info.inputCount >= 2 && info.hasPesquisar) ||
            (info.inputCount >= 2 && info.hasDataLabel)
          ) {
            targetFrame = frame;
            logger.info("Using iframe for form/table content");
            break;
          }
        } catch {
          continue;
        }
      }

      // Belém site: filters are buggy. Click "Limpar Filtros" to show ALL gazettes, then paginate.
      logger.info(
        "Clicking 'Limpar Filtros' to load all gazettes (filters do not work on site)",
      );
      const limparClicked = await targetFrame.evaluate(() => {
        const allClickable = document.querySelectorAll(
          "button, input[type=button], input[type=submit], a, [role=button], [onclick]",
        );
        for (const el of Array.from(allClickable)) {
          const text = (el.textContent || "").trim();
          const val = (el as HTMLInputElement).value || "";
          const aria = (el.getAttribute("aria-label") || "").toLowerCase();
          if (
            /limpar\s*filtro/i.test(text) ||
            /limpar\s*filtros/i.test(text) ||
            /limpar/i.test(val) ||
            /limpar/i.test(aria) ||
            (el.id && /limpar|filtro/i.test(el.id)) ||
            (el.getAttribute("name") &&
              /limpar|filtro/i.test(el.getAttribute("name") || ""))
          ) {
            (el as HTMLElement).click();
            return true;
          }
        }
        return false;
      });

      if (!limparClicked) {
        logger.warn(
          "'Limpar Filtros' button not found; extracting from current page",
        );
      }

      await new Promise((r) => setTimeout(r, 5000));

      // Wait for table (PrimeFaces: .ui-datatable-data tr, or generic table tbody tr)
      try {
        await targetFrame.waitForSelector(
          "table tbody tr, .ui-datatable-data tr, .ui-datatable tbody tr, [role=grid] tbody tr, .table tbody tr",
          { timeout: 20000 },
        );
      } catch {
        logger.warn(
          "Results table not found after search; trying extraction anyway",
        );
      }

      const seenUrls = new Set<string>();
      let currentPage = 1;
      const maxPages = 50;

      while (currentPage <= maxPages) {
        const extracted = await targetFrame.evaluate(
          (
            base: string,
          ): {
            rows: Array<{ dateStr: string; downloadUrl: string }>;
            sampleRow?: string;
          } => {
            const rowSelectors =
              "table tbody tr, .ui-datatable-data tr, .ui-datatable tbody tr, [role=grid] tbody tr, .table tbody tr";
            const rows = document.querySelectorAll(rowSelectors);
            const result: Array<{ dateStr: string; downloadUrl: string }> = [];
            const dateRegex = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;
            const dateRegexIso = /(\d{4})-(\d{2})-(\d{2})/;
            let sampleRow: string | undefined;
            rows.forEach((row, idx) => {
              const cells = row.querySelectorAll("td");
              if (cells.length < 2) return;
              const rowText = (row.textContent || "").trim();
              if (idx === 0 && rowText) sampleRow = rowText.substring(0, 300);
              let dateStr = "";
              const d1 = rowText.match(dateRegex);
              if (d1) dateStr = d1[0];
              else {
                const d2 = rowText.match(dateRegexIso);
                if (d2) dateStr = `${d2[2]}/${d2[3]}/${d2[1]}`;
              }
              if (!dateStr) return;

              let downloadUrl = "";
              const allLinks = row.querySelectorAll("a[href]");
              for (const a of Array.from(allLinks)) {
                const h =
                  (a as HTMLAnchorElement).getAttribute("href") ||
                  (a as HTMLAnchorElement).href ||
                  "";
                if (!h || h === "#" || h.startsWith("javascript:")) continue;
                downloadUrl = h.startsWith("http") ? h : new URL(h, base).href;
                break;
              }
              if (!downloadUrl) {
                const onclickEl = row.querySelector("[onclick]");
                const onclick = onclickEl?.getAttribute("onclick") || "";
                const m =
                  onclick.match(/['"]([^'"]+\.pdf)['"]/) ||
                  onclick.match(/['"]([^'"]*download[^'"]*)['"]/) ||
                  onclick.match(/(https?:\/\/[^'"]+)/) ||
                  onclick.match(/window\.open\s*\(\s*['"]([^'"]+)['"]/) ||
                  onclick.match(/['"]([^'"]+)['"]/);
                if (m?.[1]) {
                  downloadUrl = m[1].startsWith("http")
                    ? m[1]
                    : new URL(m[1], base).href;
                }
              }
              if (!downloadUrl) {
                const withData = row.querySelector(
                  "[data-href], [data-url], [data-link]",
                );
                const dataUrl =
                  withData?.getAttribute("data-href") ||
                  withData?.getAttribute("data-url") ||
                  withData?.getAttribute("data-link");
                if (dataUrl)
                  downloadUrl = dataUrl.startsWith("http")
                    ? dataUrl
                    : new URL(dataUrl, base).href;
              }
              if (!downloadUrl) {
                const firstNum = rowText.match(/\b(\d{4,})\b/);
                if (firstNum) {
                  const id = firstNum[1];
                  const baseClean = base
                    .replace(/\?.*$/, "")
                    .replace(/\/$/, "");
                  downloadUrl = `${baseClean}/download?id=${id}`;
                }
              }
              if (
                dateStr &&
                downloadUrl &&
                !downloadUrl.startsWith("javascript:")
              ) {
                result.push({ dateStr, downloadUrl });
              }
            });
            return { rows: result, sampleRow };
          },
          this.baseUrl,
        );

        const rowsData = extracted.rows;
        if (currentPage === 1 && rowsData.length === 0 && extracted.sampleRow) {
          logger.info("First row sample (for debugging)", {
            sample: extracted.sampleRow,
          });
        }

        for (const row of rowsData) {
          const matchSlash = row.dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
          const matchIso = row.dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
          const d = matchSlash ? matchSlash[1] : matchIso ? matchIso[3] : null;
          const m = matchSlash ? matchSlash[2] : matchIso ? matchIso[2] : null;
          const y = matchSlash ? matchSlash[3] : matchIso ? matchIso[1] : null;
          if (!d || !m || !y) continue;
          const gazetteDate = new Date(
            parseInt(y, 10),
            parseInt(m, 10) - 1,
            parseInt(d, 10),
          );
          if (!this.isInDateRange(gazetteDate)) continue;
          let pdfUrl = row.downloadUrl;
          if (pdfUrl && !pdfUrl.startsWith("http")) {
            pdfUrl = new URL(pdfUrl, this.baseUrl).href;
          }
          if (!pdfUrl || seenUrls.has(pdfUrl)) continue;
          seenUrls.add(pdfUrl);
          const cfg = this.spiderConfig.config as PrefeituraBelemConfig;
          const g = await this.createGazette(gazetteDate, pdfUrl, {
            power: "executive",
            requiresClientRendering: cfg.requiresClientRendering ?? true,
          });
          if (g) gazettes.push(g);
        }

        logger.info(
          `Page ${currentPage}: extracted ${rowsData.length} rows (dates+links), ${gazettes.length} gazettes in range so far`,
        );
        if (currentPage === 1 && rowsData.length === 0) {
          await new Promise((r) => setTimeout(r, 3000));
          const retryRows = await targetFrame.evaluate((): number => {
            const rows = document.querySelectorAll(
              "table tbody tr, .ui-datatable-data tr",
            );
            return rows.length;
          });
          logger.info(`Retry: table has ${retryRows} rows after extra wait`);
        }
        const consecutiveEmpty = currentPage >= 2 && rowsData.length === 0;
        if (consecutiveEmpty) {
          logger.info(
            "Two consecutive pages with 0 extracted rows; stopping pagination",
          );
          break;
        }

        // List is usually newest-first; stop when all dates on page are before our range
        if (rowsData.length > 0) {
          const pageDates = rowsData
            .map((r) => {
              const m =
                r.dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/) ||
                r.dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
              if (!m) return null;
              if (m.length === 4 && m[0].includes("/")) {
                return new Date(
                  parseInt(m[3], 10),
                  parseInt(m[2], 10) - 1,
                  parseInt(m[1], 10),
                );
              }
              if (m.length === 4)
                return new Date(
                  parseInt(m[1], 10),
                  parseInt(m[2], 10) - 1,
                  parseInt(m[3], 10),
                );
              return null;
            })
            .filter((d): d is Date => d !== null);
          const minPageDate = pageDates.length
            ? new Date(Math.min(...pageDates.map((d) => d.getTime())))
            : null;
          if (minPageDate && minPageDate < this.startDate) {
            logger.info(
              `Page dates are before range (min ${minPageDate.toISOString().slice(0, 10)}); stopping pagination`,
            );
            break;
          }
        }

        const hasNext = await targetFrame.evaluate(() => {
          const sel =
            'a[title="Próximo"], .ui-paginator-next:not(.ui-state-disabled), [aria-label="Next"], .pagination .next a, a.next';
          if (document.querySelector(sel)) return true;
          const links = Array.from(document.querySelectorAll("a, button"));
          return links.some(
            (el) =>
              />>|pr[oó]ximo|next/i.test((el.textContent || "").trim()) ||
              (el.getAttribute("aria-label") || "")
                .toLowerCase()
                .includes("next"),
          );
        });

        if (!hasNext) break;
        const clicked = await targetFrame.evaluate(() => {
          const links = Array.from(document.querySelectorAll("a, button"));
          const next = links.find(
            (el) =>
              />>|pr[oó]ximo|next/i.test((el.textContent || "").trim()) ||
              (el.getAttribute("aria-label") || "")
                .toLowerCase()
                .includes("next"),
          );
          if (next) {
            (next as HTMLElement).click();
            return true;
          }
          const sel =
            '.ui-paginator-next:not(.ui-state-disabled), a[title="Próximo"]';
          const el = document.querySelector(sel);
          if (el) {
            (el as HTMLElement).click();
            return true;
          }
          return false;
        });
        if (!clicked) break;
        await new Promise((r) => setTimeout(r, 2000));
        currentPage++;
        this.requestCount++;
      }

      logger.info(
        `PrefeituraBelemSpider found ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
      );
    } catch (err) {
      logger.error("PrefeituraBelemSpider crawl error:", err as Error);
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (e) {
          logger.warn("Error closing page", { error: (e as Error).message });
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (e) {
          logger.warn("Error closing browser", { error: (e as Error).message });
        }
      }
    }

    return gazettes;
  }
}
