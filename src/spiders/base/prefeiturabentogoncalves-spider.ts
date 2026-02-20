import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig } from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";

interface ElotechDiario {
  id: string;
  edition: number;
  editionType: string;
  publishedAt: string;
  signingBy: string;
  publishedBy: string;
  fileSize: number;
}

interface ElotechPageResponse {
  number: number;
  size: number;
  totalPages: number;
  numberOfElements: number;
  totalElements: number;
  content: ElotechDiario[];
  last: boolean;
  first: boolean;
}

interface PrefeiturabentogoncalvesConfig {
  type: "prefeiturabentogoncalves";
  baseUrl: string;
}

export class PrefeiturabentogoncalvesSpider extends BaseSpider {
  private baseUrl: string;
  private apiBaseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeiturabentogoncalvesConfig;
    this.baseUrl = platformConfig.baseUrl;
    this.apiBaseUrl = `${this.baseUrl}/portaltransparencia-api/api/legislacao`;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Bento Gonçalves gazette for ${this.config.name}...`);

    try {
      const pageSize = 50;
      let page = 0;
      let hasMore = true;

      const search = `publishedAt>=${this.dateRange.start}T00:00;publishedAt<=${this.dateRange.end}T23:59:59`;

      while (hasMore) {
        const apiUrl = `${this.apiBaseUrl}/diarios-oficiais/publicados?page=${page}&size=${pageSize}&sort=edition,desc&search=${encodeURIComponent(search)}`;
        logger.info(`Fetching page ${page}: ${apiUrl}`);

        const response = await fetch(apiUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          logger.error(`API returned ${response.status} for page ${page}`);
          break;
        }

        const data = (await response.json()) as ElotechPageResponse;

        for (const item of data.content) {
          const isoDate = item.publishedAt.substring(0, 10);

          const fileUrl = await this.resolveDownloadUrl(item.id);
          if (!fileUrl) {
            logger.warn(
              `Could not resolve download URL for edition ${item.edition}`,
            );
            continue;
          }

          const isExtra =
            item.editionType === "SUPLEMENTAR" ||
            item.editionType.includes("EXTRAORDIN");

          gazettes.push({
            date: isoDate,
            editionNumber: item.edition?.toString(),
            fileUrl,
            territoryId: this.config.territoryId,
            isExtraEdition: isExtra,
            power: item.editionType.includes("CAMARA")
              ? "legislative"
              : "executive",
            scrapedAt: new Date().toISOString(),
            requiresClientRendering: true,
          });
        }

        hasMore = !data.last;
        page++;
      }

      logger.info(`Found ${gazettes.length} gazettes for Bento Gonçalves`);
    } catch (error) {
      logger.error(`Error crawling Bento Gonçalves: ${error}`);
    }

    return gazettes;
  }

  private async resolveDownloadUrl(diarioId: string): Promise<string | null> {
    try {
      const url = `${this.apiBaseUrl}/diarios-oficiais/url-download/${diarioId}`;
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "text/plain",
        },
      });

      if (!response.ok) return null;
      const downloadUrl = (await response.text()).trim();
      return downloadUrl || null;
    } catch {
      return null;
    }
  }
}
