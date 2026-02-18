import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeituraScCityConfig,
} from "../../types";
import { logger } from "../../utils/logger";

/**
 * Spider para o Diário Oficial Eletrônico do Município de Joinville (DOEM).
 * Site próprio: https://www.joinville.sc.gov.br/jornal
 *
 * Lista paginada em /jornal/index/page/N. Links para edições em visualizaranexos ou diretos .pdf.
 */
export class PrefeituraJoinvilleScSpider extends BaseSpider {
  protected scConfig: PrefeituraScCityConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.scConfig = spiderConfig.config as PrefeituraScCityConfig;
    const base = this.scConfig.baseUrl.replace(/\/$/, "");
    if (!base.includes("joinville")) {
      throw new Error(
        `PrefeituraJoinvilleScSpider requires Joinville baseUrl for ${spiderConfig.name}`,
      );
    }
    logger.info(
      `Initializing PrefeituraJoinvilleScSpider for ${spiderConfig.name}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const base = this.scConfig.baseUrl.replace(/\/$/, "");
    const jornalBase = `${base}/jornal`;
    const seenUrls = new Set<string>();

    try {
      const maxPages = 100;
      for (let page = 1; page <= maxPages; page++) {
        const listUrl = `${jornalBase}/index/page/${page}`;
        logger.debug(`Fetching ${listUrl}`);

        const html = await this.fetch(listUrl);

        // Links para edição: visualizaranexos?cod_jornal=X&cod_sei_publicacao=Y ou .pdf
        const linkRegex =
          /href=["']([^"']*(?:visualizaranexos|\.pdf)[^"']*)["']/gi;
        const dateRegex = /(\d{2})\/(\d{2})\/(\d{4})/g;
        let match;

        while ((match = linkRegex.exec(html)) !== null) {
          let href = match[1];
          if (href.startsWith("javascript:")) continue;
          if (!href.startsWith("http")) {
            href = href.startsWith("/")
              ? `${new URL(base).origin}${href}`
              : `${jornalBase}/${href}`;
          }
          if (seenUrls.has(href)) continue;
          seenUrls.add(href);

          // Contexto ao redor do link para extrair data
          const start = Math.max(0, match.index - 200);
          const end = Math.min(html.length, match.index + 200);
          const context = html.slice(start, end);
          const gazetteDate = this.extractDateFromContext(context);
          if (!gazetteDate) continue;
          if (!this.isInDateRange(gazetteDate)) continue;

          let pdfUrl = href;
          if (href.includes("visualizaranexos") && !href.endsWith(".pdf")) {
            pdfUrl = await this.resolvePdfFromViewUrl(href, base);
            if (!pdfUrl) continue;
          }

          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            power: "executive",
            sourceText: "Diário Oficial Eletrônico do Município de Joinville",
          });
          if (gazette) gazettes.push(gazette);
        }

        // Se não achou nenhum link nesta página, pode ter acabado a lista
        if (page === 1 && seenUrls.size === 0) break;
        const hasMore =
          html.includes("page/" + (page + 1)) ||
          html.includes("Próxima") ||
          html.includes("próxima");
        if (!hasMore) break;
      }

      logger.info(`Found ${gazettes.length} gazettes for Joinville`);
    } catch (error) {
      logger.error(`Error crawling Joinville DOEM:`, error as Error);
    }

    return gazettes;
  }

  private extractDateFromContext(context: string): Date | null {
    const numericMatch = context.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (numericMatch) {
      const [, day, month, year] = numericMatch;
      return new Date(`${year}-${month}-${day}`);
    }

    const textMatch = context.match(
      /(\d{2})\s*\|\s*([A-ZÇ]{3})\s*\|\s*(\d{4})/,
    );
    if (!textMatch) return null;

    const [, day, monthText, year] = textMatch;
    const monthMap: Record<string, string> = {
      JAN: "01",
      FEV: "02",
      MAR: "03",
      ABR: "04",
      MAI: "05",
      JUN: "06",
      JUL: "07",
      AGO: "08",
      SET: "09",
      OUT: "10",
      NOV: "11",
      DEZ: "12",
    };
    const month = monthMap[monthText.toUpperCase()];
    if (!month) return null;

    return new Date(`${year}-${month}-${day}`);
  }

  private async resolvePdfFromViewUrl(
    viewUrl: string,
    base: string,
  ): Promise<string | null> {
    try {
      const html = await this.fetch(
        viewUrl.startsWith("http")
          ? viewUrl
          : `${base}${viewUrl.startsWith("/") ? "" : "/"}${viewUrl}`,
      );
      const pdfMatch =
        html.match(/href=["']([^"']*\.pdf)["']/i) ||
        html.match(/window\.location\s*=\s*["']([^"']+)["']/);
      if (pdfMatch) {
        let u = pdfMatch[1];
        if (!u.startsWith("http")) u = new URL(u, base).toString();
        return u;
      }
    } catch {
      // ignore
    }
    return null;
  }
}
