import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig, DOMWordPressConfig } from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
import { getCurrentTimestamp } from "../../utils/date-utils";

interface DOMWordPressItem {
  numero_diario: string;
  data_publicacao: string;
  origem_diario: string;
  tamanho: string;
  baixar: string;
  retificacao: string;
  termo_conteudo: string;
  timestamp: boolean;
}

interface DOMWordPressResponse {
  data: DOMWordPressItem[];
}

/**
 * Spider for DOM WordPress platform (Portal da Transparência 2020 theme)
 *
 * Platform: WordPress with custom "portaldatransparencia2020" theme
 *
 * Used by: Urbano Santos-MA (dom.urbanosantos.ma.gov.br)
 *
 * API endpoint: /wp-json/wp/v2/diarios?post_type=diariooficial
 *
 * The API returns a JSON object with a "data" array containing gazette items.
 * Each item has:
 * - numero_diario: Edition number (e.g., "Volume VII - Nº 577/2024")
 * - data_publicacao: Date in DD/MM/YYYY format
 * - origem_diario: Source (e.g., "Poder Executivo")
 * - baixar: HTML with download link containing PDF URL in onclick handler
 */
export class DOMWordPressSpider extends BaseSpider {
  protected config: DOMWordPressConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as DOMWordPressConfig;

    if (!this.config.baseUrl) {
      throw new Error(
        `DOMWordPressSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing DOMWordPressSpider for ${spiderConfig.name} with URL: ${this.config.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.config.baseUrl} for ${this.spiderConfig.name}...`,
    );

    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();

    try {
      // Fetch all gazettes from the API
      const apiUrl = `${this.config.baseUrl}/wp-json/wp/v2/diarios?post_type=diariooficial`;

      logger.info(`Fetching gazettes from: ${apiUrl}`);

      const response = await fetch(apiUrl, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch gazettes: ${response.status} ${response.statusText}`,
        );
      }

      const data: DOMWordPressResponse = await response.json();

      if (!data.data || !Array.isArray(data.data)) {
        logger.warn(`Invalid response format from ${apiUrl}`);
        return gazettes;
      }

      logger.info(`Found ${data.data.length} total gazettes in API response`);

      for (const item of data.data) {
        try {
          // Parse date from DD/MM/YYYY format
          const dateMatch = item.data_publicacao.match(
            /(\d{2})\/(\d{2})\/(\d{4})/,
          );
          if (!dateMatch) {
            logger.debug(
              `Skipping gazette with invalid date: ${item.data_publicacao}`,
            );
            continue;
          }

          const [, day, month, year] = dateMatch;
          const date = `${year}-${month}-${day}`;

          // Check if date is in range
          if (!this.isInDateRange(new Date(date))) {
            continue;
          }

          // Extract PDF URL from the "baixar" HTML field
          // Format: onclick="CenterWindow(1000,800,50,'https://dom.urbanosantos.ma.gov.br/wp-content/uploads/2024/10/DOM-577.pdf','demo_win');"
          const pdfUrlMatch = item.baixar.match(
            /CenterWindow\([^']*,'([^']+\.pdf)'/,
          );
          if (!pdfUrlMatch) {
            logger.debug(
              `Skipping gazette without PDF URL: ${item.numero_diario}`,
            );
            continue;
          }

          const pdfUrl = pdfUrlMatch[1];

          // Avoid duplicates
          if (seenUrls.has(pdfUrl)) {
            continue;
          }
          seenUrls.add(pdfUrl);

          // Extract edition number from numero_diario
          // Format: "Volume VII - Nº 577/2024"
          let editionNumber: string | undefined;
          const editionMatch = item.numero_diario.match(/N[ºo°]\s*(\d+)/i);
          if (editionMatch) {
            editionNumber = editionMatch[1];
          }

          // Determine power based on origem_diario
          let power: "executive" | "legislative" | "executive_legislative" =
            "executive";
          if (item.origem_diario) {
            const origem = item.origem_diario.toLowerCase();
            if (origem.includes("legislativo")) {
              power = "legislative";
            } else if (
              origem.includes("executivo") &&
              origem.includes("legislativo")
            ) {
              power = "executive_legislative";
            }
          }

          // Check if it's a rectification
          const isExtraEdition =
            item.retificacao !== "" && item.retificacao !== null;

          gazettes.push({
            date,
            fileUrl: pdfUrl,
            territoryId: this.spiderConfig.territoryId,
            editionNumber,
            power,
            isExtraEdition,
            scrapedAt: getCurrentTimestamp(),
          });

          logger.debug(
            `Found gazette: ${item.numero_diario} - ${date} - ${pdfUrl}`,
          );
        } catch (error) {
          logger.error(`Error processing gazette item:`, error as Error);
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
