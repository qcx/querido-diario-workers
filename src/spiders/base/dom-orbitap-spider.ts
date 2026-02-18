import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig, DomOrbitapConfig } from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
import { toISODate } from "../../utils/date-utils";

/**
 * Spider for Órbita Tecnologia DOM platform (Next.js)
 *
 * Platform: dom.*.pa.gov.br (Órbita Tecnologia)
 * Used by: Barcarena-PA (dom.barcarena.pa.gov.br)
 *
 * Next.js SPA with "Últimas Edições" section that loads content dynamically.
 * Waits for loading spinner to disappear and uses broad selectors to find
 * PDF links in the dynamically rendered content.
 */
export class DomOrbitapSpider extends BaseSpider {
  protected config: DomOrbitapConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as DomOrbitapConfig;

    if (!this.config.baseUrl) {
      throw new Error(
        `DomOrbitapSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing DomOrbitapSpider for ${spiderConfig.name} with URL: ${this.config.baseUrl}`,
    );
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.config.baseUrl} for ${this.spiderConfig.name}...`,
    );

    if (!this.browser) {
      logger.warn(
        "Browser not available for Órbita Next.js site, crawl may fail",
      );
      return [];
    }

    return this.crawlWithBrowser();
  }

  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();

    try {
      // @ts-expect-error - Cloudflare Puppeteer has different API
      const browserInstance = await puppeteer.launch(this.browser);
      const page = await browserInstance.newPage();

      await page.setViewport({ width: 1280, height: 800 });

      // Capture API responses that might contain edition data (Órbita fetches from backend)
      const apiResponses: Array<{ url: string; body: string }> = [];
      page.on("response", async (response) => {
        try {
          const url = response.url();
          const contentType = response.headers()["content-type"] || "";
          if (contentType.includes("application/json") && response.ok()) {
            const body = await response.text();
            if (
              body &&
              (body.includes("pdf") ||
                body.includes("edicao") ||
                body.includes("publicacao"))
            ) {
              apiResponses.push({ url, body });
            }
          }
        } catch {
          // Ignore response read errors
        }
      });

      await page.goto(this.config.baseUrl, {
        waitUntil: "networkidle0",
        timeout: 30000,
      });

      // Next.js + API fetch needs extra time - Órbita loads "Últimas Edições" dynamically
      await new Promise((resolve) => setTimeout(resolve, 6000));

      // Wait for PDF links or edition content to appear (Órbita loads "Últimas Edições" via API)
      try {
        await page.waitForSelector(
          'a[href*=".pdf"], a[href*="/pdf"], [class*="edicao"], [class*="card"]',
          { timeout: 20000 },
        );
      } catch {
        logger.debug(
          "Edition elements not found within timeout - continuing with broad extraction",
        );
      }

      // Additional wait for dynamic content
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Try to scroll to "Últimas Edições" section to trigger lazy load
      await page.evaluate(() => {
        const ultimasHeading = Array.from(
          document.querySelectorAll("h2, h3"),
        ).find(
          (el) =>
            el.textContent?.includes("Últimas") ||
            el.textContent?.includes("Edições"),
        );
        ultimasHeading?.scrollIntoView({ behavior: "smooth" });
      });
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const pageGazettes = await page.evaluate(() => {
        const items: Array<{
          href: string;
          dateText: string;
          editionNumber: string | undefined;
        }> = [];
        const seen = new Set<string>();

        const addItem = (
          href: string,
          dateText: string,
          editionNumber?: string,
        ) => {
          if (!href || seen.has(href)) return;
          if (!href.includes("pdf") && !href.endsWith(".pdf")) return;
          seen.add(href);
          items.push({ href, dateText, editionNumber });
        };

        // Strategy 1: Direct PDF links
        document
          .querySelectorAll('a[href*=".pdf"], a[href*="/pdf"], a[href*="pdf"]')
          .forEach((link) => {
            const href = link.getAttribute("href");
            if (!href) return;

            let dateText = "";
            let editionNumber: string | undefined;
            let parent: Element | null = link.parentElement;

            for (let i = 0; i < 8 && parent; i++) {
              const text = parent.textContent || "";
              const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
              if (dateMatch) dateText = dateMatch[0];
              const editionMatch = text.match(
                /Edi[çc][ãa]o\s*(?:n[°º.]?\s*)?(\d+)|N[°º.]?\s*(\d+)/i,
              );
              if (editionMatch)
                editionNumber = editionMatch[1] || editionMatch[2];
              if (dateText) break;
              parent = parent.parentElement;
            }

            addItem(href, dateText, editionNumber);
          });

        // Strategy 2: Links with "Baixar", "Download", "Ver" near date/edition
        document
          .querySelectorAll('a[href], button[onclick], [role="button"]')
          .forEach((el) => {
            const text = (el.textContent || "").toLowerCase();
            if (!text.match(/baixar|download|ver|acessar|pdf/)) return;

            let href =
              (el as HTMLAnchorElement).href ||
              el.getAttribute("href") ||
              (el.getAttribute("onclick") || "").match(
                /['"](https?:\/\/[^'"]+\.pdf)['"]/,
              )?.[1] ||
              (el.getAttribute("onclick") || "").match(
                /window\.open\(['"]([^'"]+)['"]/,
              )?.[1];

            if (!href) return;

            const container = el.closest("div, li, tr, article, section");
            const containerText = container?.textContent || "";
            const dateMatch = containerText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            const editionMatch = containerText.match(
              /Edi[çc][ãa]o\s*(?:n[°º.]?\s*)?(\d+)|N[°º.]?\s*(\d+)/i,
            );

            addItem(
              href,
              dateMatch ? dateMatch[0] : "",
              editionMatch ? editionMatch[1] || editionMatch[2] : undefined,
            );
          });

        // Strategy 3: Grid/div containers that look like edition cards
        document
          .querySelectorAll(
            '[class*="grid"] > div, [class*="grid-cols"] > div, .py-5 > div',
          )
          .forEach((card) => {
            const link = card.querySelector(
              'a[href*="pdf"], a[href*="download"]',
            );
            const href = link?.getAttribute("href");
            if (!href) return;

            const cardText = card.textContent || "";
            const dateMatch = cardText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            const editionMatch = cardText.match(
              /Edi[çc][ãa]o\s*(?:n[°º.]?\s*)?(\d+)|N[°º.]?\s*(\d+)/i,
            );

            addItem(
              href,
              dateMatch ? dateMatch[0] : "",
              editionMatch ? editionMatch[1] || editionMatch[2] : undefined,
            );
          });

        // Strategy 4: Any element with data-url or data-href pointing to PDF
        document
          .querySelectorAll("[data-url], [data-href], [data-pdf]")
          .forEach((el) => {
            const href =
              el.getAttribute("data-url") ||
              el.getAttribute("data-href") ||
              el.getAttribute("data-pdf");
            if (!href || !href.includes("pdf")) return;

            const parent = el.closest("div, li, article");
            const parentText = parent?.textContent || "";
            const dateMatch = parentText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            const editionMatch = parentText.match(
              /Edi[çc][ãa]o\s*(?:n[°º.]?\s*)?(\d+)|N[°º.]?\s*(\d+)/i,
            );

            addItem(
              href,
              dateMatch ? dateMatch[0] : "",
              editionMatch ? editionMatch[1] || editionMatch[2] : undefined,
            );
          });

        return items;
      });

      // Strategy: Parse captured API responses for edition/PDF data
      for (const { body } of apiResponses) {
        try {
          const data = JSON.parse(body);
          const extractFromApi = (obj: unknown): void => {
            if (!obj || typeof obj !== "object") return;
            const o = obj as Record<string, unknown>;
            if (o.url && typeof o.url === "string" && o.url.includes("pdf")) {
              const dateRaw =
                (o.data && typeof o.data === "string" ? o.data : null) ||
                (o.dataPublicacao && typeof o.dataPublicacao === "string"
                  ? o.dataPublicacao
                  : null) ||
                (o.data_publicacao && typeof o.data_publicacao === "string"
                  ? o.data_publicacao
                  : null) ||
                (o.createdAt && typeof o.createdAt === "string"
                  ? o.createdAt
                  : null);
              // Convert YYYY-MM-DD to DD/MM/YYYY for dateText
              let dateText = "";
              if (dateRaw) {
                const m = String(dateRaw).match(/(\d{4})-(\d{2})-(\d{2})/);
                dateText = m
                  ? `${m[3]}/${m[2]}/${m[1]}`
                  : String(dateRaw).slice(0, 10);
              }
              const edition =
                o.numero ?? o.edicao ?? o.numeroEdicao ?? o.edicao_numero;
              pageGazettes.push({
                href: o.url,
                dateText,
                editionNumber: edition != null ? String(edition) : undefined,
              });
            }
            if (Array.isArray(o.data)) o.data.forEach(extractFromApi);
            if (Array.isArray(o.edicoes)) o.edicoes.forEach(extractFromApi);
            if (Array.isArray(o.publicacoes))
              o.publicacoes.forEach(extractFromApi);
          };
          extractFromApi(data);
        } catch {
          // Not JSON or parse error - skip
        }
      }

      const baseUrl = new URL(this.config.baseUrl);

      for (const item of pageGazettes) {
        let date: string | null = null;

        if (item.dateText) {
          const dateMatch = item.dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (dateMatch) {
            const [, day, month, year] = dateMatch;
            date = `${year}-${month}-${day}`;
          }
        }

        if (!date) {
          const urlDateMatch =
            item.href.match(/(\d{4})-(\d{2})-(\d{2})/) ||
            item.href.match(/(\d{4})(\d{2})(\d{2})/) ||
            item.href.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
          if (urlDateMatch) {
            date = `${urlDateMatch[1]}-${urlDateMatch[2]}-${urlDateMatch[3]}`;
          }
        }

        if (!date) {
          const timestampMatch = item.href.match(/\/(\d{10,13})[_\-]/);
          if (timestampMatch) {
            const ts = parseInt(timestampMatch[1]);
            const ms = ts > 9999999999 ? ts : ts * 1000;
            date = toISODate(new Date(ms));
          }
        }

        if (!date || !this.isInDateRange(new Date(date))) continue;

        const fullUrl = item.href.startsWith("http")
          ? item.href
          : `${baseUrl.origin}${item.href.startsWith("/") ? "" : "/"}${item.href}`;

        if (seenUrls.has(fullUrl)) continue;
        seenUrls.add(fullUrl);

        gazettes.push({
          date,
          fileUrl: fullUrl,
          territoryId: this.spiderConfig.territoryId,
          editionNumber: item.editionNumber,
          power: "executive",
          scrapedAt: new Date().toISOString(),
          requiresClientRendering: true,
        });
      }

      await browserInstance.close();

      logger.info(
        `DomOrbitapSpider: found ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
      );
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
      throw error;
    }

    return gazettes;
  }
}
