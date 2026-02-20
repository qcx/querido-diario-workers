import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange, AgmConfig } from "../../types";
import { logger } from "../../utils/logger";
import { toISODate } from "../../utils/date-utils";

/**
 * AgmSpider - Diário Oficial da Associação Goiana de Municípios (AGM).
 *
 * Portal em diariomunicipal.com.br/agm/. Retorna URLs de PDF com entidades
 * HTML (&amp;). Usa calendário ?dia=DD&mes=MM&ano=YYYY para cada data e
 * fallback na página principal.
 */
export class AgmSpider extends BaseSpider {
  protected agmConfig: AgmConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.agmConfig = spiderConfig.config as AgmConfig;
    const cityName = this.agmConfig.cityName || this.spiderConfig.name;
    logger.info(
      `Initializing AgmSpider for ${cityName} with URL: ${this.agmConfig.url}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    const cityName = this.agmConfig.cityName || this.spiderConfig.name;
    logger.info(`Crawling AGM ${this.agmConfig.url} for ${cityName}...`);

    try {
      const gazettes = await this.crawlByCalendar();
      if (gazettes.length > 0) {
        logger.info(
          `Found ${gazettes.length} gazettes for ${cityName} via calendar`,
        );
        return gazettes;
      }
      return await this.crawlMainPageFallback();
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
      return [];
    }
  }

  /**
   * Crawl by fetching one URL per date (calendar strategy).
   * AGM accepts ?dia=DD&mes=MM&ano=YYYY to show content for that date.
   */
  private async crawlByCalendar(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const cityName = this.agmConfig.cityName || this.spiderConfig.name;
    const baseUrl = this.agmConfig.url.replace(/\?.*$/, "").replace(/\/$/, "");

    const pdfUrlRegex =
      /https:\/\/www-storage\.voxtecnologia\.com\.br\/\?m=sigpub\.publicacao&f=(\d+)&i=publicado_(\d+)_(\d{4}-\d{2}-\d{2})_[a-f0-9]+\.pdf/g;

    let currentDate = new Date(this.startDate);
    const endDate = new Date(this.endDate);

    while (currentDate <= endDate) {
      const day = currentDate.getUTCDate().toString().padStart(2, "0");
      const month = (currentDate.getUTCMonth() + 1).toString().padStart(2, "0");
      const year = currentDate.getUTCFullYear();
      const dateStr = toISODate(currentDate);
      const url = `${baseUrl}/?dia=${day}&mes=${month}&ano=${year}`;

      try {
        logger.debug(`Fetching AGM for ${dateStr}: ${url}`);
        const response = await this.fetch(url);
        const normalizedHtml = response.replace(/&amp;/g, "&");
        const matches = normalizedHtml.matchAll(pdfUrlRegex);

        for (const match of matches) {
          const pdfUrl = match[0];
          const pdfDateStr = match[3];

          if (pdfDateStr !== dateStr) continue;

          const gazette = await this.createGazette(currentDate, pdfUrl, {
            editionNumber: match[2],
            isExtraEdition: false,
            power: "executive",
          });
          if (gazette) {
            gazette.notes = `Diário Oficial AGM (${this.agmConfig.url}). Município: ${cityName}.`;
            gazettes.push(gazette);
            break;
          }
        }
      } catch (err) {
        logger.debug(
          `No gazette or error for ${dateStr}: ${(err as Error).message}`,
        );
      }

      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }

    return gazettes;
  }

  /**
   * Fallback: fetch main page and extract any PDF in date range.
   */
  private async crawlMainPageFallback(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const cityName = this.agmConfig.cityName || this.spiderConfig.name;

    const response = await this.fetch(this.agmConfig.url);
    const normalizedHtml = response.replace(/&amp;/g, "&");
    const pdfUrlRegex =
      /https:\/\/www-storage\.voxtecnologia\.com\.br\/\?m=sigpub\.publicacao&f=(\d+)&i=publicado_(\d+)_(\d{4}-\d{2}-\d{2})_[a-f0-9]+\.pdf/g;

    const seenDates = new Set<string>();
    for (const match of normalizedHtml.matchAll(pdfUrlRegex)) {
      const url = match[0];
      const pdfEditionId = match[2];
      const dateStr = match[3];
      if (seenDates.has(dateStr)) continue;
      const gazetteDate = new Date(dateStr + "T00:00:00.000Z");
      if (!this.isInDateRange(gazetteDate)) continue;
      seenDates.add(dateStr);
      const gazette = await this.createGazette(gazetteDate, url, {
        editionNumber: pdfEditionId,
        isExtraEdition: false,
        power: "executive",
      });
      if (gazette) {
        gazette.notes = `Diário Oficial AGM (${this.agmConfig.url}). Município: ${cityName}.`;
        gazettes.push(gazette);
      }
    }

    if (gazettes.length > 0) {
      logger.info(
        `Found ${gazettes.length} gazettes for ${cityName} from AGM main page fallback`,
      );
    }
    return gazettes;
  }
}
