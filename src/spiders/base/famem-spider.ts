import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange, FamemConfig } from "../../types";
import { logger } from "../../utils/logger";
import type { Fetcher } from "@cloudflare/workers-types";

/**
 * Spider para o Diário Oficial da FAMEM - Federação dos Municípios do Estado do Maranhão
 *
 * Este spider coleta diários oficiais do sistema da FAMEM que é um diário consolidado
 * de todos os municípios do Maranhão.
 *
 * URL: https://www.diariooficial.famem.org.br
 * Plataforma: Siganet
 * Tipo: Diário Consolidado (todos os municípios em um único PDF diário)
 *
 * A FAMEM disponibiliza:
 * - Edições diárias consolidadas (PDF único com publicações de todos os municípios)
 * - Busca por publicações com filtro por palavra-chave (nome do município)
 * - Certificado Digital ICP-Brasil e Carimbo de Tempo
 *
 * IMPORTANTE: Este spider usa a API JSON da FAMEM para obter a lista de edições
 * e filtra por município usando a API de publicações. O filtro de data é aplicado
 * via POST na sessão.
 */

interface FamemEdition {
  PUBLICACAO_DOM: string;
  TDO_DT_GERACAO: string;
  TDO_EDICAO: string;
  TDO_ASSINADO_ARQUIVO: string;
  TDO_UUID: string;
  TDO_EDICAO_EXTRA: string;
  ANO: string;
  ANO_ROMANO: string;
}

interface FamemPublication {
  TDC_ID: string;
  TDO_DT_GERACAO: string;
  TDO_EDICAO: string;
  PUBLICACAO_DOM: string;
  TDC_TITULO: string;
  TDCT_DESCRICAO: string;
  PUBLICACAO_DONO: string;
  ANO_ROMANO: string;
  ANO: string;
}

interface FamemApiResponse<T> {
  draw: string;
  recordsTotal: number;
  recordsFiltered: number;
  data: T[];
}

export class FamemSpider extends BaseSpider {
  protected famemConfig: FamemConfig;
  private readonly FAMEM_BASE_URL = "https://www.diariooficial.famem.org.br";
  private readonly SIGANET_FILE_BASE =
    "https://painel.siganet.net.br/upload/0000000002/cms/publicacoes/diario";
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.famemConfig = spiderConfig.config as FamemConfig;
    logger.info(
      `Initializing FamemSpider for ${spiderConfig.name} (searching for: ${this.famemConfig.cityName})`,
    );
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling FAMEM for ${this.spiderConfig.name}...`);

    try {
      // Use API-based approach
      return await this.crawlViaApi();
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
      return [];
    }
  }

  /**
   * Format date as DD/MM/YYYY for FAMEM API
   * Uses UTC to avoid timezone issues
   */
  private formatDateForApi(date: Date): string {
    const day = String(date.getUTCDate()).padStart(2, "0");
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const year = date.getUTCFullYear();
    return `${day}/${month}/${year}`;
  }

  /**
   * Crawl using FAMEM's JSON API
   *
   * Strategy:
   * 1. POST to establish session with date filters
   * 2. Get all publications via API
   * 3. Filter publications by municipality name (PUBLICACAO_DONO)
   * 4. Get unique gazette dates where this municipality has publications
   * 5. Build gazette objects with correct PDF URLs
   */
  private async crawlViaApi(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const cityName = this.famemConfig.cityName;

    // Format dates for API (DD/MM/YYYY)
    const startDateStr = this.formatDateForApi(this.startDate);
    const endDateStr = this.formatDateForApi(this.endDate);

    logger.debug(
      `Searching FAMEM for "${cityName}" from ${startDateStr} to ${endDateStr}`,
    );

    try {
      // Step 1: POST to establish session with date filters
      const formData = new URLSearchParams();
      formData.append("caxDtInicio", startDateStr);
      formData.append("caxDtFim", endDateStr);

      const sessionResponse = await fetch(
        `${this.FAMEM_BASE_URL}/dom/dom/todasPublicacoes/`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
          body: formData.toString(),
        },
      );

      if (!sessionResponse.ok) {
        logger.error(
          `Failed to establish FAMEM session: ${sessionResponse.status}`,
        );
        return gazettes;
      }

      // Extract cookies from response
      const setCookie = sessionResponse.headers.get("set-cookie");
      const cookies = setCookie
        ? setCookie
            .split(",")
            .map((c) => c.split(";")[0])
            .join("; ")
        : "";

      // Step 2: Get publications via API
      const pubResponse = await fetch(
        `${this.FAMEM_BASE_URL}/dom/dom/pesquisaPublicacoes/`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Cookie: cookies,
          },
        },
      );

      if (!pubResponse.ok) {
        logger.error(
          `Failed to fetch FAMEM publications: ${pubResponse.status}`,
        );
        return gazettes;
      }

      const pubData =
        (await pubResponse.json()) as FamemApiResponse<FamemPublication>;
      logger.debug(
        `FAMEM API returned ${pubData.recordsTotal} total publications`,
      );

      // Step 3: Filter publications by municipality name
      // Match city name (case-insensitive, partial match)
      const normalizedCityName = this.normalizeString(cityName);
      const cityPublications = pubData.data.filter((pub) => {
        const pubOwner = this.normalizeString(pub.PUBLICACAO_DONO || "");
        return pubOwner.includes(normalizedCityName);
      });

      logger.debug(
        `Found ${cityPublications.length} publications for "${cityName}"`,
      );

      if (cityPublications.length === 0) {
        logger.warn(`No publications found for municipality: ${cityName}`);
        return gazettes;
      }

      // Step 4: Get unique gazette dates (editions) where this municipality has publications
      const editionMap = new Map<string, FamemPublication>();
      for (const pub of cityPublications) {
        const dateStr = pub.TDO_DT_GERACAO.split(" ")[0]; // YYYY-MM-DD
        if (!editionMap.has(dateStr)) {
          editionMap.set(dateStr, pub);
        }
      }

      logger.debug(
        `Found ${editionMap.size} unique gazette dates for "${cityName}"`,
      );

      // Step 5: Get editions API to get PDF filenames
      const editionsResponse = await fetch(
        `${this.FAMEM_BASE_URL}/dom/dom/pesquisaEdicoes/`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Cookie: cookies,
          },
        },
      );

      if (!editionsResponse.ok) {
        logger.error(
          `Failed to fetch FAMEM editions: ${editionsResponse.status}`,
        );
        return gazettes;
      }

      const editionsData =
        (await editionsResponse.json()) as FamemApiResponse<FamemEdition>;

      // Create a map of edition numbers to PDF filenames
      const editionPdfMap = new Map<string, FamemEdition>();
      for (const edition of editionsData.data) {
        editionPdfMap.set(edition.TDO_EDICAO, edition);
      }

      // Step 6: Build gazette objects
      for (const [dateStr, pub] of editionMap) {
        const edition = editionPdfMap.get(pub.TDO_EDICAO);

        if (edition) {
          const fileUrl = `${this.SIGANET_FILE_BASE}/${edition.TDO_ASSINADO_ARQUIVO}`;
          const gazetteDate = new Date(dateStr);

          // Skip if outside date range
          if (gazetteDate < this.startDate || gazetteDate > this.endDate) {
            continue;
          }

          const gazette: Gazette = {
            date: dateStr,
            fileUrl: fileUrl,
            territoryId: this.spiderConfig.territoryId,
            scrapedAt: new Date().toISOString(),
            editionNumber: pub.TDO_EDICAO,
            isExtraEdition: edition.TDO_EDICAO_EXTRA !== "Normal",
            power: "executive_legislative",
          };

          gazettes.push(gazette);
        }
      }

      // Sort by date descending
      gazettes.sort((a, b) => b.date.localeCompare(a.date));

      logger.info(`Found ${gazettes.length} FAMEM gazettes for ${cityName}`);
    } catch (error) {
      logger.error(`Error in API crawl:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Normalize string for comparison (remove accents, lowercase)
   */
  private normalizeString(str: string): string {
    return str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }
}
