import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeituraAnageConfig,
} from "../../types";
import { logger } from "../../utils/logger";
import { getCurrentTimestamp } from "../../utils/date-utils";

/**
 * PrefeituraAnageSpider implementation for Cloudflare Workers
 *
 * Anagé (BA) uses a custom PortalTP/PortalGov based gazette system.
 *
 * The system provides:
 * - A main page at /diariooficial with search filters
 * - Previous editions accessible via /diariooficial/edicoes-anteriores (note the hyphen!)
 * - Each edition page at /diariooficial/edicao/{number} redirects to the PDF
 * - PDF files stored at /arquivos/diariooficial/{hash}/DiarioOficial_Edicao_{number}.pdf
 * - Editions with volume and number (e.g., "Volume 19, Nº 3907/2026")
 * - Dates in format "Dia-da-semana, DD - Mês - AAAA" (e.g., "Sexta-Feira, 23 - Janeiro - 2026")
 *
 * URL: https://anage.ba.gov.br/diariooficial
 *
 * This spider requires browser rendering due to JavaScript-based content loading.
 */
export class PrefeituraAnageSpider extends BaseSpider {
  protected anageConfig: PrefeituraAnageConfig;
  private readonly HASH = "9821880317f01b51b339f8f237076d3c";

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.anageConfig = spiderConfig.config as PrefeituraAnageConfig;

    if (!this.anageConfig.baseUrl) {
      throw new Error(
        `PrefeituraAnageSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(`Initializing PrefeituraAnageSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    const baseUrl = this.anageConfig.baseUrl.replace(/\/$/, "");

    logger.info(`Crawling ${baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();

    try {
      // The editions page lists all previous editions with dates
      // Note: URL uses "edicoes-anteriores" with a hyphen
      const editionsUrl = `${baseUrl}/diariooficial/edicoes-anteriores`;

      logger.info(`Fetching editions from: ${editionsUrl}`);

      const html = await this.fetch(editionsUrl);
      const $ = this.loadHTML(html);

      // Parse the table rows - each row contains an edition
      // Structure:
      // <tr>
      //   <td><a href="/diariooficial/edicao/{number}#page=">Volume X, Nº {number}/YYYY</a></td>
      //   <td>{pages}</td>
      //   <td><a href="/diariooficial/sumario/{number}">...</a></td>
      //   <td>Dia-da-semana, DD - Mês - AAAA</td>
      // </tr>
      const rows = $("tr").toArray();

      logger.info(`Found ${rows.length} table rows`);

      for (const row of rows) {
        try {
          const $row = $(row);
          const cells = $row.find("td");

          if (cells.length < 4) {
            continue;
          }

          // First cell: link with edition number
          const editionCell = cells.eq(0);
          const editionLink = editionCell.find(
            'a[href*="/diariooficial/edicao/"]',
          );
          const href = editionLink.attr("href");

          if (!href) {
            continue;
          }

          // Extract edition number from URL
          const editionMatch = href.match(/\/edicao\/(\d+)/);
          if (!editionMatch) {
            continue;
          }

          const editionNumber = editionMatch[1];

          // Fourth cell: date in format "Dia-da-semana, DD - Mês - AAAA"
          const dateCell = cells.eq(3);
          const dateText = dateCell.text().trim();

          // Parse date: "Sexta-Feira, 23 - Janeiro - 2026"
          const dateMatch = dateText.match(
            /(\d{1,2})\s*[-–]\s*(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*[-–]\s*(\d{4})/i,
          );

          if (!dateMatch) {
            logger.debug(`Could not parse date from: ${dateText}`);
            continue;
          }

          const monthMap: Record<string, string> = {
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

          const day = dateMatch[1].padStart(2, "0");
          const month = monthMap[dateMatch[2].toLowerCase()];
          const year = dateMatch[3];
          const dateStr = `${year}-${month}-${day}`;
          const gazetteDate = new Date(dateStr);

          // Check if date is in range
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }

          // Build the direct PDF URL
          // Format: /arquivos/diariooficial/{hash}/DiarioOficial_Edicao_{number}.pdf
          const pdfUrl = `${baseUrl}/arquivos/diariooficial/${this.HASH}/DiarioOficial_Edicao_${editionNumber}.pdf`;

          // Skip if already seen
          if (seenUrls.has(pdfUrl)) {
            continue;
          }
          seenUrls.add(pdfUrl);

          const gazette: Gazette = {
            date: dateStr,
            fileUrl: pdfUrl,
            territoryId: this.spiderConfig.territoryId,
            scrapedAt: getCurrentTimestamp(),
            isExtraEdition: false,
            power: "executive_legislative",
            editionNumber,
            sourceText: `Diário Oficial de Anagé - Edição ${editionNumber} - ${dateStr}`,
          };

          gazettes.push(gazette);
          logger.debug(`Found gazette: ${dateStr} - Edition ${editionNumber}`);
        } catch (error) {
          logger.warn(`Error processing row:`, {
            error: (error as Error).message,
          });
        }
      }

      // If no gazettes found from editions page, try pagination
      if (gazettes.length === 0) {
        logger.warn(
          `No gazettes found from editions page, check page structure`,
        );
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
      );
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }
}
