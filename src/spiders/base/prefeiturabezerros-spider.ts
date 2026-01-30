import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeituraBezerrosConfig,
} from "../../types";
import { logger } from "../../utils/logger";
import { toISODate, getCurrentTimestamp } from "../../utils/date-utils";

/**
 * PrefeituraBezerrosSpider implementation
 *
 * Crawls the WordPress-based Diário Oficial portal for Bezerros - PE.
 * The portal has yearly pages with paginated lists of gazette PDFs.
 *
 * URL Pattern: https://bezerros.pe.gov.br/diario-oficial/diario-oficial-{year}/
 * Pagination: https://bezerros.pe.gov.br/diario-oficial/diario-oficial-{year}/page/{page}/
 *
 * PDF Pattern: https://bezerros.pe.gov.br/wp-content/uploads/{year}/{month}/DIARIO-OFICIAL-DE-BEZERROS-DD.MM.YYYY.pdf
 */
export class PrefeituraBezerrosSpider extends BaseSpider {
  private readonly bezerrosConfig: PrefeituraBezerrosConfig;
  private readonly baseUrl: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.bezerrosConfig = spiderConfig.config as PrefeituraBezerrosConfig;
    this.baseUrl =
      this.bezerrosConfig.baseUrl ||
      "https://bezerros.pe.gov.br/diario-oficial";

    logger.info(
      `Initializing PrefeituraBezerrosSpider for ${spiderConfig.name}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling Bezerros from ${toISODate(this.startDate)} to ${toISODate(this.endDate)}...`,
    );

    const gazettes: Gazette[] = [];

    try {
      // Get the years to crawl based on date range
      const startYear = this.startDate.getFullYear();
      const endYear = this.endDate.getFullYear();

      for (let year = endYear; year >= startYear; year--) {
        const yearGazettes = await this.crawlYear(year);
        gazettes.push(...yearGazettes);
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes from Bezerros`,
      );
    } catch (error) {
      logger.error(`Error crawling Bezerros:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Crawl gazettes for a specific year
   */
  private async crawlYear(year: number): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let page = 1;
    const maxPages = 50; // Safety limit
    let hasMorePages = true;

    while (hasMorePages && page <= maxPages) {
      const pageUrl =
        page === 1
          ? `${this.baseUrl}/diario-oficial-${year}/`
          : `${this.baseUrl}/diario-oficial-${year}/page/${page}/`;

      logger.debug(`Fetching page ${page} for year ${year}: ${pageUrl}`);

      try {
        const response = await fetch(pageUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
          },
        });

        if (!response.ok) {
          if (response.status === 404) {
            logger.debug(
              `No more pages for year ${year} (404 on page ${page})`,
            );
            hasMorePages = false;
            break;
          }
          logger.warn(`Failed to fetch page ${page}: ${response.status}`);
          break;
        }

        const html = await response.text();
        const pageGazettes = this.extractGazettesFromHtml(html, year);

        if (pageGazettes.length === 0) {
          logger.debug(`No gazettes found on page ${page}, stopping`);
          hasMorePages = false;
          break;
        }

        // Filter by date range
        const startDateStr = toISODate(this.startDate);
        const endDateStr = toISODate(this.endDate);

        for (const gazette of pageGazettes) {
          if (gazette.date >= startDateStr && gazette.date <= endDateStr) {
            gazettes.push(gazette);
          }
        }

        // Check if there are more pages
        hasMorePages = this.hasNextPage(html);
        page++;
      } catch (error) {
        logger.error(`Error fetching page ${page} for year ${year}:`, error);
        break;
      }
    }

    logger.info(`Found ${gazettes.length} gazettes for year ${year}`);
    return gazettes;
  }

  /**
   * Extract gazette information from HTML content
   */
  private extractGazettesFromHtml(html: string, year: number): Gazette[] {
    const gazettes: Gazette[] = [];

    // Pattern to find PDF links in the content
    // Links are in format: href="https://bezerros.pe.gov.br/wp-content/uploads/2026/01/DIARIO-OFICIAL-DE-BEZERROS-27.01.2026.pdf"
    const pdfLinkRegex =
      /href=["'](https?:\/\/bezerros\.pe\.gov\.br\/wp-content\/uploads\/\d{4}\/\d{2}\/[^"']+\.pdf)["']/gi;

    let match;
    const seenUrls = new Set<string>();

    while ((match = pdfLinkRegex.exec(html)) !== null) {
      const pdfUrl = match[1];

      // Skip duplicates
      if (seenUrls.has(pdfUrl)) {
        continue;
      }
      seenUrls.add(pdfUrl);

      // Extract date from filename
      // Patterns:
      // - DIARIO-OFICIAL-DE-BEZERROS-DD.MM.YYYY.pdf
      // - DIARIO-OFICIAL-EXTRAORDINARIA-No-XX-DD.MM.YYYY.pdf
      const dateFromFilename = this.extractDateFromPdfUrl(pdfUrl);

      if (!dateFromFilename) {
        logger.debug(`Could not extract date from PDF URL: ${pdfUrl}`);
        continue;
      }

      // Determine if it's an extra edition
      const isExtraEdition =
        pdfUrl.toLowerCase().includes("extraordinar") ||
        pdfUrl.toLowerCase().includes("extra");

      // Extract edition number if present
      const editionMatch = pdfUrl.match(/No-(\d+)/i);
      const editionNumber = editionMatch ? editionMatch[1] : undefined;

      const gazette: Gazette = {
        date: dateFromFilename,
        fileUrl: pdfUrl,
        territoryId: this.spiderConfig.territoryId,
        scrapedAt: getCurrentTimestamp(),
        isExtraEdition,
        power: "executive_legislative",
        sourceText: `Diário Oficial de Bezerros${isExtraEdition ? " - Edição Extraordinária" : ""}${editionNumber ? ` Nº ${editionNumber}` : ""}`,
        editionNumber,
      };

      gazettes.push(gazette);
      logger.debug(`Found gazette: date=${gazette.date}, url=${pdfUrl}`);
    }

    return gazettes;
  }

  /**
   * Extract date from PDF URL
   * Example: DIARIO-OFICIAL-DE-BEZERROS-27.01.2026.pdf -> 2026-01-27
   */
  private extractDateFromPdfUrl(url: string): string | null {
    // Pattern: DD.MM.YYYY in the filename
    const datePattern = /(\d{2})\.(\d{2})\.(\d{4})\.pdf$/i;
    const match = url.match(datePattern);

    if (match) {
      const day = match[1];
      const month = match[2];
      const year = match[3];
      return `${year}-${month}-${day}`;
    }

    // Alternative pattern: YYYY-MM-DD
    const isoPattern = /(\d{4})-(\d{2})-(\d{2})\.pdf$/i;
    const isoMatch = url.match(isoPattern);

    if (isoMatch) {
      return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    }

    return null;
  }

  /**
   * Check if there's a next page link
   */
  private hasNextPage(html: string): boolean {
    // WordPress pagination typically has "next" or "próximo" links
    // or numbered page links like /page/2/, /page/3/
    return (
      html.includes('class="next page-numbers"') ||
      html.includes("page-numbers next") ||
      /\/page\/\d+\/["']/.test(html)
    );
  }
}
