import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  PrefeiturabacabalConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";

/**
 * Spider for Prefeitura de Bacabal - MA
 *
 * Site: www.bacabal.ma.gov.br/diario
 *
 * Custom platform with:
 * - Table listing editions with direct PDF links
 * - PDFs at /DOM/BAC{YYYYMMDD}-a.pdf or /DOM/BAC{YYYYMMDD}-{n}-a.pdf for extras
 * - Simple pagination: /diario/1, /diario/2, etc.
 * - Date embedded in PDF filename: BACYYYYMMDD
 */
export class PrefeiturabacabalSpider extends BaseSpider {
  protected config: PrefeiturabacabalConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeiturabacabalConfig;

    if (!this.config.baseUrl) {
      throw new Error(
        `PrefeiturabacabalSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeiturabacabalSpider for ${spiderConfig.name} with URL: ${this.config.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.config.baseUrl} for ${this.spiderConfig.name}...`,
    );

    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();
    let currentPage = 1;
    const maxPages = 10; // Safety limit

    try {
      while (currentPage <= maxPages) {
        const pageUrl =
          currentPage === 1
            ? this.config.baseUrl
            : `${this.config.baseUrl}/${currentPage}`;

        logger.debug(`Fetching page ${currentPage}: ${pageUrl}`);

        const response = await fetch(pageUrl, {
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
          logger.warn(
            `Failed to fetch page ${currentPage}: ${response.status} ${response.statusText}`,
          );
          break;
        }

        const html = await response.text();

        // Extract all PDF links from DOM folder
        // Pattern: href='https://www.bacabal.ma.gov.br/DOM/BAC{YYYYMMDD}[-{n}]-a.pdf'
        const pdfMatches = html.matchAll(
          /href=['"]([^'"]*\/DOM\/BAC(\d{8})(-\d+)?-a\.pdf)['"]/gi,
        );

        let foundInRange = false;
        let foundAny = false;

        for (const match of pdfMatches) {
          foundAny = true;
          const pdfUrl = match[1];
          const dateStr = match[2]; // YYYYMMDD
          const extraSuffix = match[3]; // -1, -2, etc. or undefined

          // Skip if already seen
          if (seenUrls.has(pdfUrl)) continue;
          seenUrls.add(pdfUrl);

          // Parse date from filename: YYYYMMDD -> YYYY-MM-DD
          const year = dateStr.substring(0, 4);
          const month = dateStr.substring(4, 6);
          const day = dateStr.substring(6, 8);
          const date = `${year}-${month}-${day}`;

          // Check if in date range
          const dateObj = new Date(date);
          if (!this.isInDateRange(dateObj)) {
            // If we've gone past the start date range, we can stop
            if (dateObj < new Date(this.dateRange.start)) {
              logger.debug(
                `Date ${date} is before range start, stopping pagination`,
              );
              // Continue to check other entries on this page, then stop
              continue;
            }
            continue;
          }

          foundInRange = true;

          // Extract edition number from the page content if available
          // Look for "Volume X - Nº. BACYYYYMMDD" pattern
          const editionNumber = `BAC${dateStr}${extraSuffix || ""}`;

          const isExtraEdition = !!extraSuffix;

          gazettes.push({
            date,
            fileUrl: pdfUrl,
            territoryId: this.spiderConfig.territoryId,
            editionNumber,
            power: "executive",
            isExtraEdition,
            scrapedAt: new Date().toISOString(),
          });
        }

        // If no PDFs found at all on this page, stop
        if (!foundAny) {
          logger.debug(`No PDFs found on page ${currentPage}, stopping`);
          break;
        }

        // Check if we should continue to next page
        // If we found gazettes in range, continue; if not, check if dates are before range
        if (!foundInRange && gazettes.length > 0) {
          // We've passed the date range, stop
          logger.debug(
            `No more gazettes in date range after page ${currentPage}`,
          );
          break;
        }

        currentPage++;
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
