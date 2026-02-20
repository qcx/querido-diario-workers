import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig, GazetaMunicipalConfig } from "../../types/spider-config";
import { DateRange } from "../../types";
import { getMonthlySequence } from "../../utils/date-utils";
import { logger } from "../../utils/logger";

/**
 * Response from Gazeta Municipal API (Sistema de Publicação Oficial - Cuiabá variant)
 * GET {baseUrl}/api/api/editions/published?page=N
 * GET {baseUrl}/api/api/editions/published/{year}/{month}
 */
interface PublishedResponse {
  status: string;
  editions: GazetaEditionItem[];
}

interface GazetaEditionItem {
  id: number;
  number: number;
  edition_type_name: string;
  suplement: boolean;
  publication_date: string; // ISO "2026-02-06T04:00:00.000000Z"
  downloads?: number;
  views?: number;
}

/**
 * Spider for Gazeta Municipal (Sistema de Publicação Oficial - API variant used by Cuiabá/MT).
 *
 * API (different from diariomunicipiosjc):
 * - List by month: GET {baseUrl}/api/api/editions/published/{year}/{month}
 * - PDF: GET {baseUrl}/api/api/editions/viewPdf/{id}
 */
export class GazetaMunicipalSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const gmConfig = config.config as GazetaMunicipalConfig;
    this.baseUrl = gmConfig.baseUrl.replace(/\/$/, "");
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const months = getMonthlySequence(this.startDate, this.endDate);

    logger.info(`Crawling ${this.baseUrl} for ${this.config.name}...`);

    for (const monthDate of months) {
      const year = monthDate.getFullYear();
      const month = monthDate.getMonth() + 1;
      const url = `${this.baseUrl}/api/api/editions/published/${year}/${month}`;

      logger.debug(
        `Fetching editions for ${year}-${String(month).padStart(2, "0")}`,
      );

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
          logger.warn(`Failed to fetch ${url}: ${response.status}`);
          continue;
        }

        const data = (await response.json()) as PublishedResponse;

        if (data.status !== "success" || !data.editions?.length) {
          continue;
        }

        const startTime = this.startDate.getTime();
        const endTime = this.endDate.getTime();

        for (const item of data.editions) {
          const pubDate = new Date(item.publication_date);
          const itemTime = pubDate.getTime();
          if (itemTime < startTime || itemTime > endTime) continue;

          const isoDate = item.publication_date.slice(0, 10);

          const gazette: Gazette = {
            date: isoDate,
            fileUrl: `${this.baseUrl}/api/api/editions/viewPdf/${item.id}`,
            territoryId: this.config.territoryId,
            scrapedAt: new Date().toISOString(),
            editionNumber: item.number?.toString() || undefined,
            isExtraEdition: item.suplement === true,
            power: "executive",
          };

          gazettes.push(gazette);
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        if (
          msg.includes("abort") ||
          (error as { name?: string })?.name === "AbortError"
        ) {
          logger.warn(`Timeout fetching editions for ${year}-${month}`);
        } else {
          logger.error(`Error fetching editions for ${year}-${month}: ${msg}`);
        }
      }
    }

    logger.info(
      `Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`,
    );
    return gazettes;
  }
}
