import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeituraNatalConfig,
} from "../../types";
import { logger } from "../../utils/logger";
import { toISODate, getCurrentTimestamp } from "../../utils/date-utils";

/**
 * PrefeituraNatalSpider implementation
 *
 * Crawls the official gazette from Natal, RN.
 * URL pattern: https://www2.natal.rn.gov.br/dom/
 *
 * The site lists gazettes by month/year and provides direct PDF links.
 * PDF URL pattern: https://www2.natal.rn.gov.br/_anexos/publicacao/dom/dom_{YYYYMMDD}_{hash}.pdf
 */
export class PrefeituraNatalSpider extends BaseSpider {
  protected natalConfig: PrefeituraNatalConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.natalConfig = spiderConfig.config as PrefeituraNatalConfig;

    if (!this.natalConfig.baseUrl) {
      throw new Error(
        `PrefeituraNatalSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(`Initializing PrefeituraNatalSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.natalConfig.baseUrl} for ${this.spiderConfig.name}...`,
    );
    const gazettes: Gazette[] = [];

    try {
      // Iterate through each month in the date range
      const startDate = new Date(this.startDate);
      const endDate = new Date(this.endDate);

      const monthsToProcess: Array<{ month: number; year: number }> = [];

      let currentDate = new Date(
        startDate.getFullYear(),
        startDate.getMonth(),
        1,
      );
      while (currentDate <= endDate) {
        monthsToProcess.push({
          month: currentDate.getMonth() + 1, // 1-12
          year: currentDate.getFullYear(),
        });
        currentDate.setMonth(currentDate.getMonth() + 1);
      }

      for (const { month, year } of monthsToProcess) {
        const monthGazettes = await this.fetchMonthGazettes(month, year);
        gazettes.push(...monthGazettes);
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
   * Fetch gazettes for a specific month and year
   */
  private async fetchMonthGazettes(
    month: number,
    year: number,
  ): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const monthStr = month.toString().padStart(2, "0");

    // Construct URL with month and year parameters
    const url = `${this.natalConfig.baseUrl}index.php?p=d&m=${monthStr}&a=${year}`;

    logger.debug(`Fetching gazettes for ${month}/${year}: ${url}`);

    try {
      const response = await this.fetch(url);

      // Extract PDF links using regex
      // Pattern: https://www2.natal.rn.gov.br/_anexos/publicacao/dom/dom_YYYYMMDD_hash.pdf
      // Also captures extra/especial editions: dom_YYYYMMDD_extra_hash.pdf, dom_YYYYMMDD_especial_hash.pdf
      const pdfRegex =
        /https:\/\/www2\.natal\.rn\.gov\.br\/_anexos\/publicacao\/dom\/dom_(\d{4})(\d{2})(\d{2})(?:_(extra|especial))?_[a-f0-9]+\.pdf/gi;

      const matches = response.matchAll(pdfRegex);
      const seenUrls = new Set<string>();

      for (const match of matches) {
        const fullUrl = match[0];
        const year = match[1];
        const month = match[2];
        const day = match[3];
        const editionType = match[4]?.toLowerCase(); // 'extra' or 'especial' or undefined

        // Avoid duplicates
        if (seenUrls.has(fullUrl)) {
          continue;
        }
        seenUrls.add(fullUrl);

        const dateStr = `${year}-${month}-${day}`;
        const gazetteDate = new Date(`${dateStr}T00:00:00.000Z`);

        // Check if date is in range
        if (!this.isInDateRange(gazetteDate)) {
          continue;
        }

        const isExtra = editionType === "extra" || editionType === "especial";

        const gazette = await this.createGazette(gazetteDate, fullUrl, {
          isExtraEdition: isExtra,
          power: "executive",
        });

        if (gazette) {
          if (editionType) {
            gazette.sourceText = `Diário Oficial de Natal - Edição ${editionType.charAt(0).toUpperCase() + editionType.slice(1)} - ${day}/${month}/${year}`;
          } else {
            gazette.sourceText = `Diário Oficial de Natal - ${day}/${month}/${year}`;
          }
          gazettes.push(gazette);
          logger.info(
            `Found gazette for ${gazette.date}: ${gazette.sourceText}`,
          );
        }
      }

      logger.debug(`Found ${gazettes.length} gazettes for ${month}/${year}`);
    } catch (error) {
      logger.error(
        `Error fetching gazettes for ${month}/${year}:`,
        error as Error,
      );
    }

    return gazettes;
  }
}
