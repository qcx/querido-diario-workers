import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse } from "node-html-parser";
import { getMonthlySequence } from "../../utils/date-utils";
import type { PrefeituragoianiaConfig } from "../../types/spider-config";

/** Meses em português para parse do texto "DD de mês de YYYY" */
const MESES_PT: Record<string, number> = {
  janeiro: 0,
  fevereiro: 1,
  março: 2,
  marco: 2,
  abril: 3,
  maio: 4,
  junho: 5,
  julho: 6,
  agosto: 7,
  setembro: 8,
  outubro: 9,
  novembro: 10,
  dezembro: 11,
};

/**
 * Spider for Diário Oficial de Goiânia - GO
 *
 * Fontes:
 * 1) Lista Casa Civil: goiania.go.gov.br/shtml/portal/casacivil/lista_diarios.asp?ano=YYYY
 *    (lista "Edição nº N de DD de mês de YYYY"; links para ver_diario.asp ou PDF)
 * 2) Sileg: sileg.goiania.go.gov.br (fallback)
 * 3) Página Casa Civil: casa-civil/diario-oficial/ (fallback para links diretos)
 */
export class PrefeituragoianiaSpider extends BaseSpider {
  private baseUrl: string;
  private silegUrl: string;
  private diarioOficialUrl: string;
  /** Base para lista_diarios.asp (ex.: baseUrl/shtml/portal/casacivil) */
  private listaDiariosBase: string;

  constructor(
    spiderConfig: SpiderConfig,
    dateRange: DateRange,
    _browser?: Fetcher,
  ) {
    super(spiderConfig, dateRange);

    const config = this.config.config as PrefeituragoianiaConfig;
    if (!config.baseUrl || !config.silegUrl) {
      throw new Error(
        `PrefeituragoianiaSpider requires baseUrl and silegUrl in config for ${spiderConfig.name}`,
      );
    }

    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.silegUrl = config.silegUrl.replace(/\/$/, "");
    this.diarioOficialUrl =
      config.diarioOficialUrl?.replace(/\/$/, "") ||
      `${this.baseUrl}/casa-civil/diario-oficial`;
    // Path pode ser /shtml/portal/casacivil ou /shtml//portal/casacivil (conforme site)
    this.listaDiariosBase = `${this.baseUrl}/shtml/portal/casacivil`;

    logger.info(
      `Initializing PrefeituragoianiaSpider for ${spiderConfig.name} with baseUrl: ${this.baseUrl}, listaDiarios: ${this.listaDiariosBase}, sileg: ${this.silegUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const seenKeys = new Set<string>();

    logger.info(`Crawling Diário Oficial Goiânia for ${this.config.name}`);

    // 1) Fonte principal: lista_diarios.asp (portal Casa Civil) por ano
    const years = new Set<number>();
    const months = getMonthlySequence(this.startDate, this.endDate);
    for (const d of months) years.add(d.getFullYear());
    for (const year of years) {
      const fromLista = await this.crawlListaDiarios(year, seenKeys);
      gazettes.push(...fromLista);
    }

    // 2) Fallback: Sileg (ano/mês) e depois página casa-civil
    if (gazettes.length === 0) {
      for (const monthDate of months) {
        const year = monthDate.getFullYear();
        const month = monthDate.getMonth() + 1;
        const silegGazettes = await this.crawlSilegMonth(year, month, seenKeys);
        gazettes.push(...silegGazettes);
      }
      if (gazettes.length === 0 && months.length > 0) {
        const fromCasaCivil = await this.crawlCasaCivilFallback(seenKeys);
        gazettes.push(...fromCasaCivil);
      }
    }

    logger.info(`Crawled ${gazettes.length} gazettes for ${this.config.name}`);
    return gazettes;
  }

  /**
   * Lista Casa Civil: lista_diarios.asp?ano=YYYY
   * Texto dos links: "Edição nº 8717 de 06 de fevereiro de 2026" ou "... - Edição Extra"
   */
  private async crawlListaDiarios(
    year: number,
    seenKeys: Set<string>,
  ): Promise<Gazette[]> {
    const out: Gazette[] = [];
    const listUrl = `${this.listaDiariosBase}/lista_diarios.asp?ano=${year}`;
    const listUrlAlt = `${this.baseUrl}/shtml//portal/casacivil/lista_diarios.asp?ano=${year}`;
    try {
      let html = await this.fetch(listUrl);
      if (!html) return out;
      let root = parse(html);
      await this.parseListaDiariosHtml(root, year, seenKeys, out);
      if (out.length === 0) {
        try {
          html = await this.fetch(listUrlAlt);
          if (html) {
            root = parse(html);
            await this.parseListaDiariosHtml(root, year, seenKeys, out);
          }
        } catch {
          // ignore
        }
      }
      return out;
    } catch (err) {
      logger.warn(
        `Error fetching lista_diarios.asp?ano=${year}:`,
        err as Error,
      );
      return out;
    }
  }

  private async parseListaDiariosHtml(
    root: ReturnType<typeof parse>,
    _year: number,
    seenKeys: Set<string>,
    out: Gazette[],
  ): Promise<void> {
    const linkTextRe =
      /Edi[cç]ão\s*n[ºo°]?\s*(\d+)\s+de\s+(\d{1,2})\s+de\s+(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})(\s*-\s*Edi[cç]ão\s*Extra)?/i;
    const links = root.querySelectorAll("a[href]");
    for (const a of links) {
      const href = a.getAttribute("href");
      const text = (a.textContent || "").trim();
      if (!href || !text) continue;
      const m = text.match(linkTextRe);
      if (!m) continue;
      const [, editionStr, dayStr, monthName, yearStr, extraPart] = m;
      const monthNum = MESES_PT[monthName.toLowerCase()];
      if (monthNum === undefined) continue;
      const day = parseInt(dayStr, 10);
      const yearNum = parseInt(yearStr, 10);
      const gazetteDate = new Date(yearNum, monthNum, day);
      if (!this.isInDateRange(gazetteDate)) continue;
      const key = `${gazetteDate.toISOString().slice(0, 10)}-${editionStr}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      let pdfUrl = href.trim();
      if (!pdfUrl.startsWith("http")) {
        const base = this.listaDiariosBase.replace(/\/$/, "");
        pdfUrl = pdfUrl.startsWith("/")
          ? `${this.baseUrl}${pdfUrl}`
          : `${base}/${pdfUrl.replace(/^\.\//, "")}`;
      }
      const isExtra = /Edi[cç]ão\s*Extra/i.test(extraPart || "");
      const g = await this.createGazette(gazetteDate, pdfUrl, {
        editionNumber: editionStr,
        isExtraEdition: isExtra,
        power: "executive",
      });
      if (g) out.push(g);
    }
  }

  private async crawlSilegMonth(
    year: number,
    month: number,
    seenKeys: Set<string>,
  ): Promise<Gazette[]> {
    const out: Gazette[] = [];
    const queryParams = new URLSearchParams({
      ano: String(year),
      mes: String(month),
    });
    const silegQueryUrl = `${this.silegUrl}/?${queryParams.toString()}`;
    try {
      const html = await this.fetch(silegQueryUrl);
      const root = parse(html);
      const links = root.querySelectorAll(
        'a[href*="diariooficial"], a[href*="diario-oficial"], a[href*=".pdf"]',
      );
      for (const link of links) {
        const href = link.getAttribute("href");
        if (!href) continue;
        let pdfUrl = href;
        if (href.startsWith("/")) pdfUrl = `${this.baseUrl}${href}`;
        else if (!href.startsWith("http"))
          pdfUrl = href.includes("goiania.go.gov.br")
            ? href
            : `${this.baseUrl}/Download/legislacao/diariooficial/${year}/${href}`;
        const dateMatch =
          pdfUrl.match(/do_(\d{4})(\d{2})(\d{2})_/i) ||
          pdfUrl.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//) ||
          pdfUrl.match(/\/(\d{4})\/(\d{2})\/[^/]*\.pdf$/);
        if (!dateMatch) continue;
        const [, y, m, d] = dateMatch;
        const gazetteDate = new Date(
          parseInt(y, 10),
          parseInt(m, 10) - 1,
          parseInt(d || "1", 10),
        );
        if (!this.isInDateRange(gazetteDate)) continue;
        const dateKey = gazetteDate.toISOString().slice(0, 10);
        const editionMatch = pdfUrl.match(/do_\d+_(\d+)/);
        const editionNumber = editionMatch ? editionMatch[1] : undefined;
        const key = editionNumber ? `${dateKey}-${editionNumber}` : dateKey;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        const g = await this.createGazette(gazetteDate, pdfUrl, {
          editionNumber,
          isExtraEdition: false,
          power: "executive",
        });
        if (g) out.push(g);
      }
    } catch (error) {
      logger.warn(
        `Error fetching Sileg ${year}-${String(month).padStart(2, "0")}:`,
        error as Error,
      );
    }
    return out;
  }

  private async crawlCasaCivilFallback(
    seenKeys: Set<string>,
  ): Promise<Gazette[]> {
    const out: Gazette[] = [];
    try {
      const html = await this.fetch(`${this.diarioOficialUrl}/`);
      const root = parse(html);
      const pdfLinks = root.querySelectorAll(
        'a[href*="Download"], a[href*=".pdf"], a[href*="diariooficial"]',
      );
      for (const a of pdfLinks) {
        const href = a.getAttribute("href");
        if (!href || !href.includes("diariooficial")) continue;
        const fullUrl = href.startsWith("http")
          ? href
          : `${this.baseUrl}${href.startsWith("/") ? "" : "/"}${href}`;
        const dm = fullUrl.match(/do_(\d{4})(\d{2})(\d{2})_/);
        if (!dm) continue;
        const [, yy, mm, dd] = dm;
        const gDate = new Date(
          parseInt(yy, 10),
          parseInt(mm, 10) - 1,
          parseInt(dd, 10),
        );
        if (!this.isInDateRange(gDate)) continue;
        const dk = gDate.toISOString().slice(0, 10);
        if (seenKeys.has(dk)) continue;
        seenKeys.add(dk);
        const g = await this.createGazette(gDate, fullUrl, {
          power: "executive",
        });
        if (g) out.push(g);
      }
    } catch {
      // ignore
    }
    return out;
  }
}
