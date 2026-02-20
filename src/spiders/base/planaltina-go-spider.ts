import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PlanaltinaGoConfig,
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
 * PlanaltinaGoSpider - Diário Oficial / Atos normativos de Planaltina (GO).
 *
 * Fonte: portal BSIT/SIGEP em planaltina.bsit-br.com.br/portal/legislation.jsf
 * Lista atos (decretos, leis, portarias) em tabela com colunas:
 * Número, Descrição, Dt. Documento, Publicação, Ano, Download.
 *
 * Usa a data de "Publicação" para cada documento e tenta obter o link de download.
 */
export class PlanaltinaGoSpider extends BaseSpider {
  protected planaltinaConfig: PlanaltinaGoConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.planaltinaConfig = spiderConfig.config as PlanaltinaGoConfig;
    const baseUrl = this.planaltinaConfig.baseUrl.replace(/\/$/, "");
    logger.info(
      `Initializing PlanaltinaGoSpider for ${spiderConfig.name} with baseUrl: ${baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const baseUrl = this.planaltinaConfig.baseUrl.replace(/\/$/, "");
    const listUrl = `${baseUrl}/legislation.jsf`;

    logger.info(
      `Crawling Planaltina GO ${listUrl} for ${this.spiderConfig.name}...`,
    );

    try {
      const html = await this.fetch(listUrl);
      const origin = new URL(listUrl).origin;
      const items = this.parseTable(html, origin);

      const seenDates = new Set<string>();

      for (const item of items) {
        const date = new Date(item.dateStr + "T12:00:00.000Z");
        if (isNaN(date.getTime()) || !this.isInDateRange(date)) continue;
        if (seenDates.has(item.dateStr)) continue;
        if (!item.fileUrl) continue;
        seenDates.add(item.dateStr);

        const gazette: Gazette = {
          date: item.dateStr,
          fileUrl: item.fileUrl,
          territoryId: this.spiderConfig.territoryId,
          scrapedAt: getCurrentTimestamp(),
          isExtraEdition: false,
          power: "executive_legislative",
          sourceText: item.description || undefined,
        };
        gazettes.push(gazette);
      }

      logger.info(
        `PlanaltinaGo: found ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
      );
    } catch (error) {
      logger.error(
        `Error crawling Planaltina GO ${this.spiderConfig.name}:`,
        error as Error,
      );
    }

    return gazettes;
  }

  /**
   * Parse table rows from legislation.jsf.
   * Columns: N. | Número | Descrição | Dt. Documento | Publicação | Ano | Download | Selecionar
   * Date format: "25 de abr de 2025" or "25/04/2025"
   */
  private parseTable(
    html: string,
    origin: string,
  ): { dateStr: string; fileUrl: string | null; description?: string }[] {
    const items: {
      dateStr: string;
      fileUrl: string | null;
      description?: string;
    }[] = [];
    const $ = this.loadHTML(html);

    $("table tbody tr, table tr").each((_, rowEl) => {
      const $row = $(rowEl);
      const cells = $row.find("td");
      if (cells.length < 5) return;

      // Publicação costuma ser uma das colunas (ex.: "25 de abr de 2025")
      let dateStr: string | null = null;
      let fileUrl: string | null = null;
      let description: string | undefined;

      cells.each((i, cellEl) => {
        const text = $(cellEl).text().trim();
        const $links = $(cellEl).find("a[href]");

        // Tentar data "dd de MMM de yyyy"
        const matchBr = text.match(
          /^(\d{1,2})\s+de\s+(\w{3})\s+de\s+(\d{4})$/i,
        );
        if (matchBr) {
          const [, d, mesAbr, y] = matchBr;
          const mes = MES_ABREV[mesAbr.toLowerCase()];
          if (mes) dateStr = `${y}-${mes}-${d.padStart(2, "0")}`;
        }
        // Ou "dd/MM/yyyy"
        const matchSlash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (matchSlash && !dateStr) {
          const [, d, m, y] = matchSlash;
          dateStr = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
        }

        $links.each((_, a) => {
          const href = $(a).attr("href");
          if (!href) return;
          const fullUrl = href.startsWith("http")
            ? href
            : href.startsWith("/")
              ? `${origin}${href}`
              : `${origin}/${href}`;
          if (
            fullUrl.includes(".pdf") ||
            fullUrl.includes("download") ||
            fullUrl.includes("Download")
          ) {
            fileUrl = fullUrl;
          }
          if (
            !fileUrl &&
            (fullUrl.includes(".jsf") || fullUrl.includes("legislation"))
          ) {
            fileUrl = fullUrl;
          }
        });
      });

      if (dateStr) {
        items.push({ dateStr, fileUrl, description });
      }
    });

    return items;
  }
}
