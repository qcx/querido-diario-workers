import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange, SigpubConfig } from "../../types";
import { logger } from "../../utils/logger";
import { toISODate } from "../../utils/date-utils";

/**
 * SigpubSeSpider - Spider específico para o SIGPub de Sergipe (AMURCES)
 *
 * A plataforma SIGPub de Sergipe tem uma peculiaridade: a data no nome do arquivo PDF
 * (ex: 2009-12-09) NÃO é a data real da publicação. A data real está armazenada em
 * campos ocultos na página HTML (id="dia", id="mes", id="ano").
 *
 * Este spider extrai a data correta dos campos ocultos ao invés de usar a data do URL.
 *
 * URL: https://www.diariomunicipal.com.br/sergipe/
 */
export class SigpubSeSpider extends BaseSpider {
  protected sigpubConfig: SigpubConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.sigpubConfig = spiderConfig.config as SigpubConfig;
    const cityName = this.sigpubConfig.cityName || this.spiderConfig.name;
    logger.info(
      `Initializing SigpubSeSpider for ${cityName} with URL: ${this.sigpubConfig.url}, entityId: ${this.sigpubConfig.entityId}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    const cityName = this.sigpubConfig.cityName || this.spiderConfig.name;
    logger.info(
      `Crawling ${this.sigpubConfig.url} for ${cityName} (entityId: ${this.sigpubConfig.entityId})...`,
    );
    logger.warn(
      `Note: SIGPub uses consolidated PDFs. The gazette will contain all municipalities, not just ${cityName}.`,
    );

    try {
      return await this.crawlWithDirectUrls();
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return [];
  }

  /**
   * Crawl by extracting PDF URLs and the REAL publication date from hidden fields
   *
   * IMPORTANT: The date in the PDF filename (e.g., 2009-12-09) is NOT the publication date.
   * The real publication date is stored in hidden input fields (id="dia", id="mes", id="ano").
   */
  private async crawlWithDirectUrls(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const cityName = this.sigpubConfig.cityName || this.spiderConfig.name;
    const entityId = this.sigpubConfig.entityId;

    try {
      const response = await this.fetch(this.sigpubConfig.url);

      logger.debug(
        `Fetched HTML (first 500 chars): ${response.substring(0, 500)}`,
      );

      // Extract the REAL publication date from hidden input fields
      // The date in the PDF URL is NOT the publication date (it's an internal identifier)
      const dayMatch = response.match(
        /<input[^>]*id="dia"[^>]*value="(\d+)"[^>]*>/,
      );
      const monthMatch = response.match(
        /<input[^>]*id="mes"[^>]*value="(\d+)"[^>]*>/,
      );
      const yearMatch = response.match(
        /<input[^>]*id="ano"[^>]*value="(\d+)"[^>]*>/,
      );

      // Also try alternative attribute order (value before id)
      const dayMatchAlt = response.match(
        /<input[^>]*value="(\d+)"[^>]*id="dia"[^>]*>/,
      );
      const monthMatchAlt = response.match(
        /<input[^>]*value="(\d+)"[^>]*id="mes"[^>]*>/,
      );
      const yearMatchAlt = response.match(
        /<input[^>]*value="(\d+)"[^>]*id="ano"[^>]*>/,
      );

      const day = dayMatch?.[1] || dayMatchAlt?.[1];
      const month = monthMatch?.[1] || monthMatchAlt?.[1];
      const year = yearMatch?.[1] || yearMatchAlt?.[1];

      if (!day || !month || !year) {
        logger.warn(
          `Could not extract publication date from hidden fields. Day: ${day}, Month: ${month}, Year: ${year}`,
        );
      } else {
        logger.debug(
          `Extracted real publication date from hidden fields: ${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
        );
      }

      // Extract PDF URL from the page
      // Pattern: https://www-storage.voxtecnologia.com.br/?m=sigpub.publicacao&f=XXX&i=publicado_XXX_YYYY-MM-DD_hash.pdf
      const pdfUrlRegex =
        /https:\/\/www-storage\.voxtecnologia\.com\.br\/\?m=sigpub\.publicacao&f=(\d+)&i=publicado_(\d+)_(\d{4}-\d{2}-\d{2})_[a-f0-9]+\.pdf/g;

      const matches = response.matchAll(pdfUrlRegex);
      let matchCount = 0;
      const seenUrls = new Set<string>();

      for (const match of matches) {
        matchCount++;
        const url = match[0];
        const pdfAssociationId = match[1]; // The association ID in the PDF URL (e.g., "416" for Sergipe)
        const pdfEditionId = match[2];
        const urlDateStr = match[3]; // This is NOT the real date, just part of the filename

        // Avoid duplicate URLs
        if (seenUrls.has(url)) {
          continue;
        }
        seenUrls.add(url);

        // Use the REAL date from hidden fields, not the date in the URL
        let realDateStr: string;
        let gazetteDate: Date;

        if (day && month && year) {
          realDateStr = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
          gazetteDate = new Date(realDateStr + "T00:00:00.000Z");
        } else {
          // Fallback to URL date if hidden fields not found (shouldn't happen)
          realDateStr = urlDateStr;
          gazetteDate = new Date(urlDateStr + "T00:00:00.000Z");
          logger.warn(
            `Falling back to URL date ${urlDateStr} as hidden fields not found`,
          );
        }

        logger.debug(
          `Match ${matchCount}: Real Date ${realDateStr}, URL Date ${urlDateStr}, Association ID: ${pdfAssociationId}, Edition: ${pdfEditionId}`,
        );

        // Format date range for logging (handle both Date objects and strings)
        const startStr =
          this.dateRange.start instanceof Date
            ? toISODate(this.dateRange.start)
            : String(this.dateRange.start);
        const endStr =
          this.dateRange.end instanceof Date
            ? toISODate(this.dateRange.end)
            : String(this.dateRange.end);
        logger.debug(
          `Date range check: ${realDateStr} is in range ${startStr} to ${endStr}? ${this.isInDateRange(gazetteDate)}`,
        );

        if (this.isInDateRange(gazetteDate)) {
          const gazette = await this.createGazette(gazetteDate, url, {
            editionNumber: pdfEditionId,
            isExtraEdition: false,
            power: "executive",
          });

          if (gazette) {
            // Add metadata about the consolidated nature
            gazette.notes = `Consolidated gazette from ${this.sigpubConfig.url}. Contains publications from multiple municipalities. EntityId for ${cityName}: ${entityId}`;
            gazettes.push(gazette);
          }
          // Only process the first valid PDF URL with the real date
          // (the page shows the latest edition, so we only get one gazette per crawl)
          break;
        }
      }

      logger.info(
        `Found ${gazettes.length} gazettes from ${matchCount} PDF URLs for ${cityName} using direct URL extraction`,
      );

      if (gazettes.length === 0 && matchCount > 0) {
        const realDate =
          day && month && year
            ? `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
            : "unknown";
        logger.warn(
          `Found ${matchCount} PDF URLs but none in the requested date range. Latest edition date: ${realDate}. The main page only shows the latest edition.`,
        );
      }
    } catch (error) {
      logger.error("Error in direct URL extraction:", error as Error);
    }

    return gazettes;
  }
}
