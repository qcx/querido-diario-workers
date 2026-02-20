import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  SantaHelenaGoConfig,
} from "../../types";
import { logger } from "../../utils/logger";

/**
 * Response type for NúcleoGov-style API (Santa Helena de Goiás)
 */
interface SantaHelenaGoApiResponse {
  current_page: number;
  data: SantaHelenaGoDiario[];
  last_page: number;
  per_page: number;
  total: number;
}

interface SantaHelenaGoDiario {
  id: number;
  numero: string;
  data: string; // YYYY-MM-DD
  situacao: number; // 1 = Em andamento, 2 = Publicado
  situacaoDescricao: string;
  nomeDiario: string;
  numeroAno: string;
  midias: SantaHelenaGoMidia[];
  tipo?: {
    id: number;
    descricao: string;
  };
}

interface SantaHelenaGoMidia {
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
 * Spider para Santa Helena de Goiás - GO
 *
 * Diário Oficial no portal próprio do município (não utiliza AGM).
 * Utiliza API compatível com NúcleoGov em /api/diarios.
 * Base URL tipicamente: acessoainformacao.santahelena.go.gov.br ou dom.santahelena.go.gov.br
 */
export class SantaHelenaGoSpider extends BaseSpider {
  protected platformConfig: SantaHelenaGoConfig;

  constructor(
    spiderConfig: SpiderConfig,
    dateRange: DateRange,
    browser?: Fetcher,
  ) {
    super(spiderConfig, dateRange);
    this.platformConfig = spiderConfig.config as SantaHelenaGoConfig;

    if (!this.platformConfig.baseUrl) {
      throw new Error(
        `SantaHelenaGoSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing SantaHelenaGoSpider for ${spiderConfig.name} with URL: ${this.platformConfig.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();

    try {
      logger.debug(
        `Crawling Santa Helena de Goiás API: ${this.platformConfig.baseUrl} for date range ${this.dateRange.start} to ${this.dateRange.end}`,
      );

      let page = 1;
      let hasMore = true;
      let foundOlderThanRange = false;

      while (hasMore && !foundOlderThanRange) {
        const apiUrl = `${this.platformConfig.baseUrl}/api/diarios?page=${page}&per_page=50`;
        logger.debug(`Fetching: ${apiUrl}`);

        try {
          const response = await this.fetch(apiUrl);

          const data: SantaHelenaGoApiResponse = JSON.parse(response);

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
        `Successfully crawled ${gazettes.length} gazettes from Santa Helena de Goiás`,
      );
    } catch (error) {
      logger.error(`Error crawling Santa Helena de Goiás:`, error as Error);
    }

    return gazettes;
  }
}
