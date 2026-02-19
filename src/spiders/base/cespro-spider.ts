import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange, CesproConfig } from "../../types";
import { fetchWithRetry } from "../../utils/http-client";
import { logger } from "../../utils/logger";
import { toISODate } from "../../utils/date-utils";

const CESPRO_API_BASE = "https://cespro.com.br/_data/api.php";
const PAGE_SIZE = 10;

interface CesproGazetteEntry {
  cd_diario_oficial: string;
  nr_diario_oficial: string;
  cd_municipio: string;
  dt_diario_oficial: string;
  nr_paginas: string;
  nr_visualizacoes: string;
  tx_url_file: string | null;
  ds_hora_publicacao: string;
  dados_diario_oficial_diploma_pesquisa: unknown[];
}

interface CesproApiResponse {
  dados_diario_oficial_pesquisa: CesproGazetteEntry[];
  dados_paginacao: Record<string, string | number>;
  dados_nr_page: number;
  nr_diario_oficial: number;
}

/**
 * HTTP-only spider for the CESPRO platform (cespro.com.br).
 *
 * Uses the Vue app's JSON API directly — no browser required.
 * API: POST _data/api.php?cdMunicipio=X&busca=t&dataInicial=...&dataFinal=...&operacao=content-diario-oficial
 * Body: { "ID": X, "page": N }
 */
export class CesproSpider extends BaseSpider {
  private cesproConfig: CesproConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.cesproConfig = spiderConfig.config as CesproConfig;

    logger.info(`Initializing CesproSpider for ${spiderConfig.name}`, {
      cdMunicipio: this.cesproConfig.cdMunicipio,
    });
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const startStr = toISODate(this.startDate);
    const endStr = toISODate(this.endDate);

    logger.info(
      `Crawling CESPRO ${this.cesproConfig.cdMunicipio} from ${startStr} to ${endStr}`,
    );

    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const result = await this.fetchPage(page, startStr, endStr);
      if (!result) break;

      for (const entry of result.entries) {
        const gazette = await this.entryToGazette(entry);
        if (gazette) gazettes.push(gazette);
      }

      hasMore = result.hasNextPage;
      page++;

      if (page > 100) {
        logger.warn("CESPRO pagination safety limit reached (100 pages)");
        break;
      }
    }

    logger.info(`CESPRO crawl complete: ${gazettes.length} gazettes found`);
    return gazettes;
  }

  private async fetchPage(
    page: number,
    startDate: string,
    endDate: string,
  ): Promise<{ entries: CesproGazetteEntry[]; hasNextPage: boolean } | null> {
    const cdMun = this.cesproConfig.cdMunicipio;
    const qs = new URLSearchParams({
      cdMunicipio: cdMun,
      busca: "t",
      dataInicial: startDate,
      dataFinal: endDate,
      operacao: "content-diario-oficial",
    });

    const url = `${CESPRO_API_BASE}?${qs.toString()}`;

    try {
      const raw = await fetchWithRetry(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/plain, */*",
        },
        body: JSON.stringify({ ID: Number(cdMun), page }),
      });

      const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
      const data: CesproApiResponse = JSON.parse(text);

      const entries = data.dados_diario_oficial_pesquisa ?? [];
      this.requestCount++;

      logger.debug(`CESPRO page ${page}: ${entries.length} entries`);

      const paginationKeys = Object.keys(data.dados_paginacao ?? {})
        .map(Number)
        .filter((n) => !isNaN(n));
      const maxPage =
        paginationKeys.length > 0 ? Math.max(...paginationKeys) : 1;
      const hasNextPage = entries.length >= PAGE_SIZE && page < maxPage;

      return { entries, hasNextPage };
    } catch (error) {
      logger.error(`Error fetching CESPRO page ${page}:`, error as Error);
      return null;
    }
  }

  private async entryToGazette(
    entry: CesproGazetteEntry,
  ): Promise<Gazette | null> {
    if (!entry.tx_url_file) return null;

    const date = new Date(entry.dt_diario_oficial + "T12:00:00");
    if (!this.isInDateRange(date)) return null;

    let pdfUrl = entry.tx_url_file;
    if (pdfUrl.includes("dropbox.com") && !pdfUrl.includes("dl=1")) {
      pdfUrl += (pdfUrl.includes("?") ? "&" : "?") + "dl=1";
    }

    return this.createGazette(date, pdfUrl, {
      editionNumber: entry.nr_diario_oficial,
      isExtraEdition: false,
      power: "executive",
      skipUrlResolution: true,
    });
  }
}
