import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange, AgapeConfig } from "../../../types";
import { logger } from "../../../utils/logger";

/**
 * V2 Spider for Ágape Sistemas platform (agportal.agapesistemas.com.br)
 *
 * JSF/RichFaces application. PDFs are downloaded via POST with session
 * cookie + ViewState, returned as base64 data URLs.
 *
 * Flow:
 *   1. GET page → extract JSESSIONID + ViewState
 *   2. Parse "Últimos Diários" table for dates
 *   3. POST per gazette to download PDF binary
 */
export class AgapeSpider extends BaseSpider {
  private alias: string;
  private cityName: string;
  private readonly BASE_URL =
    "https://agportal.agapesistemas.com.br/DiarioOficial";
  private readonly USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    const platformConfig = spiderConfig.config as AgapeConfig;
    this.alias = platformConfig.alias;
    this.cityName = platformConfig.cityName || spiderConfig.name;

    logger.info(
      `Initializing v2 AgapeSpider for ${this.cityName} (${this.alias})`,
    );
  }

  private buildUrl(): string {
    return `${this.BASE_URL}/?alias=${this.alias}`;
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

    const gazettes: Gazette[] = [];

    try {
      const initialHtml = await this.fetchWithSession(url);
      const { sessionId, viewState, actionUrl } =
        this.extractSessionInfo(initialHtml);

      if (!sessionId || !viewState) {
        logger.error("Failed to extract session info from Ágape portal");
        return [];
      }

      logger.debug(`Session extracted: sessionId=${sessionId}`);

      const gazetteInfos = this.extractGazetteInfos(initialHtml);
      logger.info(`Found ${gazetteInfos.length} gazettes on initial page`);

      for (const info of gazetteInfos) {
        if (this.isInDateRange(info.date)) {
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
              skipUrlResolution: true,
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
        `Crawled ${gazettes.length} gazettes from Ágape for ${this.cityName}`,
      );
    } catch (error) {
      logger.error(`Error crawling Ágape:`, error as Error);
    }

    return gazettes;
  }

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

      this.requestCount++;
      const response = await fetch(postUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": this.USER_AGENT,
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
      logger.debug(`Downloaded PDF: ${pdfBuffer.byteLength} bytes`);

      const pdfBase64 = this.arrayBufferToBase64(pdfBuffer);
      return `data:application/pdf;base64,${pdfBase64}`;
    } catch (error) {
      logger.error(`Error downloading PDF:`, error as Error);
      return null;
    }
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private async fetchWithSession(url: string): Promise<string> {
    this.requestCount++;
    const response = await fetch(url, {
      headers: {
        "User-Agent": this.USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });
    return response.text();
  }

  private extractSessionInfo(html: string): {
    sessionId: string;
    viewState: string;
    actionUrl: string;
  } {
    const actionMatch = html.match(
      /action="([^"]*jsessionid=([A-Za-z0-9.]+)[^"]*)"/,
    );
    const sessionId = actionMatch ? actionMatch[2] : "";
    const actionUrl = actionMatch ? actionMatch[1] : "";

    const viewStateMatch = html.match(
      /name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/,
    );
    const viewState = viewStateMatch ? viewStateMatch[1] : "";

    return { sessionId, viewState, actionUrl };
  }

  private extractGazetteInfos(
    html: string,
  ): Array<{ date: Date; dateStr: string; index: number }> {
    const gazettes: Array<{ date: Date; dateStr: string; index: number }> = [];

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

    if (gazettes.length === 0) {
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

  private parseDateBR(dateStr: string): Date | null {
    const parts = dateStr.split("/");
    if (parts.length !== 3) return null;

    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);

    const date = new Date(year, month, day);
    if (isNaN(date.getTime())) return null;

    return date;
  }
}
