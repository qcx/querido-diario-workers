import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  PrefeituralaranjaldojariConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
import { getCurrentTimestamp } from "../../utils/date-utils";
// @ts-ignore
import { parse } from "node-html-parser";

/**
 * Spider for Prefeitura de Laranjal do Jari gazette portal
 *
 * Site: https://laranjaldojari.ap.gov.br/diario-oficial/
 *
 * The site uses a calendar-based listing with direct PDF links.
 * Navigation by year/month via query params: ?ano=YYYY&mes=MM
 *
 * HTML Structure:
 * - Calendar view with days containing gazette links
 * - Each gazette entry has:
 *   - Title: "Diário Oficial N˚ {number}/{year}"
 *   - Visualizar link: /diario-oficial/{year}/{month}/{day}/{number}-{year}/
 *   - Baixar link: /diario-oficial/wp-content/uploads/{year}/{month}/No{number}-{date}-DIARIO-OFICIAL.pdf
 */
export class PrefeituralaranjaldojariSpider extends BaseSpider {
  protected config: PrefeituralaranjaldojariConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeituralaranjaldojariConfig;

    if (!this.config.baseUrl) {
      throw new Error(
        `PrefeituralaranjaldojariSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeituralaranjaldojariSpider for ${spiderConfig.name} with URL: ${this.config.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.config.baseUrl} for ${this.spiderConfig.name}...`,
    );

    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();

    try {
      // Get the date range to crawl
      const startDate = new Date(this.dateRange.start);
      const endDate = new Date(this.dateRange.end);

      // Generate list of months to crawl
      const monthsToFetch: { year: number; month: number }[] = [];
      const currentDate = new Date(startDate);
      currentDate.setDate(1); // Start from first day of month

      while (currentDate <= endDate) {
        monthsToFetch.push({
          year: currentDate.getFullYear(),
          month: currentDate.getMonth() + 1,
        });
        currentDate.setMonth(currentDate.getMonth() + 1);
      }

      logger.info(`Fetching ${monthsToFetch.length} months of gazettes`);

      // Fetch each month
      for (const { year, month } of monthsToFetch) {
        const monthGazettes = await this.fetchMonth(year, month, seenUrls);
        gazettes.push(...monthGazettes);
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

  private async fetchMonth(
    year: number,
    month: number,
    seenUrls: Set<string>,
  ): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      // Build URL with year/month params
      const url = `${this.config.baseUrl}?ano=${year}&mes=${month}`;
      logger.debug(`Fetching month ${month}/${year}: ${url}`);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      if (!response.ok) {
        logger.warn(
          `Failed to fetch month ${month}/${year}: ${response.status}`,
        );
        return gazettes;
      }

      const html = await response.text();
      const root = parse(html);

      // Find all PDF download links
      // Pattern: href="...wp-content/uploads/.../No{number}-{date}-DIARIO-OFICIAL.pdf"
      const pdfLinks = root.querySelectorAll('a[href*=".pdf"]');

      logger.debug(`Found ${pdfLinks.length} PDF links for ${month}/${year}`);

      for (const link of pdfLinks) {
        try {
          const href = link.getAttribute("href");
          if (!href || !href.includes("DIARIO-OFICIAL")) {
            continue;
          }

          // Make absolute URL if relative
          let pdfUrl = href;
          if (!pdfUrl.startsWith("http")) {
            const baseUrlObj = new URL(this.config.baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith("/") ? "" : "/"}${pdfUrl}`;
          }

          // Avoid duplicates
          if (seenUrls.has(pdfUrl)) {
            continue;
          }
          seenUrls.add(pdfUrl);

          // Extract date and edition from URL
          // Pattern: No{number}-{day}-DE-{month}-DE-{year}-DIARIO-OFICIAL.pdf
          // Example: No4686-05-DE-JANEIRO-DE-2026-DIARIO-OFICIAL.pdf
          const filenameMatch = pdfUrl.match(
            /No(\d+)-(\d{2})-DE-([A-Z]+)-DE-(\d{4})-DIARIO-OFICIAL/i,
          );

          let date: string;
          let editionNumber: string | undefined;

          if (filenameMatch) {
            const [, edition, day, monthName, yearStr] = filenameMatch;
            editionNumber = edition;
            const monthNum = this.monthNameToNumber(monthName);
            date = `${yearStr}-${monthNum.toString().padStart(2, "0")}-${day}`;
          } else {
            // Try alternative pattern from URL path
            // Pattern: /diario-oficial/{year}/{month}/{day}/{number}-{year}/
            const pathMatch = pdfUrl.match(/\/(\d{4})\/(\d{2})\/.*No(\d+)/);
            if (pathMatch) {
              const [, yearStr, monthStr, edition] = pathMatch;
              editionNumber = edition;
              // Use the month/year from URL, day from filename
              const dayMatch = pdfUrl.match(/No\d+-(\d{2})/);
              const day = dayMatch ? dayMatch[1] : "01";
              date = `${yearStr}-${monthStr}-${day}`;
            } else {
              // Fallback: use current month being fetched
              date = `${year}-${month.toString().padStart(2, "0")}-01`;
            }
          }

          const gazetteDate = new Date(date);

          // Check if date is in range
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }

          // Get title from parent element or link text
          const parentText = link.parentNode?.text || "";
          const titleMatch = parentText.match(
            /Diário Oficial N[˚°º]?\s*(\d+)/i,
          );
          if (titleMatch && !editionNumber) {
            editionNumber = titleMatch[1];
          }

          // Check if it's an extra edition
          const isExtraEdition =
            pdfUrl.toLowerCase().includes("extra") ||
            pdfUrl.toLowerCase().includes("suplemento");

          gazettes.push({
            date,
            fileUrl: pdfUrl,
            territoryId: this.spiderConfig.territoryId,
            editionNumber,
            power: "executive_legislative",
            isExtraEdition,
            scrapedAt: getCurrentTimestamp(),
          });

          logger.debug(`Found gazette: ${editionNumber} - ${date} - ${pdfUrl}`);
        } catch (error) {
          logger.error(`Error processing PDF link:`, error as Error);
        }
      }
    } catch (error) {
      logger.error(`Error fetching month ${month}/${year}:`, error as Error);
    }

    return gazettes;
  }

  private monthNameToNumber(monthName: string): number {
    const months: Record<string, number> = {
      janeiro: 1,
      fevereiro: 2,
      marco: 3,
      março: 3,
      abril: 4,
      maio: 5,
      junho: 6,
      julho: 7,
      agosto: 8,
      setembro: 9,
      outubro: 10,
      novembro: 11,
      dezembro: 12,
    };
    return months[monthName.toLowerCase()] || 1;
  }
}
