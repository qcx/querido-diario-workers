import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig } from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";

interface PrefeiturapalotinaConfig {
  type: "prefeiturapalotina";
  baseUrl: string;
}

interface PalotinaEdition {
  edicao: string;
  dataAtualizacao: string;
  data: string;
  edicaoExtra: string | null;
  descricao: string;
}

/**
 * Spider for Palotina PR official gazette
 * Platform: siteparaprefeituras.com.br
 *
 * API: GET /portal/dados-abertos/diario-oficial/{YEAR}
 * Response: { "dados": [{ "edicao", "data", "edicaoExtra", ... }] }
 *
 * PDF resolution: the download page at /portal/download/diario-oficial/{edicao}/
 * returns a meta-refresh chain that resolves to the actual PDF path under /uploads/.
 * We need to follow the www redirect and parse the meta-refresh to get the real PDF URL.
 */
export class PrefeiturapalotinaSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeiturapalotinaConfig;
    this.baseUrl = platformConfig.baseUrl;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Palotina gazette for ${this.config.name}...`);

    try {
      const startYear = this.startDate.getFullYear();
      const endYear = this.endDate.getFullYear();

      for (let year = startYear; year <= endYear; year++) {
        await this.crawlYear(year, gazettes);
      }

      logger.info(
        `Found ${gazettes.length} gazette(s) for ${this.config.name}`,
      );
    } catch (error) {
      logger.error(`Error crawling Palotina gazette: ${error}`);
    }

    return gazettes;
  }

  private async crawlYear(year: number, gazettes: Gazette[]): Promise<void> {
    const apiUrl = `${this.baseUrl.replace(/\/diario-oficial\/?$/, "")}/dados-abertos/diario-oficial/${year}`;
    logger.info(`Fetching Palotina API for year ${year}: ${apiUrl}`);

    try {
      const response = await fetch(apiUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        logger.warn(
          `Failed to fetch Palotina API for year ${year}: ${response.status}`,
        );
        return;
      }

      const contentType = response.headers.get("content-type") || "";
      let data: any;

      if (contentType.includes("json")) {
        data = await response.json();
      } else {
        const text = await response.text();
        try {
          data = JSON.parse(text);
        } catch {
          logger.warn(`Non-JSON response for Palotina year ${year}`);
          return;
        }
      }

      const editions: PalotinaEdition[] = Array.isArray(data)
        ? data
        : data?.dados || [];

      for (const edition of editions) {
        try {
          const dateStr = edition.data;
          if (!dateStr) continue;

          const gazetteDate = dateStr.substring(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(gazetteDate)) continue;

          const editionDate = new Date(gazetteDate);
          if (editionDate < this.startDate || editionDate > this.endDate)
            continue;

          const pdfUrl = await this.resolvePdfUrl(edition.edicao);
          if (!pdfUrl) {
            logger.warn(
              `Could not resolve PDF URL for edition ${edition.edicao}`,
            );
            continue;
          }

          gazettes.push({
            date: gazetteDate,
            fileUrl: pdfUrl,
            territoryId: this.config.territoryId,
            scrapedAt: new Date().toISOString(),
            editionNumber: edition.edicao,
            isExtraEdition: edition.edicaoExtra === "S",
            power: "executive",
          });
        } catch (err) {
          logger.warn(`Error parsing Palotina edition: ${err}`);
        }
      }
    } catch (error) {
      logger.error(`Error fetching Palotina API: ${error}`);
    }
  }

  private async resolvePdfUrl(edicao: string): Promise<string | null> {
    const wwwBase = this.baseUrl
      .replace(/\/diario-oficial\/?$/, "")
      .replace("://palotina.", "://www.palotina.");
    const downloadUrl = `${wwwBase}/download/diario-oficial/${edicao}/`;

    try {
      const response = await fetch(downloadUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        redirect: "follow",
      });

      if (!response.ok) return null;

      const html = await response.text();
      const match = html.match(/url=([^"'\s>]+\.pdf[^"'\s>]*)/i);

      if (match) {
        const pdfPath = match[1];
        if (pdfPath.startsWith("http")) return pdfPath;
        const origin = new URL(downloadUrl).origin;
        return `${origin}${pdfPath.startsWith("/") ? "" : "/"}${pdfPath}`;
      }

      return null;
    } catch (error) {
      logger.warn(`Error resolving PDF for edition ${edicao}: ${error}`);
      return null;
    }
  }
}
