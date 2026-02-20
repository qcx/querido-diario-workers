import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  PrefeituratransparenteConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";

/**
 * Spider for Prefeitura Transparente platform
 *
 * Platform: prefeituratransparente.com.br (Laravel + Vue.js SPA)
 *
 * Used by: Coroatá-MA (dom.coroata.ma.gov.br)
 *
 * This is a SPA platform that requires client-side JavaScript rendering.
 * The page contains a table of gazettes with "Baixar" buttons.
 * Each row contains: edition number, date, PDF download link.
 */
export class PrefeituratransparenteSpider extends BaseSpider {
  protected config: PrefeituratransparenteConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeituratransparenteConfig;

    if (!this.config.baseUrl) {
      throw new Error(
        `PrefeituratransparenteSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeituratransparenteSpider for ${spiderConfig.name} with URL: ${this.config.baseUrl}`,
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

  /**
   * Crawl using Puppeteer browser
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();

    try {
      // @ts-expect-error - Cloudflare Puppeteer has different API
      const browserInstance = await puppeteer.launch(this.browser);
      const page = await browserInstance.newPage();

      await page.setViewport({ width: 1280, height: 800 });

      await page.goto(this.config.baseUrl, {
        waitUntil: "networkidle0",
        timeout: 30000,
      });

      // Wait for page content to load - Vue.js SPA needs time
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Wait for content elements (buttons with "Baixar" text or PDF links)
      await page
        .waitForSelector(
          'a[href*=".pdf"], button:has-text("Baixar"), a:has-text("Baixar")',
          {
            timeout: 15000,
          },
        )
        .catch(() => {
          logger.debug("Waiting for download buttons...");
        });

      // Additional wait for dynamic content
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Extract gazette data from the page
      const pageGazettes = await page.evaluate(() => {
        const items: Array<{
          href: string | null;
          dateText: string;
          editionNumber: string | undefined;
        }> = [];

        // Strategy 1: Look for table rows with download buttons
        const tableRows = document.querySelectorAll(
          "table tbody tr, [class*='table'] tbody tr, .list-item, .gazette-item",
        );

        for (const row of tableRows) {
          const rowText = row.textContent || "";

          // Try to find a download link
          let href: string | null = null;
          const downloadLink = row.querySelector(
            'a[href*=".pdf"], a[href*="download"], a[download]',
          );
          if (downloadLink) {
            href = downloadLink.getAttribute("href");
          }

          // Also check for links in buttons
          if (!href) {
            const buttonLink = row
              .querySelector("a:has(button), a button")
              ?.closest("a");
            if (buttonLink) {
              href = buttonLink.getAttribute("href");
            }
          }

          if (!href) continue;

          // Extract date - look for DD/MM/YYYY format
          let dateText = "";
          const dateMatch = rowText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (dateMatch) {
            dateText = dateMatch[0];
          }

          // Extract edition number
          let editionNumber: string | undefined;
          const editionMatch = rowText.match(
            /(?:Edi[çc][ãa]o|Nº?|N\.|#)\s*:?\s*(\d+)/i,
          );
          if (editionMatch) {
            editionNumber = editionMatch[1];
          }

          items.push({ href, dateText, editionNumber });
        }

        // Strategy 2: If no table rows found, look for any download links
        if (items.length === 0) {
          const allLinks = document.querySelectorAll(
            'a[href*=".pdf"], a[href*="download"]',
          );

          for (const link of allLinks) {
            const href = link.getAttribute("href");
            if (!href) continue;

            // Get context from parent elements
            let parent = link.parentElement;
            let dateText = "";
            let editionNumber: string | undefined;

            for (let i = 0; i < 10 && parent; i++) {
              const text = parent.textContent || "";

              // Find date
              if (!dateText) {
                const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                if (dateMatch) {
                  dateText = dateMatch[0];
                }
              }

              // Find edition number
              if (!editionNumber) {
                const editionMatch = text.match(
                  /(?:Edi[çc][ãa]o|Nº?|N\.|#)\s*:?\s*(\d+)/i,
                );
                if (editionMatch) {
                  editionNumber = editionMatch[1];
                }
              }

              if (dateText && editionNumber) break;
              parent = parent.parentElement;
            }

            items.push({ href, dateText, editionNumber });
          }
        }

        // Strategy 3: Look for Vue.js rendered data-* attributes
        if (items.length === 0) {
          const cards = document.querySelectorAll(
            "[data-edition], [data-diario], .card, .publication",
          );

          for (const card of cards) {
            const downloadBtn = card.querySelector("a[href], button[onclick]");
            if (!downloadBtn) continue;

            const href =
              downloadBtn.getAttribute("href") ||
              (downloadBtn.getAttribute("onclick") || "").match(
                /window\.open\(['"]([^'"]+)['"]/,
              )?.[1];

            if (!href) continue;

            const cardText = card.textContent || "";
            let dateText = "";
            const dateMatch = cardText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (dateMatch) {
              dateText = dateMatch[0];
            }

            let editionNumber: string | undefined;
            const editionMatch = cardText.match(
              /(?:Edi[çc][ãa]o|Nº?|N\.|#)\s*:?\s*(\d+)/i,
            );
            if (editionMatch) {
              editionNumber = editionMatch[1];
            }

            items.push({ href, dateText, editionNumber });
          }
        }

        return items;
      });

      const baseUrl = new URL(this.config.baseUrl);

      for (const item of pageGazettes) {
        if (!item.href) continue;

        let date: string | null = null;

        // Try to extract date from dateText
        if (item.dateText) {
          const dateMatch = item.dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (dateMatch) {
            const [, day, month, year] = dateMatch;
            date = `${year}-${month}-${day}`;
          }
        }

        // Try URL date patterns
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
          logger.debug(`Skipping gazette without date: ${item.href}`);
          continue;
        }

        if (!this.isInDateRange(new Date(date))) continue;

        const fullUrl = item.href.startsWith("http")
          ? item.href
          : `${baseUrl.origin}${item.href.startsWith("/") ? "" : "/"}${item.href}`;

        // Avoid duplicates
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
