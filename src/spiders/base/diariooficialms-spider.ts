import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  DiarioOficialMSConfig,
} from "../../types";
import { logger } from "../../utils/logger";
import { toISODate } from "../../utils/date-utils";

/**
 * Diário Oficial MS (Assomasul) - plataforma centralizada para municípios de MS
 *
 * URL: https://www.diariooficialms.com.br/assomasul
 * A página carrega "Arquivo de Publicações" via JavaScript.
 * Requer browser para renderizar e extrair lista por município (cityName).
 */
export class DiarioOficialMSSpider extends BaseSpider {
  private readonly config: DiarioOficialMSConfig;
  private readonly baseUrl: string;
  private readonly cityName: string;
  private browser: Fetcher | null = null;

  constructor(
    spiderConfig: SpiderConfig,
    dateRange: DateRange,
    browser?: Fetcher,
  ) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as DiarioOficialMSConfig;
    this.baseUrl = (this.config.baseUrl || "").replace(/\/$/, "");
    this.cityName = this.config.cityName || spiderConfig.name.split(" - ")[0];
    this.browser = browser || null;

    logger.info(
      `Initializing DiarioOficialMSSpider for ${spiderConfig.name} with city: ${this.cityName}`,
    );
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.warn(
        `DiarioOficialMSSpider for ${this.config.name} requires browser binding; returning empty`,
      );
      return [];
    }
    return this.crawlWithBrowser();
  }

  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();

      await page.goto(this.baseUrl, {
        waitUntil: "networkidle0",
        timeout: 60000,
      });
      this.requestCount++;

      await new Promise((resolve) => setTimeout(resolve, 5000));

      const items = await page.evaluate(
        (cityName) => {
          const results: { date: string; pdfUrl: string }[] = [];
          const links = document.querySelectorAll(
            'a[href*=".pdf"], a[href*="download"], a[href*="arquivo"]',
          );
          for (const a of Array.from(links)) {
            const href = (a as HTMLAnchorElement).href;
            if (!href || !href.toLowerCase().includes(".pdf")) continue;
            const row = (a as HTMLElement).closest("tr, .item, .publicacao, li");
            const text = (row || a).textContent || "";
            const dateMatch = text.match(
              /(\d{2})[\/\-](\d{2})[\/\-](\d{4})|(\d{4})[\/\-](\d{2})[\/\-](\d{2})/,
            );
            if (dateMatch) {
              let iso: string;
              if (dateMatch[4]) {
                iso = `${dateMatch[4]}-${dateMatch[5]}-${dateMatch[6]}`;
              } else {
                iso = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
              }
              results.push({ date: iso, pdfUrl: href });
            } else {
              results.push({
                date: new Date().toISOString().slice(0, 10),
                pdfUrl: href,
              });
            }
          }
          return results;
        },
        this.cityName,
      );

      const startStr = toISODate(this.startDate);
      const endStr = toISODate(this.endDate);

      for (const item of items) {
        if (item.date >= startStr && item.date <= endStr) {
          gazettes.push({
            date: item.date,
            fileUrl: item.pdfUrl,
            territoryId: this.spiderConfig.territoryId,
            scrapedAt: new Date().toISOString(),
            power: "executive",
          });
        }
      }

      logger.info(
        `DiarioOficialMSSpider found ${gazettes.length} gazettes for ${this.cityName}`,
      );
    } catch (error) {
      logger.error(
        `Error crawling DiarioOficialMS for ${this.cityName}:`,
        error as Error,
      );
    } finally {
      if (page) await page.close().catch(() => {});
      if (browserInstance) await browserInstance.close().catch(() => {});
    }

    return gazettes;
  }
}
