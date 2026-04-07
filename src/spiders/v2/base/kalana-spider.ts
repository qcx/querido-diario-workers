import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange, KalanaConfig } from "../../../types";
import { logger } from "../../../utils/logger";
import { getCurrentTimestamp } from "../../../utils/date-utils";

interface KalanaApiResponse {
  valid?: boolean;
  data?: Array<{
    diarios_key_id?: number;
    diario_data?: string;
    diario_numero?: string | number;
    diario_nome?: string;
    diario_arquivo?: string;
    diario_data_publicacao?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

/**
 * V2 Spider for Kalana platform (Flutter Web SPA)
 *
 * Kalana renders via canvas/WebGL so DOM extraction is impossible.
 * We intercept the API responses that Flutter makes to its backend.
 */
export class KalanaSpider extends BaseSpider {
  protected kalanaConfig: KalanaConfig;
  private browser: Fetcher | null = null;

  constructor(
    spiderConfig: SpiderConfig,
    dateRange: DateRange,
    browser?: Fetcher,
  ) {
    super(spiderConfig, dateRange);
    this.kalanaConfig = spiderConfig.config as KalanaConfig;
    this.browser = browser || null;

    logger.info(
      `Initializing v2 KalanaSpider for ${spiderConfig.name} with CNPJ: ${this.kalanaConfig.cnpj}`,
    );
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    const cnpj = this.kalanaConfig.cnpj;
    const baseUrl = `https://app.kalana.com.br/?c=${cnpj}&r=diariooficial&u=0000`;

    logger.info(`Crawling ${baseUrl} for ${this.spiderConfig.name}...`);

    if (this.browser && this.kalanaConfig.requiresClientRendering === true) {
      return this.crawlWithBrowser(baseUrl);
    }

    logger.warn(
      `Browser not available for Kalana. Platform requires client rendering.`,
    );
    return [];
  }

  /**
   * Intercept Flutter API calls via Puppeteer to extract gazette data.
   */
  private async crawlWithBrowser(baseUrl: string): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    const interceptedData: KalanaApiResponse[] = [];

    try {
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();

      await page.setRequestInterception(true);

      page.on("request", (request: any) => {
        const url = request.url();
        if (
          url.includes("mobiledados") ||
          url.includes("kalana.com.br/api")
        ) {
          logger.debug(`Intercepted API request: ${url}`);
        }
        request.continue();
      });

      page.on("response", async (response: any) => {
        const url = response.url();

        try {
          if (
            url.includes("mobiledados") ||
            url.includes("kalana.com.br/api")
          ) {
            const contentType = response.headers()["content-type"] || "";
            if (contentType.includes("application/json")) {
              const text = await response.text();
              try {
                const data = JSON.parse(text);
                logger.debug(
                  `Captured API response from ${url}, size: ${text.length}`,
                );

                if (data && data.valid !== false) {
                  const dataArray =
                    data.data || (Array.isArray(data) ? data : []);

                  const hasGazetteData = dataArray.some((item: any) => {
                    if (typeof item === "object" && item !== null) {
                      const keys = Object.keys(item);
                      return keys.some(
                        (k: string) =>
                          k.includes("diario") ||
                          k.includes("data_publicacao") ||
                          k.includes("arquivo") ||
                          k.includes("edicao"),
                      );
                    }
                    return false;
                  });

                  if (hasGazetteData) {
                    interceptedData.push(data);
                    logger.info(
                      `Found gazette data in API response with ${dataArray.length} items`,
                    );
                  } else {
                    logger.debug(
                      `API response does not contain gazette data (likely permissions/config)`,
                    );
                  }
                }
              } catch {
                // Not JSON
              }
            }
          }
        } catch {
          // Response body might not be available
        }
      });

      logger.debug(`Navigating to: ${baseUrl}`);
      this.requestCount++;
      await page.goto(baseUrl, { waitUntil: "networkidle0", timeout: 90000 });

      logger.debug(`Waiting for Flutter app to initialize...`);
      await new Promise((resolve) => setTimeout(resolve, 20000));

      logger.debug(`Attempting to trigger gazette data loading...`);
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await new Promise((resolve) => setTimeout(resolve, 5000));

      try {
        await page.mouse.click(400, 400);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await page.mouse.click(400, 600);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } catch (e) {
        logger.debug(`Mouse interaction failed: ${e}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 5000));

      logger.info(
        `Processing ${interceptedData.length} intercepted API responses`,
      );

      for (const apiResponse of interceptedData) {
        const dataArray =
          apiResponse.data || (Array.isArray(apiResponse) ? apiResponse : []);

        for (const item of dataArray) {
          try {
            const gazette = this.extractGazetteFromApiItem(item);
            if (gazette) {
              if (this.isInDateRange(new Date(gazette.date))) {
                gazettes.push(gazette);
              }
            }
          } catch (e) {
            logger.debug(`Error extracting gazette from item: ${e}`);
          }
        }
      }

      if (gazettes.length === 0) {
        logger.info(
          `No API responses captured, trying alternative extraction...`,
        );
        const pdfLinks = await this.extractPdfLinksFromPage(page);
        for (const link of pdfLinks) {
          const gazette = this.buildGazetteFromPdfLink(link);
          if (gazette && this.isInDateRange(new Date(gazette.date))) {
            gazettes.push(gazette);
          }
        }
      }

      logger.info(
        `Crawled ${gazettes.length} gazettes from Kalana for ${this.spiderConfig.name}`,
      );
    } catch (error) {
      logger.error(`Error crawling Kalana with browser:`, error as Error);
    } finally {
      if (page) {
        try {
          await page.close();
        } catch {
          // ignore
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch {
          // ignore
        }
      }
    }

    return gazettes;
  }

  private extractGazetteFromApiItem(
    item: Record<string, unknown>,
  ): Gazette | null {
    try {
      const dateField =
        item.diario_data ||
        item.diario_data_publicacao ||
        item.data ||
        item.data_publicacao;

      const fileField =
        item.diario_arquivo ||
        item.arquivo ||
        item.file ||
        item.pdf ||
        item.url;

      const editionField =
        item.diario_numero || item.numero || item.edicao || item.edition;

      const titleField =
        item.diario_nome || item.nome || item.titulo || item.title;

      if (!dateField || !fileField) return null;

      let dateStr: string;
      if (typeof dateField === "string") {
        const ddmmyyyy = dateField.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        const yyyymmdd = dateField.match(/(\d{4})-(\d{2})-(\d{2})/);
        const timestamp = dateField.match(/(\d{4})-(\d{2})-(\d{2})T/);

        if (ddmmyyyy) {
          dateStr = `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
        } else if (yyyymmdd) {
          dateStr = `${yyyymmdd[1]}-${yyyymmdd[2]}-${yyyymmdd[3]}`;
        } else if (timestamp) {
          dateStr = `${timestamp[1]}-${timestamp[2]}-${timestamp[3]}`;
        } else {
          const d = new Date(dateField);
          if (!isNaN(d.getTime())) {
            dateStr = d.toISOString().split("T")[0];
          } else {
            return null;
          }
        }
      } else {
        return null;
      }

      let fileUrl: string;
      if (typeof fileField === "string") {
        if (fileField.startsWith("http")) {
          fileUrl = fileField;
        } else {
          fileUrl = `https://kalana.com.br/download/?file_name=${encodeURIComponent(fileField)}&cnpj=${this.kalanaConfig.cnpj}`;
        }
      } else {
        return null;
      }

      const editionNumber =
        typeof editionField === "string" || typeof editionField === "number"
          ? String(editionField)
          : "";

      const title =
        typeof titleField === "string"
          ? titleField
          : `Diário Oficial ${dateStr}`;

      return {
        date: dateStr,
        fileUrl,
        territoryId: this.spiderConfig.territoryId,
        scrapedAt: getCurrentTimestamp(),
        isExtraEdition: false,
        power: "executive",
        editionNumber,
        sourceText: title,
      };
    } catch {
      return null;
    }
  }

  private async extractPdfLinksFromPage(
    page: any,
  ): Promise<Array<{ url: string; date?: string }>> {
    const pdfLinks: Array<{ url: string; date?: string }> = [];

    try {
      const requests: string[] = await page.evaluate(() => {
        const pageContent = document.body?.innerHTML || "";
        return (
          pageContent.match(/https?:\/\/[^"'\s]+\.pdf/gi) || []
        );
      });

      for (const url of requests) {
        const dateMatch = url.match(/(\d{4})[_-]?(\d{2})[_-]?(\d{2})/);
        const date = dateMatch
          ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
          : undefined;
        pdfLinks.push({ url, date });
      }
    } catch (e) {
      logger.debug(`Failed to extract PDF links from page: ${e}`);
    }

    return pdfLinks;
  }

  private buildGazetteFromPdfLink(link: {
    url: string;
    date?: string;
  }): Gazette | null {
    if (!link.date) return null;

    return {
      date: link.date,
      fileUrl: link.url,
      territoryId: this.spiderConfig.territoryId,
      scrapedAt: getCurrentTimestamp(),
      isExtraEdition: false,
      power: "executive",
      editionNumber: "",
      sourceText: `Diário Oficial ${link.date}`,
    };
  }
}
