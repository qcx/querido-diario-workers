import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";

/**
 * Configuration for NúcleoGov spider
 */
export interface NucleogovConfig {
  type: "nucleogov";
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/**
 * Response type for NúcleoGov API
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
 * Spider for NúcleoGov platform used by municipalities
 *
 * Used by:
 * - Paraíso do Tocantins (diariooficial.paraiso.to.gov.br)
 *
 * This platform provides a JSON API at /api/diarios that returns
 * paginated gazette data with direct PDF links.
 *
 * Features:
 * - JSON API with pagination
 * - Direct S3 PDF URLs
 * - Filter by month/year
 * - Digital signature verification (ICP-Brasil)
 */
export class NucleogovSpider extends BaseSpider {
  protected platformConfig: NucleogovConfig;

  constructor(
    spiderConfig: SpiderConfig,
    dateRange: DateRange,
    browser?: Fetcher,
  ) {
    super(spiderConfig, dateRange);
    this.platformConfig = spiderConfig.config as NucleogovConfig;

    if (!this.platformConfig.baseUrl) {
      throw new Error(
        `NucleogovSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing NucleogovSpider for ${spiderConfig.name} with URL: ${this.platformConfig.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();

    try {
      logger.debug(
        `Crawling NúcleoGov API: ${this.platformConfig.baseUrl} for date range ${this.dateRange.start} to ${this.dateRange.end}`,
      );

      // NúcleoGov API returns all diarios sorted by date (newest first)
      // The ano/mes parameters are ignored by the API, so we just paginate
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
            // Skip diarios without published status or without media
            if (diario.situacao !== 2 || !diario.midias || diario.midias.length === 0) {
              continue;
            }

            const gazetteDate = new Date(diario.data + "T12:00:00");
            
            // If we've gone past the start date, stop pagination
            if (gazetteDate < this.startDate) {
              foundOlderThanRange = true;
              break;
            }
            
            // Skip if outside date range (but continue looking for older entries)
            if (!this.isInDateRange(gazetteDate)) {
              continue;
            }

            // Process each PDF in the diario
            for (const midia of diario.midias) {
              if (!midia.url || !midia.mime_type?.includes("pdf")) {
                continue;
              }

              // Skip duplicate URLs
              if (seenUrls.has(midia.url)) {
                continue;
              }
              seenUrls.add(midia.url);

              // Extract edition number from numero field (e.g., "1.181" -> "1181")
              const editionNumber = diario.numero?.replace(/\./g, "");

              // Check if it's an extra edition
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

          // Check if there are more pages
          hasMore = page < data.last_page;
          page++;
        } catch (error) {
          logger.warn(`Error fetching page ${page}: ${error}`);
          hasMore = false;
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes from NúcleoGov API`,
      );
    } catch (error) {
      logger.error(`Error crawling NúcleoGov:`, error as Error);
    }

    return gazettes;
  }
}
