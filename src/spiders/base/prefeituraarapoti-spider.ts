import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig } from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";

interface PrefeituraarapotiConfig {
  type: "prefeituraarapoti";
  baseUrl: string;
}

const MONTHS_PT: Record<string, string> = {
  janeiro: "01",
  fevereiro: "02",
  março: "03",
  abril: "04",
  maio: "05",
  junho: "06",
  julho: "07",
  agosto: "08",
  setembro: "09",
  outubro: "10",
  novembro: "11",
  dezembro: "12",
};

/**
 * Spider for PeraltaTec "Diário Eletrônico" platform (DOMWeb theme)
 *
 * URL patterns:
 * - Search: {baseUrl}/diariooficial/pesquisa/all/all/{startDate}/{endDate}/{page}
 * - View:   {baseUrl}/diariooficial/view/{id}
 * - PDF:    {baseUrl}/download/diariooficial/edition/{id}
 *
 * Dates in URL are ISO format (YYYY-MM-DD).
 * Editions contain date in Portuguese: "quarta, 18 de fevereiro de 2026"
 */
export class PrefeituraarapotiSpider extends BaseSpider {
  private baseUrl: string;

  private static readonly HEADERS = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    Accept: "text/html",
  };

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraarapotiConfig;
    this.baseUrl = platformConfig.baseUrl.replace(/\/$/, "");
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(
      `Crawling PeraltaTec Diário Eletrônico for ${this.config.name}...`,
    );

    try {
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const searchUrl = `${this.baseUrl}/diariooficial/pesquisa/all/all/${this.dateRange.start}/${this.dateRange.end}/${page}`;
        logger.info(`Fetching page ${page}: ${searchUrl}`);

        const response = await fetch(searchUrl, {
          headers: PrefeituraarapotiSpider.HEADERS,
          redirect: "follow",
        });

        if (!response.ok) {
          logger.error(`Search returned ${response.status} for page ${page}`);
          break;
        }

        const html = await response.text();
        const pageGazettes = this.parseSearchPage(html);

        if (pageGazettes.length === 0) {
          hasMore = false;
          break;
        }

        gazettes.push(...pageGazettes);

        const hasNextPage = html.includes(
          `/diariooficial/pesquisa/all/all/${this.dateRange.start}/${this.dateRange.end}/${page + 1}`,
        );
        if (!hasNextPage) {
          hasMore = false;
        }

        page++;
      }

      logger.info(`Found ${gazettes.length} gazettes for ${this.config.name}`);
    } catch (error) {
      logger.error(`Error crawling PeraltaTec: ${error}`);
    }

    return gazettes;
  }

  private parseSearchPage(html: string): Gazette[] {
    const gazettes: Gazette[] = [];

    const editionRegex =
      /Edição Nº\s*(\d+)\s*<[\s\S]*?(\w+,\s*\d{1,2}\s+de\s+\w+\s+de\s+\d{4})[\s\S]*?diariooficial\/view\/(\d+)/gi;
    let match;

    while ((match = editionRegex.exec(html)) !== null) {
      const editionNumber = match[1];
      const dateText = match[2];
      const viewId = match[3];

      const isoDate = this.parsePtDate(dateText);
      if (!isoDate) {
        logger.warn(`Could not parse date: ${dateText}`);
        continue;
      }

      if (isoDate < this.dateRange.start || isoDate > this.dateRange.end) {
        continue;
      }

      const fileUrl = `${this.baseUrl}/download/diariooficial/edition/${viewId}`;

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

    return gazettes;
  }

  private parsePtDate(dateText: string): string | null {
    const match = dateText.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
    if (!match) return null;

    const day = match[1].padStart(2, "0");
    const monthName = match[2].toLowerCase();
    const year = match[3];
    const month = MONTHS_PT[monthName];

    if (!month) return null;

    return `${year}-${month}-${day}`;
  }
}
