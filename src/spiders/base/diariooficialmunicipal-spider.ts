import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  DiarioOficialMunicipalConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";

/**
 * Spider for DiarioOficialMunicipal platform
 *
 * DiarioOficialMunicipal is a gazette publishing platform used by municipalities.
 * It provides a Laravel-based JSON API with pagination.
 *
 * API Structure:
 * - Frontend: https://{city}.diariooficialmunicipal.com
 * - API: https://paniel-{city}.diariooficialmunicipal.com/api/diarios
 * - Response: Laravel paginated response with { data: [...], last_page, current_page, ... }
 * - Each item has: numero, data, link_download
 *
 * Example cities: parnarama
 */

interface DiarioOficialMunicipalEdition {
  id: number;
  numero: string;
  numero_ano: string;
  data: string; // YYYY-MM-DD
  hora: string;
  arquivo: string;
  resumo: string | null;
  extras: {
    tamanho: string;
    paginas: number;
  };
  created_at: string;
  updated_at: string;
  link: string;
  link_download: string;
}

interface DiarioOficialMunicipalResponse {
  current_page: number;
  data: DiarioOficialMunicipalEdition[];
  first_page_url: string;
  from: number;
  last_page: number;
  last_page_url: string;
  next_page_url: string | null;
  path: string;
  per_page: number;
  prev_page_url: string | null;
  to: number;
  total: number;
}

export class DiarioOficialMunicipalSpider extends BaseSpider {
  private apiBaseUrl: string;
  private citySlug: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const domConfig = config.config as DiarioOficialMunicipalConfig;
    this.citySlug = domConfig.citySlug;
    this.apiBaseUrl = `https://paniel-${this.citySlug}.diariooficialmunicipal.com/api`;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let currentPage = 1;
    let hasMorePages = true;

    logger.info(
      `Crawling DiarioOficialMunicipal for ${this.config.name} (${this.citySlug})...`,
    );

    try {
      while (hasMorePages) {
        const url = `${this.apiBaseUrl}/diarios?page=${currentPage}`;

        logger.debug(`Fetching page ${currentPage} from ${url}`);

        const response = await fetch(url, {
          headers: {
            Accept: "application/json",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });

        if (!response.ok) {
          logger.error(`Failed to fetch ${url}: ${response.status}`);
          break;
        }

        const data = (await response.json()) as DiarioOficialMunicipalResponse;

        if (!data.data || !Array.isArray(data.data)) {
          logger.error(`Invalid response format from ${url}`);
          break;
        }

        let reachedStartDate = false;

        for (const item of data.data) {
          const dateStr = item.data; // Already in YYYY-MM-DD format
          const gazetteDate = new Date(dateStr + "T00:00:00Z");

          // Skip if after end date
          if (gazetteDate > this.endDate) continue;

          // If before start date, we've gone past our range (data is sorted descending)
          if (gazetteDate < this.startDate) {
            reachedStartDate = true;
            continue;
          }

          const gazette: Gazette = {
            date: dateStr,
            fileUrl: item.link_download,
            territoryId: this.config.territoryId,
            scrapedAt: new Date().toISOString(),
            editionNumber: item.numero,
            isExtraEdition: false,
            power: "executive_legislative",
          };

          gazettes.push(gazette);
        }

        // Stop if we've reached the start date (data is sorted descending by date)
        if (reachedStartDate) {
          logger.debug(`Reached start date, stopping pagination`);
          break;
        }

        // Check if there are more pages
        if (currentPage >= data.last_page) {
          hasMorePages = false;
        } else {
          currentPage++;
        }

        // Small delay between requests to be polite
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`,
      );
    } catch (error) {
      logger.error(`Error crawling DiarioOficialMunicipal: ${error}`);
    }

    return gazettes;
  }
}
