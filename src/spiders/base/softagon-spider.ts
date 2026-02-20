import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange, SoftagonConfig } from "../../types";
import { logger } from "../../utils/logger";
import { toISODate, getCurrentTimestamp } from "../../utils/date-utils";

/**
 * SoftagonSpider implementation
 *
 * Crawls Softagon Diário Oficial portals used by various municipalities.
 * The platform uses Nuxt.js but date information is available in server-rendered HTML.
 *
 * URL Pattern: {baseUrl}/{editionNumber}?exercicio={year}
 *
 * Strategy:
 * - Edition numbers are sequential and continue across years
 * - Each edition page contains the publication date in the server-rendered HTML
 * - We probe editions sequentially using simple fetch requests
 *
 * Known municipalities using this platform:
 * - Araripina - PE (https://www.araripina.pe.gov.br/diario-oficial)
 * - Santa Maria da Boa Vista - PE (https://santamariadaboavista.pe.gov.br/diario-oficial)
 * - Bezerros - PE (https://bezerros.pe.gov.br/diario-oficial)
 */
export class SoftagonSpider extends BaseSpider {
  private readonly softagonConfig: SoftagonConfig;
  private readonly baseUrl: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.softagonConfig = spiderConfig.config as SoftagonConfig;
    this.baseUrl = this.softagonConfig.baseUrl;

    logger.info(
      `Initializing SoftagonSpider for ${spiderConfig.name} with baseUrl: ${this.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling Softagon portal from ${toISODate(this.startDate)} to ${toISODate(this.endDate)}...`,
    );

    const gazettes: Gazette[] = [];

    try {
      // Get the years to crawl based on date range
      const startYear = this.startDate.getFullYear();
      const endYear = this.endDate.getFullYear();

      for (let year = endYear; year >= startYear; year--) {
        const yearGazettes = await this.crawlYear(year);
        gazettes.push(...yearGazettes);
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes from Softagon portal`,
      );
    } catch (error) {
      logger.error(`Error crawling Softagon portal:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Crawl gazettes for a specific year using fetch
   * Strategy: Probe individual edition pages sequentially starting from edition 1.
   */
  private async crawlYear(year: number): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    // Strategy: Probe editions sequentially
    // Edition numbers continue across years (not reset per year)
    const startEdition = 1;
    const maxEditionsToCheck = 100; // Safety limit per year
    let consecutiveNotFound = 0;
    const maxConsecutiveNotFound = 10; // Stop after 10 consecutive 404s (not found pages)
    let foundAnyInRange = false;

    logger.debug(
      `Probing editions for year ${year} starting from ${startEdition}`,
    );

    for (
      let editionNum = startEdition;
      editionNum <= startEdition + maxEditionsToCheck;
      editionNum++
    ) {
      // Only stop early if we've found editions and then hit consecutive not founds
      if (consecutiveNotFound >= maxConsecutiveNotFound && foundAnyInRange) {
        logger.debug(
          `Stopping probe after ${maxConsecutiveNotFound} consecutive not found editions`,
        );
        break;
      }

      const result = await this.crawlEdition(editionNum.toString(), year);

      if (result === "not_found") {
        // Page doesn't exist (404)
        consecutiveNotFound++;
      } else if (result === "out_of_range") {
        // Edition exists but date is out of range - keep going
        consecutiveNotFound = 0;
      } else if (result) {
        // Found a gazette in range
        gazettes.push(result);
        consecutiveNotFound = 0;
        foundAnyInRange = true;
      }
    }

    logger.info(`Found ${gazettes.length} editions for year ${year}`);

    return gazettes;
  }

  /**
   * Crawl a specific edition using fetch
   * The Nuxt.js portal renders dates in server-side HTML
   * @returns Gazette if found and in range, "out_of_range" if exists but date out of range, "not_found" if page doesn't exist
   */
  private async crawlEdition(
    editionNumber: string,
    year: number,
  ): Promise<Gazette | "not_found" | "out_of_range"> {
    try {
      const editionUrl = `${this.baseUrl}/${editionNumber}?exercicio=${year}`;

      // Fetch the page HTML
      const response = await fetch(editionUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        },
      });

      if (!response.ok) {
        return "not_found";
      }

      const html = await response.text();

      // Check if edition doesn't exist
      if (
        html.includes("não foi encontrada") ||
        html.includes("não encontrada") ||
        html.includes("não está disponível") ||
        html.includes("Edição não encontrada")
      ) {
        return "not_found";
      }

      // Extract date from the HTML
      const isoDate = this.extractDateFromHtml(html);

      if (!isoDate) {
        logger.debug(
          `Could not find date for edition ${editionNumber}, skipping`,
        );
        return "not_found";
      }

      // Check if date is in range
      const startDateStr = toISODate(this.startDate);
      const endDateStr = toISODate(this.endDate);

      if (isoDate < startDateStr || isoDate > endDateStr) {
        logger.debug(
          `Edition ${editionNumber} date ${isoDate} is out of range`,
        );
        return "out_of_range";
      }

      logger.debug(
        `Extracted gazette: edition=${editionNumber}, date=${isoDate}, url=${editionUrl}`,
      );

      return {
        date: isoDate,
        fileUrl: editionUrl,
        territoryId: this.spiderConfig.territoryId,
        scrapedAt: getCurrentTimestamp(),
        isExtraEdition: false,
        power: "executive_legislative",
        sourceText: `Diário Oficial - Edição ${editionNumber}/${year}`,
        editionNumber: editionNumber,
      };
    } catch (error) {
      logger.debug(`Error crawling edition ${editionNumber}:`, error);
      return "not_found";
    }
  }

  /**
   * Extract publication date from HTML content
   * The Nuxt.js portal includes dates in server-rendered HTML in Portuguese format
   */
  private extractDateFromHtml(html: string): string | null {
    // Portuguese month names to numbers
    const months: { [key: string]: string } = {
      janeiro: "01",
      fevereiro: "02",
      março: "03",
      marco: "03",
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

    // Pattern: "21 de janeiro de 2026"
    const datePattern =
      /(\d{1,2})\s+de\s+(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})/i;
    const match = html.match(datePattern);

    if (match) {
      const day = match[1].padStart(2, "0");
      const month = months[match[2].toLowerCase()];
      const year = match[3];

      if (month) {
        return `${year}-${month}-${day}`;
      }
    }

    // Try DD/MM/YYYY pattern
    const numericPattern = /(\d{2})\/(\d{2})\/(\d{4})/;
    const numericMatch = html.match(numericPattern);

    if (numericMatch) {
      return `${numericMatch[3]}-${numericMatch[2]}-${numericMatch[1]}`;
    }

    return null;
  }
}
