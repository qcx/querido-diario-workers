import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig, AgapeConfig } from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";

/**
 * Spider for Ágape Sistemas platform
 *
 * This platform is used by municipalities for publishing official gazettes.
 * URL pattern: https://agportal.agapesistemas.com.br/DiarioOficial/?alias={alias}
 *
 * Features:
 * - JSF-based application with AJAX form submission
 * - Search by date range
 * - PDF download via form POST
 * - Multiple entities per municipality (Prefeitura, Fundo de Saúde, etc.)
 *
 * The platform uses JavaServer Faces (JSF) with RichFaces for AJAX.
 * To download PDFs:
 * 1. GET the page to obtain the session (jsessionid) and ViewState
 * 2. POST with form:j_id39:{index}:j_id50 to download the PDF for that gazette
 *
 * NOTE: This spider uses HTTP requests only (no browser required).
 */
export class AgapeSpider extends BaseSpider {
  private alias: string;
  private cityName: string;
  private agapeConfig: AgapeConfig;
  private baseUrl = "https://agportal.agapesistemas.com.br/DiarioOficial";

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as AgapeConfig;
    this.agapeConfig = platformConfig;
    this.alias = platformConfig.alias;
    this.cityName = platformConfig.cityName || config.name;

    logger.info(
      `Initializing AgapeSpider for ${this.cityName} (${this.alias})`,
    );
  }

  private buildUrl(): string {
    return `${this.baseUrl}/?alias=${this.alias}`;
  }

  async crawl(): Promise<Gazette[]> {
    const url = this.buildUrl();

    logger.info(`Starting Ágape crawl for ${this.cityName}`, {
      url,
      dateRange: {
        start: this.startDate.toISOString(),
        end: this.endDate.toISOString(),
      },
    });

    return this.crawlWithHttp(url);
  }

  /**
   * Crawl using HTTP requests
   *
   * The Ágape platform uses RichFaces AJAX for search, which doesn't work with simple HTTP.
   * Instead, we use the initial page which shows "Últimos Diários" (latest gazettes).
   * For each gazette in the date range, we download the PDF via POST request.
   *
   * Since the platform requires POST to download PDFs, we download them during crawl
   * and return data URLs (base64 encoded PDFs).
   */
  private async crawlWithHttp(url: string): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      // Step 1: Get the initial page - it already shows the latest gazettes
      const initialResponse = await this.fetchWithSession(url);
      const { sessionId, viewState, actionUrl } =
        this.extractSessionInfo(initialResponse);

      if (!sessionId || !viewState) {
        logger.error("Failed to extract session info from Ágape portal");
        return [];
      }

      logger.debug(
        `Session info extracted: sessionId=${sessionId}, viewState=${viewState}`,
      );

      // Step 2: Extract gazette info from the initial page (shows "Últimos Diários")
      const gazetteInfos = this.extractGazetteInfos(initialResponse);

      logger.info(`Found ${gazetteInfos.length} gazettes on initial page`);

      // Step 3: Download PDFs and create gazette objects for each result in date range
      for (const info of gazetteInfos) {
        if (this.isInDateRange(info.date)) {
          // Download the PDF via POST
          const pdfDataUrl = await this.downloadPdfAsDataUrl(
            sessionId,
            viewState,
            actionUrl,
            info.index,
          );

          if (pdfDataUrl) {
            const gazette = await this.createGazette(info.date, pdfDataUrl, {
              isExtraEdition: false,
              power: "executive",
              skipUrlResolution: true, // Data URLs don't need resolution
            });

            if (gazette) {
              gazettes.push(gazette);
              logger.info(`Found gazette: ${info.dateStr}`);
            }
          } else {
            logger.warn(`Failed to download PDF for gazette: ${info.dateStr}`);
          }
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes from Ágape for ${this.cityName}`,
      );
    } catch (error) {
      logger.error(`Error crawling Ágape:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Download PDF via POST and return as data URL
   */
  private async downloadPdfAsDataUrl(
    sessionId: string,
    viewState: string,
    actionUrl: string,
    index: number,
  ): Promise<string | null> {
    try {
      const postUrl = `https://agportal.agapesistemas.com.br${actionUrl}`;

      const formData = new URLSearchParams();
      formData.append("form", "form");
      formData.append(`form:j_id39:${index}:j_id50`, "");
      formData.append("javax.faces.ViewState", viewState);

      const response = await fetch(postUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/pdf,*/*",
          Cookie: `JSESSIONID=${sessionId}`,
        },
        body: formData.toString(),
      });

      if (!response.ok) {
        logger.error(`Failed to download PDF: HTTP ${response.status}`);
        return null;
      }

      const contentType = response.headers.get("content-type");
      if (
        !contentType?.includes("application/download") &&
        !contentType?.includes("application/pdf")
      ) {
        logger.error(`Unexpected content type: ${contentType}`);
        return null;
      }

      const pdfBuffer = await response.arrayBuffer();
      const pdfBase64 = this.arrayBufferToBase64(pdfBuffer);

      logger.debug(`Downloaded PDF: ${pdfBuffer.byteLength} bytes`);

      return `data:application/pdf;base64,${pdfBase64}`;
    } catch (error) {
      logger.error(`Error downloading PDF:`, error as Error);
      return null;
    }
  }

  /**
   * Convert ArrayBuffer to base64 string
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Fetch URL with cookie handling
   */
  private async fetchWithSession(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });
    return response.text();
  }

  /**
   * Extract session ID, ViewState and action URL from HTML
   */
  private extractSessionInfo(html: string): {
    sessionId: string;
    viewState: string;
    actionUrl: string;
  } {
    // Extract jsessionid from action URL
    // Session ID format: HEXCHARS.nodename (e.g., 7DDD1AEA1899152CBE7A93BD132B43CA.aggr6no1)
    const actionMatch = html.match(
      /action="([^"]*jsessionid=([A-Za-z0-9.]+)[^"]*)"/,
    );
    const sessionId = actionMatch ? actionMatch[2] : "";
    const actionUrl = actionMatch ? actionMatch[1] : "";

    // Extract ViewState
    const viewStateMatch = html.match(
      /name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/,
    );
    const viewState = viewStateMatch ? viewStateMatch[1] : "";

    return { sessionId, viewState, actionUrl };
  }

  /**
   * Extract gazette information from search results HTML
   */
  private extractGazetteInfos(
    html: string,
  ): Array<{ date: Date; dateStr: string; index: number }> {
    const gazettes: Array<{ date: Date; dateStr: string; index: number }> = [];

    // The HTML structure has table cells with class "rich-table-cell" containing dates
    // Pattern: <td id="form:j_id39:{index}" class="rich-table-cell ...">
    //          ... <p class="titulo" ...>{date}</p> ...
    //          ... <input type="submit" name="form:j_id39:{index}:j_id50" ...> (download button)

    // Find all gazette entries by looking for the date pattern in titulo class
    // The HTML format is: <p class="titulo" style="...">30/01/2026\n                    </p>
    // Note: There are newlines and whitespace between the date and closing tag
    const datePattern =
      /<p class="titulo"[^>]*>(\d{2}\/\d{2}\/\d{4})[\s\S]*?<\/p>/gi;
    let match;
    let index = 0;

    while ((match = datePattern.exec(html)) !== null) {
      const dateStr = match[1];
      const date = this.parseDateBR(dateStr);

      if (date) {
        gazettes.push({ date, dateStr, index });
        index++;
      }
    }

    // If no results found with titulo pattern, try alternative pattern
    // Look for dates in the table cell structure
    if (gazettes.length === 0) {
      // Try to find dates in table structure by looking for the download button pattern
      // Each gazette has: <td id="form:j_id39:{index}" ...> ... date ... <input ... name="form:j_id39:{index}:j_id50" ...>
      const altPattern =
        /<td[^>]*id="form:j_id39:(\d+)"[^>]*>[\s\S]*?(\d{2}\/\d{2}\/\d{4})[\s\S]*?name="form:j_id39:\1:j_id50"/gi;
      while ((match = altPattern.exec(html)) !== null) {
        const idx = parseInt(match[1], 10);
        const dateStr = match[2];
        const date = this.parseDateBR(dateStr);

        if (date) {
          gazettes.push({ date, dateStr, index: idx });
        }
      }
    }

    return gazettes;
  }

  /**
   * Format date as DD/MM/YYYY
   */
  private formatDateBR(date: Date): string {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }

  /**
   * Parse date from DD/MM/YYYY format
   */
  private parseDateBR(dateStr: string): Date | null {
    const parts = dateStr.split("/");
    if (parts.length !== 3) return null;

    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
    const year = parseInt(parts[2], 10);

    const date = new Date(year, month, day);
    if (isNaN(date.getTime())) return null;

    return date;
  }
}
