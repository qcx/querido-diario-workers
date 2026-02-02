import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeituraVilhenaConfig,
} from "../../types";
import { logger } from "../../utils/logger";
import { toISODate } from "../../utils/date-utils";

/**
 * PrefeituraVilhenaSpider implementation
 *
 * Crawls the official gazette from Vilhena, RO.
 * Diário oficial NÃO é publicado na AROM; é no site próprio vilhena.xyz.
 *
 * URL: https://vilhena.xyz/diario-oficial
 *
 * Structure:
 * - Month folder: {baseUrl}/diarios_publicado/Abrir_Seguro/{year}/{MM}-{monthname}/
 * - PDFs: DOV N {number} - {DD.MM.YYYY}.pdf
 */
export class PrefeituraVilhenaSpider extends BaseSpider {
  protected vilhenaConfig: PrefeituraVilhenaConfig;

  private readonly monthNames: Record<number, string> = {
    1: "01-janeiro",
    2: "02-fevereiro",
    3: "03-marco",
    4: "04-abril",
    5: "05-maio",
    6: "06-junho",
    7: "07-julho",
    8: "08-agosto",
    9: "09-setembro",
    10: "10-outubro",
    11: "11-novembro",
    12: "12-dezembro",
  };

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.vilhenaConfig = spiderConfig.config as PrefeituraVilhenaConfig;

    if (!this.vilhenaConfig.baseUrl) {
      throw new Error(
        `PrefeituraVilhenaSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeituraVilhenaSpider for ${spiderConfig.name} with URL: ${this.vilhenaConfig.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.vilhenaConfig.baseUrl} for ${this.spiderConfig.name}...`,
    );

    const gazettes: Gazette[] = [];
    const startDate = this.startDate;
    const endDate = this.endDate;
    const seenUrls = new Set<string>();

    const months: { year: number; month: number }[] = [];
    const current = new Date(startDate.getFullYear(), startDate.getMonth());

    while (current <= endDate) {
      months.push({
        year: current.getFullYear(),
        month: current.getMonth() + 1,
      });
      current.setMonth(current.getMonth() + 1);
    }

    for (const { year, month } of months) {
      try {
        const monthGazettes = await this.crawlMonth(year, month);
        for (const gazette of monthGazettes) {
          if (seenUrls.has(gazette.fileUrl)) continue;
          seenUrls.add(gazette.fileUrl);
          const gazetteDate = new Date(gazette.date);
          if (this.isInDateRange(gazetteDate)) {
            gazettes.push(gazette);
          }
        }
      } catch (error) {
        logger.debug(
          `Error fetching month ${month}/${year}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    logger.info(
      `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
    );
    return gazettes;
  }

  /**
   * Crawl a specific month's directory/list page
   */
  private async crawlMonth(year: number, month: number): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const monthFolder = this.monthNames[month];
    if (!monthFolder) {
      logger.warn(`Invalid month: ${month}`);
      return gazettes;
    }

    const baseUrl = this.vilhenaConfig.baseUrl.replace(/\/$/, "");
    const monthUrl = `${baseUrl}/diarios_publicado/Abrir_Seguro/${year}/${monthFolder}/`;

    try {
      logger.debug(`Fetching month: ${monthUrl}`);
      const html = await this.fetch(monthUrl);

      // Match <a href="...DOV...pdf"> or href with URL-encoded DOV N number - DD.MM.YYYY
      // Pattern: DOV N 4166 - 13.02.2025.pdf or DOV%20N%204166%20-%2013.02.2025.pdf
      const linkPattern =
        /<a\s+href="([^"]*\.pdf)"[^>]*>/gi;
      let match;
      while ((match = linkPattern.exec(html)) !== null) {
        const href = match[1];
        const decoded = decodeURIComponent(href);
        // DOV N {number} - {DD.MM.YYYY}.pdf
        const dovMatch = decoded.match(
          /DOV\s+N[º°]?\s*(\d+)\s*[-–]\s*(\d{2})\.(\d{2})\.(\d{4})\.pdf/i,
        );
        if (!dovMatch) continue;

        const [, editionNumber, day, monthStr, yearStr] = dovMatch;
        const isoDate = `${yearStr}-${monthStr}-${day}`;
        const gazetteDate = new Date(`${isoDate}T00:00:00.000Z`);

        const pdfUrl = href.startsWith("http")
          ? href
          : new URL(href, monthUrl).href;

        const gazette = await this.createGazette(gazetteDate, pdfUrl, {
          editionNumber,
          isExtraEdition: false,
          power: "executive",
          sourceText: `DOV Edição ${editionNumber} - ${toISODate(gazetteDate)}`,
          skipUrlResolution: true,
        });
        if (gazette) {
          gazettes.push(gazette);
          logger.debug(
            `Found gazette: DOV N ${editionNumber} - ${toISODate(gazetteDate)}`,
          );
        }
      }

    } catch (error) {
      logger.debug(`Month ${month}/${year} not found or failed: ${error}`);
    }

    return gazettes;
  }
}
