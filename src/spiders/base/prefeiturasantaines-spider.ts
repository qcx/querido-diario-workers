import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  PrefeiturasantainesConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse, HTMLElement } from "node-html-parser";

/**
 * Spider for Prefeitura de Santa Inês - MA
 *
 * Site: santaines.ma.gov.br/diariooficial
 *
 * Gestor Web platform with:
 * - Edition listing at /diariooficial/edicoes-anteriores
 * - Each edition page at /diariooficial/edicao/{number}
 * - PDF download at /diariooficial/getFile/{number}/{hash}?download=true
 *
 * Table structure on edicoes-anteriores page:
 * | Edição Nº | Total de Páginas | Resumo | Data |
 *
 * Date format in table: "Quinta-Feira, 29 - Janeiro - 2026"
 */
export class PrefeiturasantainesSpider extends BaseSpider {
  protected config: PrefeiturasantainesConfig;
  private readonly EDITIONS_URL: string;
  private readonly MONTH_MAP: Record<string, string> = {
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

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeiturasantainesConfig;

    if (!this.config.baseUrl) {
      throw new Error(
        `PrefeiturasantainesSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    // Build the editions URL from baseUrl
    const baseUrl = new URL(this.config.baseUrl);
    this.EDITIONS_URL = `${baseUrl.origin}/diariooficial/edicoes-anteriores`;

    logger.info(
      `Initializing PrefeiturasantainesSpider for ${spiderConfig.name} with URL: ${this.EDITIONS_URL}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.EDITIONS_URL} for ${this.spiderConfig.name}...`,
    );

    const gazettes: Gazette[] = [];

    try {
      // Fetch the editions listing page
      const response = await fetch(this.EDITIONS_URL, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      });

      if (!response.ok) {
        logger.error(
          `Failed to fetch editions page: ${response.status} ${response.statusText}`,
        );
        return gazettes;
      }

      const html = await response.text();
      const root = parse(html);
      const baseUrl = new URL(this.EDITIONS_URL);

      // Find the table with editions
      const table = root.querySelector("table");
      if (!table) {
        logger.warn("Could not find editions table on page");
        return gazettes;
      }

      // Get all rows (skip header)
      const rows = table.querySelectorAll("tbody tr, tr");
      logger.debug(`Found ${rows.length} table rows`);

      for (const row of rows) {
        const cells = row.querySelectorAll("td");
        if (cells.length < 4) continue; // Skip header or invalid rows

        try {
          // Cell 0: Edition link (e.g., "Volume 6, Nº 999/2026")
          // Cell 1: Total de Páginas
          // Cell 2: Resumo (Ver sumário link)
          // Cell 3: Data (e.g., "Quinta-Feira, 29 - Janeiro - 2026")

          const editionCell = cells[0];
          const dateCell = cells[3];

          const editionLink = editionCell.querySelector("a");
          if (!editionLink) continue;

          const editionHref = editionLink.getAttribute("href");
          const editionText = editionLink.text?.trim() || "";
          const dateText = dateCell.text?.trim() || "";

          // Parse edition number from text like "Volume 6, Nº 999/2026" or "Volume 6, Nº 995-A/2026"
          const editionMatch = editionText.match(/Nº\s*([\d\-A-Z]+)\/\d{4}/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;

          // Parse date from text like "Quinta-Feira, 29 - Janeiro - 2026"
          const date = this.parseBrazilianDate(dateText);
          if (!date) {
            logger.debug(`Could not parse date from: ${dateText}`);
            continue;
          }

          // Check if date is in range
          if (!this.isInDateRange(new Date(date))) {
            logger.debug(
              `Edition ${editionNumber} (${date}) outside date range, skipping`,
            );
            continue;
          }

          // Now we need to fetch the edition page to get the PDF URL with hash
          if (editionHref) {
            const editionUrl = editionHref.startsWith("http")
              ? editionHref
              : `${baseUrl.origin}${editionHref}`;

            const gazette = await this.fetchEditionPdfUrl(
              editionUrl,
              date,
              editionNumber,
              baseUrl.origin,
            );

            if (gazette) {
              gazettes.push(gazette);
              logger.debug(
                `Found gazette: Edition ${editionNumber}, Date: ${date}`,
              );
            }
          }
        } catch (rowError) {
          logger.debug(`Error processing row: ${rowError}`);
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

  /**
   * Parse Brazilian date format like "Quinta-Feira, 29 - Janeiro - 2026"
   * Returns ISO date string (YYYY-MM-DD) or null if parsing fails
   */
  private parseBrazilianDate(dateText: string): string | null {
    try {
      // Pattern: "Dia-da-Semana, DD - MêsPorExtenso - YYYY"
      const match = dateText.match(
        /(\d{1,2})\s*-\s*([A-Za-zç]+)\s*-\s*(\d{4})/i,
      );
      if (!match) return null;

      const [, day, monthName, year] = match;
      const month = this.MONTH_MAP[monthName.toLowerCase()];
      if (!month) return null;

      return `${year}-${month}-${day.padStart(2, "0")}`;
    } catch {
      return null;
    }
  }

  /**
   * Fetch the edition page to extract the PDF URL with hash
   */
  private async fetchEditionPdfUrl(
    editionUrl: string,
    date: string,
    editionNumber: string | undefined,
    origin: string,
  ): Promise<Gazette | null> {
    try {
      // Clean the URL (remove #page= fragment if present)
      const cleanUrl = editionUrl.split("#")[0];

      const response = await fetch(cleanUrl, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      });

      if (!response.ok) {
        logger.debug(
          `Failed to fetch edition page ${cleanUrl}: ${response.status}`,
        );
        return null;
      }

      const html = await response.text();
      const root = parse(html);

      // Look for the "Baixar PDF" link
      // Pattern: /diariooficial/getFile/{number}/{hash}?download=true
      const pdfLink = root.querySelector('a[href*="getFile"]');
      if (!pdfLink) {
        // Try alternative patterns
        const allLinks = root.querySelectorAll("a");
        for (const link of allLinks) {
          const href = link.getAttribute("href");
          const text = link.text?.toLowerCase() || "";
          if (
            href &&
            (text.includes("baixar") ||
              text.includes("download") ||
              text.includes("pdf"))
          ) {
            if (href.includes("getFile") || href.includes(".pdf")) {
              const fullUrl = href.startsWith("http")
                ? href
                : `${origin}${href}`;
              // Edition numbers with "-A", "-B" etc. are extra editions
              const isExtraEdition = editionNumber
                ? /[-][A-Z]$/i.test(editionNumber)
                : false;
              return {
                date,
                fileUrl: fullUrl,
                territoryId: this.spiderConfig.territoryId,
                editionNumber,
                power: "executive",
                isExtraEdition,
                scrapedAt: new Date().toISOString(),
              };
            }
          }
        }
        logger.debug(`Could not find PDF link on edition page ${cleanUrl}`);
        return null;
      }

      const pdfHref = pdfLink.getAttribute("href");
      if (!pdfHref) return null;

      const fullUrl = pdfHref.startsWith("http")
        ? pdfHref
        : `${origin}${pdfHref}`;

      // Edition numbers with "-A", "-B" etc. are extra editions
      const isExtraEdition = editionNumber
        ? /[-][A-Z]$/i.test(editionNumber)
        : false;

      return {
        date,
        fileUrl: fullUrl,
        territoryId: this.spiderConfig.territoryId,
        editionNumber,
        power: "executive",
        isExtraEdition,
        scrapedAt: new Date().toISOString(),
      };
    } catch (error) {
      logger.debug(`Error fetching edition page ${editionUrl}: ${error}`);
      return null;
    }
  }
}
