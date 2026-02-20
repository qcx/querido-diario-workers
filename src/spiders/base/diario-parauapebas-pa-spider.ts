import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  DiarioParauapebasPaConfig,
} from "../../types";
import { logger } from "../../utils/logger";

/**
 * Spider for Diário Oficial de Parauapebas (PA).
 * Site: https://diario.parauapebas.pa.gov.br - MudBlazor layout with "Resultados da Busca",
 * cards with .badge.bg-main-verde (date) and download/view buttons.
 * Requires browser rendering.
 */
export class DiarioParauapebasPaSpider extends BaseSpider {
  private config: DiarioParauapebasPaConfig;
  private browser: Fetcher | null = null;

  constructor(
    spiderConfig: SpiderConfig,
    dateRange: DateRange,
    browser?: Fetcher,
  ) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as DiarioParauapebasPaConfig;
    this.browser = browser || null;
    if (!this.config.url) {
      throw new Error(
        `DiarioParauapebasPaSpider requires url for ${spiderConfig.name}`,
      );
    }
    logger.info(
      `Initializing DiarioParauapebasPaSpider for ${spiderConfig.name} with URL: ${this.config.url}`,
    );
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.warn(
        "DiarioParauapebasPaSpider requires browser binding; returning empty list",
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

      await page.goto(this.config.url, {
        waitUntil: "networkidle0",
        timeout: 30000,
      });
      this.requestCount++;
      await new Promise((r) => setTimeout(r, 4000));

      // Optional: trigger "Buscar" with date range so "Resultados da Busca" is populated
      try {
        const startStr = this.dateRange.start;
        const endStr = this.dateRange.end;
        const clicked = await page.evaluate(
          (start: string, end: string) => {
            const buttons = Array.from(
              document.querySelectorAll(
                'button, a[role="button"], input[type="submit"]',
              ),
            );
            const buscar = buttons.find((b) =>
              /buscar|pesquisar|search/i.test(
                (b as HTMLElement).innerText ||
                  (b as HTMLInputElement).value ||
                  "",
              ),
            );
            if (!buscar) return false;
            const inputs = Array.from(
              document.querySelectorAll<HTMLInputElement>(
                'input[type="date"], input[name*="data"], input[name*="date"]',
              ),
            );
            if (inputs.length >= 1) {
              inputs[0].value = start;
              if (inputs[1]) inputs[1].value = end;
              (buscar as HTMLElement).click();
              return true;
            }
            return false;
          },
          startStr,
          endStr,
        );
        if (clicked) await new Promise((r) => setTimeout(r, 3000));
      } catch (_) {}

      // Wait for MudBlazor content
      await page
        .waitForSelector(
          ".card.pdf-preview, .badge.bg-main-verde, .main-documents",
          { timeout: 15000 },
        )
        .catch(() => null);
      await new Promise((r) => setTimeout(r, 2000));

      const items = await page.evaluate((baseOrigin: string) => {
        const result: { dateText: string; pdfHref: string }[] = [];
        const dateRe = /\b(\d{2})\/(\d{2})\/(\d{4})\b/g;

        // MudBlazor: cards with .pdf-preview or containers that have .badge.bg-main-verde + link
        const cards = document.querySelectorAll(
          ".card.pdf-preview, .card.shadow-sm.pdf-preview, .document-wrapper .card, .main-documents .card",
        );
        const badges = document.querySelectorAll(
          '.badge.bg-main-verde, .badge[class*="verde"]',
        );
        const candidates: Element[] = [];

        for (const card of Array.from(cards)) {
          if (card.textContent && dateRe.test(card.textContent))
            candidates.push(card);
        }
        if (candidates.length === 0 && badges.length > 0) {
          for (const badge of Array.from(badges)) {
            let el: Element | null = badge;
            for (let i = 0; i < 10 && el; i++) {
              el = el.parentElement;
              if (
                el &&
                el.querySelector("a[href]") &&
                (el.textContent || "").match(dateRe)
              ) {
                candidates.push(el);
                break;
              }
            }
          }
        }

        for (const row of candidates) {
          const text = row.textContent || "";
          const dateM = text.match(dateRe);
          if (!dateM) continue;
          const dateText = dateM[0];
          let href: string | null = null;
          const a = row.querySelector("a[href]");
          if (a) href = a.getAttribute("href");
          if (!href) {
            const btn = row.querySelector(
              "[data-href], [data-url], [data-pdf], [data-file]",
            );
            if (btn)
              href =
                btn.getAttribute("data-href") ||
                btn.getAttribute("data-url") ||
                btn.getAttribute("data-pdf") ||
                btn.getAttribute("data-file") ||
                null;
          }
          if (href && dateText) result.push({ dateText, pdfHref: href });
        }

        // Fallback: single PDF viewer iframe (current edition)
        if (result.length === 0) {
          const iframe = document.querySelector(
            'iframe[id^="pdfViewer"]',
          ) as HTMLIFrameElement | null;
          if (iframe && iframe.src) {
            const text = document.body?.innerText || "";
            const dateM = text.match(dateRe);
            if (dateM) result.push({ dateText: dateM[0], pdfHref: iframe.src });
          }
        }

        return result;
      }, new URL(this.config.url).origin);

      logger.debug(`DiarioParauapebasPa: found ${items.length} items`);

      const seen = new Set<string>();
      for (const item of items) {
        const dateMatch = item.dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (!dateMatch) continue;
        const [, d, m, y] = dateMatch;
        const gazetteDate = new Date(`${y}-${m}-${d}`);
        if (!this.isInDateRange(gazetteDate)) continue;
        let pdfUrl = item.pdfHref;
        if (!pdfUrl.startsWith("http")) {
          const base = new URL(this.config.url);
          pdfUrl = `${base.origin}${pdfUrl.startsWith("/") ? "" : "/"}${pdfUrl}`;
        }
        const key = `${gazetteDate.toISOString().slice(0, 10)}|${pdfUrl}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const gazette = await this.createGazette(gazetteDate, pdfUrl, {
          power: "executive_legislative",
          sourceText: `Diário ${item.dateText}`,
        });
        if (gazette) gazettes.push(gazette);
      }
    } catch (error) {
      logger.error("DiarioParauapebasPaSpider error", error as Error);
    } finally {
      if (page)
        try {
          await page.close();
        } catch (_) {}
      if (browserInstance)
        try {
          await browserInstance.close();
        } catch (_) {}
    }

    return gazettes;
  }
}
