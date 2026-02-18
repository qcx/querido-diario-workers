import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  PrefeituramaringaConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
import type { Fetcher } from "@cloudflare/workers-types";

/**
 * Spider for Maringá - PR Diário Oficial.
 * Portal: pr.portaldatransparencia.com.br (same platform as PTIO, but dedicated spider to avoid overloading ptio).
 *
 * HTML structure (Portal da Transparência PR):
 * - Blocks: div.edicoes
 * - Date: div.data-caderno (e.g. "6/Janeiro/2026")
 * - PDF: button/link with pagina=abreDocumento&arquivo=...
 */
export class PrefeituramaringaSpider extends BaseSpider {
  private baseUrl: string;
  private listBaseUrl: string;
  private browser: Fetcher | null = null;

  private static readonly MONTH_MAP: Record<string, string> = {
    janeiro: "01",
    fevereiro: "02",
    março: "03",
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

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituramaringaConfig;
    const urlObj = new URL(platformConfig.baseUrl);
    this.baseUrl = platformConfig.baseUrl;
    this.listBaseUrl = `${urlObj.origin}${urlObj.pathname}`.replace(/\/$/, "");
    this.browser = browser ?? null;
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  private parseDate(rawDate: string): string | null {
    const monthNameMatch = rawDate.match(/(\d{1,2})\/(\w+)\/(\d{4})/i);
    if (monthNameMatch) {
      const [, day, monthName, year] = monthNameMatch;
      const month =
        PrefeituramaringaSpider.MONTH_MAP[monthName.toLowerCase()];
      if (month) {
        return `${year}-${month}-${day.padStart(2, "0")}`;
      }
    }
    const numericMatch = rawDate.match(/(\d{1,2})\/(\d{2})\/(\d{4})/);
    if (numericMatch) {
      const [, day, month, year] = numericMatch;
      return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
    return null;
  }

  private buildListUrl(page: number): string {
    const separator = this.listBaseUrl.includes("?") ? "&" : "?";
    if (page === 1) {
      return `${this.listBaseUrl}${separator}pagina=dop`;
    }
    return `${this.listBaseUrl}${separator}pagina=dop&page=${page}`;
  }

  async crawl(): Promise<Gazette[]> {
    return this.crawlWithFetch();
  }

  private async crawlWithFetch(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Maringá (prefeituramaringa) for ${this.config.name}...`);

    try {
      let currentPage = 1;
      let hasNextPage = true;
      const baseUrlObj = new URL(this.listBaseUrl);

      while (hasNextPage) {
        const url = this.buildListUrl(currentPage);
        logger.debug(`Fetching page ${currentPage}: ${url}`);

        let response;
        let lastError;
        let retries = 0;
        const maxRetries = 3;

        while (retries < maxRetries) {
          try {
            response = await fetch(url, {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                Accept:
                  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
              },
            });
            break;
          } catch (error) {
            lastError = error;
            retries++;
            if (retries < maxRetries) {
              logger.debug(
                `Retry ${retries}/${maxRetries} for page ${currentPage}, waiting 1000ms...`
              );
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          }
        }

        if (!response) {
          logger.debug(
            `Failed to fetch page ${currentPage} after ${maxRetries} retries. Website may not be accessible via HTTP requests.`
          );
          break;
        }

        if (!response.ok) {
          logger.warn(`Failed to fetch page ${currentPage}: ${response.status}`);
          break;
        }

        const html = await response.text();
        const gazetteBlocks = html.split(/<div[^>]*class="edicoes"[^>]*>/);
        let foundGazettes = 0;
        let foundOlderThanRange = false;

        for (let i = 1; i < gazetteBlocks.length; i++) {
          const gazetteHtml = gazetteBlocks[i];
          const dateMatch = gazetteHtml.match(
            /class="data-caderno[^"]*"[^>]*>([^<]+)</
          );
          if (!dateMatch) continue;

          const rawDate = dateMatch[1].trim();
          const date = this.parseDate(rawDate);
          if (!date) continue;

          if (date > this.dateRange.end) continue;
          if (date < this.dateRange.start) {
            foundOlderThanRange = true;
            continue;
          }

          const editionMatch = gazetteHtml.match(/Edição\s+([\d.]+)/i);
          const editionNumber = editionMatch
            ? editionMatch[1].replace(/\./g, "")
            : undefined;

          let fileUrl: string | null = null;
          const buttonHrefMatch = gazetteHtml.match(
            /<button[^>]*href="([^"]+)"/
          );
          if (buttonHrefMatch && buttonHrefMatch[1].includes("abreDocumento")) {
            const queryMatch = buttonHrefMatch[1].match(/\?(.+)/);
            if (queryMatch) {
              fileUrl = `${baseUrlObj.origin}${baseUrlObj.pathname}?${queryMatch[1]}`;
            }
          }
          if (!fileUrl) {
            const onClickMatch = gazetteHtml.match(
              /onClick="[^"]*\?pagina=abreDocumento&arquivo=([^'"]+)/
            );
            if (onClickMatch) {
              fileUrl = `${baseUrlObj.origin}${baseUrlObj.pathname}?pagina=abreDocumento&arquivo=${onClickMatch[1]}`;
            }
          }
          if (!fileUrl) {
            const linkMatch = gazetteHtml.match(
              /<a[^>]*href="([^"]*abreDocumento[^"]*)"/
            );
            if (linkMatch) {
              const href = linkMatch[1];
              fileUrl = href.startsWith("http")
                ? href
                : `${baseUrlObj.origin}${href.startsWith("/") ? "" : baseUrlObj.pathname}${href}`;
            }
          }

          if (!fileUrl) continue;

          gazettes.push({
            date,
            editionNumber,
            fileUrl,
            territoryId: this.config.territoryId,
            isExtraEdition: false,
            power: "executive",
            scrapedAt: new Date().toISOString(),
          });
          foundGazettes++;
        }

        if (foundOlderThanRange) {
          hasNextPage = false;
          continue;
        }

        const nextPageMatch =
          html.match(/<a[^>]*class="proximo"[^>]*href="([^"]+)"/) ||
          html.match(/<a[^>]*href="[^"]*\?[^"]*pagina=(\d+)"[^>]*>\s*»\s*<\/a>/);
        hasNextPage = !!nextPageMatch && foundGazettes > 0;

        if (hasNextPage) {
          currentPage++;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes from Maringá (prefeituramaringa)`
      );
    } catch (error) {
      logger.error(`Error crawling prefeituramaringa: ${error}`);
    }

    return gazettes;
  }
}
