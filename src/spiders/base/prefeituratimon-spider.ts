import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig, PrefeituraTimonConfig } from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse } from "node-html-parser";
import { toISODate } from "../../utils/date-utils";

/**
 * Spider for Prefeitura de Timon
 *
 * The site uses ScriptCase with iframes that contain editions.
 * Main page: https://www.timon.ma.gov.br/diario-oficial/
 * Executivo iframe: https://timon.ma.gov.br/diario-oficial/diario_executivo/publicacao_executivo/
 * Legislativo iframe: https://timon.ma.gov.br/diario-oficial/diario_legislativo/publicacao_legislativo/
 *
 * PDF URL pattern:
 * - https://timon.ma.gov.br/diario-oficial/administrador/_lib/file/doc/Diário Executivo DD.MM.YYYY.pdf
 * - https://timon.ma.gov.br/diario-oficial/administrador/_lib/file/doc/Diário Executivo Extra DD.MM.YYYY.pdf
 * - https://timon.ma.gov.br/diario-oficial/administrador/_lib/file/doc/Diário Legislativo DD.MM.YYYY.pdf
 */
export class PrefeituraTimonSpider extends BaseSpider {
  protected config: PrefeituraTimonConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeituraTimonConfig;

    if (!this.config.baseUrl) {
      throw new Error(
        `PrefeituraTimonSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeituraTimonSpider for ${spiderConfig.name} with URL: ${this.config.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    // Fetch both Executivo and Legislativo editions
    const endpoints = [
      {
        url: "https://timon.ma.gov.br/diario-oficial/diario_executivo/publicacao_executivo/",
        type: "executivo",
      },
      {
        url: "https://timon.ma.gov.br/diario-oficial/diario_legislativo/publicacao_legislativo/",
        type: "legislativo",
      },
    ];

    for (const endpoint of endpoints) {
      try {
        logger.info(`Fetching ${endpoint.type} editions from ${endpoint.url}`);
        const editionsGazettes = await this.fetchEditions(
          endpoint.url,
          endpoint.type,
        );
        gazettes.push(...editionsGazettes);
      } catch (error) {
        logger.error(
          `Error fetching ${endpoint.type} editions:`,
          error as Error,
        );
      }
    }

    logger.info(
      `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
    );

    return gazettes;
  }

  private async fetchEditions(url: string, type: string): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      const response = await fetch(url, {
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
        logger.error(`Failed to fetch ${url}: ${response.status}`);
        return gazettes;
      }

      const html = await response.text();
      const root = parse(html);

      // Find all PDF links in the HTML
      // Pattern: href='https://timon.ma.gov.br/diario-oficial/administrador/_lib/file/doc/Diário Executivo 26.01.2026.pdf'
      const pdfLinks = root.querySelectorAll('a[href*=".pdf"]');

      for (const link of pdfLinks) {
        const href = link.getAttribute("href");
        if (!href || !href.includes("/administrador/_lib/file/doc/")) {
          continue;
        }

        const gazette = this.parseGazetteFromUrl(href);
        if (gazette && this.isInDateRange(new Date(gazette.date))) {
          gazettes.push(gazette);
        }
      }

      // Also try to extract from span elements with file names
      const fileNameSpans = root.querySelectorAll(
        'span[id^="id_sc_field_pub_arquivo"]',
      );
      for (const span of fileNameSpans) {
        const fileName = span.text?.trim();
        if (!fileName || !fileName.endsWith(".pdf")) {
          continue;
        }

        const pdfUrl = `https://timon.ma.gov.br/diario-oficial/administrador/_lib/file/doc/${fileName}`;
        const gazette = this.parseGazetteFromUrl(pdfUrl);
        if (gazette && this.isInDateRange(new Date(gazette.date))) {
          // Avoid duplicates
          if (!gazettes.some((g) => g.fileUrl === gazette.fileUrl)) {
            gazettes.push(gazette);
          }
        }
      }

      logger.debug(`Found ${gazettes.length} ${type} gazettes from ${url}`);
    } catch (error) {
      logger.error(`Error parsing ${url}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Parse gazette information from PDF URL
   * Example URL: https://timon.ma.gov.br/diario-oficial/administrador/_lib/file/doc/Diário Executivo 26.01.2026.pdf
   */
  private parseGazetteFromUrl(pdfUrl: string): Gazette | null {
    try {
      // Decode URL-encoded characters
      const decodedUrl = decodeURIComponent(pdfUrl);

      // Extract date from filename
      // Pattern: DD.MM.YYYY or DD.MM.YYYY(N) (for duplicates)
      const dateMatch = decodedUrl.match(
        /(\d{2})\.(\d{2})\.(\d{4})(?:\(\d+\))?\.pdf$/i,
      );
      if (!dateMatch) {
        logger.debug(`Could not parse date from URL: ${pdfUrl}`);
        return null;
      }

      const [, day, month, year] = dateMatch;
      const gazetteDate = new Date(`${year}-${month}-${day}`);

      if (isNaN(gazetteDate.getTime())) {
        logger.debug(`Invalid date parsed from URL: ${pdfUrl}`);
        return null;
      }

      // Check if older than date range
      if (gazetteDate < new Date(this.dateRange.start)) {
        return null;
      }

      // Determine if it's an extra edition
      const isExtraEdition =
        decodedUrl.toLowerCase().includes("extra") ||
        decodedUrl.toLowerCase().includes("suplementar");

      // Determine power (executive vs legislative)
      const isLegislative = decodedUrl.toLowerCase().includes("legislativo");
      const power = isLegislative ? "legislative" : "executive";

      return {
        date: toISODate(gazetteDate),
        fileUrl: pdfUrl,
        territoryId: this.spiderConfig.territoryId,
        isExtraEdition,
        power,
        scrapedAt: new Date().toISOString(),
      };
    } catch (error) {
      logger.error(`Error parsing gazette from URL ${pdfUrl}:`, error as Error);
      return null;
    }
  }
}
