import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";
import type { MorrinhosGoConfig } from "../../types/spider-config";

/**
 * Response type for NúcleoGov-style API (acessoainformacao.morrinhos.go.gov.br)
 */
interface NucleogovApiResponse {
  current_page: number;
  data: NucleogovDiario[];
  last_page: number;
  per_page: number;
  total: number;
}

interface NucleogovDiario {
  id: number;
  numero: string;
  data: string; // YYYY-MM-DD
  situacao: number; // 1 = Em andamento, 2 = Publicado
  situacaoDescricao: string;
  nomeDiario: string;
  numeroAno: string;
  midias: NucleogovMidia[];
  tipo?: {
    id: number;
    descricao: string;
  };
}

interface NucleogovMidia {
  id: number;
  name: string;
  file_name: string;
  url: string;
  path: string;
  size: number;
  mime_type: string;
  created_at: string;
}

/**
 * Spider for Morrinhos - GO
 *
 * Portal: acessoainformacao.morrinhos.go.gov.br (NúcleoGov)
 * Diário Oficial via API /api/diarios.
 *
 * Morrinhos não utiliza AGM; o diário é publicado no portal próprio
 * de transparência (NúcleoGov).
 */
export class MorrinhosGoSpider extends BaseSpider {
  protected platformConfig: MorrinhosGoConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.platformConfig = spiderConfig.config as MorrinhosGoConfig;

    if (!this.platformConfig.baseUrl) {
      throw new Error(
        `MorrinhosGoSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing MorrinhosGoSpider for ${spiderConfig.name} with URL: ${this.platformConfig.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();

    try {
      logger.debug(
        `Crawling Morrinhos GO API: ${this.platformConfig.baseUrl} for date range ${this.dateRange.start} to ${this.dateRange.end}`,
      );

      let page = 1;
      let hasMore = true;
      let foundOlderThanRange = false;

      while (hasMore && !foundOlderThanRange) {
        const apiUrl = `${this.platformConfig.baseUrl}/api/diarios?page=${page}&per_page=50`;
        logger.debug(`Fetching: ${apiUrl}`);

        try {
          const response = await this.fetch(apiUrl);

          const data: NucleogovApiResponse = JSON.parse(response);

          if (!data.data || data.data.length === 0) {
            hasMore = false;
            continue;
          }

          for (const diario of data.data) {
            if (
              diario.situacao !== 2 ||
              !diario.midias ||
              diario.midias.length === 0
            ) {
              continue;
            }

            const gazetteDate = new Date(diario.data + "T12:00:00");

            if (gazetteDate < this.startDate) {
              foundOlderThanRange = true;
              break;
            }

            if (!this.isInDateRange(gazetteDate)) {
              continue;
            }

            for (const midia of diario.midias) {
              if (!midia.url || !midia.mime_type?.includes("pdf")) {
                continue;
              }

              if (seenUrls.has(midia.url)) {
                continue;
              }
              seenUrls.add(midia.url);

              const editionNumber = diario.numero?.replace(/\./g, "");
              const isExtra =
                diario.nomeDiario?.toLowerCase().includes("extra") ||
                diario.tipo?.descricao?.toLowerCase().includes("extra") ||
                false;

              const gazette = await this.createGazette(gazetteDate, midia.url, {
                editionNumber,
                isExtraEdition: isExtra,
                power: "executive_legislative",
                sourceText: diario.nomeDiario,
              });

              if (gazette) {
                gazettes.push(gazette);
              }
            }
          }

          hasMore = page < data.last_page;
          page++;
        } catch (error) {
          logger.warn(`Error fetching page ${page}: ${error}`);
          hasMore = false;
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes from Morrinhos GO`,
      );
    } catch (error) {
      logger.error(`Error crawling Morrinhos GO:`, error as Error);
    }

    return gazettes;
  }
}
