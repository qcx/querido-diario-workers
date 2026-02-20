import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeituraAltamiraConfig,
} from "../../types";
import { logger } from "../../utils/logger";

/**
 * Spider for Diário Oficial de Altamira-PA.
 * List: https://altamira.pa.gov.br/diario-oficial/
 * Each item links to a page (diario-oficial-no-XXX-YYYY-DD-MM-DD) that contains the PDF link.
 */
export class PrefeituraAltamiraSpider extends BaseSpider {
  private baseUrl: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    const cfg = spiderConfig.config as PrefeituraAltamiraConfig;
    this.baseUrl = cfg.baseUrl.replace(/\/$/, "");
    if (!this.baseUrl) {
      throw new Error(
        `PrefeituraAltamiraSpider requires baseUrl for ${spiderConfig.name}`,
      );
    }
    logger.info(
      `Initializing PrefeituraAltamiraSpider for ${spiderConfig.name}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const html = await this.fetch(this.baseUrl);

    // Links to edition pages: diario-oficial-no-266-2026-11-02-2026/ (URL: edition, YYYY, DD, MM, YYYY)
    const pageLinkRegex =
      /href="(https?:\/\/[^"]*\/diario-oficial-no-(\d+)-(\d{4})-(\d{2})-(\d{2})-\d{4}(?:-[^"]*)?\/)"/g;
    const matches = [...html.matchAll(pageLinkRegex)];
    const seenUrls = new Set<string>();

    for (const m of matches) {
      const pageUrl = m[1].replace(/\/$/, "");
      const year = m[3];
      const day = m[4];
      const month = m[5];
      // URL pattern: diario-oficial-no-266-2026-11-02-2026 -> edition, year, day, month
      const dateStr = `${year}-${month}-${day}`;
      const gazetteDate = new Date(dateStr + "T12:00:00Z");
      if (!this.isInDateRange(gazetteDate)) continue;
      if (seenUrls.has(pageUrl)) continue;
      seenUrls.add(pageUrl);

      try {
        const pageHtml = await this.fetch(pageUrl);
        const pdfMatch = pageHtml.match(
          /href="(https?:\/\/[^"]*\/[^"]*\.pdf)"/,
        );
        if (!pdfMatch) continue;
        let pdfUrl = pdfMatch[1];
        if (pdfUrl.startsWith("/")) {
          const u = new URL(pageUrl);
          pdfUrl = u.origin + pdfUrl;
        }
        const g = await this.createGazette(gazetteDate, pdfUrl, {
          editionNumber: m[2],
          power: "executive",
        });
        if (g) gazettes.push(g);
      } catch (err) {
        logger.debug(
          `Failed to fetch edition page ${pageUrl}: ${(err as Error).message}`,
        );
      }
    }

    logger.info(
      `PrefeituraAltamiraSpider found ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
    );
    return gazettes;
  }
}
