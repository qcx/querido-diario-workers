import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeituraAnanindeuaConfig,
} from "../../types";
import { logger } from "../../utils/logger";
import { toISODate } from "../../utils/date-utils";

/**
 * Spider for Diário Oficial de Ananindeua-PA.
 * Site: https://www.ananindeua.pa.gov.br/diario_oficial
 * List with "Data da Publicação: DD/MM/YYYY" and direct PDF links (Baixar o aquivo).
 * Pagination: diario_oficial.asp?num_rows=...&pag=N
 */
export class PrefeituraAnanindeuaSpider extends BaseSpider {
  private baseUrl: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    const cfg = spiderConfig.config as PrefeituraAnanindeuaConfig;
    this.baseUrl = cfg.baseUrl.replace(/\/$/, "");
    if (!this.baseUrl) {
      throw new Error(
        `PrefeituraAnanindeuaSpider requires baseUrl for ${spiderConfig.name}`,
      );
    }
    logger.info(
      `Initializing PrefeituraAnanindeuaSpider for ${spiderConfig.name}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let page = 1;
    const maxPages = 100;
    const seenPdfUrls = new Set<string>();
    // Site uses .asp for list and pagination (e.g. diario_oficial.asp?num_rows=4376&pag=2)
    const listPath =
      this.baseUrl.replace(/\/$/, "").replace(/(\.asp)?(\?.*)?$/i, "") + ".asp";
    const origin = new URL(listPath).origin;

    while (page <= maxPages) {
      const url =
        page === 1 ? listPath : `${listPath}?num_rows=5000&pag=${page}`;

      logger.debug(`Fetching page ${page}: ${url}`);

      const html = await this.fetch(url);

      // Match blocks: "Data da Publicação: DD/MM/YYYY" followed by link to .pdf
      const dateRegex = /Data da Publicação:\s*(\d{2})\/(\d{2})\/(\d{4})/gi;
      // Absolute or relative PDF links (site may use href="/midias/...pdf" or href="https://...")
      const pdfRegex =
        /href=["'](https?:\/\/[^"']+\.pdf)["']|href=["']([^"']*\.pdf)["']/gi;

      const dateMatches = [...html.matchAll(dateRegex)];
      const pdfMatches: { index: number; url: string }[] = [];
      let m: RegExpExecArray | null;
      pdfRegex.lastIndex = 0;
      while ((m = pdfRegex.exec(html)) !== null) {
        const pdfUrl = (m[1] || m[2] || "").trim();
        if (!pdfUrl) continue;
        const absoluteUrl = pdfUrl.startsWith("http")
          ? pdfUrl
          : new URL(pdfUrl, origin + "/").href;
        pdfMatches.push({ index: m.index, url: absoluteUrl });
      }

      for (const dm of dateMatches) {
        const day = parseInt(dm[1], 10);
        const month = parseInt(dm[2], 10);
        const year = parseInt(dm[3], 10);
        const gazetteDate = new Date(year, month - 1, day);
        if (!this.isInDateRange(gazetteDate)) continue;

        const pos = dm.index!;
        const nextPdf = pdfMatches.find(
          (m) => m.index > pos && m.index < pos + 800,
        );
        if (!nextPdf || seenPdfUrls.has(nextPdf.url)) continue;
        seenPdfUrls.add(nextPdf.url);

        const g = await this.createGazette(gazetteDate, nextPdf.url, {
          power: "executive",
        });
        if (g) gazettes.push(g);
      }

      const hasNext =
        html.includes(`pag=${page + 1}`) || html.includes("próximo");
      if (!hasNext || dateMatches.length === 0) break;
      page++;
    }

    logger.info(
      `PrefeituraAnanindeuaSpider found ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
    );
    return gazettes;
  }
}
