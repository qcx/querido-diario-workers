import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  PrefeituraLagoaSecaConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";

/**
 * Spider for Prefeitura de Lagoa Seca - PB official gazette (Boletim Oficial)
 *
 * Site uses WordPress Download Manager (WPDM) plugin
 * - List page: https://lagoaseca.pb.gov.br/boletim-oficial/
 * - Pagination: ?cp=N (N = 1, 2, 3, ..., 125)
 * - Download links: data-downloadurl="https://lagoaseca.pb.gov.br/download/{slug}/?wpdmdl={id}&refresh={token}"
 *
 * Structure:
 * - Each gazette is listed with format "Boletim Oficial - DD de MMMM de YYYY - Edição Extraordinária"
 * - Links contain direct download URLs in data-downloadurl attribute
 */
export class PrefeituraLagoaSecaSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraLagoaSecaConfig;
    this.baseUrl = platformConfig.baseUrl || "https://lagoaseca.pb.gov.br";
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura Lagoa Seca for ${this.config.name}...`);

    try {
      let page = 1;
      let hasMore = true;
      const seenUrls = new Set<string>();
      const maxPages = 150; // Safety limit

      while (hasMore && page <= maxPages) {
        const listUrl =
          page === 1
            ? `${this.baseUrl}/boletim-oficial/`
            : `${this.baseUrl}/boletim-oficial/?cp=${page}`;

        logger.debug(`Fetching page ${page}: ${listUrl}`);

        const response = await fetch(listUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch list page: ${response.status}`);
        }

        const html = await response.text();

        // Extract download links from data-downloadurl attribute
        // Pattern: data-downloadurl="https://lagoaseca.pb.gov.br/download/{slug}/?wpdmdl={id}&refresh={token}"
        const downloadPattern =
          /data-downloadurl="([^"]+lagoaseca\.pb\.gov\.br\/download\/([^"]+)\?wpdmdl=\d+[^"]*)"/g;
        const matches = [...html.matchAll(downloadPattern)];

        if (matches.length === 0) {
          logger.debug(`No more gazettes found on page ${page}`);
          hasMore = false;
          break;
        }

        logger.debug(`Found ${matches.length} gazette links on page ${page}`);

        let foundInRange = false;

        for (const match of matches) {
          const fileUrl = match[1];
          const slug = match[2];

          // Skip duplicates
          if (seenUrls.has(fileUrl)) {
            continue;
          }
          seenUrls.add(fileUrl);

          // Extract date from slug
          // Pattern: boletim-oficial-DD-de-MMMM-de-YYYY-edicao-extraordinaria/
          const dateInfo = this.extractDateFromSlug(slug);

          if (!dateInfo) {
            logger.debug(`Could not extract date from slug: ${slug}`);
            continue;
          }

          const { dateStr, isExtraEdition } = dateInfo;
          const gazetteDate = new Date(dateStr);

          // Check if within date range
          const startDate = new Date(this.dateRange.start);
          const endDate = new Date(this.dateRange.end);

          if (gazetteDate < startDate) {
            // If we've gone past the start date, we can stop
            logger.debug(
              `Gazette ${dateStr} is before start date, stopping pagination`,
            );
            hasMore = false;
            break;
          }

          if (gazetteDate > endDate) {
            logger.debug(`Skipping gazette ${dateStr}: after end date`);
            continue;
          }

          foundInRange = true;

          gazettes.push({
            date: dateStr,
            fileUrl: fileUrl,
            territoryId: this.config.territoryId,
            isExtraEdition: isExtraEdition,
            power: "executive",
            scrapedAt: new Date().toISOString(),
          });

          logger.debug(`Found gazette: ${dateStr} - ${fileUrl}`);
        }

        // Check if there's a next page link
        const hasNextPage = html.includes(`?cp=${page + 1}`);

        if (!hasNextPage) {
          hasMore = false;
        } else {
          page++;
          // Add delay between requests
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes from Prefeitura Lagoa Seca`,
      );
    } catch (error) {
      logger.error(`Error crawling Prefeitura Lagoa Seca: ${error}`);
      throw error;
    }

    return gazettes;
  }

  private extractDateFromSlug(
    slug: string,
  ): { dateStr: string; isExtraEdition: boolean } | null {
    // Pattern: boletim-oficial-DD-de-MMMM-de-YYYY-edicao-extraordinaria/
    // Example: boletim-oficial-26-de-janeiro-de-2026-edicao-extraordinaria/

    const monthMap: { [key: string]: string } = {
      janeiro: "01",
      fevereiro: "02",
      marco: "03",
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

    // Try pattern with day-de-month-de-year
    const pattern = /boletim-oficial-(\d{1,2})-de-(\w+)-de-(\d{4})/i;
    const match = slug.match(pattern);

    if (match) {
      const day = match[1].padStart(2, "0");
      const monthName = match[2].toLowerCase();
      const year = match[3];

      const month = monthMap[monthName];
      if (month) {
        const dateStr = `${year}-${month}-${day}`;
        const isExtraEdition =
          slug.toLowerCase().includes("extraordinaria") ||
          slug.toLowerCase().includes("extraordinario");
        return { dateStr, isExtraEdition };
      }
    }

    // Try alternate pattern: boletim-oficial-DD-MM-YYYY
    const altPattern = /boletim-oficial-(\d{2})-(\d{2})-(\d{4})/i;
    const altMatch = slug.match(altPattern);

    if (altMatch) {
      const day = altMatch[1];
      const month = altMatch[2];
      const year = altMatch[3];
      const dateStr = `${year}-${month}-${day}`;
      const isExtraEdition =
        slug.toLowerCase().includes("extraordinaria") ||
        slug.toLowerCase().includes("extraordinario");
      return { dateStr, isExtraEdition };
    }

    return null;
  }
}
