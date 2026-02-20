import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";
import { toISODate, getCurrentTimestamp } from "../../utils/date-utils";

/**
 * Configuration for Directus Portal spider
 */
export interface DirectusPortalConfig {
  type: "directus_portal";
  /** API base URL (e.g., https://app.bodoco.pe.gov.br/) */
  apiBase: string;
  /** API token for authorization */
  apiToken: string;
  /** City ID in the system */
  cityId: string;
  /** Collection name for gazettes (default: "edicao") */
  collection?: string;
  /** Public portal base URL for gazette pages */
  portalBaseUrl: string;
}

interface DirectusEdition {
  id: string;
  status: string;
  DOM: number;
  data_edicao: string;
  data_publicacao: string;
  exercicio: string;
  arquivo?: string;
  esfera?: string;
}

interface DirectusResponse {
  data: DirectusEdition[];
}

/**
 * DirectusPortalSpider implementation
 *
 * Crawls municipal gazette portals built on Directus CMS.
 * These portals use a REST API to fetch gazette editions.
 *
 * Known municipalities using this platform:
 * - Bodocó - PE (https://bodoco.pe.gov.br/diario-oficial)
 */
export class DirectusPortalSpider extends BaseSpider {
  private readonly directusConfig: DirectusPortalConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.directusConfig = spiderConfig.config as DirectusPortalConfig;

    logger.info(
      `Initializing DirectusPortalSpider for ${spiderConfig.name} with API: ${this.directusConfig.apiBase}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling Directus portal from ${toISODate(this.startDate)} to ${toISODate(this.endDate)}...`,
    );

    const gazettes: Gazette[] = [];

    try {
      const collection = this.directusConfig.collection || "edicao";
      const startDateStr = toISODate(this.startDate);
      const endDateStr = toISODate(this.endDate);

      // Build filter for date range and city
      const filter = {
        _and: [
          { cidade: { _eq: this.directusConfig.cityId } },
          { data_publicacao: { _gte: startDateStr } },
          { data_publicacao: { _lte: endDateStr } },
          { status: { _eq: "published" } },
        ],
      };

      const url = new URL(`items/${collection}`, this.directusConfig.apiBase);
      url.searchParams.set("fields", "*");
      url.searchParams.set("filter", JSON.stringify(filter));
      url.searchParams.set("sort", "-data_publicacao");
      url.searchParams.set("limit", "100");

      logger.debug(`Fetching from Directus API: ${url.toString()}`);

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${this.directusConfig.apiToken}`,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        logger.error(
          `Directus API error: ${response.status} ${response.statusText}`,
        );
        return [];
      }

      const data: DirectusResponse = await response.json();

      logger.debug(`Found ${data.data.length} editions from Directus API`);

      for (const edition of data.data) {
        // Build the public URL for this edition
        const gazetteUrl = `${this.directusConfig.portalBaseUrl}/${edition.DOM}?exercicio=${edition.exercicio}`;

        // If there's a PDF file, we can also provide a direct download URL
        const fileUrl = edition.arquivo
          ? `${this.directusConfig.apiBase}assets/${edition.arquivo}`
          : gazetteUrl;

        gazettes.push({
          date: edition.data_publicacao,
          fileUrl: fileUrl,
          territoryId: this.spiderConfig.territoryId,
          scrapedAt: getCurrentTimestamp(),
          isExtraEdition: false,
          power:
            edition.esfera?.toLowerCase() === "legislativo"
              ? "legislative"
              : "executive_legislative",
          sourceText: `Diário Oficial Municipal - Edição ${edition.DOM}/${edition.exercicio}`,
          editionNumber: edition.DOM.toString(),
        });
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes from Directus portal`,
      );
    } catch (error) {
      logger.error(`Error crawling Directus portal:`, error as Error);
    }

    return gazettes;
  }
}
