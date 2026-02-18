import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeituraPontaPoraConfig,
} from "../../types";
import { logger } from "../../utils/logger";
import { toISODate } from "../../utils/date-utils";
// @ts-ignore
import { parse } from "node-html-parser";

/**
 * Prefeitura Ponta Porã MS - Diário Oficial
 *
 * URL: https://diariooficial.pontapora.ms.gov.br
 * Estrutura: WordPress com calendário e lista de edições.
 * PDFs: wp-content/uploads/diarios-YYYY/DIARIO-OFICIAL-DD-DE-MES-DE-YYYY.pdf
 * Texto ao lado: "DD/MM/YYYY | Diário Oficial" com link [Copiar] para o PDF.
 */
export class PrefeituraPontaPoraSpider extends BaseSpider {
  private readonly config: PrefeituraPontaPoraConfig;
  private readonly baseUrl: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeituraPontaPoraConfig;
    this.baseUrl = (this.config.baseUrl || "").replace(/\/$/, "");

    logger.info(
      `Initializing PrefeituraPontaPoraSpider for ${spiderConfig.name} with baseUrl: ${this.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      logger.info(
        `Crawling Ponta Porã from ${toISODate(this.startDate)} to ${toISODate(this.endDate)}...`,
      );

      const html = await this.fetch(this.baseUrl);
      const root = parse(html);

      const startStr = toISODate(this.startDate);
      const endStr = toISODate(this.endDate);
      const seenUrls = new Set<string>();

      // 1) Tentar via DOM
      const pdfLinks = root.querySelectorAll(
        'a[href*="wp-content/uploads/diarios"], a[href*=".pdf"]',
      );
      for (const link of pdfLinks) {
        const href = link.getAttribute("href");
        if (!href || !href.includes(".pdf")) continue;
        const fullPdfUrl = href.startsWith("http")
          ? href
          : href.startsWith("/")
            ? new URL(href, this.baseUrl).href
            : `${this.baseUrl}/${href}`;
        const dateFromUrl = this.parseDateFromPdfUrl(fullPdfUrl);
        const parentText = link.parentNode?.toString() || "";
        const dateFromText = this.parseDateFromText(parentText);
        const isoDate = dateFromUrl || dateFromText;
        if (!isoDate || isoDate < startStr || isoDate > endStr) continue;
        if (seenUrls.has(fullPdfUrl)) continue;
        seenUrls.add(fullPdfUrl);
        const isExtraEdition =
          fullPdfUrl.toUpperCase().includes("EXTRA") ||
          /extra/i.test(parentText);
        gazettes.push({
          date: isoDate,
          fileUrl: fullPdfUrl,
          territoryId: this.spiderConfig.territoryId,
          scrapedAt: new Date().toISOString(),
          power: "executive",
          isExtraEdition,
        });
      }

      // 2) Fallback: regex no HTML bruto (caso o conteúdo seja carregado ou o DOM seja diferente)
      if (gazettes.length === 0) {
        const pdfUrlRegex = /href=["']([^"']*\.pdf)["']/gi;
        let m: RegExpExecArray | null;
        while ((m = pdfUrlRegex.exec(html)) !== null) {
          const raw = m[1].replace(/&amp;/g, "&");
          const fullPdfUrl = raw.startsWith("http")
            ? raw
            : raw.startsWith("/")
              ? new URL(raw, this.baseUrl).href
              : `${this.baseUrl}/${raw}`;
          if (!fullPdfUrl.includes("pontapora")) continue;
          const isoDate = this.parseDateFromPdfUrl(fullPdfUrl);
          if (!isoDate || isoDate < startStr || isoDate > endStr) continue;
          if (seenUrls.has(fullPdfUrl)) continue;
          seenUrls.add(fullPdfUrl);
          const isExtraEdition = fullPdfUrl.toUpperCase().includes("EXTRA");
          gazettes.push({
            date: isoDate,
            fileUrl: fullPdfUrl,
            territoryId: this.spiderConfig.territoryId,
            scrapedAt: new Date().toISOString(),
            power: "executive",
            isExtraEdition,
          });
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes for Ponta Porã`,
      );
    } catch (error) {
      logger.error(`Error crawling Ponta Porã:`, error as Error);
    }

    return gazettes;
  }

  private parseDateFromPdfUrl(url: string): string | null {
    // DIARIO-OFICIAL-08-DE-JANEIRO-DE-2026.pdf
    const match = url.match(
      /(\d{1,2})-DE-(JANEIRO|FEVEREIRO|MAR[CÇ]O|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)-DE-(\d{4})/i,
    );
    if (!match) return null;
    const meses: Record<string, string> = {
      janeiro: "01",
      fevereiro: "02",
      março: "03",
      marco: "03",
      abril: "04",
      maio: "05",
      junho: "06",
      julho: "07",
      agosto: "08",
      setembro: "09",
      outubro: "10",
      novembro: "11",
      dezembro: "12",
    };
    const [, dd, mes, yyyy] = match;
    const mm = meses[mes.toLowerCase().replace("ç", "c")];
    if (!mm) return null;
    return `${yyyy}-${mm}-${dd.padStart(2, "0")}`;
  }

  private parseDateFromText(text: string): string | null {
    // 08/01/2026 | Diário Oficial
    const match = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!match) return null;
    const [, dd, mm, yyyy] = match;
    return `${yyyy}-${mm}-${dd}`;
  }
}
