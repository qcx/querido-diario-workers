import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeituraUlianopolisConfig,
} from "../../types";
import { logger } from "../../utils/logger";

/**
 * Spider for Diário Oficial de Ulianópolis-PA.
 * List: https://www.ulianopolis.pa.gov.br/diariooficial.php
 * Each edition: diariooficial.php?id=N; PDF at arquivos_download.php?id=N&pg=diariooficial.
 */
export class PrefeituraUlianopolisSpider extends BaseSpider {
  private baseUrl: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    const cfg = spiderConfig.config as PrefeituraUlianopolisConfig;
    this.baseUrl = cfg.baseUrl.replace(/\/$/, "");
    if (!this.baseUrl) {
      throw new Error(
        `PrefeituraUlianopolisSpider requires baseUrl for ${spiderConfig.name}`,
      );
    }
    logger.info(
      `Initializing PrefeituraUlianopolisSpider for ${spiderConfig.name}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const listUrl = `${this.baseUrl}/diariooficial.php`;
    const html = await this.fetch(listUrl);

    // Match "diariooficial.php?id=N" then ") DD/MM/YYYY" (date right after link)
    const entryRegex =
      /diariooficial\.php\?id=(\d+)\)\s*(\d{2})\/(\d{2})\/(\d{4})/gi;
    const matches = [...html.matchAll(entryRegex)];
    const seenIds = new Set<string>();

    for (const m of matches) {
      const id = m[1];
      const day = m[2];
      const month = m[3];
      const year = m[4];
      const dateStr = `${year}-${month}-${day}`;
      const gazetteDate = new Date(dateStr + "T12:00:00Z");
      if (!this.isInDateRange(gazetteDate)) continue;
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const pdfUrl = `${this.baseUrl}/arquivos_download.php?id=${id}&pg=diariooficial`;
      const g = await this.createGazette(gazetteDate, pdfUrl, {
        power: "executive",
      });
      if (g) gazettes.push(g);
    }

    logger.info(
      `PrefeituraUlianopolisSpider found ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
    );
    return gazettes;
  }
}
