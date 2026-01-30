import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange, KalanaConfig } from "../../types";
import { logger } from "../../utils/logger";
import { getCurrentTimestamp } from "../../utils/date-utils";
import puppeteer from "@cloudflare/puppeteer";

/**
 * Interface for intercepted API response data
 */
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
 * KalanaSpider implementation
 *
 * Crawls official gazettes from Kalana platform (Flutter Web SPA)
 * Example: https://app.kalana.com.br/?c=12264222000109&r=diariooficial&u=0000
 *
 * IMPORTANT: Kalana is a Flutter Web application that renders via canvas/WebGL.
 * This means we CANNOT extract data from the DOM directly.
 * Instead, we intercept the API responses that Flutter makes to its backend.
 */
export class KalanaSpider extends BaseSpider {
  protected kalanaConfig: KalanaConfig;
  private browser?: any;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.kalanaConfig = spiderConfig.config as KalanaConfig;

    logger.info(
      `Initializing KalanaSpider for ${spiderConfig.name} with CNPJ: ${this.kalanaConfig.cnpj}`,
    );
  }

  setBrowser(browser: any): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    const cnpj = this.kalanaConfig.cnpj;
    const baseUrl = `https://app.kalana.com.br/?c=${cnpj}&r=diariooficial&u=0000`;

    logger.info(`Crawling ${baseUrl} for ${this.spiderConfig.name}...`);

    // If browser is available and requiresClientRendering is true, use Puppeteer
    if (this.browser && this.kalanaConfig.requiresClientRendering === true) {
      return this.crawlWithBrowser(baseUrl);
    }

    // Fallback - try to fetch data without browser
    logger.warn(
      `Browser not available for Kalana. Platform requires client rendering.`,
    );
    return [];
  }

  /**
   * Crawl using Puppeteer browser with network interception
   *
   * Since Kalana is a Flutter Web app that renders via canvas,
   * we intercept the API calls to extract gazette data.
   */
  private async crawlWithBrowser(baseUrl: string): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    // Store intercepted API responses
    const interceptedData: KalanaApiResponse[] = [];

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();

      // Set up request interception to capture API responses
      await page.setRequestInterception(true);

      // Store a reference to captured responses
      const capturedResponses: Map<string, Promise<string>> = new Map();

      // Handle requests - let them pass through but mark API calls
      page.on("request", (request: any) => {
        const url = request.url();
        // Check if this is an API call to mobiledados
        if (url.includes("mobiledados") || url.includes("kalana.com.br/api")) {
          logger.debug(`Intercepted API request: ${url}`);
        }
        request.continue();
      });

      // Handle responses - capture API data
      page.on("response", async (response: any) => {
        const url = response.url();

        try {
          // Check if this is an API response we're interested in
          if (
            url.includes("mobiledados") ||
            url.includes("kalana.com.br/api")
          ) {
            const contentType = response.headers()["content-type"] || "";
            if (contentType.includes("application/json")) {
              const text = await response.text();
              try {
                const data = JSON.parse(text);
                logger.debug(`Captured API response from ${url}, size: ${text.length}`);

                // Check if this contains gazette data - look for diario-specific fields
                if (data && data.valid !== false) {
                  const dataArray = data.data || (Array.isArray(data) ? data : []);
                  
                  // Check if any item has diario-related fields
                  const hasGazetteData = dataArray.some((item: any) => {
                    if (typeof item === "object" && item !== null) {
                      const keys = Object.keys(item);
                      return keys.some(
                        (k) =>
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
                    logger.info(`Found gazette data in API response with ${dataArray.length} items`);
                  } else {
                    logger.debug(`API response does not contain gazette data (likely permissions/config)`);
                  }
                }
              } catch (parseError) {
                // Not JSON, ignore
              }
            }
          }
        } catch (e) {
          // Response body might not be available, ignore
        }
      });

      // Navigate to the diario page
      logger.debug(`Navigating to: ${baseUrl}`);
      await page.goto(baseUrl, { waitUntil: "networkidle0", timeout: 90000 });

      // Wait for Flutter app to load and make API calls
      // Flutter apps typically need more time to initialize
      logger.debug(`Waiting for Flutter app to initialize...`);
      await new Promise((resolve) => setTimeout(resolve, 20000));

      // Try scrolling and clicking to trigger API calls for gazette data
      logger.debug(`Attempting to trigger gazette data loading...`);
      
      // Scroll down to load more content
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await new Promise((resolve) => setTimeout(resolve, 5000));
      
      // Try clicking in different areas to trigger data loading
      // Flutter apps may need interaction to load data
      try {
        // Click in the center of the page
        await page.mouse.click(400, 400);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        
        // Click lower
        await page.mouse.click(400, 600);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } catch (e) {
        logger.debug(`Mouse interaction failed: ${e}`);
      }
      
      // Wait for additional network activity
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Process intercepted data
      logger.info(
        `Processing ${interceptedData.length} intercepted API responses`,
      );

      for (const apiResponse of interceptedData) {
        logger.debug(`API Response keys: ${Object.keys(apiResponse).join(", ")}`);
        logger.debug(`API Response valid: ${apiResponse.valid}, has data: ${!!apiResponse.data}, isArray: ${Array.isArray(apiResponse)}`);
        
        const dataArray =
          apiResponse.data || (Array.isArray(apiResponse) ? apiResponse : []);

        logger.debug(`Data array length: ${dataArray.length}`);
        
        if (dataArray.length > 0) {
          const sampleItem = dataArray[0];
          logger.debug(`Sample item keys: ${Object.keys(sampleItem as Record<string, unknown>).join(", ")}`);
          logger.debug(`Sample item: ${JSON.stringify(sampleItem).substring(0, 500)}`);
        }

        for (const item of dataArray) {
          try {
            // Extract gazette information from API response
            const gazette = this.extractGazetteFromApiItem(item);
            if (gazette) {
              logger.debug(`Extracted gazette: ${gazette.date}, file: ${gazette.fileUrl.substring(0, 100)}`);
              if (this.isInDateRange(new Date(gazette.date))) {
                gazettes.push(gazette);
              } else {
                logger.debug(`Gazette ${gazette.date} is outside date range`);
              }
            } else {
              logger.debug(`Failed to extract gazette from item: ${JSON.stringify(item).substring(0, 200)}`);
            }
          } catch (e) {
            logger.debug(`Error extracting gazette from item: ${e}`);
          }
        }
      }

      // If we didn't intercept any API calls, try to capture download links
      // by looking at network requests for PDFs
      if (gazettes.length === 0) {
        logger.info(
          `No API responses captured, trying alternative extraction methods...`,
        );

        // Try to find PDF download links in network requests
        const pdfLinks = await this.extractPdfLinksFromPage(page);
        for (const link of pdfLinks) {
          const gazette = this.createGazetteFromPdfLink(link);
          if (gazette && this.isInDateRange(new Date(gazette.date))) {
            gazettes.push(gazette);
          }
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes from Kalana for ${this.spiderConfig.name}`,
      );
    } catch (error) {
      logger.error(`Error crawling Kalana with browser:`, error as Error);
    } finally {
      // Clean up
      if (page) {
        try {
          await page.close();
        } catch (e) {
          // Ignore close errors
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (e) {
          // Ignore close errors
        }
      }
    }

    return gazettes;
  }

  /**
   * Extract gazette information from a Kalana API response item
   */
  private extractGazetteFromApiItem(
    item: Record<string, unknown>,
  ): Gazette | null {
    try {
      // Common field names in Kalana API
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

      if (!dateField || !fileField) {
        return null;
      }

      // Parse date
      let dateStr: string;
      if (typeof dateField === "string") {
        // Try to parse different date formats
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
          // Try direct parse
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

      // Build file URL
      let fileUrl: string;
      if (typeof fileField === "string") {
        if (fileField.startsWith("http")) {
          fileUrl = fileField;
        } else {
          // Use Kalana download endpoint
          fileUrl = `https://kalana.com.br/download/?file_name=${encodeURIComponent(fileField)}&cnpj=${this.kalanaConfig.cnpj}`;
        }
      } else {
        return null;
      }

      // Edition number
      const editionNumber =
        typeof editionField === "string" || typeof editionField === "number"
          ? String(editionField)
          : "";

      // Title
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
    } catch (e) {
      return null;
    }
  }

  /**
   * Try to extract PDF links from network requests
   */
  private async extractPdfLinksFromPage(
    page: any,
  ): Promise<Array<{ url: string; date?: string }>> {
    const pdfLinks: Array<{ url: string; date?: string }> = [];

    try {
      // Get all network requests that contain PDF references
      const requests = await page.evaluate(() => {
        // Look for any data in the page that might contain PDF URLs
        const pageContent = document.body?.innerHTML || "";
        const pdfMatches =
          pageContent.match(/https?:\/\/[^"'\s]+\.pdf/gi) || [];
        return pdfMatches;
      });

      for (const url of requests) {
        // Try to extract date from URL
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

  /**
   * Create a gazette from a PDF link
   */
  private createGazetteFromPdfLink(link: {
    url: string;
    date?: string;
  }): Gazette | null {
    if (!link.date) {
      return null;
    }

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
