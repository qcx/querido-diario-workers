import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";
import { toISODate, getCurrentTimestamp } from "../../utils/date-utils";

/**
 * Configuration for Caruaru spider
 */
export interface PrefeituraCaruaruConfig {
  type: "prefeituracaruaru";
  /** Base URL for the diário oficial portal */
  baseUrl: string;
}

/**
 * JSON structure from the diariosJSON hidden input
 */
interface DiarioItem {
  id: number;
  dataEntrada: string; // YYYY-MM-DD
  dataFim: string;
  thumb: string;
  resumo: string;
  status: number;
  arquivo_id: number;
  usuario_id: number;
  data: string; // DD/MM/YYYY
  arquivo: {
    id: number;
    date: string;
    name: string;
    status: number;
    url: string; // e.g., "/diario/Diario Oficial 2497.pdf"
    nome: string;
  };
}

/**
 * PrefeituraCaruaruSpider implementation
 *
 * Crawls the custom Diário Oficial portal for Caruaru - PE.
 * The portal provides a JSON dataset embedded in a hidden input field (diariosJSON).
 *
 * Search is done via GET parameters: ?dataInicio=DD/MM/YYYY&dataFim=DD/MM/YYYY
 *
 * Example: https://diariooficial.caruaru.pe.gov.br/?dataInicio=01/01/2026&dataFim=28/01/2026
 */
export class PrefeituraCaruaruSpider extends BaseSpider {
  private readonly caruaruConfig: PrefeituraCaruaruConfig;
  private readonly baseUrl: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.caruaruConfig = spiderConfig.config as PrefeituraCaruaruConfig;
    this.baseUrl =
      this.caruaruConfig.baseUrl || "https://diariooficial.caruaru.pe.gov.br";

    logger.info(
      `Initializing PrefeituraCaruaruSpider for ${spiderConfig.name}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling Caruaru from ${toISODate(this.startDate)} to ${toISODate(this.endDate)}...`,
    );
    const gazettes: Gazette[] = [];

    try {
      // Format dates for the search URL (DD/MM/YYYY)
      const startDateFormatted = this.formatDateBR(this.startDate);
      const endDateFormatted = this.formatDateBR(this.endDate);

      // Build the search URL with GET parameters
      const searchUrl = `${this.baseUrl}/?dataInicio=${encodeURIComponent(startDateFormatted)}&dataFim=${encodeURIComponent(endDateFormatted)}`;

      logger.debug(`Fetching: ${searchUrl}`);

      const response = await fetch(searchUrl, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        },
      });

      if (!response.ok) {
        logger.error(
          `Failed to fetch Caruaru page: ${response.status} ${response.statusText}`,
        );
        return gazettes;
      }

      const html = await response.text();

      // Extract the JSON from the hidden input with id="diariosJSON"
      // Pattern: <input type="hidden" id="diariosJSON" data-items='[...]' />
      const jsonPattern = /id="diariosJSON"\s+data-items='([^']*)'/;
      const match = html.match(jsonPattern);

      if (!match || !match[1]) {
        logger.warn("Could not find diariosJSON data in the page");
        return gazettes;
      }

      let diarios: DiarioItem[];
      try {
        diarios = JSON.parse(match[1]);
      } catch (parseError) {
        logger.error("Failed to parse diariosJSON:", parseError);
        return gazettes;
      }

      logger.info(`Found ${diarios.length} diários in the response`);

      // Process each diário
      for (const diario of diarios) {
        const gazette = this.parseGazetteFromDiario(diario);
        if (gazette) {
          gazettes.push(gazette);
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes from Caruaru`,
      );
    } catch (error) {
      logger.error(`Error crawling Caruaru:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Format date to Brazilian format DD/MM/YYYY
   */
  private formatDateBR(date: Date): string {
    const day = date.getDate().toString().padStart(2, "0");
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }

  /**
   * Parse gazette from the diário JSON item
   */
  private parseGazetteFromDiario(diario: DiarioItem): Gazette | null {
    try {
      // Get the date from dataEntrada (YYYY-MM-DD format)
      const isoDate = diario.dataEntrada;

      if (!isoDate || !diario.arquivo?.url) {
        logger.debug(
          `Skipping diário ${diario.id}: missing date or arquivo URL`,
        );
        return null;
      }

      // Check if date is in range
      const startDateStr = toISODate(this.startDate);
      const endDateStr = toISODate(this.endDate);

      if (isoDate < startDateStr || isoDate > endDateStr) {
        return null;
      }

      // Build the full PDF URL
      const pdfUrl = diario.arquivo.url.startsWith("http")
        ? diario.arquivo.url
        : `${this.baseUrl}${diario.arquivo.url}`;

      const title = diario.arquivo.nome || diario.arquivo.name || "";

      return {
        date: isoDate,
        fileUrl: pdfUrl,
        territoryId: this.spiderConfig.territoryId,
        scrapedAt: getCurrentTimestamp(),
        isExtraEdition: title.toLowerCase().includes("extra"),
        power: "executive_legislative",
        sourceText: title || `Diário Oficial de Caruaru - ${diario.data}`,
        editionNumber: this.extractEditionNumber(title),
      };
    } catch (err) {
      logger.debug(`Error parsing diário ${diario.id}:`, err);
      return null;
    }
  }

  /**
   * Extract edition number from title like "Diario Oficial 2497"
   */
  private extractEditionNumber(title: string): string | undefined {
    const match = title.match(/(\d+)/);
    return match ? match[1] : undefined;
  }
}
