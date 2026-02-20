import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig } from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";

interface PrefeituracianorteConfig {
  type: "prefeituracianorte";
  baseUrl: string;
  apiBaseUrl: string;
}

interface ElotechOxyGazetteItem {
  id: string;
  edition: number;
  editionType: string;
  publishedAt: string;
  fileSize: number;
}

interface ElotechOxyApiResponse {
  content: ElotechOxyGazetteItem[];
  number: number;
  size: number;
  totalPages: number;
  totalElements: number;
  last: boolean;
}

export class PrefeituracianorteSpider extends BaseSpider {
  private baseUrl: string;
  private apiBaseUrl: string;

  private static readonly HEADERS = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    Accept: "application/json",
  };

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituracianorteConfig;
    this.baseUrl = platformConfig.baseUrl;
    this.apiBaseUrl = platformConfig.apiBaseUrl;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Cianorte gazette for ${this.config.name}...`);

    try {
      let page = 0;
      let reachedBeforeRange = false;

      while (!reachedBeforeRange) {
        const apiUrl = `${this.apiBaseUrl}/api/legislacao/diarios-oficiais/publicados?sort=edition,desc&page=${page}&size=50`;
        logger.info(`Fetching page ${page}: ${apiUrl}`);

        const response = await fetch(apiUrl, {
          headers: PrefeituracianorteSpider.HEADERS,
        });

        if (!response.ok) {
          logger.error(`API returned ${response.status} for page ${page}`);
          break;
        }

        const data = (await response.json()) as ElotechOxyApiResponse;
        const items = data.content;

        if (!items || items.length === 0) break;

        for (const item of items) {
          const isoDate = item.publishedAt.substring(0, 10);

          if (isoDate > this.dateRange.end) continue;
          if (isoDate < this.dateRange.start) {
            reachedBeforeRange = true;
            break;
          }

          const fileUrl = await this.resolveDownloadUrl(item.id);
          if (!fileUrl) continue;

          const isExtra =
            item.editionType.toLowerCase().includes("suplementar") ||
            item.editionType.toLowerCase().includes("extraordin");

          gazettes.push({
            date: isoDate,
            editionNumber: item.edition.toString(),
            fileUrl,
            territoryId: this.config.territoryId,
            isExtraEdition: isExtra,
            power: "executive",
            scrapedAt: new Date().toISOString(),
          });
        }

        if (data.last) break;
        page++;
      }

      logger.info(`Found ${gazettes.length} gazettes for Cianorte`);
    } catch (error) {
      logger.error(`Error crawling Cianorte: ${error}`);
    }

    return gazettes;
  }

  private async resolveDownloadUrl(gazetteId: string): Promise<string | null> {
    try {
      const url = `${this.apiBaseUrl}/api/legislacao/diarios-oficiais/url-download/${gazetteId}`;
      const response = await fetch(url, {
        headers: PrefeituracianorteSpider.HEADERS,
      });

      if (!response.ok) return null;

      const downloadUrl = await response.text();
      return downloadUrl.trim() || null;
    } catch (error) {
      logger.error(`Failed to resolve download URL for ${gazetteId}: ${error}`);
      return null;
    }
  }
}
