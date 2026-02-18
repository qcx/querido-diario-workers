import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeituraPaPublicacoesConfig,
} from "../../types";
import { logger } from "../../utils/logger";

const MONTH_ABBREV: Record<string, string> = {
  jan: "01",
  fev: "02",
  mar: "03",
  abr: "04",
  mai: "05",
  jun: "06",
  jul: "07",
  ago: "08",
  set: "09",
  out: "10",
  nov: "11",
  dez: "12",
};

/**
 * Spider for Diário Oficial / Publicações Oficiais of PA cities using WordPress
 * with archive list (month year + "mon dd [title](url)") and PDF links inside each post.
 * Used by Portel (c/publicacoes/demais), Vigia (c/publicacoes), etc.
 */
export class PrefeituraPaPublicacoesSpider extends BaseSpider {
  private baseUrl: string;
  private listPath: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    const cfg = spiderConfig.config as PrefeituraPaPublicacoesConfig;
    this.baseUrl = cfg.baseUrl.replace(/\/$/, "");
    this.listPath = (cfg.listPath || "c/publicacoes/demais").replace(/^\//, "");
    if (!this.baseUrl) {
      throw new Error(
        `PrefeituraPaPublicacoesSpider requires baseUrl for ${spiderConfig.name}`,
      );
    }
    logger.info(
      `Initializing PrefeituraPaPublicacoesSpider for ${spiderConfig.name} (${this.baseUrl}/${this.listPath})`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const listUrl = `${this.baseUrl}/${this.listPath}`;
    const html = await this.fetch(listUrl);

    // Section "month_full, year" sets year; "mon_abbrev dd [title](url)" gives day/month/url
    const reYear = /(\w+),\s*(\d{4})/g;
    const reLine =
      /(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\s+(\d{1,2})\s+\[[\s\S]*?\]\((https?:\/\/[^)]+)\)/gi;
    const yearPositions: { index: number; year: string }[] = [];
    let y: RegExpExecArray | null;
    while ((y = reYear.exec(html)) !== null) {
      yearPositions.push({ index: y.index, year: y[2] });
    }
    const defaultYear = String(new Date().getFullYear());
    const entriesFinal: {
      year: string;
      month: string;
      day: string;
      url: string;
    }[] = [];
    let l: RegExpExecArray | null;
    while ((l = reLine.exec(html)) !== null) {
      const pos = l.index;
      let year = defaultYear;
      for (const yp of yearPositions) {
        if (yp.index <= pos) year = yp.year;
      }
      const abbrev = l[1].toLowerCase();
      const monthNum = MONTH_ABBREV[abbrev];
      if (!monthNum) continue;
      entriesFinal.push({
        year,
        month: monthNum,
        day: l[2].padStart(2, "0"),
        url: l[3].replace(/\/$/, ""),
      });
    }

    const seenPdfUrls = new Set<string>();

    for (const entry of entriesFinal) {
      const dateStr = `${entry.year}-${entry.month}-${entry.day}`;
      const gazetteDate = new Date(dateStr + "T12:00:00Z");
      if (!this.isInDateRange(gazetteDate)) continue;

      try {
        const pageHtml = await this.fetch(entry.url);
        const pdfRegex =
          /href="(https?:\/\/[^"]*\/wp-content\/uploads\/[^"]*\.pdf)"/gi;
        let pdfMatch: RegExpExecArray | null;
        while ((pdfMatch = pdfRegex.exec(pageHtml)) !== null) {
          let pdfUrl = pdfMatch[1];
          if (pdfUrl.startsWith("/")) {
            const u = new URL(entry.url);
            pdfUrl = u.origin + pdfUrl;
          }
          if (seenPdfUrls.has(pdfUrl)) continue;
          seenPdfUrls.add(pdfUrl);
          const g = await this.createGazette(gazetteDate, pdfUrl, {
            power: "executive",
          });
          if (g) gazettes.push(g);
        }
      } catch (err) {
        logger.debug(
          `Failed to fetch post ${entry.url}: ${(err as Error).message}`,
        );
      }
    }

    logger.info(
      `PrefeituraPaPublicacoesSpider found ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
    );
    return gazettes;
  }
}
