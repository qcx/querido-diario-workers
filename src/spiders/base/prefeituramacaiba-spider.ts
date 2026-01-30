import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeituraMacaibaConfig,
} from "../../types";
import { logger } from "../../utils/logger";
import { toISODate, getCurrentTimestamp } from "../../utils/date-utils";

/**
 * PrefeituraMacaibaSpider implementation
 *
 * Crawls the official gazette from Macaíba, RN.
 * URL: https://macaiba.rn.gov.br/servicos/diario-oficial/
 *
 * The site uses WordPress with paginated list of PDFs.
 * PDF URL pattern: https://macaiba.rn.gov.br/wp-content/uploads/YYYY/MM/DOMM-XXXX.pdf
 *
 * Each entry has format: "DOMM XXXX - DD/month/YYYY"
 */
export class PrefeituraMacaibaSpider extends BaseSpider {
  protected macaibaConfig: PrefeituraMacaibaConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.macaibaConfig = spiderConfig.config as PrefeituraMacaibaConfig;

    if (!this.macaibaConfig.baseUrl) {
      throw new Error(
        `PrefeituraMacaibaSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeituraMacaibaSpider for ${spiderConfig.name}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.macaibaConfig.baseUrl} for ${this.spiderConfig.name}...`,
    );
    const gazettes: Gazette[] = [];

    try {
      // Fetch multiple pages to get enough data
      const maxPages = 10;
      const seenUrls = new Set<string>();

      for (let page = 1; page <= maxPages; page++) {
        const url =
          page === 1
            ? this.macaibaConfig.baseUrl
            : `${this.macaibaConfig.baseUrl}page/${page}/`;

        logger.debug(`Fetching page ${page}: ${url}`);

        try {
          const response = await this.fetch(url);

          // Extract links with pattern: "DOMM XXXX - DD/month/YYYY" followed by PDF link
          // Pattern: DOMM 1856 - 31/dezembro/2025 ... href="...pdf"
          const entryRegex =
            /DOMM\s+(\d+)\s*-\s*(\d{1,2})\/(\w+)\/(\d{4})[^<]*<a[^>]*href="([^"]+\.pdf)"/gi;

          let foundOnPage = 0;

          for (const match of response.matchAll(entryRegex)) {
            const editionNum = match[1];
            const day = match[2].padStart(2, "0");
            const monthName = match[3].toLowerCase();
            const year = match[4];
            const pdfUrl = match[5];

            if (seenUrls.has(pdfUrl)) {
              continue;
            }
            seenUrls.add(pdfUrl);

            const monthMap: Record<string, string> = {
              janeiro: "01",
              fevereiro: "02",
              março: "03",
              marco: "03",
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

            const month = monthMap[monthName];
            if (!month) {
              logger.debug(`Unknown month: ${monthName}`);
              continue;
            }

            const dateStr = `${year}-${month}-${day}`;
            const gazetteDate = new Date(`${dateStr}T00:00:00.000Z`);

            if (this.isInDateRange(gazetteDate)) {
              const gazette = await this.createGazette(gazetteDate, pdfUrl, {
                editionNumber: editionNum,
                isExtraEdition: false,
                power: "executive",
              });

              if (gazette) {
                gazette.sourceText = `DOMM ${editionNum} - ${day}/${month}/${year}`;
                gazettes.push(gazette);
                logger.info(
                  `Found gazette for ${gazette.date}: ${gazette.sourceText}`,
                );
                foundOnPage++;
              }
            }
          }

          // Also try simpler regex for direct PDF links with dates
          const simplePdfRegex =
            /href="(https:\/\/macaiba\.rn\.gov\.br\/wp-content\/uploads\/(\d{4})\/(\d{2})\/DOMM[-_]?(\d+)[^"]*\.pdf)"/gi;

          for (const match of response.matchAll(simplePdfRegex)) {
            const pdfUrl = match[1];
            const year = match[2];
            const month = match[3];
            const editionNum = match[4];

            if (seenUrls.has(pdfUrl)) {
              continue;
            }
            seenUrls.add(pdfUrl);

            // Try to find date near the link
            // Look for pattern: DD/monthname/YYYY before the link
            const linkPos = response.indexOf(pdfUrl);
            const contextStart = Math.max(0, linkPos - 200);
            const context = response.substring(contextStart, linkPos);

            const dateMatch = context.match(/(\d{1,2})\/(\w+)\/(\d{4})/);

            if (dateMatch) {
              const day = dateMatch[1].padStart(2, "0");
              const monthName = dateMatch[2].toLowerCase();
              const dateYear = dateMatch[3];

              const monthMap: Record<string, string> = {
                janeiro: "01",
                fevereiro: "02",
                março: "03",
                marco: "03",
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

              const monthNum = monthMap[monthName];
              if (monthNum) {
                const dateStr = `${dateYear}-${monthNum}-${day}`;
                const gazetteDate = new Date(`${dateStr}T00:00:00.000Z`);

                if (this.isInDateRange(gazetteDate)) {
                  const gazette = await this.createGazette(
                    gazetteDate,
                    pdfUrl,
                    {
                      editionNumber: editionNum,
                      isExtraEdition: false,
                      power: "executive",
                    },
                  );

                  if (gazette) {
                    gazette.sourceText = `DOMM ${editionNum} - ${day}/${monthNum}/${dateYear}`;
                    gazettes.push(gazette);
                    logger.info(
                      `Found gazette for ${gazette.date}: ${gazette.sourceText}`,
                    );
                    foundOnPage++;
                  }
                }
              }
            }
          }

          logger.debug(`Found ${foundOnPage} gazettes on page ${page}`);

          // If no results on this page, stop pagination
          if (foundOnPage === 0 && page > 1) {
            logger.debug("No more gazettes found, stopping pagination");
            break;
          }
        } catch (error) {
          logger.debug(`Error fetching page ${page}:`, error as Error);
          break;
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
      );
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }
}
