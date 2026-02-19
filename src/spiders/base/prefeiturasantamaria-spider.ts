import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { PrefeiturasantamariaConfig } from "../../types/spider-config";
import { logger } from "../../utils/logger";

/**
 * Spider for Prefeitura de Santa Maria - RS
 *
 * Santa Maria publishes official acts (editais, decretos) at santamaria.rs.gov.br/editais.
 * The site is a Laravel/Livewire SPA, but table content is server-rendered in the initial HTML.
 *
 * HTML Structure:
 *   <tr onclick="window.open('/arquivos/baixar-arquivo/documentos/doc_{code}.pdf', '_blank')">
 *     <td>icon</td>
 *     <td>número</td>
 *     <td>descrição</td>
 *     <td>acessos</td>
 *     <td>DD/MM/YYYY</td>
 *   </tr>
 *
 * Pagination via ?page=N URL parameter (server-side via Livewire, but reflected in initial HTML).
 */
export class PrefeiturasantamariaSpider extends BaseSpider {
  private baseUrl: string;
  private maxPages = 30;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    const platformConfig = spiderConfig.config as PrefeiturasantamariaConfig;
    this.baseUrl = platformConfig.baseUrl.replace(/\/$/, "");
    logger.info(
      `Initializing PrefeiturasantamariaSpider for ${spiderConfig.name} with URL: ${this.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.baseUrl}/editais for ${this.spiderConfig.name}...`);

    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();
    let page = 1;
    let foundOlderThanRange = false;

    while (page <= this.maxPages && !foundOlderThanRange) {
      const pageUrl = `${this.baseUrl}/editais?page=${page}`;
      logger.debug(`Fetching page ${page}: ${pageUrl}`);

      let html: string;
      try {
        html = await this.fetch(pageUrl);
      } catch (error) {
        logger.warn(`Failed to fetch page ${page}: ${(error as Error).message}`);
        break;
      }

      const $ = this.loadHTML(html);
      const rows = $("tr[onclick]").toArray();

      if (rows.length === 0) {
        logger.debug(`No rows found on page ${page}, stopping pagination`);
        break;
      }

      let pageHasResults = false;

      for (const row of rows) {
        const $row = $(row);
        const onclick = $row.attr("onclick") || "";

        const pdfMatch = onclick.match(/window\.open\('([^']+\.pdf)'/);
        if (!pdfMatch) continue;

        const pdfPath = pdfMatch[1];
        const fullPdfUrl = pdfPath.startsWith("http")
          ? pdfPath
          : `${this.baseUrl}${pdfPath}`;

        if (seenUrls.has(fullPdfUrl)) continue;

        const cells = $row.find("td").toArray();
        if (cells.length < 3) continue;

        const dateText = $(cells[cells.length - 1]).text().trim();
        const parsedDate = this.parseBrazilianDate(dateText);
        if (!parsedDate) {
          logger.debug(`Could not parse date: "${dateText}"`);
          continue;
        }

        if (parsedDate < this.startDate) {
          foundOlderThanRange = true;
        }

        if (!this.isInDateRange(parsedDate)) continue;

        const editionNumber = cells.length >= 3 ? $(cells[1]).text().trim() : undefined;
        const description = cells.length >= 4 ? $(cells[2]).text().trim() : undefined;

        pageHasResults = true;

        const gazette = await this.createGazette(parsedDate, fullPdfUrl, {
          editionNumber,
          power: "executive",
          sourceText: description,
          skipUrlResolution: true,
        });

        if (gazette) {
          gazettes.push(gazette);
          seenUrls.add(fullPdfUrl);
        }
      }

      if (!pageHasResults && !foundOlderThanRange) {
        logger.debug(`No gazettes in date range on page ${page}, checking if older`);
      }

      page++;
    }

    logger.info(
      `Crawl complete for ${this.spiderConfig.name}. Found ${gazettes.length} gazettes in ${this.requestCount} requests`,
    );

    return gazettes;
  }

  private parseBrazilianDate(dateStr: string): Date | null {
    const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!match) return null;
    const [, day, month, year] = match;
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (isNaN(date.getTime())) return null;
    return date;
  }
}
