import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse } from "node-html-parser";

/**
 * Configuration for Prefeitura de Porto Nacional spider
 */
export interface PrefeituraportonacionalConfig {
  type: "prefeituraportonacional";
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/**
 * Spider for Diário Oficial de Porto Nacional - TO
 *
 * URL: https://diariooficial.portonacional.to.gov.br/edicoes
 *
 * URL Patterns:
 * - List page: {baseUrl}/edicoes?page={page}
 * - Download: {baseUrl}/pdf/DO{YYYYMMDD}.pdf
 *
 * HTML Structure:
 * - Table with rows for each edition
 * - Edition info: "EDIÇÃO Nº XXXX" in <strong> tag
 * - Date: "DD de Mês de YYYY"
 * - Download link: <a href="...pdf/DO{date}.pdf">
 */
export class PrefeituraportonacionalSpider extends BaseSpider {
  constructor(
    spiderConfig: SpiderConfig,
    dateRange: DateRange,
    _browser?: Fetcher,
  ) {
    super(spiderConfig, dateRange);

    if (!this.portoConfig.baseUrl) {
      throw new Error(
        `PrefeituraportonacionalSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeituraportonacionalSpider for ${spiderConfig.name} with URL: ${this.portoConfig.baseUrl}`,
    );
  }

  private get portoConfig(): PrefeituraportonacionalConfig {
    return this.spiderConfig.config as PrefeituraportonacionalConfig;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let page = 1;
    let hasMorePages = true;
    const maxPages = 150;

    logger.info(`Starting crawl for ${this.spiderConfig.name}`);

    while (hasMorePages && page <= maxPages) {
      try {
        const pageUrl =
          page === 1
            ? `${this.portoConfig.baseUrl}/edicoes`
            : `${this.portoConfig.baseUrl}/edicoes?page=${page}`;

        logger.debug(`Fetching page ${page}: ${pageUrl}`);

        const html = await this.fetch(pageUrl);
        const root = parse(html);

        // Find all table rows with edition info
        const tableRows = root.querySelectorAll("tr");
        const editionRows: any[] = [];

        for (const row of tableRows) {
          const strongTag = row.querySelector("strong");
          const text = strongTag?.text || "";
          // Match pattern like "EDIÇÃO Nº 1158"
          if (text.match(/EDIÇÃO\s+N[º°]?\s*\d+/i)) {
            editionRows.push(row);
          }
        }

        if (editionRows.length === 0) {
          logger.debug(`No editions found on page ${page}, stopping`);
          hasMorePages = false;
          continue;
        }

        logger.debug(`Found ${editionRows.length} editions on page ${page}`);

        let foundOlderThanRange = false;

        for (const row of editionRows) {
          try {
            const gazette = await this.parseEditionRow(row);
            if (gazette) {
              const gazetteDate = new Date(gazette.date);
              const startDate = new Date(this.dateRange.start);

              if (gazetteDate < startDate) {
                foundOlderThanRange = true;
                continue;
              }

              if (this.isInDateRange(gazetteDate)) {
                gazettes.push(gazette);
              }
            }
          } catch (error) {
            logger.error(`Error parsing edition:`, error as Error);
          }
        }

        if (foundOlderThanRange) {
          logger.debug(
            `Found editions older than date range, stopping pagination`,
          );
          hasMorePages = false;
          continue;
        }

        // Check for next page - look for pagination link
        const paginationLinks = root.querySelectorAll("a");
        let hasNextPage = false;
        for (const link of paginationLinks) {
          const href = link.getAttribute("href") || "";
          if (href.includes(`page=${page + 1}`)) {
            hasNextPage = true;
            break;
          }
        }

        if (!hasNextPage) {
          hasMorePages = false;
        }

        page++;
      } catch (error) {
        logger.error(`Error fetching page ${page}:`, error as Error);
        hasMorePages = false;
      }
    }

    logger.info(
      `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
    );
    return gazettes;
  }

  /**
   * Parse an edition table row to extract gazette information
   */
  private async parseEditionRow(row: any): Promise<Gazette | null> {
    try {
      const rowText = row.text?.trim() || "";

      // Extract edition number - pattern: "EDIÇÃO Nº 1158"
      const editionMatch = rowText.match(/EDIÇÃO\s+N[º°]?\s*(\d+)/i);
      const editionNumber = editionMatch ? editionMatch[1] : undefined;

      // Extract date - pattern: "DD de Mês de YYYY"
      const dateMatch = rowText.match(
        /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i,
      );

      if (!dateMatch) {
        logger.warn(`Could not parse date from: ${rowText.substring(0, 100)}`);
        return null;
      }

      const [, day, monthName, year] = dateMatch;
      const month = this.parseMonthName(monthName);

      if (month === -1) {
        logger.warn(`Unknown month name: ${monthName}`);
        return null;
      }

      const gazetteDate = new Date(parseInt(year), month, parseInt(day));

      // Find download link - look for href containing ".pdf"
      const downloadLink = row.querySelector('a[href*=".pdf"]');
      let pdfUrl = downloadLink?.getAttribute("href");

      if (!pdfUrl) {
        // Construct PDF URL based on date pattern: /pdf/DOYYYYMMDD.pdf
        const formattedDate = `${year}${String(month + 1).padStart(2, "0")}${String(parseInt(day)).padStart(2, "0")}`;
        pdfUrl = `${this.portoConfig.baseUrl}/pdf/DO${formattedDate}.pdf`;
      }

      // Make absolute URL if relative
      if (pdfUrl && !pdfUrl.startsWith("http")) {
        pdfUrl = `${this.portoConfig.baseUrl}${pdfUrl.startsWith("/") ? "" : "/"}${pdfUrl}`;
      }

      // Check if it's a supplement/extra edition
      const isExtraEdition =
        rowText.toLowerCase().includes("suplemento") ||
        rowText.toLowerCase().includes("extra");

      return await this.createGazette(gazetteDate, pdfUrl, {
        editionNumber,
        isExtraEdition,
        power: "executive_legislative",
        sourceText: rowText.substring(0, 200),
      });
    } catch (error) {
      logger.error(`Error parsing edition row:`, error as Error);
      return null;
    }
  }

  /**
   * Parse Portuguese month name to month index (0-11)
   */
  private parseMonthName(monthName: string): number {
    const months: { [key: string]: number } = {
      janeiro: 0,
      fevereiro: 1,
      março: 2,
      marco: 2,
      abril: 3,
      maio: 4,
      junho: 5,
      julho: 6,
      agosto: 7,
      setembro: 8,
      outubro: 9,
      novembro: 10,
      dezembro: 11,
    };

    return months[monthName.toLowerCase()] ?? -1;
  }
}
