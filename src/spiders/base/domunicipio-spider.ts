import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  DomunicipioConfig,
} from "../../types";
import { logger } from "../../utils/logger";
import {
  getCurrentTimestamp,
  parseBrazilianDate,
} from "../../utils/date-utils";
import { toISODate } from "../../utils/date-utils";

/**
 * DomunicipioSpider implementation
 *
 * Crawls gazette data from domunicipio.com platform.
 * The site displays a calendar with clickable days that link to gazette PDFs.
 *
 * Page Structure:
 * - Main page: cidade.php?q={q}&id={cityId}
 *   - q=1 for Ordinary editions
 *   - q=2 for Extraordinary editions
 * - Publications are listed as <div class="added-event"> elements with:
 *   - data-date: "DD-MM-YYYY"
 *   - data-link: "getPublication.php?id=XXXX"
 *   - data-title: "Publicação DD-MM-YYYY"
 *
 * - getPublication.php redirects via JS to PDF URL:
 *   location.href='https://domunicipio.com/pdf/viewer.html?file=https://domunicipio.com/publish/...'
 */
export class DomunicipioSpider extends BaseSpider {
  protected domunicipioConfig: DomunicipioConfig;
  private baseUrl = "https://domunicipio.com";

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.domunicipioConfig = spiderConfig.config as DomunicipioConfig;

    if (!this.domunicipioConfig.cityId) {
      throw new Error(
        `DomunicipioSpider requires cityId in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing DomunicipioSpider for ${spiderConfig.name} with cityId: ${this.domunicipioConfig.cityId}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling domunicipio.com for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Crawl ordinary editions (q=1)
      const ordinaryGazettes = await this.crawlEditionType(1, false);
      gazettes.push(...ordinaryGazettes);

      // Crawl extraordinary editions (q=2) if configured
      if (this.domunicipioConfig.includeExtraordinary !== false) {
        const extraordinaryGazettes = await this.crawlEditionType(2, true);
        gazettes.push(...extraordinaryGazettes);
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
      );
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Crawl a specific edition type (ordinary or extraordinary)
   */
  private async crawlEditionType(
    q: number,
    isExtra: boolean,
  ): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const url = `${this.baseUrl}/cidade.php?q=${q}&id=${this.domunicipioConfig.cityId}`;

    logger.info(
      `Fetching ${isExtra ? "extraordinary" : "ordinary"} editions from: ${url}`,
    );

    try {
      const html = await this.fetch(url);
      const publications = this.extractPublications(html);

      logger.info(
        `Found ${publications.length} ${isExtra ? "extraordinary" : "ordinary"} publications`,
      );

      for (const pub of publications) {
        try {
          // Parse the date from DD-MM-YYYY format
          const [day, month, year] = pub.date.split("-").map(Number);
          const pubDate = new Date(year, month - 1, day);

          // Check if within date range
          if (pubDate < this.startDate || pubDate > this.endDate) {
            continue;
          }

          // Get the PDF URL from the publication page
          const pdfUrl = await this.getPdfUrl(pub.link);

          if (pdfUrl) {
            const gazette: Gazette = {
              date: toISODate(pubDate),
              fileUrl: pdfUrl,
              territoryId: this.spiderConfig.territoryId,
              scrapedAt: getCurrentTimestamp(),
              isExtraEdition: isExtra,
              power: "executive_legislative",
              sourceText: `Diário Oficial ${isExtra ? "Extraordinário" : "Ordinário"} - ${pub.date}`,
            };

            gazettes.push(gazette);
            logger.info(`Found gazette for ${pub.date}: ${pdfUrl}`);
          }
        } catch (error) {
          logger.error(
            `Error processing publication ${pub.date}:`,
            error as Error,
          );
        }
      }
    } catch (error) {
      logger.error(`Error fetching edition type ${q}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Extract publication data from the HTML page
   * Publications are in <div class="added-event"> elements
   */
  private extractPublications(
    html: string,
  ): Array<{ date: string; link: string }> {
    const publications: Array<{ date: string; link: string }> = [];

    // Match all added-event divs with their data attributes
    const regex =
      /<div class="added-event"[^>]*data-date="([^"]+)"[^>]*data-link="([^"]+)"[^>]*>/g;
    let match;

    while ((match = regex.exec(html)) !== null) {
      const date = match[1];
      const link = match[2];

      if (date && link) {
        publications.push({ date, link });
      }
    }

    return publications;
  }

  /**
   * Get the actual PDF URL from the publication page
   * The page contains a JS redirect: location.href='...'
   */
  private async getPdfUrl(publicationPath: string): Promise<string | null> {
    try {
      const url = `${this.baseUrl}/${publicationPath}`;
      const html = await this.fetch(url);

      // Extract PDF URL from JS redirect
      // Pattern: location.href='https://domunicipio.com/pdf/viewer.html?file=https://domunicipio.com/publish/...'
      const viewerMatch = html.match(/location\.href\s*=\s*['"]([^'"]+)['"]/);

      if (viewerMatch) {
        const viewerUrl = viewerMatch[1];

        // Extract the actual PDF URL from the viewer URL
        const fileMatch = viewerUrl.match(/file=([^&'"]+)/);
        if (fileMatch) {
          // Decode the URL if needed
          let pdfUrl = decodeURIComponent(fileMatch[1]);

          // If the PDF URL is relative, make it absolute
          if (!pdfUrl.startsWith("http")) {
            pdfUrl = `${this.baseUrl}/${pdfUrl}`;
          }

          // Normalize the URL (encode special characters and spaces)
          pdfUrl = this.normalizeUrl(pdfUrl);

          return pdfUrl;
        }

        // If no file parameter, the viewer URL might be the direct link
        if (viewerUrl.endsWith(".pdf")) {
          let pdfUrl = viewerUrl.startsWith("http")
            ? viewerUrl
            : `${this.baseUrl}/${viewerUrl}`;
          return this.normalizeUrl(pdfUrl);
        }
      }

      logger.warn(`Could not extract PDF URL from ${url}`);
      return null;
    } catch (error) {
      logger.error(
        `Error getting PDF URL from ${publicationPath}:`,
        error as Error,
      );
      return null;
    }
  }

  /**
   * Normalize URL by properly encoding special characters and spaces
   * Converts: https://domunicipio.com/publish/Conceição do Coité - BA-13-1-2026_1958b_1223.pdf
   * To: https://domunicipio.com/publish/Concei%C3%A7%C3%A3o%20do%20Coit%C3%A9%20-%20BA-13-1-2026_1958b_1223.pdf
   */
  private normalizeUrl(url: string): string {
    try {
      // Parse the URL to separate protocol/host from path
      const urlObj = new URL(url);

      // Split the pathname into segments and encode each one
      const pathSegments = urlObj.pathname.split("/");
      const encodedSegments = pathSegments.map((segment) => {
        // Decode first in case it's already partially encoded, then re-encode properly
        const decoded = decodeURIComponent(segment);
        return encodeURIComponent(decoded);
      });

      // Reconstruct the URL with encoded path
      urlObj.pathname = encodedSegments.join("/");

      return urlObj.toString();
    } catch (error) {
      // If URL parsing fails, fall back to simple encoding
      logger.warn(`Failed to parse URL for normalization: ${url}`);
      return url.replace(/ /g, "%20");
    }
  }
}
