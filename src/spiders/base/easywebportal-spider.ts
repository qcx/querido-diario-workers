import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  EasywebPortalConfig,
} from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse, HTMLElement } from "node-html-parser";
import { toISODate } from "../../utils/date-utils";

/**
 * Easyweb Portal Spider
 *
 * Spider for municipalities using the Easyweb CMS platform.
 * Example: https://catoledorocha.pb.gov.br/jornal-oficial/p16_sectionid/39
 *
 * Features:
 * - Direct PDF links in tables on the homepage
 * - PDFs stored in /images/arquivos/documentos/{timestamp}.pdf
 * - Date format in text: DD/MM/YYYY - JORNAL XXXX P1
 * - Section-based organization by year
 * - Pagination via p16_start parameter
 */
export class EasywebPortalSpider extends BaseSpider {
  protected platformConfig: EasywebPortalConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.platformConfig = spiderConfig.config as EasywebPortalConfig;

    if (!this.platformConfig.baseUrl) {
      throw new Error(
        `EasywebPortalSpider requires a baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing EasywebPortalSpider for ${spiderConfig.name} with URL: ${this.platformConfig.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.platformConfig.baseUrl} for ${this.spiderConfig.name}...`,
    );

    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();

    try {
      // Fetch the main page first to get gazettes listed there
      logger.debug(`Fetching main page: ${this.platformConfig.baseUrl}`);
      const mainHtml = await this.fetch(this.platformConfig.baseUrl);
      const mainRoot = parse(mainHtml);

      // Extract gazettes from the main page
      const mainPageGazettes = this.extractGazettesFromPage(mainRoot);
      for (const gazette of mainPageGazettes) {
        if (!seenUrls.has(gazette.fileUrl)) {
          const gazetteDate = new Date(gazette.date);
          if (this.isInDateRange(gazetteDate)) {
            gazettes.push(gazette);
            seenUrls.add(gazette.fileUrl);
          }
        }
      }

      logger.info(
        `Extracted ${mainPageGazettes.length} gazettes from main page`,
      );

      // Get the years from the section links
      const yearSections = this.extractYearSections(mainRoot);
      logger.debug(`Found ${yearSections.length} year sections`);

      // For each year section, fetch and extract gazettes
      for (const yearSection of yearSections) {
        try {
          logger.debug(`Fetching year section: ${yearSection.url}`);
          const yearHtml = await this.fetch(yearSection.url);
          const yearRoot = parse(yearHtml);

          // Extract gazettes from this year's page
          const yearGazettes = this.extractGazettesFromPage(yearRoot);
          let addedCount = 0;

          for (const gazette of yearGazettes) {
            if (!seenUrls.has(gazette.fileUrl)) {
              const gazetteDate = new Date(gazette.date);
              if (this.isInDateRange(gazetteDate)) {
                gazettes.push(gazette);
                seenUrls.add(gazette.fileUrl);
                addedCount++;
              }
            }
          }

          logger.debug(
            `Extracted ${addedCount} gazettes from ${yearSection.year}`,
          );

          // Handle pagination within the year section
          let hasMorePages = true;
          let pageStart = 10; // p16_start=0 is the first page, p16_start=10 is second, etc.
          const maxPages = 100;
          let pageCount = 1;

          while (hasMorePages && pageCount < maxPages) {
            const paginatedUrl = `${yearSection.url}&p16_start=${pageStart}`;
            try {
              logger.debug(`Fetching paginated URL: ${paginatedUrl}`);
              const paginatedHtml = await this.fetch(paginatedUrl);
              const paginatedRoot = parse(paginatedHtml);

              const paginatedGazettes =
                this.extractGazettesFromPage(paginatedRoot);

              if (paginatedGazettes.length === 0) {
                hasMorePages = false;
                continue;
              }

              let pageAddedCount = 0;
              for (const gazette of paginatedGazettes) {
                if (!seenUrls.has(gazette.fileUrl)) {
                  const gazetteDate = new Date(gazette.date);
                  if (this.isInDateRange(gazetteDate)) {
                    gazettes.push(gazette);
                    seenUrls.add(gazette.fileUrl);
                    pageAddedCount++;
                  }
                }
              }

              if (pageAddedCount === 0) {
                // No new gazettes found, might have reached the end or past the date range
                hasMorePages = false;
              }

              pageStart += 10;
              pageCount++;
            } catch (error) {
              logger.debug(`Error fetching paginated page: ${error}`);
              hasMorePages = false;
            }
          }
        } catch (error) {
          logger.debug(
            `Error processing year section ${yearSection.year}: ${error}`,
          );
        }
      }
    } catch (error) {
      logger.error(
        `Error crawling ${this.platformConfig.baseUrl}:`,
        error as Error,
      );
    }

    logger.info(
      `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
    );

    return gazettes;
  }

  /**
   * Extract year sections from the page (DOM 2021, DOM 2022, etc.)
   */
  private extractYearSections(
    root: HTMLElement,
  ): Array<{ year: number; url: string }> {
    const sections: Array<{ year: number; url: string }> = [];
    const baseUrlObj = new URL(this.platformConfig.baseUrl);

    // Look for links containing "DOM YYYY" or similar year patterns
    const links = root.querySelectorAll("a");

    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const text = link.text.trim();

      // Match year patterns in the text (DOM 2021, DOM 2022, etc.)
      const yearMatch = text.match(/DOM\s*(\d{4})/i);
      if (yearMatch) {
        const year = parseInt(yearMatch[1], 10);

        // Build full URL if relative
        let fullUrl = href;
        if (href.startsWith("/")) {
          fullUrl = `${baseUrlObj.origin}${href}`;
        } else if (!href.startsWith("http")) {
          fullUrl = `${baseUrlObj.origin}/${href}`;
        }

        // Only add if the year is within reasonable range
        if (year >= 2010 && year <= new Date().getFullYear() + 1) {
          sections.push({ year, url: fullUrl });
        }
      }
    }

    // Sort by year descending (most recent first)
    return sections.sort((a, b) => b.year - a.year);
  }

  /**
   * Extract gazettes from a single page
   */
  private extractGazettesFromPage(root: HTMLElement): Gazette[] {
    const gazettes: Gazette[] = [];
    const baseUrlObj = new URL(this.platformConfig.baseUrl);

    // Method 1: Look for table rows with PDF links
    const tableRows = root.querySelectorAll("tr");
    for (const row of tableRows) {
      const gazette = this.extractGazetteFromRow(row, baseUrlObj);
      if (gazette) {
        gazettes.push(gazette);
      }
    }

    // Method 2: Look for direct PDF links in the page
    const pdfLinks = root.querySelectorAll('a[href*=".pdf"]');
    for (const link of pdfLinks) {
      const gazette = this.extractGazetteFromLink(link, baseUrlObj);
      if (gazette) {
        // Check if we already have this gazette (avoid duplicates)
        const exists = gazettes.some((g) => g.fileUrl === gazette.fileUrl);
        if (!exists) {
          gazettes.push(gazette);
        }
      }
    }

    return gazettes;
  }

  /**
   * Extract gazette from a table row
   */
  private extractGazetteFromRow(
    row: HTMLElement,
    baseUrlObj: URL,
  ): Gazette | null {
    try {
      // Look for PDF link in the row
      const pdfLink = row.querySelector('a[href*=".pdf"]');
      if (!pdfLink) {
        return null;
      }

      const href = pdfLink.getAttribute("href") || "";
      if (!href) {
        return null;
      }

      // Get the text content of the row
      const rowText = row.text.trim();

      // Extract date from text (format: DD/MM/YYYY)
      const dateMatch = rowText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (!dateMatch) {
        return null;
      }

      const [, day, month, year] = dateMatch;
      const gazetteDate = new Date(`${year}-${month}-${day}`);

      if (isNaN(gazetteDate.getTime())) {
        return null;
      }

      // Extract edition number from text (format: JORNAL XXXX)
      let editionNumber: string | undefined;
      const editionMatch = rowText.match(/JORNAL\s*(\d+)/i);
      if (editionMatch) {
        editionNumber = editionMatch[1];
      }

      // Build full PDF URL
      let pdfUrl = href;
      if (href.startsWith("/")) {
        pdfUrl = `${baseUrlObj.origin}${href}`;
      } else if (!href.startsWith("http")) {
        pdfUrl = `${baseUrlObj.origin}/${href}`;
      }

      return this.createGazetteSync(gazetteDate, pdfUrl, {
        editionNumber,
        sourceText: rowText,
      });
    } catch (error) {
      logger.debug(`Error extracting gazette from row: ${error}`);
      return null;
    }
  }

  /**
   * Extract gazette from a direct PDF link
   */
  private extractGazetteFromLink(
    link: HTMLElement,
    baseUrlObj: URL,
  ): Gazette | null {
    try {
      const href = link.getAttribute("href") || "";
      if (!href || !href.includes(".pdf")) {
        return null;
      }

      // Get the link text or parent text for date extraction
      let text = link.text.trim();
      if (!text) {
        text = link.parentNode?.text?.trim() || "";
      }

      // Try to find date in nearby text
      const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (!dateMatch) {
        // Try to extract date from filename (timestamp format)
        const timestampMatch = href.match(/(\d{10,})\.pdf/);
        if (timestampMatch) {
          // Unix timestamp (seconds)
          const timestamp = parseInt(timestampMatch[1], 10);
          const gazetteDate = new Date(timestamp * 1000);
          if (!isNaN(gazetteDate.getTime())) {
            let pdfUrl = href;
            if (href.startsWith("/")) {
              pdfUrl = `${baseUrlObj.origin}${href}`;
            } else if (!href.startsWith("http")) {
              pdfUrl = `${baseUrlObj.origin}/${href}`;
            }

            let editionNumber: string | undefined;
            const editionMatch = text.match(/JORNAL\s*(\d+)/i);
            if (editionMatch) {
              editionNumber = editionMatch[1];
            }

            return this.createGazetteSync(gazetteDate, pdfUrl, {
              editionNumber,
              sourceText: text,
            });
          }
        }
        return null;
      }

      const [, day, month, year] = dateMatch;
      const gazetteDate = new Date(`${year}-${month}-${day}`);

      if (isNaN(gazetteDate.getTime())) {
        return null;
      }

      // Build full PDF URL
      let pdfUrl = href;
      if (href.startsWith("/")) {
        pdfUrl = `${baseUrlObj.origin}${href}`;
      } else if (!href.startsWith("http")) {
        pdfUrl = `${baseUrlObj.origin}/${href}`;
      }

      let editionNumber: string | undefined;
      const editionMatch = text.match(/JORNAL\s*(\d+)/i);
      if (editionMatch) {
        editionNumber = editionMatch[1];
      }

      return this.createGazetteSync(gazetteDate, pdfUrl, {
        editionNumber,
        sourceText: text,
      });
    } catch (error) {
      logger.debug(`Error extracting gazette from link: ${error}`);
      return null;
    }
  }

  /**
   * Synchronous version of createGazette for simpler logic
   */
  private createGazetteSync(
    date: Date,
    pdfUrl: string,
    options?: {
      editionNumber?: string;
      isExtraEdition?: boolean;
      power?: string;
      sourceText?: string;
    },
  ): Gazette | null {
    try {
      const gazette: Gazette = {
        date: toISODate(date),
        fileUrl: pdfUrl,
        territoryId: this.spiderConfig.territoryId,
        power: (options?.power as any) || "executive_legislative",
        isExtraEdition: options?.isExtraEdition || false,
        editionNumber: options?.editionNumber,
        scrapedAt: new Date().toISOString(),
        sourceText: options?.sourceText,
      };

      return gazette;
    } catch (error) {
      logger.debug(`Error creating gazette: ${error}`);
      return null;
    }
  }
}
