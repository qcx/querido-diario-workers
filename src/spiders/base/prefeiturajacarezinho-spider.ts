import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig } from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
import * as cheerio from "cheerio";

interface PrefeituraJacarezinhoConfig {
  type: "prefeiturajacarezinho";
  baseUrl: string;
}

/**
 * Spider for Jacarezinho PR official gazette
 * Platform: Portyx (jacarezinho.pr.gov.br/diario-oficial)
 *
 * Structure: HTML table with year-based pagination
 * Table ID: listagem-itens
 * Columns: Número/Ano | Categoria | Data Publicação | Arquivo PDF
 * Year filter: index.php?ano=YYYY
 * PDF pattern: /uploads/diarioOficial/diario-DDMMYYYY.pdf
 */
export class PrefeiturajacarezinhoSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraJacarezinhoConfig;
    this.baseUrl = platformConfig.baseUrl;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Jacarezinho gazette for ${this.config.name}...`);

    try {
      const startYear = new Date(this.startDate).getFullYear();
      const endYear = new Date(this.endDate).getFullYear();

      for (let year = startYear; year <= endYear; year++) {
        const url = `${this.baseUrl}/index.php?ano=${year}`;
        logger.info(`Fetching year ${year}: ${url}`);

        const response = await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });

        if (!response.ok) {
          logger.warn(`Failed to fetch year ${year}: ${response.status}`);
          continue;
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        $(
          'table#listagem-itens tbody tr, table[name="listagem-itens"] tbody tr',
        ).each((_i, row) => {
          try {
            const cols = $(row).find("td");
            if (cols.length < 4) return;

            const dateText = $(cols[2]).text().trim();
            const pdfLink = $(cols[3]).find("a").attr("href")?.trim();

            if (!dateText || !pdfLink) return;

            const [day, month, yearStr] = dateText.split("/");
            if (!day || !month || !yearStr) return;

            const gazetteDate = `${yearStr.trim()}-${month.trim().padStart(2, "0")}-${day.trim().padStart(2, "0")}`;

            if (gazetteDate < this.startDate || gazetteDate > this.endDate)
              return;

            const pdfUrl = pdfLink.startsWith("http")
              ? pdfLink
              : `https://jacarezinho.pr.gov.br${pdfLink.startsWith("/") ? "" : "/"}${pdfLink}`;

            const edition = $(cols[0]).text().trim();
            const category = $(cols[1]).text().trim();
            const isExtra = category.toLowerCase().includes("extra");

            gazettes.push({
              date: gazetteDate,
              fileUrl: pdfUrl,
              territoryId: this.config.territoryId,
              editionNumber: edition,
              isExtraEdition: isExtra,
              power: "executive",
              scrapedAt: new Date().toISOString(),
            });
          } catch (err) {
            logger.warn(`Error parsing row: ${err}`);
          }
        });
      }

      logger.info(
        `Found ${gazettes.length} gazette(s) for ${this.config.name}`,
      );
    } catch (error) {
      logger.error(`Error crawling Jacarezinho gazette: ${error}`);
    }

    return gazettes;
  }
}
