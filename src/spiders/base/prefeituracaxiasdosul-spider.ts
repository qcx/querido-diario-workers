import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  PrefeituracaxiasdosulConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";

/**
 * Spider for Prefeitura de Caxias do Sul - RS (DOE)
 *
 * Site: doe.caxias.rs.gov.br
 * Yii2 framework with GridView table listing gazette editions.
 *
 * Search via GET: /site/index?PublicacoesSearch[dt_range]=DD/MM/YY até DD/MM/YY&per-page=100
 * Download via: /site/download/{id}
 *
 * Table structure per row (<tr data-key="{id}">):
 *   - Column 1 (hidden-xs): edition number
 *   - Column 2: date (DD/MM/YYYY)
 *   - Column 3: type (Normal / Extra)
 *   - Column 4: action links (janela, download, view)
 */
export class PrefeituracaxiasdosulSpider extends BaseSpider {
  private caxiasConfig: PrefeituracaxiasdosulConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.caxiasConfig = spiderConfig.config as PrefeituracaxiasdosulConfig;

    if (!this.caxiasConfig.baseUrl) {
      throw new Error(
        `PrefeituracaxiasdosulSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeituracaxiasdosulSpider for ${spiderConfig.name} with URL: ${this.caxiasConfig.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.caxiasConfig.baseUrl} for ${this.spiderConfig.name}...`,
    );

    const gazettes: Gazette[] = [];

    try {
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const searchUrl = this.buildSearchUrl(page);
        logger.debug(`Fetching page ${page}: ${searchUrl}`);

        const html = await this.fetch(searchUrl);
        const $ = this.loadHTML(html);

        const rows = $("table.table tbody tr[data-key]");

        if (rows.length === 0) {
          logger.debug(`No rows found on page ${page}, stopping`);
          break;
        }

        logger.debug(`Found ${rows.length} rows on page ${page}`);

        for (let i = 0; i < rows.length; i++) {
          const row = $(rows[i]);
          const dataKey = row.attr("data-key");
          if (!dataKey) continue;

          const cells = row.find("td");
          const editionNumber = $(cells[0]).text().trim();
          const dateText = $(cells[1]).text().trim();
          const pubType = $(cells[2]).text().trim();

          const dateMatch = dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) {
            logger.debug(`Could not parse date from: "${dateText}"`);
            continue;
          }

          const [, day, month, year] = dateMatch;
          const gazetteDate = new Date(`${year}-${month}-${day}`);

          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }

          const isExtra = pubType.toLowerCase() === "extra";
          const baseUrl = this.caxiasConfig.baseUrl.replace(/\/$/, "");
          const downloadUrl = `${baseUrl}/site/download/${dataKey}`;

          const gazette = await this.createGazette(gazetteDate, downloadUrl, {
            editionNumber,
            isExtraEdition: isExtra,
            power: "executive",
            sourceText: `Edição ${editionNumber} - ${dateText}${isExtra ? " (Extra)" : ""}`,
          });

          if (gazette) {
            gazettes.push(gazette);
          }
        }

        const nextPage = $("ul.pagination li.next:not(.disabled) a");
        hasMore = nextPage.length > 0;
        page++;

        if (page > 50) {
          logger.warn("Reached page limit of 50, stopping pagination");
          break;
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
      );
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
      throw error;
    }

    return gazettes;
  }

  private buildSearchUrl(page: number): string {
    const baseUrl = this.caxiasConfig.baseUrl.replace(/\/$/, "");
    const startStr = this.formatDateForSearch(this.startDate);
    const endStr = this.formatDateForSearch(this.endDate);
    const dtRange = `${startStr} até ${endStr}`;

    const params = new URLSearchParams();
    params.set("PublicacoesSearch[dt_range]", dtRange);
    params.set("per-page", "100");
    if (page > 1) {
      params.set("page", String(page));
    }

    return `${baseUrl}/site/index?${params.toString()}`;
  }

  /** Formats a Date as DD/MM/YY (2-digit year) as required by the site */
  private formatDateForSearch(date: Date): string {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = String(date.getFullYear()).slice(-2);
    return `${day}/${month}/${year}`;
  }
}
