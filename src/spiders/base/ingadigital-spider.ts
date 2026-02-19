import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig } from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";

export interface IngaDigitalConfig {
  type: "ingadigital";
  idCliente: string;
  sessao?: string;
}

/**
 * Spider for Inga Digital / Controle Municipal gazette platform.
 * Used by municipalities like Assis Chateaubriand-PR, Marialva-PR.
 *
 * Listing: ingadigital.com.br/transparencia/index.php?id_cliente={id}&sessao={sessao}
 * Detail:  controlemunicipal.com.br/site/diario/publicacao.php?id={id}&id_cliente={id}
 * PDF:     controlemunicipal.com.br/inga/sistema/arquivos/diario/{id_cliente}/{file}
 *
 * The listing page is a plain HTML table (no JS). Each row has a link
 * to a detail page that contains the direct PDF URL. Pagination via ?pagina=N.
 */
export class IngaDigitalSpider extends BaseSpider {
  private idCliente: string;
  private sessao: string;
  private readonly BASE_URL =
    "https://www.ingadigital.com.br/transparencia/index.php";
  private readonly DETAIL_ORIGIN = "https://www.controlemunicipal.com.br";

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as IngaDigitalConfig;
    this.idCliente = platformConfig.idCliente;
    this.sessao = platformConfig.sessao ?? "";
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Inga Digital for ${this.config.name}...`);

    try {
      let page = 1;
      let reachedBeforeRange = false;
      const maxPages = 50;

      while (page <= maxPages && !reachedBeforeRange) {
        const url = this.buildListUrl(page);
        logger.debug(`Fetching listing page ${page}: ${url}`);

        const html = await this.fetch(url);
        const $ = this.loadHTML(html);

        const rows = $("table.table-striped tr").toArray();
        if (rows.length <= 1) break;

        let foundAny = false;

        for (const row of rows) {
          const tds = $(row).find("td");
          if (tds.length < 3) continue;

          const dateText = $(tds[1]).text().trim();
          const title = $(tds[2]).text().trim();
          const detailLink = $(tds[0]).find("a").attr("href") || "";

          const parsed = this.parseDate(dateText);
          if (!parsed) continue;

          const { isoDate, dateObj } = parsed;

          if (isoDate < this.dateRange.start) {
            reachedBeforeRange = true;
            break;
          }

          if (isoDate > this.dateRange.end) continue;

          const pdfUrl = await this.extractPdfUrl(detailLink);
          if (!pdfUrl) {
            logger.warn(`No PDF found for ${title} on ${isoDate}`);
            continue;
          }

          const gazette = await this.createGazette(dateObj, pdfUrl, {
            sourceText: title,
            skipUrlResolution: true,
          });
          if (gazette) {
            gazettes.push(gazette);
            foundAny = true;
          }
        }

        if (!foundAny && page > 1) break;
        page++;
      }

      logger.info(
        `Found ${gazettes.length} gazettes for ${this.config.name} via Inga Digital`,
      );
    } catch (error) {
      logger.error(
        `Error crawling Inga Digital for ${this.config.name}: ${error}`,
      );
    }

    return gazettes;
  }

  private buildListUrl(page: number): string {
    const params = new URLSearchParams({ id_cliente: this.idCliente });
    if (this.sessao) params.set("sessao", this.sessao);
    if (page > 1) params.set("pagina", String(page));
    return `${this.BASE_URL}?${params.toString()}`;
  }

  private parseDate(text: string): { isoDate: string; dateObj: Date } | null {
    const match = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!match) return null;
    const [, day, month, year] = match;
    const isoDate = `${year}-${month}-${day}`;
    const dateObj = new Date(`${isoDate}T12:00:00`);
    return { isoDate, dateObj };
  }

  private async extractPdfUrl(detailLink: string): Promise<string | null> {
    if (!detailLink) return null;

    let url = detailLink;
    if (!url.startsWith("http")) {
      url = `${this.DETAIL_ORIGIN}${url.startsWith("/") ? "" : "/"}${url}`;
    }

    try {
      const html = await this.fetch(url);
      const $ = this.loadHTML(html);

      const downloadBtn = $('a[download][href*="arquivos/diario"]');
      if (downloadBtn.length) {
        return downloadBtn.attr("href") || null;
      }

      const iframeSrc = $('iframe[src*=".pdf"]').attr("src");
      if (iframeSrc) return iframeSrc;

      const downloadPhp = $('a[href*="download.php"]').attr("href");
      if (downloadPhp) {
        return downloadPhp.startsWith("http")
          ? downloadPhp
          : `${this.DETAIL_ORIGIN}${downloadPhp.startsWith("/") ? "" : "/"}${downloadPhp}`;
      }

      const anyPdf = $('a[href$=".pdf"]').attr("href");
      if (anyPdf) {
        return anyPdf.startsWith("http")
          ? anyPdf
          : `${this.DETAIL_ORIGIN}${anyPdf.startsWith("/") ? "" : "/"}${anyPdf}`;
      }

      return null;
    } catch (error) {
      logger.warn(`Failed to extract PDF from ${url}: ${error}`);
      return null;
    }
  }
}
