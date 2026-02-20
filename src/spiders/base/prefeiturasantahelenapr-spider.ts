import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig } from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";

interface PrefeiturasantahelenaprConfig {
  type: "prefeiturasantahelenapr";
  baseUrl: string;
}

interface DataTablesResponse {
  draw: number;
  recordsTotal: number;
  recordsFiltered: number;
  data: string[][];
}

/**
 * Spider for PAETSERVICES gazette platform (Santa Helena - PR)
 *
 * Uses DataTables server-side processing via POST to /home/JSONDiario.
 * Requires a session cookie obtained by visiting the main page first.
 *
 * PDF URL pattern: {baseUrl}/diario/ver/{filename}
 * where filename comes from the API response data[i][3]
 */
export class PrefeiturasantahelenaprSpider extends BaseSpider {
  private baseUrl: string;

  private static readonly HEADERS = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  };

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeiturasantahelenaprConfig;
    this.baseUrl = platformConfig.baseUrl.replace(/\/$/, "");
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling PAETSERVICES for ${this.config.name}...`);

    try {
      const sessionCookie = await this.getSessionCookie();
      if (!sessionCookie) {
        logger.error("Failed to obtain session cookie");
        return gazettes;
      }

      let start = 0;
      const pageSize = 50;
      let hasMore = true;
      let draw = 1;
      let reachedBeforeRange = false;

      while (hasMore && !reachedBeforeRange) {
        const body = new URLSearchParams({
          draw: draw.toString(),
          "columns[0][data]": "0",
          "columns[0][searchable]": "true",
          "columns[0][orderable]": "false",
          "columns[1][data]": "1",
          "columns[1][searchable]": "true",
          "columns[1][orderable]": "false",
          "columns[2][data]": "2",
          "columns[2][searchable]": "true",
          "columns[2][orderable]": "false",
          start: start.toString(),
          length: pageSize.toString(),
          "search[value]": "",
          "search[regex]": "false",
        });

        const apiUrl = `${this.baseUrl}/home/JSONDiario`;
        logger.info(`Fetching offset ${start}: ${apiUrl}`);

        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            ...PrefeiturasantahelenaprSpider.HEADERS,
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Requested-With": "XMLHttpRequest",
            Cookie: `PHPSESSID=${sessionCookie}`,
          },
          body: body.toString(),
        });

        if (!response.ok) {
          logger.error(`API returned ${response.status}`);
          break;
        }

        const data = (await response.json()) as DataTablesResponse;

        if (!data.data || data.data.length === 0) {
          hasMore = false;
          break;
        }

        for (const row of data.data) {
          const dateStr = row[2];
          const filename = row[3];

          if (!dateStr || !filename) continue;

          const isoDate = this.parseBrDate(dateStr);
          if (!isoDate) continue;

          if (isoDate > this.dateRange.end) continue;
          if (isoDate < this.dateRange.start) {
            reachedBeforeRange = true;
            break;
          }

          const editionMatch = row[0].match(/<strong>(\d+)<\/strong>/);
          const editionNumber = editionMatch ? editionMatch[1] : "";

          const fileUrl = `${this.baseUrl}/diario/ver/${filename}`;

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

        start += pageSize;
        draw++;

        if (start >= data.recordsTotal) {
          hasMore = false;
        }
      }

      logger.info(`Found ${gazettes.length} gazettes for ${this.config.name}`);
    } catch (error) {
      logger.error(`Error crawling PAETSERVICES: ${error}`);
    }

    return gazettes;
  }

  private async getSessionCookie(): Promise<string | null> {
    try {
      const response = await fetch(this.baseUrl, {
        headers: PrefeiturasantahelenaprSpider.HEADERS,
        redirect: "manual",
      });

      const setCookie = response.headers.get("set-cookie");
      if (setCookie) {
        const match = setCookie.match(/PHPSESSID=([^;]+)/);
        if (match) return match[1];
      }

      return null;
    } catch (error) {
      logger.error(`Failed to get session cookie: ${error}`);
      return null;
    }
  }

  private parseBrDate(dateStr: string): string | null {
    const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!match) return null;
    return `${match[3]}-${match[2]}-${match[1]}`;
  }
}
