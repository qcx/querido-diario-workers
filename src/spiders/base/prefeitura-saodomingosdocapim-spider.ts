import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeituraSaodomingosdocapimConfig,
} from "../../types";
import { logger } from "../../utils/logger";

const LIST_PAGES = [
  "leis.php",
  "decretos.php",
  "portaria.php",
  "diariaslista.php",
];

/**
 * Spider for Diário Oficial / Publicações Oficiais of São Domingos do Capim-PA.
 * Site: https://saodomingosdocapim.pa.gov.br/
 * Lists: leis.php, decretos.php, portaria.php, diariaslista.php
 * Each row has date DD/MM/YYYY and [Acessar](detail_url). Detail page has PDF link.
 */
export class PrefeituraSaodomingosdocapimSpider extends BaseSpider {
  private baseUrl: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    const cfg = spiderConfig.config as PrefeituraSaodomingosdocapimConfig;
    this.baseUrl = cfg.baseUrl.replace(/\/$/, "");
    if (!this.baseUrl) {
      throw new Error(
        `PrefeituraSaodomingosdocapimSpider requires baseUrl for ${spiderConfig.name}`,
      );
    }
    logger.info(
      `Initializing PrefeituraSaodomingosdocapimSpider for ${spiderConfig.name}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const seenPdfUrls = new Set<string>();

    // Parse: "#### TYPE: XXX/YYYY DD/MM/YYYY" ... "[Acessar](url)"
    const listItemRegex =
      /#### [^:]+:[\s\S]*?(\d{2})\/(\d{2})\/(\d{4})[\s\S]*?\[Acessar\]\((https?:\/\/[^)]+\?id=\d+)\)/gi;

    for (const listPage of LIST_PAGES) {
      const listUrl = `${this.baseUrl}/${listPage}`;
      try {
        const html = await this.fetch(listUrl);
        let m: RegExpExecArray | null;
        while ((m = listItemRegex.exec(html)) !== null) {
          const day = m[1];
          const month = m[2];
          const year = m[3];
          const detailUrl = m[4];
          const dateStr = `${year}-${month}-${day}`;
          const gazetteDate = new Date(dateStr + "T12:00:00Z");
          if (!this.isInDateRange(gazetteDate)) continue;

          try {
            const detailHtml = await this.fetch(detailUrl);
            const origin = new URL(this.baseUrl).origin;
            const pdfRegex = /href="(https?:\/\/[^"]+\.pdf)"/gi;
            let pdfMatch: RegExpExecArray | null;
            while ((pdfMatch = pdfRegex.exec(detailHtml)) !== null) {
              let pdfUrl = pdfMatch[1];
              if (pdfUrl.startsWith("/")) {
                pdfUrl = origin + pdfUrl;
              }
              if (!pdfUrl.startsWith(origin)) continue;
              if (seenPdfUrls.has(pdfUrl)) continue;
              seenPdfUrls.add(pdfUrl);
              const g = await this.createGazette(gazetteDate, pdfUrl, {
                power: "executive",
              });
              if (g) gazettes.push(g);
            }
          } catch (err) {
            logger.debug(
              `Failed to fetch detail ${detailUrl}: ${(err as Error).message}`,
            );
          }
        }
      } catch (err) {
        logger.debug(
          `Failed to fetch list ${listUrl}: ${(err as Error).message}`,
        );
      }
    }

    logger.info(
      `PrefeituraSaodomingosdocapimSpider found ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
    );
    return gazettes;
  }
}
