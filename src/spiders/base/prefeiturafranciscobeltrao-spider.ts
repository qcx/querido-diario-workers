import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig } from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
import puppeteer from "@cloudflare/puppeteer";

interface PrefeiturafranciscobeltraoConfig {
  type: "prefeiturafranciscobeltrao";
  baseUrl: string;
}

/**
 * Spider for Prefeitura de Francisco Beltrão - PR
 *
 * CRONOS/1Doc platform (diariooficial.franciscobeltrao.com.br).
 * React SPA that requires browser rendering.
 * "Listar todas edições" button loads all editions via AJAX.
 * Editions are shown as links with show-edition/{hash} URLs.
 */
export class PrefeiturafranciscobeltraoSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeiturafranciscobeltraoConfig;
    this.baseUrl = platformConfig.baseUrl;
    this.browser = browser || null;
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(
      `Crawling Francisco Beltrão gazette for ${this.config.name}...`,
    );

    try {
      const httpGazettes = await this.crawlHttp();
      if (httpGazettes.length > 0) {
        return httpGazettes;
      }

      if (!this.browser) {
        logger.warn(
          "No browser available for Francisco Beltrão - requires browser rendering",
        );
        return gazettes;
      }

      return await this.crawlWithBrowser();
    } catch (error) {
      logger.error(`Error crawling Francisco Beltrão: ${error}`);
    }

    return gazettes;
  }

  private async crawlHttp(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      const response = await fetch(this.baseUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      if (!response.ok) return gazettes;

      const html = await response.text();

      const editionPattern = /show-edition\/([A-Za-z0-9+/=]+)/g;
      const editionMatches = [...html.matchAll(editionPattern)];

      if (editionMatches.length === 0) {
        logger.info("No editions found via HTTP, will try browser");
        return gazettes;
      }

      for (const match of editionMatches) {
        const hash = match[1];
        const editionUrl = `${this.baseUrl.replace(/\/$/, "")}/show-edition/${hash}`;

        try {
          const editionResponse = await fetch(editionUrl, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
          });

          if (!editionResponse.ok) continue;

          const editionHtml = await editionResponse.text();

          const dateMatch = editionHtml.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) continue;

          const isoDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;

          if (isoDate < this.dateRange.start || isoDate > this.dateRange.end)
            continue;

          const pdfMatch = editionHtml.match(/href="([^"]*\.pdf[^"]*)"/i);
          const pdfUrl = pdfMatch ? pdfMatch[1] : editionUrl;

          const edNumMatch = editionHtml.match(
            /Edi[çc][ãa]o\s*(?:n[°º]?\s*)?(\d+)/i,
          );
          const editionNumber = edNumMatch ? edNumMatch[1] : "";

          gazettes.push({
            date: isoDate,
            editionNumber: editionNumber,
            isExtraEdition: editionHtml.toLowerCase().includes("extraordin"),
            power: "executive",
            fileUrl: pdfUrl,
            scrapedAt: new Date().toISOString(),
            territoryId: this.config.territoryId,
            sourceText: `Diário Oficial Francisco Beltrão - ${isoDate}`,
          });
        } catch {
          continue;
        }
      }
    } catch (error) {
      logger.debug(`HTTP crawling failed: ${error}`);
    }

    return gazettes;
  }

  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    if (!this.browser) return gazettes;

    try {
      const browser = await puppeteer.launch(this.browser);
      const page = await browser.newPage();

      await page.goto(this.baseUrl, {
        waitUntil: "networkidle0",
        timeout: 30000,
      });
      await page.waitForSelector("#btShowAllEditions", { timeout: 10000 });

      await page.click("#btShowAllEditions");
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const editions = await page.evaluate(() => {
        const items: Array<{ text: string; href: string }> = [];
        const links = document.querySelectorAll('a[href*="show-edition"]');
        links.forEach((link) => {
          items.push({
            text: (link as HTMLElement).innerText,
            href: (link as HTMLAnchorElement).href,
          });
        });
        return items;
      });

      for (const edition of editions) {
        const dateMatch = edition.text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (!dateMatch) continue;

        const isoDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
        if (isoDate < this.dateRange.start || isoDate > this.dateRange.end)
          continue;

        const edNumMatch = edition.text.match(
          /Edi[çc][ãa]o\s*(?:n[°º]?\s*)?(\d+)/i,
        );
        const editionNumber = edNumMatch ? edNumMatch[1] : "";

        gazettes.push({
          date: isoDate,
          editionNumber: editionNumber,
          isExtraEdition: edition.text.toLowerCase().includes("extraordin"),
          power: "executive",
          fileUrl: edition.href,
          scrapedAt: new Date().toISOString(),
          territoryId: this.config.territoryId,
          sourceText: edition.text,
        });
      }

      await browser.close();
    } catch (error) {
      logger.error(`Browser crawling failed: ${error}`);
    }

    return gazettes;
  }
}
