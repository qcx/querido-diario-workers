import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange, SigpubConfig } from "../../types";
import { logger } from "../../utils/logger";
import { toISODate } from "../../utils/date-utils";

/**
 * SigpubMtSpider - SIGPub específico para Mato Grosso (AMM-MT).
 *
 * O portal AMM-MT (diariomunicipal.com.br/amm-mt/) retorna URLs de PDF com
 * entidades HTML (&amp; em vez de &). A página principal só mostra a "última edição"
 * (que pode ser antiga). Para obter edições por data, usamos a mesma estratégia
 * do APRECE: buscar a URL com ?dia=DD&mes=MM&ano=YYYY para cada data no intervalo.
 *
 * Não altere o SigpubSpider base para não impactar outros estados.
 */
export class SigpubMtSpider extends BaseSpider {
  protected sigpubConfig: SigpubConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.sigpubConfig = spiderConfig.config as SigpubConfig;
    const cityName = this.sigpubConfig.cityName || this.spiderConfig.name;
    logger.info(
      `Initializing SigpubMtSpider for ${cityName} with URL: ${this.sigpubConfig.url}, entityId: ${this.sigpubConfig.entityId}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    const cityName = this.sigpubConfig.cityName || this.spiderConfig.name;
    logger.info(
      `Crawling ${this.sigpubConfig.url} for ${cityName} (entityId: ${this.sigpubConfig.entityId})...`,
    );
    logger.warn(
      `Note: SIGPub uses consolidated PDFs. The gazette will contain all municipalities, not just ${cityName}.`,
    );

    try {
      const gazettes = await this.crawlByCalendar();
      if (gazettes.length > 0) {
        logger.info(`Found ${gazettes.length} gazettes for ${cityName} via calendar`);
        return gazettes;
      }
      return await this.crawlMainPageFallback();
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
      return [];
    }
  }

  /**
   * Crawl by fetching one URL per date (calendar strategy, same as APRECE).
   * AMM-MT accepts ?dia=DD&mes=MM&ano=YYYY to show content for that date.
   */
  private async crawlByCalendar(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const cityName = this.sigpubConfig.cityName || this.spiderConfig.name;
    const entityId = this.sigpubConfig.entityId;
    const baseUrl = this.sigpubConfig.url.replace(/\?.*$/, "").replace(/\/$/, "");

    const pdfUrlRegex =
      /https:\/\/www-storage\.voxtecnologia\.com\.br\/\?m=sigpub\.publicacao&f=(\d+)&i=publicado_(\d+)_(\d{4}-\d{2}-\d{2})_[a-f0-9]+\.pdf/g;

    let currentDate = new Date(this.startDate);
    const endDate = new Date(this.endDate);

    while (currentDate <= endDate) {
      const day = currentDate.getDate().toString().padStart(2, "0");
      const month = (currentDate.getMonth() + 1).toString().padStart(2, "0");
      const year = currentDate.getFullYear();
      const dateStr = toISODate(currentDate);
      const url = `${baseUrl}/?dia=${day}&mes=${month}&ano=${year}`;

      try {
        logger.debug(`Fetching AMM-MT for ${dateStr}: ${url}`);
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
            gazette.notes = `Consolidated gazette from ${this.sigpubConfig.url}. EntityId for ${cityName}: ${entityId}`;
            gazettes.push(gazette);
            break;
          }
        }
      } catch (err) {
        logger.debug(`No gazette or error for ${dateStr}: ${(err as Error).message}`);
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return gazettes;
  }

  /**
   * Fallback: fetch main page and extract any PDF in date range (main page often shows only "last edition").
   */
  private async crawlMainPageFallback(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const cityName = this.sigpubConfig.cityName || this.spiderConfig.name;
    const entityId = this.sigpubConfig.entityId;

    const response = await this.fetch(this.sigpubConfig.url);
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
        gazette.notes = `Consolidated gazette from ${this.sigpubConfig.url}. EntityId for ${cityName}: ${entityId}`;
        gazettes.push(gazette);
      }
    }

    if (gazettes.length > 0) {
      logger.info(`Found ${gazettes.length} gazettes for ${cityName} from main page fallback`);
    }
    return gazettes;
  }
}
