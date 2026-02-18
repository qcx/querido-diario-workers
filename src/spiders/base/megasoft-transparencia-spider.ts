import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  MegasoftTransparenciaConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";

/**
 * Spider for Megasoft Transparência platform
 *
 * Platform: {subdomain}.megasofttransparencia.com.br
 *
 * Used by: Uruaçu-GO (uruacu.megasofttransparencia.com.br)
 *
 * Structure: Diário Oficial em "Legislação e Publicações" (/legislacao-e-publicacoes).
 * SPA que requer renderização client-side com JavaScript.
 */
export class MegasoftTransparenciaSpider extends BaseSpider {
  protected config: MegasoftTransparenciaConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as MegasoftTransparenciaConfig;

    if (!this.config.baseUrl) {
      throw new Error(
        `MegasoftTransparenciaSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing MegasoftTransparenciaSpider for ${spiderConfig.name} with URL: ${this.config.baseUrl}`,
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
      logger.warn("Browser not available for SPA site, crawl may fail");
      return [];
    }

    return this.crawlWithBrowser();
  }

  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();

    try {
      const baseUrl = this.config.baseUrl.replace(/\/$/, "");
      const diarioPath = this.config.diarioPath || "legislacao-e-publicacoes";
      const listUrl = diarioPath.startsWith("http")
        ? diarioPath
        : `${baseUrl}/${diarioPath}`;

      // @ts-expect-error - Cloudflare Puppeteer has different API
      const browserInstance = await puppeteer.launch(this.browser);
      const page = await browserInstance.newPage();

      await page.setViewport({ width: 1280, height: 800 });

      await page.goto(listUrl, {
        waitUntil: "networkidle0",
        timeout: 30000,
      });

      // Wait for SPA content
      await new Promise((resolve) => setTimeout(resolve, 5000));

      await page
        .waitForSelector(
          'a[href*=".pdf"], a[href*="download"], [class*="diario"], [class*="publicacao"]',
          {
            timeout: 15000,
          },
        )
        .catch(() => {
          logger.debug("Waiting for content...");
        });

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const pageGazettes = await page.evaluate(() => {
        const items: Array<{
          href: string | null;
          dateText: string;
          editionNumber: string | undefined;
        }> = [];

        // Strategy 1: Table rows
        const tableRows = document.querySelectorAll(
          "table tbody tr, [class*='table'] tbody tr, .list-item, .gazette-item, [class*='publicacao']",
        );

        for (const row of tableRows) {
          const rowText = row.textContent || "";
          if (
            !/di[aá]rio|oficial|edi[çc][ãa]o|publica[çc][ãa]o/i.test(rowText)
          ) {
            continue;
          }

          let href: string | null = null;
          const link = row.querySelector(
            'a[href*=".pdf"], a[href*="download"], a[download], a[href*="visualizar"]',
          );
          if (link) {
            href = link.getAttribute("href");
          }
          if (!href) {
            const btn = row.querySelector("a");
            if (btn) href = btn.getAttribute("href");
          }

          if (!href || !href.includes(".pdf")) continue;

          let dateText = "";
          const dateMatch = rowText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (dateMatch) dateText = dateMatch[0];

          let editionNumber: string | undefined;
          const editionMatch = rowText.match(
            /(?:Edi[çc][ãa]o|Nº?|N\.|#)\s*:?\s*(\d+)/i,
          );
          if (editionMatch) editionNumber = editionMatch[1];

          items.push({ href, dateText, editionNumber });
        }

        // Strategy 2: Any PDF links in Diário Oficial context
        if (items.length === 0) {
          const allLinks = document.querySelectorAll('a[href*=".pdf"]');
          for (const link of allLinks) {
            const href = link.getAttribute("href");
            if (!href) continue;

            let parent = link.parentElement;
            for (let i = 0; i < 10 && parent; i++) {
              const text = parent.textContent || "";
              if (
                /di[aá]rio|oficial|edi[çc][ãa]o|publica[çc][ãa]o/i.test(text)
              ) {
                let dateText = "";
                const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                if (dateMatch) dateText = dateMatch[0];

                let editionNumber: string | undefined;
                const editionMatch = text.match(
                  /(?:Edi[çc][ãa]o|Nº?|N\.|#)\s*:?\s*(\d+)/i,
                );
                if (editionMatch) editionNumber = editionMatch[1];

                items.push({ href, dateText, editionNumber });
                break;
              }
              parent = parent.parentElement;
            }
          }
        }

        // Strategy 3: All PDF links with date in context
        if (items.length === 0) {
          const allLinks = document.querySelectorAll(
            'a[href*=".pdf"], a[href*="download"]',
          );
          for (const link of allLinks) {
            const href = link.getAttribute("href");
            if (!href) continue;

            let dateText = "";
            let editionNumber: string | undefined;
            let parent = link.parentElement;

            for (let i = 0; i < 10 && parent; i++) {
              const text = parent.textContent || "";
              const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
              if (dateMatch) dateText = dateMatch[0];
              const editionMatch = text.match(
                /(?:Edi[çc][ãa]o|Nº?|N\.|#)\s*:?\s*(\d+)/i,
              );
              if (editionMatch) editionNumber = editionMatch[1];
              if (dateText) break;
              parent = parent.parentElement;
            }

            if (dateText) {
              items.push({ href, dateText, editionNumber });
            }
          }
        }

        return items;
      });

      const baseUrlParsed = new URL(listUrl);

      for (const item of pageGazettes) {
        if (!item.href) continue;

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
          const fileDate = item.href.match(/(\d{8})/);
          if (fileDate) {
            const s = fileDate[1];
            date = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
          }
        }

        if (!date) {
          logger.debug(`Skipping gazette without date: ${item.href}`);
          continue;
        }

        if (!this.isInDateRange(new Date(date))) continue;

        const fullUrl = item.href.startsWith("http")
          ? item.href
          : `${baseUrlParsed.origin}${item.href.startsWith("/") ? "" : "/"}${item.href}`;

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
        `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
      );
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
      throw error;
    }

    return gazettes;
  }
}
