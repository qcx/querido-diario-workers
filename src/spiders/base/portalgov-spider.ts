import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange, PortalGovConfig } from "../../types";
import { logger } from "../../utils/logger";
import {
  toISODate,
  getCurrentTimestamp,
  fromISODate,
} from "../../utils/date-utils";

/**
 * PortalGov Spider implementation
 *
 * Crawls gazette data from PortalGov platform (portalgov.srv.br).
 * Used by municipalities like Brumado, BA.
 *
 * URL Structure:
 * - Main page: https://portalgov.srv.br/diariooficial/{slug}
 * - PDF links: https://portalgov.srv.br/diariooficial/uploads/{filename}.pdf
 *
 * HTML Structure:
 * - Table with edition rows containing:
 *   - Edition number
 *   - Description (list of contents)
 *   - Publication date
 *   - Authentication code
 *   - PDF download links
 *
 * Supports search filters:
 * - Data Inicial / Data Final for date range
 * - Ano (year) filter
 */
export class PortalGovSpider extends BaseSpider {
  protected portalgov: PortalGovConfig;
  private baseUrl: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.portalgov = spiderConfig.config as PortalGovConfig;

    if (!this.portalgov.slug) {
      throw new Error(
        `PortalGovSpider requires slug in config for ${spiderConfig.name}`,
      );
    }

    this.baseUrl = this.portalgov.baseUrl || "https://portalgov.srv.br";

    logger.info(
      `Initializing PortalGovSpider for ${spiderConfig.name} with slug: ${this.portalgov.slug}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling PortalGov for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      const pageUrl = this.buildSearchUrl();
      logger.info(`Fetching from URL: ${pageUrl}`);

      const response = await fetch(pageUrl, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      });

      if (!response.ok) {
        throw new Error(
          `Page request failed: ${response.status} ${response.statusText}`,
        );
      }

      const html = await response.text();

      // Parse the HTML to extract gazette entries
      const parsedGazettes = this.parseHtml(html);

      for (const gazette of parsedGazettes) {
        gazettes.push(gazette);
        logger.info(
          `Found gazette for ${gazette.date}: Edition ${gazette.editionNumber}`,
        );
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
   * Build the search URL with date range parameters
   */
  private buildSearchUrl(): string {
    const startDate = this.formatDateForSearch(this.startDate);
    const endDate = this.formatDateForSearch(this.endDate);

    // PortalGov uses a simple page format with optional search parameters
    // The search uses Data Inicial and Data Final fields
    const baseSearchUrl = `${this.baseUrl}/diariooficial/${this.portalgov.slug}`;

    return baseSearchUrl;
  }

  /**
   * Format date for search (DD/MM/YYYY)
   */
  private formatDateForSearch(date: Date): string {
    const day = date.getDate().toString().padStart(2, "0");
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }

  /**
   * Parse HTML to extract gazette entries
   */
  private parseHtml(html: string): Gazette[] {
    const gazettes: Gazette[] = [];

    // Match table rows with gazette data
    // Pattern: Look for rows with edition number, description, date, and PDF link
    // Example row pattern from the HTML
    const rowRegex =
      /(\d+)\|(?:\[.*?\])?\s*\[([^\]]+)\]\([^)]+\)\|(\d{2}\/\d{2}\/\d{4})\|[^|]*\|\[\*\*\]\((uploads\/[^)]+\.pdf)\)/gm;

    // Alternative: Look for PDF links directly with dates
    const pdfLinkRegex = /<a[^>]*href="([^"]*uploads\/[^"]*\.pdf)"[^>]*>/gi;
    const dateRowRegex = /(\d{2})\/(\d{2})\/(\d{4})/g;

    // Parse the markdown-like table structure from the fetch result
    // Format: |N°|Descricao|Data|Nº Autent.|DOP|DOU|Jornal|
    const lines = html.split("\n");

    for (const line of lines) {
      // Look for lines that have edition numbers and dates
      const match = line.match(
        /^(\d+)\|.*?\|(\d{2}\/\d{2}\/\d{4})\|.*?\|\[\*\*\]\((uploads\/[^)]+\.pdf)\)/,
      );

      if (match) {
        const editionNumber = match[1];
        const dateStr = match[2];
        const pdfPath = match[3];

        const gazette = this.createGazette(editionNumber, dateStr, pdfPath);
        if (gazette && this.isDateInRange(gazette.date)) {
          gazettes.push(gazette);
        }
      }
    }

    // If no matches found with the markdown format, try HTML parsing
    if (gazettes.length === 0) {
      // Try to parse HTML table format
      const tableRowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
      const rows = html.match(tableRowRegex) || [];

      for (const row of rows) {
        // Extract edition number
        const editionMatch = row.match(/>(\d+)<\/td>/);
        // Extract date
        const dateMatch = row.match(/(\d{2}\/\d{2}\/\d{4})/);
        // Extract PDF link
        const pdfMatch = row.match(/href="([^"]*\.pdf)"/i);

        if (editionMatch && dateMatch && pdfMatch) {
          const editionNumber = editionMatch[1];
          const dateStr = dateMatch[1];
          let pdfPath = pdfMatch[1];

          // Ensure the PDF path is complete
          if (!pdfPath.startsWith("http")) {
            pdfPath = pdfPath.startsWith("/") ? pdfPath : `/${pdfPath}`;
          }

          const gazette = this.createGazette(editionNumber, dateStr, pdfPath);
          if (gazette && this.isDateInRange(gazette.date)) {
            gazettes.push(gazette);
          }
        }
      }
    }

    return gazettes;
  }

  /**
   * Check if a date string (YYYY-MM-DD) is within the search range
   */
  private isDateInRange(dateStr: string): boolean {
    try {
      const date = fromISODate(dateStr);
      return date >= this.startDate && date <= this.endDate;
    } catch {
      return false;
    }
  }

  /**
   * Create a gazette object from parsed data
   */
  private createGazette(
    editionNumber: string,
    dateStr: string,
    pdfPath: string,
  ): Gazette | null {
    try {
      // Parse date from DD/MM/YYYY format
      const [day, month, year] = dateStr.split("/");
      const isoDate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;

      // Build full PDF URL
      let fileUrl: string;
      if (pdfPath.startsWith("http")) {
        fileUrl = pdfPath;
      } else if (pdfPath.startsWith("/")) {
        fileUrl = `${this.baseUrl}/diariooficial${pdfPath}`;
      } else {
        fileUrl = `${this.baseUrl}/diariooficial/${pdfPath}`;
      }

      const gazette: Gazette = {
        date: isoDate,
        fileUrl: fileUrl,
        territoryId: this.spiderConfig.territoryId,
        scrapedAt: getCurrentTimestamp(),
        editionNumber: editionNumber,
        isExtraEdition: false,
        power: "executive_legislative",
        sourceText: `Diário Oficial - Edição ${editionNumber}`,
      };

      return gazette;
    } catch (error) {
      logger.error(`Error creating gazette from entry:`, error as Error);
      return null;
    }
  }
}
