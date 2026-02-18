import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse } from "node-html-parser";

/**
 * Configuration for Prefeitura de Rondonópolis spider
 */
export interface PrefeiturarondonopolisConfig {
  type: "prefeiturarondonopolis";
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/**
 * Spider for Diário Oficial de Rondonópolis - MT
 *
 * URL: https://www.rondonopolis.mt.gov.br/diario-oficial/
 *
 * HTML Structure:
 * - Table with columns: Edição | Data de Edição | Baixar Arquivo
 * - Date format: DD/MM/YY
 * - PDF links: /media/docs/edicoes/YYYY/Month/uuid.pdf
 */
export class PrefeiturarondonopolisSpider extends BaseSpider {
  constructor(
    spiderConfig: SpiderConfig,
    dateRange: DateRange,
    _browser?: Fetcher,
  ) {
    super(spiderConfig, dateRange);

    const config = this.config.config as PrefeiturarondonopolisConfig;
    if (!config.baseUrl) {
      throw new Error(
        `PrefeiturarondonopolisSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeiturarondonopolisSpider for ${spiderConfig.name} with URL: ${config.baseUrl}`,
    );
  }

  private get baseUrl(): string {
    return (this.config.config as PrefeiturarondonopolisConfig).baseUrl.replace(
      /\/$/,
      "",
    );
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let page = 1;
    const maxPages = 100;

    logger.info(`Crawling Diário Oficial Rondonópolis for ${this.config.name}`);

    while (page <= maxPages) {
      const listUrl =
        page === 1
          ? `${this.baseUrl}/diario-oficial/`
          : `${this.baseUrl}/diario-oficial/?p=${page}`;

      try {
        const html = await this.fetch(listUrl);
        const root = parse(html);

        const table = root.querySelector("table");
        if (!table) {
          if (page === 1) {
            logger.warn("No table found on diario-oficial page");
          }
          break;
        }

        const dataRows = table.querySelectorAll("tbody tr");
        if (dataRows.length === 0) break;
        let foundInRange = 0;
        let foundOlderThanRange = false;

        for (const row of dataRows) {
          // First column is <th scope="row"> (edition), then <td> (date), <td> (link)
          const cells = row.querySelectorAll("th, td");
          if (cells.length < 3) continue;

          const editionText = cells[0]?.text?.trim() || "";
          if (/edição|data|baixar/i.test(editionText)) continue;
          const dateText = cells[1]?.text?.trim() || "";
          const link = row.querySelector('a[href*=".pdf"]');
          const href = link?.getAttribute("href");
          if (!href || !dateText) continue;

          const editionNumber = editionText.replace(/\D/g, "") || undefined;

          // Date format: DD/MM/YY
          const dateMatch = dateText.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
          if (!dateMatch) continue;

          const [, d, m, y] = dateMatch;
          const year =
            y.length === 2
              ? parseInt(y, 10) <= 50
                ? 2000 + parseInt(y, 10)
                : 1900 + parseInt(y, 10)
              : parseInt(y, 10);
          const month = parseInt(m, 10) - 1;
          const day = parseInt(d, 10);
          const gazetteDate = new Date(year, month, day);

          if (gazetteDate < this.startDate) {
            foundOlderThanRange = true;
            continue;
          }
          if (!this.isInDateRange(gazetteDate)) continue;

          const pdfUrl = href.startsWith("http")
            ? href
            : `${this.baseUrl}${href.startsWith("/") ? "" : "/"}${href}`;

          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber,
            isExtraEdition: false,
            power: "executive",
            sourceText: `Edição ${editionNumber} - ${dateText}`,
          });
          if (gazette) {
            gazettes.push(gazette);
            foundInRange++;
          }
        }

        if (
          foundOlderThanRange ||
          (dataRows.length > 0 && foundInRange === 0 && page > 1)
        ) {
          logger.debug("Reached editions older than date range, stopping");
          break;
        }
        if (dataRows.length === 0) break;

        page++;
      } catch (error) {
        logger.warn(`Error fetching page ${page}:`, error as Error);
        break;
      }
    }

    logger.info(`Crawled ${gazettes.length} gazettes for ${this.config.name}`);
    return gazettes;
  }
}
