import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig, AplusConfig } from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";

/**
 * Spider for Aplus platform (AgenciaPlus)
 * Used by cities in Maranhão (Codó, Bacabal, Coroatá)
 *
 * Platform structure:
 * - Main page at baseUrl with date filter form
 * - POST with data={start}&data2={end}&termo= returns filtered results
 * - Table rows with: edition number, date (DD/MM/YYYY), PDF link
 * - PDFs at: {baseUrl}/DOM/DOM{YYYYMMDD}.pdf (or -a suffix for extra editions)
 */
export class AplusSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as AplusConfig;
    this.baseUrl = platformConfig.baseUrl;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Aplus for ${this.config.name}...`);

    try {
      // Format dates as YYYY-MM-DD (site accepts this format)
      const startDate = this.dateRange.start;
      const endDate = this.dateRange.end;

      const formData = new URLSearchParams({
        data: startDate,
        data2: endDate,
        termo: "",
      });

      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      });

      if (!response.ok) {
        logger.warn(`Failed to fetch Aplus data: ${response.status}`);
        return gazettes;
      }

      const html = await response.text();

      // Parse table rows - AgenciaPlus uses a specific table structure
      const rowMatches = html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);

      for (const match of rowMatches) {
        const rowHtml = match[1];

        // Skip header and empty rows
        if (
          rowHtml.includes("Nenhum registro encontrado") ||
          rowHtml.includes("<th")
        ) {
          continue;
        }

        // Extract PDF URL directly - look for links to .pdf files
        const pdfUrlMatch = rowHtml.match(/href=['"]([^'"]*\.pdf)['"]/i);
        if (!pdfUrlMatch) continue;

        const fileUrl = pdfUrlMatch[1].startsWith("http")
          ? pdfUrlMatch[1]
          : new URL(pdfUrlMatch[1], this.baseUrl).href;

        // Extract date from the row (format: DD/MM/YYYY)
        const dateTextMatch = rowHtml.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (!dateTextMatch) {
          // Try to extract date from PDF URL (format: DOMYYYYMMDD.pdf)
          const pdfDateMatch = fileUrl.match(/DOM(\d{4})(\d{2})(\d{2})/);
          if (!pdfDateMatch) continue;

          const [, year, month, day] = pdfDateMatch;
          const date = `${year}-${month}-${day}`;

          // Check if extra edition (URL contains -a, -b, etc.)
          const isExtraEdition = /-[a-z]\.pdf$/i.test(fileUrl);

          // Extract edition number from row if available
          const editionMatch = rowHtml.match(/Nº\.?\s*(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;

          gazettes.push({
            date,
            editionNumber,
            fileUrl,
            territoryId: this.config.territoryId,
            isExtraEdition,
            power: "executive",
            scrapedAt: new Date().toISOString(),
          });
          continue;
        }

        const [, day, month, year] = dateTextMatch;
        const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;

        // Extract edition number (look for "Nº. XXX" pattern)
        const editionMatch = rowHtml.match(/Nº\.?\s*(\d+)/i);
        const editionNumber = editionMatch ? editionMatch[1] : undefined;

        // Check if extra edition (URL contains -a, -b, etc.)
        const isExtraEdition = /-[a-z]\.pdf$/i.test(fileUrl);

        gazettes.push({
          date,
          editionNumber,
          fileUrl,
          territoryId: this.config.territoryId,
          isExtraEdition,
          power: "executive",
          scrapedAt: new Date().toISOString(),
        });
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes from Aplus`,
      );
    } catch (error) {
      logger.error(`Error crawling Aplus: ${error}`);
      throw error;
    }

    return gazettes;
  }
}
