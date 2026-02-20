import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeituraSantanaAraguaiaConfig,
} from "../../types";
import { logger } from "../../utils/logger";

/**
 * Spider for Diário Oficial de Santana do Araguaia-PA.
 * Site: https://diariooficial.pmsaraguaia.pa.gov.br/
 * List of editions with direct PDF links: DOMSA-DDMMYYYY-EN-NNN.pdf (edição normal) and suplemento.
 */
export class PrefeituraSantanaAraguaiaSpider extends BaseSpider {
  private baseUrl: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    const cfg = spiderConfig.config as PrefeituraSantanaAraguaiaConfig;
    this.baseUrl = cfg.baseUrl.replace(/\/$/, "");
    if (!this.baseUrl) {
      throw new Error(
        `PrefeituraSantanaAraguaiaSpider requires baseUrl for ${spiderConfig.name}`,
      );
    }
    logger.info(
      `Initializing PrefeituraSantanaAraguaiaSpider for ${spiderConfig.name}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const seen = new Set<string>();
    const html = await this.fetch(this.baseUrl);

    // PDFs: DOMSA-DDMMYYYY-EN-NNN.pdf (edição normal) e DOMSA-DDMMYYYY-SP-NNN.pdf (suplemento)
    const linkRegex =
      /href="(https?:\/\/[^"]*\/DOMSA-(\d{2})(\d{2})(\d{4})-(?:EN|SP)-\d+\.pdf)"/gi;
    let m: RegExpExecArray | null;
    while ((m = linkRegex.exec(html)) !== null) {
      const pdfUrl = m[1];
      const day = m[2];
      const month = m[3];
      const year = m[4];
      const dateStr = `${year}-${month}-${day}`;
      const gazetteDate = new Date(dateStr + "T12:00:00Z");
      if (!this.isInDateRange(gazetteDate)) continue;
      if (seen.has(pdfUrl)) continue;
      seen.add(pdfUrl);

      const editionMatch = pdfUrl.match(/-(\d+)\.pdf$/);
      const g = await this.createGazette(gazetteDate, pdfUrl, {
        editionNumber: editionMatch ? editionMatch[1] : undefined,
        power: "executive",
      });
      if (g) gazettes.push(g);
    }

    logger.info(
      `PrefeituraSantanaAraguaiaSpider found ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
    );
    return gazettes;
  }
}
