import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  SantoAntonioDescobertoGoConfig,
} from "../../types";
import { logger } from "../../utils/logger";
import { getCurrentTimestamp } from "../../utils/date-utils";

const MES_ABREV: Record<string, string> = {
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
 * SantoAntonioDescobertoGoSpider - Diário Oficial de Santo Antônio do Descoberto (GO).
 *
 * Fonte: portal da prefeitura em santoantoniododescoberto.go.gov.br/diario-oficial/
 * Lista edições do diário (links para PDF). Não utiliza AGM.
 */
export class SantoAntonioDescobertoGoSpider extends BaseSpider {
  protected sadConfig: SantoAntonioDescobertoGoConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.sadConfig = spiderConfig.config as SantoAntonioDescobertoGoConfig;
    const baseUrl = this.sadConfig.baseUrl.replace(/\/$/, "");
    const path = this.sadConfig.diarioPath || "diario-oficial";
    logger.info(
      `Initializing SantoAntonioDescobertoGoSpider for ${spiderConfig.name} with baseUrl: ${baseUrl}/${path}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const baseUrl = this.sadConfig.baseUrl.replace(/\/$/, "");
    const path = this.sadConfig.diarioPath || "diario-oficial";
    const listUrl = path.startsWith("http") ? path : `${baseUrl}/${path}`;

    logger.info(
      `Crawling Santo Antônio do Descoberto GO ${listUrl} for ${this.spiderConfig.name}...`,
    );

    try {
      const html = await this.fetch(listUrl);
      const origin = new URL(listUrl).origin;
      const items = this.parsePdfLinks(html, origin);

      const seenUrls = new Set<string>();

      for (const item of items) {
        if (!item.fileUrl || seenUrls.has(item.fileUrl)) continue;
        const date = new Date(item.dateStr + "T12:00:00.000Z");
        if (isNaN(date.getTime()) || !this.isInDateRange(date)) continue;
        seenUrls.add(item.fileUrl);

        const gazette: Gazette = {
          date: item.dateStr,
          fileUrl: item.fileUrl,
          territoryId: this.spiderConfig.territoryId,
          scrapedAt: getCurrentTimestamp(),
          isExtraEdition: item.isExtra ?? false,
          power: "executive",
          sourceText: item.description || undefined,
        };
        gazettes.push(gazette);
      }

      logger.info(
        `Santo Antônio do Descoberto GO: found ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
      );
    } catch (error) {
      logger.error(
        `Error crawling Santo Antônio do Descoberto GO ${this.spiderConfig.name}:`,
        error as Error,
      );
    }

    return gazettes;
  }

  /**
   * Parse PDF links from the diário oficial page.
   * Supports: direct links in <a href="...pdf">, dates from link text (dd/mm/yyyy, dd de MMM de yyyy), or from URL path (YYYY/MM/).
   */
  private parsePdfLinks(
    html: string,
    origin: string,
  ): {
    dateStr: string;
    fileUrl: string | null;
    description?: string;
    isExtra?: boolean;
  }[] {
    const items: {
      dateStr: string;
      fileUrl: string | null;
      description?: string;
      isExtra?: boolean;
    }[] = [];
    const $ = this.loadHTML(html);

    $('a[href*=".pdf"]').each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      const fullUrl = href.startsWith("http")
        ? href
        : href.startsWith("/")
          ? `${origin}${href}`
          : `${origin}/${href}`;

      const linkText = $(el).text().trim();
      const parentText = $(el)
        .closest("article, .entry, .post, li, tr")
        .text()
        .trim();
      const context = `${linkText} ${parentText}`;

      let dateStr: string | null = null;

      // dd/mm/yyyy
      const matchSlash = context.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (matchSlash) {
        const [, d, m, y] = matchSlash;
        dateStr = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
      }
      // dd de MMM de yyyy
      if (!dateStr) {
        const matchBr = context.match(
          /(\d{1,2})\s+de\s+(\w{3})\s+de\s+(\d{4})/i,
        );
        if (matchBr) {
          const [, d, mesAbr, y] = matchBr;
          const mes = MES_ABREV[mesAbr.toLowerCase()];
          if (mes) dateStr = `${y}-${mes}-${d.padStart(2, "0")}`;
        }
      }
      // YYYY-MM-DD or YYYY/MM/ in URL
      if (!dateStr) {
        const urlDate = fullUrl.match(
          /(\d{4})[-\/](\d{2})[-\/](\d{2})|(\d{4})[-\/](\d{2})\//,
        );
        if (urlDate) {
          if (urlDate[3]) {
            dateStr = `${urlDate[1]}-${urlDate[2]}-${urlDate[3]}`;
          } else if (urlDate[4] && urlDate[5]) {
            dateStr = `${urlDate[4]}-${urlDate[5]}-01`;
          }
        }
      }
      // YYYYMMDD in filename
      if (!dateStr) {
        const fileDate = fullUrl.match(/(\d{8})/);
        if (fileDate) {
          const s = fileDate[1];
          dateStr = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
        }
      }

      if (dateStr) {
        items.push({
          dateStr,
          fileUrl: fullUrl,
          description: linkText || undefined,
          isExtra: /extraordin[aá]ri[ao]|suplementar|especial/i.test(context),
        });
      }
    });

    // Fallback: regex on raw HTML for any PDF URL (e.g. in data attributes or scripts)
    if (items.length === 0) {
      const simplePdfRegex = /(https?:\/\/[^\s"']+\.pdf)/gi;
      let match: RegExpExecArray | null;
      while ((match = simplePdfRegex.exec(html)) !== null) {
        const fullUrl = match[1];
        let dateStr: string | null = null;
        const urlDate = fullUrl.match(
          /(\d{4})[-\/](\d{2})[-\/](\d{2})|(\d{4})[-\/](\d{2})\//,
        );
        if (urlDate) {
          if (urlDate[3]) {
            dateStr = `${urlDate[1]}-${urlDate[2]}-${urlDate[3]}`;
          } else if (urlDate[4] && urlDate[5]) {
            dateStr = `${urlDate[4]}-${urlDate[5]}-01`;
          }
        }
        const fileDate = fullUrl.match(/(\d{8})/);
        if (!dateStr && fileDate) {
          const s = fileDate[1];
          dateStr = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
        }
        if (dateStr) {
          items.push({
            dateStr,
            fileUrl: fullUrl,
            isExtra: false,
          });
        }
      }
    }

    return items;
  }
}
