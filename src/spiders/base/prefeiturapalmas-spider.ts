import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse } from "node-html-parser";

/**
 * Configuration for Prefeitura de Palmas spider
 */
export interface PrefeiturapalmastConfig {
  type: "prefeiturapalmas";
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/**
 * Spider for Diário Oficial de Palmas - TO
 *
 * URL: http://diariooficial.palmas.to.gov.br/todos-diarios/
 *
 * URL Patterns:
 * - List page: {baseUrl}/todos-diarios/?page={page}
 * - Download: {baseUrl}/download/diario/{id}/
 *
 * HTML Structure:
 * - List items with edition info: "3885ª Edição de 29 de Janeiro de 2026"
 * - Download links with "baixar" text
 * - Pagination with page numbers
 */
export class PrefeiturapalmastSpider extends BaseSpider {
  protected config: PrefeiturapalmastConfig;

  constructor(
    spiderConfig: SpiderConfig,
    dateRange: DateRange,
    browser?: Fetcher,
  ) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeiturapalmastConfig;

    if (!this.config.baseUrl) {
      throw new Error(
        `PrefeiturapalmastSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeiturapalmastSpider for ${spiderConfig.name} with URL: ${this.config.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let page = 1;
    let hasMorePages = true;
    const maxPages = 100;

    logger.info(`Starting crawl for ${this.spiderConfig.name}`);

    while (hasMorePages && page <= maxPages) {
      try {
        const pageUrl =
          page === 1
            ? `${this.config.baseUrl}/todos-diarios/`
            : `${this.config.baseUrl}/todos-diarios/?page=${page}`;

        logger.debug(`Fetching page ${page}: ${pageUrl}`);

        const html = await this.fetch(pageUrl);
        const root = parse(html);

        // Find all edition list items
        const listItems = root.querySelectorAll("li");
        const editionItems: any[] = [];

        for (const item of listItems) {
          const text = item.text || "";
          // Match pattern like "3885ª Edição de 29 de Janeiro de 2026"
          if (
            text.match(/\d+[ªº]?\s*Edição\s+de\s+\d+\s+de\s+\w+\s+de\s+\d{4}/i)
          ) {
            editionItems.push(item);
          }
        }

        if (editionItems.length === 0) {
          logger.debug(`No editions found on page ${page}, stopping`);
          hasMorePages = false;
          continue;
        }

        logger.debug(`Found ${editionItems.length} editions on page ${page}`);

        let foundOlderThanRange = false;

        for (const item of editionItems) {
          try {
            const gazette = await this.parseEditionItem(item);
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

        // Check for next page
        const nextPageLink = root.querySelector(`a[href*="page=${page + 1}"]`);
        if (!nextPageLink) {
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
   * Parse an edition list item to extract gazette information
   */
  private async parseEditionItem(item: any): Promise<Gazette | null> {
    try {
      const itemText = item.text?.trim() || "";

      // Extract edition number - pattern: "3885ª Edição"
      const editionMatch = itemText.match(/(\d+)[ªº]?\s*Edição/i);
      const editionNumber = editionMatch ? editionMatch[1] : undefined;

      // Extract date - pattern: "de DD de Mês de YYYY"
      const dateMatch = itemText.match(
        /de\s+(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i,
      );

      if (!dateMatch) {
        logger.warn(`Could not parse date from: ${itemText.substring(0, 100)}`);
        return null;
      }

      const [, day, monthName, year] = dateMatch;
      const month = this.parseMonthName(monthName);

      if (month === -1) {
        logger.warn(`Unknown month name: ${monthName}`);
        return null;
      }

      const gazetteDate = new Date(parseInt(year), month, parseInt(day));

      // Find download link
      const downloadLink = item.querySelector('a[href*="download/diario"]');
      let pdfUrl = downloadLink?.getAttribute("href");

      if (!pdfUrl) {
        // Try to find any link with "baixar" text
        const links = item.querySelectorAll("a");
        for (const link of links) {
          const href = link.getAttribute("href") || "";
          if (href.includes("download")) {
            pdfUrl = href;
            break;
          }
        }
      }

      if (!pdfUrl) {
        logger.warn(`No download link found for edition ${editionNumber}`);
        return null;
      }

      // Make absolute URL if relative
      if (!pdfUrl.startsWith("http")) {
        pdfUrl = `${this.config.baseUrl}${pdfUrl.startsWith("/") ? "" : "/"}${pdfUrl}`;
      }

      // Check if it's a supplement
      const isExtraEdition =
        itemText.toLowerCase().includes("suplemento") ||
        itemText.toLowerCase().includes("extra");

      return await this.createGazette(gazetteDate, pdfUrl, {
        editionNumber,
        isExtraEdition,
        power: "executive_legislative",
        sourceText: itemText.substring(0, 200),
      });
    } catch (error) {
      logger.error(`Error parsing edition item:`, error as Error);
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
