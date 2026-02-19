import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig } from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";

interface PrefeiturapinhaoConfig {
  type: "prefeiturapinhao";
  baseUrl: string;
  apiBaseUrl: string;
  publicacaoId?: number;
  entidadeId?: number;
}

interface ElotechPublicacaoEntry {
  id: number;
  nomeArquivo: string;
  dataArquivo: string;
  idArquivo: number;
  resumo?: string;
}

interface ElotechPublicacaoGroup {
  list: ElotechPublicacaoEntry[];
}

interface ElotechPublicacaoResponse {
  id: number;
  valor: string;
  list: ElotechPublicacaoGroup[];
}

/**
 * Spider for Elotech OXY Portal Transparência - Publicações module
 *
 * Used by municipalities that publish gazettes under the "Publicações"
 * module instead of the "Diário Oficial" module.
 * API: GET /api/publicacoes/{publicacaoId}?entidade={entidadeId}&exercicio={year}
 */
export class PrefeiturapinhaoSpider extends BaseSpider {
  private baseUrl: string;
  private apiBaseUrl: string;
  private publicacaoId: number;
  private entidadeId: number;

  private static readonly HEADERS = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    Accept: "application/json",
  };

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeiturapinhaoConfig;
    this.baseUrl = platformConfig.baseUrl;
    this.apiBaseUrl = platformConfig.apiBaseUrl;
    this.publicacaoId = platformConfig.publicacaoId || 1001;
    this.entidadeId = platformConfig.entidadeId || 1;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Elotech OXY Publicações for ${this.config.name}...`);

    try {
      const startYear = parseInt(this.dateRange.start.substring(0, 4));
      const endYear = parseInt(this.dateRange.end.substring(0, 4));

      for (let year = endYear; year >= startYear; year--) {
        const apiUrl = `${this.apiBaseUrl}/api/publicacoes/${this.publicacaoId}?entidade=${this.entidadeId}&exercicio=${year}`;
        logger.info(`Fetching year ${year}: ${apiUrl}`);

        const response = await fetch(apiUrl, {
          headers: PrefeiturapinhaoSpider.HEADERS,
        });

        if (!response.ok) {
          logger.error(`API returned ${response.status} for year ${year}`);
          continue;
        }

        const data = (await response.json()) as ElotechPublicacaoResponse[];

        if (!data || data.length === 0) continue;

        for (const category of data) {
          for (const group of category.list || []) {
            for (const entry of group.list || []) {
              const isoDate = entry.dataArquivo;
              if (!isoDate) continue;

              if (isoDate > this.dateRange.end) continue;
              if (isoDate < this.dateRange.start) continue;

              const fileUrl = `${this.apiBaseUrl}/api/files/arquivo/${entry.idArquivo}`;

              const editionMatch = entry.nomeArquivo.match(/(\d+)/);
              const editionNumber = editionMatch ? editionMatch[1] : "";

              gazettes.push({
                date: isoDate,
                editionNumber,
                fileUrl,
                territoryId: this.config.territoryId,
                isExtraEdition: false,
                power: "executive",
                scrapedAt: new Date().toISOString(),
              });
            }
          }
        }
      }

      logger.info(`Found ${gazettes.length} gazettes for ${this.config.name}`);
    } catch (error) {
      logger.error(`Error crawling Elotech Publicações: ${error}`);
    }

    return gazettes;
  }
}
