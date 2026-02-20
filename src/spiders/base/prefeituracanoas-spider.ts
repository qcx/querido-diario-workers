import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";
import { toISODate } from "../../utils/date-utils";

interface DOMCEditionIndex {
  page_start: string;
  page_end: string;
  publication_id: string;
  publication_title: string;
}

interface DOMCEdition {
  id: number;
  title: string;
  type: "N" | "C";
  index: DOMCEditionIndex[];
}

interface DOMCDiaryResponse {
  id?: number;
  day?: string;
  number?: string;
  editions?: DOMCEdition[];
}

/**
 * Spider for Prefeitura de Canoas - RS (DOMC)
 *
 * Uses the DOMC public API (Laravel) at sistemas.canoas.rs.gov.br/domc
 * - GET /api/public/diary-by-day?day=DD/MM/YYYY → diary JSON with editions
 * - GET /api/edition-file/{editionId} → PDF file
 */
export class PrefeituracanoasSpider extends BaseSpider {
  private baseUrl: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    const config = spiderConfig.config as { baseUrl: string };
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling DOMC Canoas for ${this.config.name}...`);

    const current = new Date(this.startDate);
    while (current <= this.endDate) {
      const dayStr = this.formatDateBR(current);

      try {
        const diary = await this.fetchDiary(dayStr);

        if (diary && diary.editions && diary.editions.length > 0) {
          for (const edition of diary.editions) {
            const pdfUrl = `${this.baseUrl}/api/edition-file/${edition.id}`;
            const isExtra = edition.type === "C";

            const gazette = await this.createGazette(
              new Date(current),
              pdfUrl,
              {
                editionNumber: diary.number,
                isExtraEdition: isExtra,
                power: "executive_legislative",
                skipUrlResolution: true,
              },
            );

            if (gazette) {
              gazettes.push(gazette);
            }
          }
        }
      } catch (error) {
        logger.warn(
          `Failed to fetch diary for ${dayStr}: ${(error as Error).message}`,
        );
      }

      current.setDate(current.getDate() + 1);
    }

    logger.info(`Found ${gazettes.length} gazettes for Canoas`);
    return gazettes;
  }

  private formatDateBR(date: Date): string {
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = date.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  private async fetchDiary(dayBR: string): Promise<DOMCDiaryResponse | null> {
    const url = `${this.baseUrl}/api/public/diary-by-day?day=${encodeURIComponent(dayBR)}`;
    this.requestCount++;

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    if (!response.ok) {
      logger.warn(`DOMC API returned ${response.status} for day=${dayBR}`);
      return null;
    }

    const data = (await response.json()) as DOMCDiaryResponse;

    if (!data || !data.editions || data.editions.length === 0) {
      return null;
    }

    return data;
  }
}
