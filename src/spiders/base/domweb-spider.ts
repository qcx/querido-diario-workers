import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import { SpiderConfig, DateRange, Gazette } from "../../types";
import { logger } from "../../utils/logger";
import { toISODate, getCurrentTimestamp } from "../../utils/date-utils";

export interface DomWebConfig {
  type: "domweb";
  baseUrl: string;
  requiresClientRendering?: boolean;
  cityName?: string;
}

/**
 * Generic Spider for DomWeb platform (Yii2 framework)
 *
 * DomWeb is a platform used by many Brazilian municipalities for publishing
 * official gazettes. It has a consistent structure across implementations.
 *
 * Site structure:
 * - List URL: {baseUrl}/diario-oficial
 * - Search URL: {baseUrl}/diario-oficial?BuscaSearch[data_inicio]={YYYY-MM-DD}&BuscaSearch[data_fim]={YYYY-MM-DD}
 * - PDF URL: {baseUrl}/diario-oficial/versao-pdf/{id}
 *
 * Examples of cities using this platform:
 * - Maragogi (AL): https://diario.maragogi.al.gov.br/
 * - Nova Friburgo (RJ): https://diario.novafriburgo.rj.gov.br/
 * - Presidente Prudente (SP): https://diario.presidenteprudente.sp.gov.br/
 *
 * NOTE: These sites often block Cloudflare Workers IPs for direct fetch requests.
 * They require a browser binding (Puppeteer) to work properly.
 */
export class DomWebSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;
  private cityName: string;

  private static readonly MONTHS_PT: { [key: string]: string } = {
    janeiro: "01",
    fevereiro: "02",
    março: "03",
    abril: "04",
    maio: "05",
    junho: "06",
    julho: "07",
    agosto: "08",
    setembro: "09",
    outubro: "10",
    novembro: "11",
    dezembro: "12",
  };

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as DomWebConfig;
    this.baseUrl = platformConfig.baseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.browser = browser || null;
    this.cityName = platformConfig.cityName || config.name;
    logger.info(
      `Initializing DomWebSpider for ${this.cityName} with baseUrl: ${this.baseUrl}`,
    );
  }

  /**
   * Set browser instance (for queue consumer context with browser binding)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    const startDateStr = toISODate(this.startDate);
    const endDateStr = toISODate(this.endDate);
    const platformConfig = this.config.config as DomWebConfig;

    logger.info(
      `Crawling DomWeb for ${this.cityName} from ${startDateStr} to ${endDateStr}`,
      {
        hasBrowser: !!this.browser,
        requiresClientRendering: platformConfig.requiresClientRendering,
      },
    );

    // DomWeb sites typically block datacenter IPs - requires browser binding
    if (this.browser && platformConfig.requiresClientRendering === true) {
      logger.debug("Using browser-based crawling for DomWeb site");
      return this.crawlWithBrowser(startDateStr, endDateStr);
    }

    if (platformConfig.requiresClientRendering === true && !this.browser) {
      logger.error(
        "Browser binding required but not available - cannot crawl DomWeb site. Make sure BROWSER binding is configured.",
      );
      return [];
    }

    // Fallback to direct fetch (will likely fail due to IP blocking)
    logger.warn(
      "No browser binding available - direct fetch may fail due to IP blocking",
    );
    return this.crawlWithFetch(startDateStr, endDateStr);
  }

  /**
   * Crawl using Puppeteer browser (for sites that block datacenter IPs)
   */
  private async crawlWithBrowser(
    startDateStr: string,
    endDateStr: string,
  ): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();

      // Build URL with date filters
      const listUrl = `${this.baseUrl}/diario-oficial?BuscaSearch%5Bdata_inicio%5D=${startDateStr}&BuscaSearch%5Bdata_fim%5D=${endDateStr}&per-page=100`;

      logger.debug(`Fetching gazette list with browser: ${listUrl}`);

      await page.goto(listUrl, { waitUntil: "networkidle0", timeout: 30000 });
      this.requestCount++;

      // Wait for content to load
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Extract editions from the page using browser evaluation
      const editions = await page.evaluate(() => {
        const results: Array<{
          id: string;
          editionNumber: string;
          isExtra: boolean;
          pdfUrl: string;
          dateStr: string;
        }> = [];

        const months: { [key: string]: string } = {
          janeiro: "01",
          fevereiro: "02",
          março: "03",
          abril: "04",
          maio: "05",
          junho: "06",
          julho: "07",
          agosto: "08",
          setembro: "09",
          outubro: "10",
          novembro: "11",
          dezembro: "12",
        };

        // Look for gazette cards/boxes
        // DomWeb typically has cards with class containing 'box' or 'card' or 'edicao'
        const selectors = [
          ".box-publicacao[data-key]",
          ".box-publicacao",
          "[data-key]",
          ".publicacao",
          '[class*="edicao"]',
          '[class*="diario"]',
          'div[class*="box"]',
          "article",
          ".card",
        ];

        let boxes: Element[] = [];

        // Find all potential boxes
        for (const selector of selectors) {
          const elements = Array.from(document.querySelectorAll(selector));
          for (const el of elements) {
            const text = el.textContent || "";
            // Check if element contains gazette-related content
            if (
              text.includes("Edição") ||
              text.includes("EDIÇÃO") ||
              text.includes("Veiculação") ||
              text.includes("PDF") ||
              text.includes("Diário")
            ) {
              boxes.push(el);
            }
          }
          if (boxes.length > 0) break;
        }

        // If no boxes found, look for links to PDFs directly
        if (boxes.length === 0) {
          const pdfLinks = document.querySelectorAll(
            'a[href*="pdf"], a[href*="versao-pdf"], a[href*="diario"]',
          );
          pdfLinks.forEach((link) => {
            const href = link.getAttribute("href") || "";
            const text = link.textContent || "";
            const parentText = link.parentElement?.textContent || "";

            // Extract date from text or parent
            let dateStr = "";

            // Pattern: "DD de MES de YYYY"
            const dateMatch = (parentText || text).match(
              /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i,
            );
            if (dateMatch) {
              const day = dateMatch[1].padStart(2, "0");
              const month = months[dateMatch[2].toLowerCase()];
              const year = dateMatch[3];
              if (month) dateStr = `${year}-${month}-${day}`;
            }

            // Pattern: DD/MM/YYYY
            if (!dateStr) {
              const dateMatch2 = (parentText || text).match(
                /(\d{2})\/(\d{2})\/(\d{4})/,
              );
              if (dateMatch2) {
                dateStr = `${dateMatch2[3]}-${dateMatch2[2]}-${dateMatch2[1]}`;
              }
            }

            // Extract edition number
            const editionMatch = (parentText || text).match(
              /(?:Edição|EDIÇÃO)\s*(?:n[º°]?)?\s*(\d+(?:[-\/]\w+)?)/i,
            );
            const editionNumber = editionMatch ? editionMatch[1] : "N/A";
            const isExtra = /extra/i.test(parentText || text);

            if (href && dateStr) {
              results.push({
                id: editionNumber.replace(/[\/\\]/g, "-"),
                editionNumber,
                isExtra,
                pdfUrl: href,
                dateStr,
              });
            }
          });
        }

        // Process each box
        for (const box of boxes) {
          const boxText = box.textContent || "";

          // Extract edition number: "Edição nº 352/2026" or "EDIÇÃO Nº 2512/2026"
          const editionMatch = boxText.match(
            /(?:Edição|EDIÇÃO)\s*(?:n[º°]?)?\s*(\d+(?:[-\/]\w+)?)/i,
          );
          if (!editionMatch) continue;

          const editionNumber = editionMatch[1];
          const isExtra = /extra/i.test(boxText);

          // Extract date
          let dateStr = "";

          // Pattern 1: "Veiculação: 16 de janeiro de 2026" or "16 de janeiro de 2026"
          const dateMatch1 = boxText.match(
            /(?:Veiculação[:\s]*)?(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i,
          );
          if (dateMatch1) {
            const day = dateMatch1[1].padStart(2, "0");
            const month = months[dateMatch1[2].toLowerCase()];
            const year = dateMatch1[3];
            if (month) dateStr = `${year}-${month}-${day}`;
          }

          // Pattern 2: DD/MM/YYYY
          if (!dateStr) {
            const dateMatch2 = boxText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (dateMatch2) {
              dateStr = `${dateMatch2[3]}-${dateMatch2[2]}-${dateMatch2[1]}`;
            }
          }

          // Find PDF link
          let pdfUrl = "";

          // Check for data-key attribute
          const dataKey =
            box.getAttribute("data-key") ||
            box.querySelector("[data-key]")?.getAttribute("data-key") ||
            "";

          // Look for links with href containing pdf, versao, or diario
          const allLinks = box.querySelectorAll("a[href]");
          for (const link of Array.from(allLinks)) {
            const href = link.getAttribute("href") || "";
            if (
              href.includes(".pdf") ||
              href.includes("versao") ||
              href.includes("versão") ||
              href.includes("diario") ||
              href.includes("download") ||
              href.includes("view") ||
              href.includes("visualizar")
            ) {
              pdfUrl = href;
              break;
            }
          }

          // If we have data-key but no PDF link, try to construct the URL
          if (!pdfUrl && dataKey) {
            pdfUrl = `/diario-oficial/versao-pdf/${dataKey}`;
          }

          // Use edition number as ID
          const id = editionNumber.replace(/[\/\\]/g, "-");

          if (pdfUrl) {
            results.push({
              id,
              editionNumber,
              isExtra,
              pdfUrl,
              dateStr,
            });
          }
        }

        return results;
      });

      if (editions.length === 0) {
        logger.info(
          `No gazettes found for date range ${startDateStr} to ${endDateStr}`,
        );
        return gazettes;
      }

      logger.info(`Found ${editions.length} editions using browser`);

      // Process each edition
      for (const edition of editions) {
        try {
          let dateStr = edition.dateStr;

          // If no date found, try to fetch from the view page
          if (!dateStr && edition.id !== "N/A") {
            const viewUrl = `${this.baseUrl}/diario-oficial/view/${edition.id}`;
            try {
              await page.goto(viewUrl, {
                waitUntil: "networkidle0",
                timeout: 15000,
              });
              this.requestCount++;

              dateStr = await page.evaluate(() => {
                const text = document.body.textContent || "";
                const months: { [key: string]: string } = {
                  janeiro: "01",
                  fevereiro: "02",
                  março: "03",
                  abril: "04",
                  maio: "05",
                  junho: "06",
                  julho: "07",
                  agosto: "08",
                  setembro: "09",
                  outubro: "10",
                  novembro: "11",
                  dezembro: "12",
                };

                const match = text.match(
                  /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i,
                );
                if (match) {
                  const day = match[1].padStart(2, "0");
                  const month = months[match[2].toLowerCase()];
                  const year = match[3];
                  if (month) return `${year}-${month}-${day}`;
                }

                const match2 = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                if (match2) {
                  return `${match2[3]}-${match2[2]}-${match2[1]}`;
                }

                return "";
              });
            } catch (e) {
              logger.warn(
                `Failed to fetch date for edition ${edition.editionNumber}: ${e}`,
              );
            }
          }

          if (!dateStr) {
            logger.warn(
              `Could not extract date for edition ${edition.editionNumber}`,
            );
            continue;
          }

          // Create full PDF URL
          const fullPdfUrl = edition.pdfUrl.startsWith("http")
            ? edition.pdfUrl
            : `${this.baseUrl}${edition.pdfUrl}`;

          const gazette: Gazette = {
            date: dateStr,
            fileUrl: fullPdfUrl,
            territoryId: this.config.territoryId,
            scrapedAt: getCurrentTimestamp(),
            editionNumber: edition.editionNumber,
            isExtraEdition: edition.isExtra,
            power: "executive",
            sourceText: `Diário Oficial de ${this.cityName} - Edição nº ${edition.editionNumber}${edition.isExtra ? " - EXTRA" : ""}`,
          };

          gazettes.push(gazette);
          logger.info(
            `Found gazette: Edition ${edition.editionNumber} - ${dateStr}`,
          );
        } catch (e) {
          logger.warn(
            `Failed to process edition ${edition.editionNumber}: ${e}`,
          );
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes with browser`,
      );
    } catch (error) {
      logger.error(`Error crawling DomWeb with browser:`, error as Error);
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (e) {
          /* ignore */
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (e) {
          /* ignore */
        }
      }
    }

    return gazettes;
  }

  /**
   * Crawl using direct fetch (fallback, may fail due to IP blocking)
   */
  private async crawlWithFetch(
    startDateStr: string,
    endDateStr: string,
  ): Promise<Gazette[]> {
    logger.warn("Direct fetch not implemented for DomWeb - requires browser");
    return [];
  }
}
