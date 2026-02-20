import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  PrefeituramacapaConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
import { getCurrentTimestamp } from "../../utils/date-utils";
// @ts-ignore
import { parse } from "node-html-parser";

/**
 * Spider for Prefeitura de Macapá gazette portal
 *
 * Site: https://macapa.ap.gov.br/diarios-oficiais/
 *
 * The site uses a WordPress-based portal with a table listing all gazettes.
 * PDFs are stored in wp-content/uploads with pattern:
 * /portal/wp-content/uploads/{year}/{month}/Diario-Oficial-{number}-{date}.pdf
 *
 * The page renders a table with:
 * - Número (edition number)
 * - Data (date in DD/MM/YYYY format)
 * - Título (title)
 * - Visualizar (link to PDF)
 */
export class PrefeituramacapaSpider extends BaseSpider {
  protected config: PrefeituramacapaConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeituramacapaConfig;

    if (!this.config.baseUrl) {
      throw new Error(
        `PrefeituramacapaSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeituramacapaSpider for ${spiderConfig.name} with URL: ${this.config.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.config.baseUrl} for ${this.spiderConfig.name}...`,
    );

    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();

    try {
      // Fetch the main page
      const response = await fetch(this.config.baseUrl, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch page: ${response.status} ${response.statusText}`,
        );
      }

      const html = await response.text();
      const root = parse(html);

      // Find all table rows with gazette data
      // The table has columns: Número | Data | Título | Visualizar
      const rows = root.querySelectorAll("table tr");

      logger.info(`Found ${rows.length} rows in table`);

      for (const row of rows) {
        try {
          const cells = row.querySelectorAll("td");
          if (cells.length < 4) continue;

          // Extract data from cells
          const numeroCell = cells[0];
          const dataCell = cells[1];
          const tituloCell = cells[2];
          const visualizarCell = cells[3];

          // Get edition number
          const editionNumber = numeroCell.text?.trim();

          // Get date (DD/MM/YYYY format)
          const dateText = dataCell.text?.trim();
          const dateMatch = dateText?.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) {
            continue;
          }

          const [, day, month, year] = dateMatch;
          const date = `${year}-${month}-${day}`;
          const gazetteDate = new Date(date);

          // Check if date is in range
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }

          // Get PDF URL from the visualizar cell
          const pdfLink = visualizarCell.querySelector("a[href*='.pdf']");
          let pdfUrl = pdfLink?.getAttribute("href");

          if (!pdfUrl) {
            logger.debug(
              `No PDF link found for gazette ${editionNumber} on ${date}`,
            );
            continue;
          }

          // Make absolute URL if relative
          if (!pdfUrl.startsWith("http")) {
            const baseUrlObj = new URL(this.config.baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith("/") ? "" : "/"}${pdfUrl}`;
          }

          // Avoid duplicates
          if (seenUrls.has(pdfUrl)) {
            continue;
          }
          seenUrls.add(pdfUrl);

          // Get title
          const title =
            tituloCell.text?.trim() || `Diário Oficial ${editionNumber}`;

          // Check if it's an extra edition
          const isExtraEdition =
            title.toLowerCase().includes("extra") ||
            title.toLowerCase().includes("suplemento");

          gazettes.push({
            date,
            fileUrl: pdfUrl,
            territoryId: this.spiderConfig.territoryId,
            editionNumber,
            power: "executive_legislative",
            isExtraEdition,
            scrapedAt: getCurrentTimestamp(),
          });

          logger.debug(`Found gazette: ${editionNumber} - ${date} - ${pdfUrl}`);
        } catch (error) {
          logger.error(`Error processing row:`, error as Error);
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
}
