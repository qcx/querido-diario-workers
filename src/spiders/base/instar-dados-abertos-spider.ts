import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  InstarDadosAbertosConfig,
} from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse } from "node-html-parser";
import { formatBrazilianDate, toISODate } from "../../utils/date-utils";

interface DadosAbertosEntry {
  edicao: string;
  dataAtualizacao: string;
  data: string;
  edicaoExtra: string;
  descricao: string;
}

interface DadosAbertosResponse {
  dados: DadosAbertosEntry[];
}

/**
 * Spider for Instar-platform municipalities that expose the "dados abertos" JSON API.
 *
 * Strategy:
 *  1. Fetch the dados abertos API for each year in the date range to get
 *     structured edition metadata (dates, edition numbers, extra-edition flag).
 *  2. Fetch the standard Instar HTML listing (date-filtered URL) to obtain
 *     session-scoped download links (`data-href`).
 *  3. Match API entries → HTML download links by edition number.
 *  4. `createGazette` resolves the intermediate download URL (meta-refresh)
 *     to the final static PDF URL.
 *
 * This spider operates in HTTP-only mode (no browser required).
 *
 * URL patterns:
 *   API:  {baseUrl}/dados-abertos/diario-oficial/{year}
 *   HTML: {baseUrl}/{page}/{startDate}/{endDate}/0/0/
 */
export class InstarDadosAbertosSpider extends BaseSpider {
  protected config_: InstarDadosAbertosConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config_ = spiderConfig.config as InstarDadosAbertosConfig;

    if (!this.config_.baseUrl) {
      throw new Error(
        `InstarDadosAbertosSpider requires a baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing InstarDadosAbertosSpider for ${spiderConfig.name}`,
      { baseUrl: this.config_.baseUrl },
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.config_.baseUrl} for ${this.spiderConfig.name}`,
    );

    const apiEditions = await this.fetchEditionsFromApi();

    if (apiEditions.length === 0) {
      logger.info(`No editions found in dados abertos API for date range`);
      return [];
    }

    logger.info(
      `Found ${apiEditions.length} editions in date range from dados abertos API`,
    );

    const downloadMap = await this.fetchDownloadUrls();

    return this.buildGazettes(apiEditions, downloadMap);
  }

  /**
   * Fetch edition metadata from the dados abertos JSON API for every year
   * that overlaps with the configured date range.
   */
  private async fetchEditionsFromApi(): Promise<DadosAbertosEntry[]> {
    const startYear = new Date(this.dateRange.start).getFullYear();
    const endYear = new Date(this.dateRange.end).getFullYear();

    const allEditions: DadosAbertosEntry[] = [];

    for (let year = startYear; year <= endYear; year++) {
      const url = `${this.config_.dadosAbertosUrl}/${year}`;
      logger.debug(`Fetching dados abertos: ${url}`);

      try {
        const json = await this.fetch(url);
        const response: DadosAbertosResponse = JSON.parse(json);

        if (!response.dados || !Array.isArray(response.dados)) {
          logger.warn(`Unexpected dados abertos response for year ${year}`);
          continue;
        }

        for (const entry of response.dados) {
          const entryDate = new Date(entry.data);
          if (this.isInDateRange(entryDate)) {
            allEditions.push(entry);
          }
        }
      } catch (error) {
        logger.error(
          `Failed to fetch dados abertos for year ${year}:`,
          error as Error,
        );
      }
    }

    return allEditions;
  }

  /**
   * Fetch the HTML listing page(s) and return a map of edition number → download path.
   */
  private async fetchDownloadUrls(): Promise<Map<string, string>> {
    const downloadMap = new Map<string, string>();

    const startDate = formatBrazilianDate(new Date(this.dateRange.start));
    const endDate = formatBrazilianDate(new Date(this.dateRange.end));

    const firstPageUrl = `${this.config_.baseUrl}/1/${startDate}/${endDate}/0/0/`;
    logger.debug(`Fetching HTML listing: ${firstPageUrl}`);

    const firstPageHtml = await this.fetch(firstPageUrl);
    const firstPageRoot = parse(firstPageHtml);

    const resultsText =
      firstPageRoot.querySelector(".sw_qtde_resultados")?.text || "0";
    const totalResults = parseInt(resultsText.trim(), 10);

    if (totalResults === 0) {
      logger.info(`No results on HTML listing page`);
      return downloadMap;
    }

    const resultsPerPage = 50;
    const totalPages = Math.ceil(totalResults / resultsPerPage);
    logger.info(
      `HTML listing: ${totalResults} results across ${totalPages} page(s)`,
    );

    const pagePromises: Promise<string>[] = [Promise.resolve(firstPageHtml)];
    for (let page = 2; page <= totalPages; page++) {
      const pageUrl = `${this.config_.baseUrl}/${page}/${startDate}/${endDate}/0/0/`;
      pagePromises.push(this.fetch(pageUrl));
    }

    const allPagesHtml = await Promise.all(pagePromises);

    for (const pageHtml of allPagesHtml) {
      const root = parse(pageHtml);
      const gazetteElements = root.querySelectorAll(".dof_publicacao_diario");

      for (const el of gazetteElements) {
        const titleEl = el.querySelector(".dof_titulo_publicacao span");
        const titleText = titleEl?.text?.trim() || "";
        const editionMatch = titleText.match(/(\d+)/);
        if (!editionMatch) continue;

        const editionNumber = editionMatch[1];
        const downloadEl = el.querySelector(".dof_download");
        const downloadHref = downloadEl?.getAttribute("data-href");

        if (downloadHref) {
          let fullUrl = downloadHref;
          if (!fullUrl.startsWith("http")) {
            const origin = new URL(this.config_.baseUrl).origin;
            fullUrl = `${origin}${fullUrl.startsWith("/") ? "" : "/"}${fullUrl}`;
          }
          downloadMap.set(editionNumber, fullUrl);
        }
      }
    }

    logger.debug(
      `Extracted download URLs for ${downloadMap.size} editions from HTML`,
    );
    return downloadMap;
  }

  /**
   * Combine API editions + HTML download map into Gazette objects.
   */
  private async buildGazettes(
    editions: DadosAbertosEntry[],
    downloadMap: Map<string, string>,
  ): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    for (const edition of editions) {
      const downloadUrl = downloadMap.get(edition.edicao);
      if (!downloadUrl) {
        logger.warn(
          `No download URL found for edition ${edition.edicao}, skipping`,
        );
        continue;
      }

      const date = new Date(edition.data);
      const isExtraEdition = edition.edicaoExtra === "S";

      const gazette = await this.createGazette(date, downloadUrl, {
        editionNumber: edition.edicao,
        isExtraEdition,
        power: "executive_legislative",
        sourceText: `Edição nº ${edition.edicao}${isExtraEdition ? " (extra)" : ""}`,
      });

      if (gazette) {
        gazettes.push(gazette);
      }
    }

    logger.info(
      `Successfully built ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
    );
    return gazettes;
  }
}
