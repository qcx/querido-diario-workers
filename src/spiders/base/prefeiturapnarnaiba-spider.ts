import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  PrefeituraParnaraibaConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse } from "node-html-parser";

/**
 * Spider for Prefeitura de Parnaíba official gazette (DOM - Diário Oficial Municipal)
 *
 * Site Structure:
 * - URL: https://dom.parnaiba.pi.gov.br/
 * - Lists gazettes in a grid/list format
 * - Each gazette has a "Visualizar" button that opens the PDF
 * - Pagination with numbered pages
 *
 * PDFs are served from: https://dom.parnaiba.pi.gov.br/assets/diarios/{hash}.pdf
 *
 * Requires browser rendering to extract PDF URLs from links
 */
export class PrefeituraParnaraibaSpider extends BaseSpider {
  private _baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraParnaraibaConfig;
    this._baseUrl = platformConfig.baseUrl || "https://dom.parnaiba.pi.gov.br/";
    this.browser = browser || null;

    logger.info(
      `Initializing PrefeituraParnaraibaSpider for ${config.name} with URL: ${this._baseUrl}`,
    );
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(
        `PrefeituraParnaraibaSpider for ${this.config.name} requires browser binding`,
      );
      return [];
    }

    return this.crawlWithBrowser();
  }

  /**
   * Crawl using browser for JavaScript-rendered content
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

      let hasMorePages = true;
      let pageNum = 1;
      const maxPages = 20;

      while (hasMorePages && pageNum <= maxPages) {
        logger.debug(`Processing page ${pageNum}`);

        const html = await page.content();
        const root = parse(html);

        // Find all gazette entries - look for date patterns and Visualizar links
        const visualizarLinks = root.querySelectorAll("a");
        let foundInRange = false;

        for (const link of visualizarLinks) {
          try {
            const linkText = link.text?.trim() || "";
            const href = link.getAttribute("href") || "";

            // Skip non-visualizar links or non-PDF links
            if (
              !linkText.toLowerCase().includes("visualizar") &&
              !href.includes(".pdf")
            ) {
              continue;
            }

            // Find parent element that might contain the date
            let dateStr = "";
            let parentNode = link.parentNode;
            let maxDepth = 5;

            while (parentNode && maxDepth > 0) {
              const parentText = parentNode.text || "";

              // Look for date pattern DD-MM-YYYY (used in the main table)
              let dateMatch = parentText.match(/(\d{2})-(\d{2})-(\d{4})/);
              if (dateMatch) {
                const [, day, month, year] = dateMatch;
                dateStr = `${year}-${month}-${day}`;
                break;
              }

              // Also try DD/MM/YYYY pattern (alternative format)
              dateMatch = parentText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
              if (dateMatch) {
                const [, day, month, year] = dateMatch;
                dateStr = `${year}-${month}-${day}`;
                break;
              }

              parentNode = parentNode.parentNode;
              maxDepth--;
            }

            if (!dateStr) {
              // Try to extract date from URL filename
              // Pattern 1: DOM_XXXX-DDMMYYYY.pdf or DOM_XXXX_DDMMYYYY.pdf (older files)
              let urlDateMatch = href.match(
                /DOM[_-]\d+[_-](\d{2})(\d{2})(\d{4})/i,
              );
              if (urlDateMatch) {
                const [, day, month, year] = urlDateMatch;
                dateStr = `${year}-${month}-${day}`;
              }
            }

            if (!dateStr) {
              // Pattern 2: DDMMYYYY in URL (8 consecutive digits)
              const urlDateMatch = href.match(/(\d{2})(\d{2})(\d{4})/);
              if (urlDateMatch) {
                const [, day, month, year] = urlDateMatch;
                // Validate it's a reasonable date (year between 2000-2030)
                if (parseInt(year) >= 2000 && parseInt(year) <= 2030) {
                  dateStr = `${year}-${month}-${day}`;
                }
              }
            }

            if (!dateStr) {
              logger.debug(`No date found for link: ${href}`);
              continue;
            }

            const gazetteDate = new Date(dateStr);

            if (isNaN(gazetteDate.getTime())) continue;
            if (gazetteDate < this.startDate) continue;
            if (gazetteDate > this.endDate) continue;

            foundInRange = true;

            // Get PDF URL
            let pdfUrl = href;
            if (!pdfUrl.startsWith("http")) {
              pdfUrl = new URL(pdfUrl, this._baseUrl).href;
            }

            // Extract edition number if available from parent text
            let editionNumber: string | undefined;
            if (parentNode) {
              const editionMatch = (parentNode.text || "").match(
                /(?:Edição|N[°º]?)\s*(\d+)/i,
              );
              if (editionMatch) {
                editionNumber = editionMatch[1];
              }
            }

            const gazette = await this.createGazette(gazetteDate, pdfUrl, {
              editionNumber,
              isExtraEdition: false,
              power: "executive_legislative",
            });

            if (gazette) {
              // Avoid duplicates
              const exists = gazettes.some((g) => g.fileUrl === pdfUrl);
              if (!exists) {
                gazettes.push(gazette);
              }
            }
          } catch (error) {
            logger.error(`Error processing gazette link:`, error as Error);
          }
        }

        // Check for pagination
        const paginationLinks = root.querySelectorAll("a");
        let nextPageUrl = "";

        for (const pLink of paginationLinks) {
          const text = pLink.text?.trim() || "";
          const href = pLink.getAttribute("href") || "";

          // Look for next page link
          if (
            text === String(pageNum + 1) ||
            text.toLowerCase().includes("próximo") ||
            text === "»"
          ) {
            nextPageUrl = href;
            break;
          }
        }

        if (nextPageUrl && foundInRange) {
          if (!nextPageUrl.startsWith("http")) {
            nextPageUrl = new URL(nextPageUrl, this._baseUrl).href;
          }

          logger.debug(`Navigating to next page: ${nextPageUrl}`);
          await page.goto(nextPageUrl, {
            waitUntil: "networkidle0",
            timeout: 30000,
          });
          this.requestCount++;
          await new Promise((resolve) => setTimeout(resolve, 2000));
          pageNum++;
        } else {
          hasMorePages = false;
        }

        // Stop if we've passed the date range
        if (!foundInRange && pageNum > 1) {
          hasMorePages = false;
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`,
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
