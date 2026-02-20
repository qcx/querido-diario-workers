import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  PrefeiturareTeresinhaConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse } from "node-html-parser";

/**
 * Spider for Prefeitura de Teresina official gazette (DOM - Diário Oficial Municipal)
 *
 * Site Structure:
 * - URL: https://dom.pmt.pi.gov.br/lista_diario.php
 * - Lists gazettes as "DOM{number}-{DDMMYYYY}" format
 * - PDF URLs: https://dom.pmt.pi.gov.br/admin/upload/DOM{number}-{DDMMYYYY}-ASSINADO.pdf
 * - Pagination with numbered pages
 * - Date filter inputs available
 *
 * Requires browser rendering for JavaScript-rendered content
 */
export class PrefeiturareTeresinhaSpider extends BaseSpider {
  private _baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeiturareTeresinhaConfig;
    this._baseUrl =
      platformConfig.baseUrl || "https://dom.pmt.pi.gov.br/lista_diario.php";
    this.browser = browser || null;

    logger.info(
      `Initializing PrefeiturareTeresinhaSpider for ${config.name} with URL: ${this._baseUrl}`,
    );
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(
      `Crawling Prefeitura Teresina for ${this.config.name}... (${this._baseUrl})`,
    );

    // Try HTTP-first approach
    try {
      const httpGazettes = await this.crawlWithHttp();
      if (httpGazettes.length > 0) {
        return httpGazettes;
      }
    } catch (error) {
      logger.warn(`HTTP crawl failed, falling back to browser: ${error}`);
    }

    if (this.browser) {
      return this.crawlWithBrowser();
    }

    return gazettes;
  }

  /**
   * Crawl using HTTP requests (preferred method)
   */
  private async crawlWithHttp(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      logger.debug(`Fetching page via HTTP: ${this._baseUrl}`);

      const response = await fetch(this._baseUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      const root = parse(html);

      // Find all gazette links (DOM{number}-{DDMMYYYY})
      const links = root.querySelectorAll("a");

      for (const link of links) {
        try {
          const linkText = link.text?.trim() || "";

          // Match pattern: DOM4185-27012026
          const domMatch = linkText.match(/DOM(\d+)-(\d{2})(\d{2})(\d{4})/i);
          if (!domMatch) continue;

          const [, editionNumber, day, month, year] = domMatch;
          const gazetteDate = new Date(`${year}-${month}-${day}`);

          // Check date range
          if (isNaN(gazetteDate.getTime())) continue;
          if (gazetteDate < this.startDate) continue;
          if (gazetteDate > this.endDate) continue;

          // Construct PDF URL
          const pdfUrl = `https://dom.pmt.pi.gov.br/admin/upload/DOM${editionNumber}-${day}${month}${year}-ASSINADO.pdf`;

          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber,
            isExtraEdition: false,
            power: "executive_legislative",
            sourceText: linkText,
          });

          if (gazette) {
            gazettes.push(gazette);
          }
        } catch (error) {
          logger.error(`Error processing gazette link:`, error as Error);
        }
      }

      // Check for more pages if needed
      let pageNum = 2;
      const maxPages = 10;

      while (gazettes.length > 0 && pageNum <= maxPages) {
        const oldestGazette = gazettes.reduce((oldest, g) => {
          const gDate = new Date(g.date);
          const oDate = new Date(oldest.date);
          return gDate < oDate ? g : oldest;
        });

        if (new Date(oldestGazette.date) <= this.startDate) {
          break; // We have all the gazettes we need
        }

        // Try to fetch next page
        const pageUrl = `${this._baseUrl}?page=${pageNum}`;
        logger.debug(`Fetching page ${pageNum}: ${pageUrl}`);

        const pageResponse = await fetch(pageUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });

        if (!pageResponse.ok) break;

        const pageHtml = await pageResponse.text();
        const pageRoot = parse(pageHtml);
        const pageLinks = pageRoot.querySelectorAll("a");

        let foundNew = false;
        for (const link of pageLinks) {
          const linkText = link.text?.trim() || "";
          const domMatch = linkText.match(/DOM(\d+)-(\d{2})(\d{2})(\d{4})/i);
          if (!domMatch) continue;

          const [, editionNumber, day, month, year] = domMatch;
          const gazetteDate = new Date(`${year}-${month}-${day}`);

          if (isNaN(gazetteDate.getTime())) continue;
          if (gazetteDate < this.startDate) continue;
          if (gazetteDate > this.endDate) continue;

          // Check if already exists
          const exists = gazettes.some(
            (g) => g.editionNumber === editionNumber,
          );
          if (exists) continue;

          const pdfUrl = `https://dom.pmt.pi.gov.br/admin/upload/DOM${editionNumber}-${day}${month}${year}-ASSINADO.pdf`;

          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber,
            isExtraEdition: false,
            power: "executive_legislative",
          });

          if (gazette) {
            gazettes.push(gazette);
            foundNew = true;
          }
        }

        if (!foundNew) break;
        pageNum++;
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes for ${this.config.name} via HTTP`,
      );
    } catch (error) {
      logger.error(`Error in HTTP crawl: ${error}`);
      throw error;
    }

    return gazettes;
  }

  /**
   * Crawl using browser for JavaScript-rendered content (fallback)
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();

      logger.debug(`Navigating to: ${this._baseUrl}`);

      await page.goto(this._baseUrl, {
        waitUntil: "networkidle0",
        timeout: 30000,
      });
      this.requestCount++;

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const html = await page.content();
      const root = parse(html);

      const links = root.querySelectorAll("a");

      for (const link of links) {
        try {
          const linkText = link.text?.trim() || "";

          const domMatch = linkText.match(/DOM(\d+)-(\d{2})(\d{2})(\d{4})/i);
          if (!domMatch) continue;

          const [, editionNumber, day, month, year] = domMatch;
          const gazetteDate = new Date(`${year}-${month}-${day}`);

          if (isNaN(gazetteDate.getTime())) continue;
          if (gazetteDate < this.startDate) continue;
          if (gazetteDate > this.endDate) continue;

          const pdfUrl = `https://dom.pmt.pi.gov.br/admin/upload/DOM${editionNumber}-${day}${month}${year}-ASSINADO.pdf`;

          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber,
            isExtraEdition: false,
            power: "executive_legislative",
          });

          if (gazette) {
            gazettes.push(gazette);
          }
        } catch (error) {
          logger.error(`Error processing gazette link:`, error as Error);
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes for ${this.config.name} via browser`,
      );
    } catch (error) {
      logger.error(`Error crawling ${this.config.name}:`, error as Error);
    } finally {
      if (page) await page.close();
      if (browserInstance) await browserInstance.close();
    }

    return gazettes;
  }
}
