import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  PrefeiturasantanaapConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
import { getCurrentTimestamp } from "../../utils/date-utils";

interface SantanaGazetteItem {
  numero: string;
  id: number;
  tipo: string;
  link: string;
  titulo: string;
  circulacao: string;
  exercicio: string;
  data: string;
  arquivo: string;
}

interface SantanaApiResponse {
  data: SantanaGazetteItem[];
}

/**
 * Spider for Prefeitura de Santana-AP gazette portal
 *
 * Site: https://santana.ap.gov.br/diario-oficial/
 *
 * The site uses DataTables with a JSON API endpoint:
 * /wp-admin/admin-ajax.php?action=datatables_endpoint
 *
 * API Response format:
 * {
 *   "data": [
 *     {
 *       "numero": "2224",
 *       "id": 43601,
 *       "tipo": "diario-oficial",
 *       "link": "https://santana.ap.gov.br/diario-oficial/d-o-m-no-2224/",
 *       "titulo": "D.O.M. – No 2224",
 *       "circulacao": "30 de janeiro de 2026",
 *       "exercicio": "2026",
 *       "data": "30/01/2026",
 *       "arquivo": "<a href='https://santana.ap.gov.br/wp-content/uploads/2026/01/DOM-2224.pdf'>Baixar</a> | ..."
 *     }
 *   ]
 * }
 */
export class PrefeiturasantanaapSpider extends BaseSpider {
  protected config: PrefeiturasantanaapConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeiturasantanaapConfig;

    if (!this.config.baseUrl) {
      throw new Error(
        `PrefeiturasantanaapSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeiturasantanaapSpider for ${spiderConfig.name} with URL: ${this.config.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.config.baseUrl} for ${this.spiderConfig.name}...`,
    );

    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();

    try {
      // Build API URL
      const baseUrlObj = new URL(this.config.baseUrl);
      const apiUrl = `${baseUrlObj.origin}/wp-admin/admin-ajax.php?action=datatables_endpoint`;

      logger.info(`Fetching gazettes from API: ${apiUrl}`);

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
          `Failed to fetch API: ${response.status} ${response.statusText}`,
        );
      }

      const data: SantanaApiResponse = await response.json();

      if (!data.data || !Array.isArray(data.data)) {
        logger.warn(`Invalid response format from ${apiUrl}`);
        return gazettes;
      }

      logger.info(`Found ${data.data.length} total gazettes in API response`);

      for (const item of data.data) {
        try {
          // Parse date from DD/MM/YYYY format
          const dateMatch = item.data.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) {
            logger.debug(`Skipping gazette with invalid date: ${item.data}`);
            continue;
          }

          const [, day, month, year] = dateMatch;
          const date = `${year}-${month}-${day}`;
          const gazetteDate = new Date(date);

          // Check if date is in range
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }

          // Extract PDF URL from the "arquivo" HTML field
          // Format: <a href='https://santana.ap.gov.br/wp-content/uploads/2026/01/DOM-2224.pdf'>Baixar</a>
          const pdfUrlMatch = item.arquivo.match(/href='([^']+\.pdf)'/);
          if (!pdfUrlMatch) {
            logger.debug(`Skipping gazette without PDF URL: ${item.numero}`);
            continue;
          }

          const pdfUrl = pdfUrlMatch[1];

          // Avoid duplicates
          if (seenUrls.has(pdfUrl)) {
            continue;
          }
          seenUrls.add(pdfUrl);

          // Check if it's an extra edition
          const isExtraEdition =
            item.titulo.toLowerCase().includes("extra") ||
            item.titulo.toLowerCase().includes("suplemento");

          gazettes.push({
            date,
            fileUrl: pdfUrl,
            territoryId: this.spiderConfig.territoryId,
            editionNumber: item.numero,
            power: "executive_legislative",
            isExtraEdition,
            scrapedAt: getCurrentTimestamp(),
          });

          logger.debug(`Found gazette: ${item.numero} - ${date} - ${pdfUrl}`);
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
