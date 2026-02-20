import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeituraMossoroConfig,
} from "../../types";
import { logger } from "../../utils/logger";
import { toISODate, getCurrentTimestamp } from "../../utils/date-utils";

/**
 * PrefeituraMossoroSpider implementation
 *
 * Crawls the official gazette from Mossoró, RN.
 * URL: https://dom.mossoro.rn.gov.br/
 *
 * The site has a custom CMS with editions list and PDF downloads.
 * - Main page: https://dom.mossoro.rn.gov.br/ (shows latest edition + recent editions)
 * - Editions page (paginated): https://dom.mossoro.rn.gov.br/dom/edicoes?page=N
 * - Publication page: https://dom.mossoro.rn.gov.br/dom/publicacao/{id}
 * - PDF URL pattern: https://dom.mossoro.rn.gov.br/pmm/uploads/publicacao/pdf/{id}/DOM_-_N_{num}_-_{weekday},_{date}.pdf
 *
 * The editions page shows entries in the format:
 *   DOM Nº XXX
 *   DD/MM/YYYY (link to /dom/publicacao/{id})
 */
export class PrefeituraMossoroSpider extends BaseSpider {
  protected mossoroConfig: PrefeituraMossoroConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.mossoroConfig = spiderConfig.config as PrefeituraMossoroConfig;

    if (!this.mossoroConfig.baseUrl) {
      throw new Error(
        `PrefeituraMossoroSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeituraMossoroSpider for ${spiderConfig.name}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.mossoroConfig.baseUrl} for ${this.spiderConfig.name}...`,
    );
    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();

    try {
      // First, try to get publications from the paginated editions page
      const publications = await this.fetchEditionsPages();

      logger.info(
        `Found ${publications.length} publications from editions pages`,
      );

      // Process each publication
      for (const pub of publications) {
        if (seenUrls.has(pub.url)) continue;
        seenUrls.add(pub.url);

        // Check if date is in range
        if (!this.isInDateRange(pub.date)) {
          continue;
        }

        // Fetch the publication page to get the PDF URL
        const pdfUrl = await this.fetchPublicationPdfUrl(pub.id);

        if (pdfUrl) {
          const gazette = await this.createGazette(pub.date, pdfUrl, {
            isExtraEdition: false,
            power: "executive",
          });

          if (gazette) {
            const dateStr = pub.date.toISOString().split("T")[0];
            gazette.sourceText = `Diário Oficial de Mossoró - DOM Nº ${pub.number} - ${dateStr}`;
            gazettes.push(gazette);
            logger.info(
              `Found gazette for ${gazette.date}: ${gazette.sourceText}`,
            );
          }
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

  /**
   * Fetch publications from the paginated editions pages
   */
  private async fetchEditionsPages(): Promise<
    Array<{ id: string; number: string; date: Date; url: string }>
  > {
    const publications: Array<{
      id: string;
      number: string;
      date: Date;
      url: string;
    }> = [];
    const baseUrl = this.mossoroConfig.baseUrl.replace(/\/$/, "");
    const seenIds = new Set<string>();

    // Fetch multiple pages to get more editions
    const maxPages = 10;
    let foundOutOfRange = false;

    for (let page = 1; page <= maxPages && !foundOutOfRange; page++) {
      try {
        const url =
          page === 1
            ? `${baseUrl}/dom/edicoes`
            : `${baseUrl}/dom/edicoes?page=${page}`;

        logger.debug(`Fetching editions page ${page}: ${url}`);
        const html = await this.fetch(url);

        if (!html) {
          logger.debug(`Empty response for page ${page}`);
          break;
        }

        let foundInPage = 0;

        // The HTML structure for each edition is:
        // <a href="/dom/publicacao/1777">
        //   <p ...><i class="bi bi-calendar"></i> 27/01/2026</p>
        //   <h4 ...><i class="bi bi-file-text"></i> DOM Nº 749</h4>
        // </a>
        //
        // We need to find each card block with the publication ID, date, and DOM number

        // Pattern to find each edicao card block
        const edicaoRegex =
          /<div class="edicao">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;

        for (const edicaoMatch of html.matchAll(edicaoRegex)) {
          const block = edicaoMatch[1];

          // Extract publication ID from href
          const idMatch = block.match(/href=["']\/dom\/publicacao\/(\d+)["']/i);
          if (!idMatch) continue;

          const id = idMatch[1];
          if (seenIds.has(id)) continue;
          seenIds.add(id);

          // Extract date (DD/MM/YYYY)
          const dateMatch = block.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) continue;

          const day = dateMatch[1];
          const month = dateMatch[2];
          const year = dateMatch[3];
          const isoDate = `${year}-${month}-${day}`;
          const date = new Date(`${isoDate}T00:00:00.000Z`);

          // Extract DOM number
          const numberMatch = block.match(/DOM\s*(?:Nº|N°|N)\s*(\d+)/i);
          const number = numberMatch ? numberMatch[1] : id;

          publications.push({
            id,
            number,
            date,
            url: `${baseUrl}/dom/publicacao/${id}`,
          });

          foundInPage++;

          // Check if we've gone past our date range (earlier than start date)
          if (date < this.dateRange.startDate) {
            foundOutOfRange = true;
          }
        }

        // If the regex didn't work, try simpler approach - find cards with col-md-3 edicao structure
        if (foundInPage === 0) {
          // Alternative: find publication links with nearby dates
          // Pattern: href="/dom/publicacao/{id}" ... DD/MM/YYYY ... DOM Nº XXX
          const cardRegex =
            /<div class="col-md-3">\s*<div class="edicao">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;

          for (const cardMatch of html.matchAll(cardRegex)) {
            const block = cardMatch[1];

            const idMatch = block.match(
              /href=["']\/dom\/publicacao\/(\d+)["']/i,
            );
            if (!idMatch) continue;

            const id = idMatch[1];
            if (seenIds.has(id)) continue;
            seenIds.add(id);

            const dateMatch = block.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (!dateMatch) continue;

            const day = dateMatch[1];
            const month = dateMatch[2];
            const year = dateMatch[3];
            const isoDate = `${year}-${month}-${day}`;
            const date = new Date(`${isoDate}T00:00:00.000Z`);

            const numberMatch = block.match(/DOM\s*(?:Nº|N°|N)\s*(\d+)/i);
            const number = numberMatch ? numberMatch[1] : id;

            publications.push({
              id,
              number,
              date,
              url: `${baseUrl}/dom/publicacao/${id}`,
            });

            foundInPage++;

            if (date < this.dateRange.startDate) {
              foundOutOfRange = true;
            }
          }
        }

        // Last resort: simpler pattern matching
        if (foundInPage === 0) {
          // Find all href links to publicacao and then look for date/number in context
          const hrefRegex = /href=["']\/dom\/publicacao\/(\d+)["']/gi;
          const allIds: string[] = [];

          for (const hrefMatch of html.matchAll(hrefRegex)) {
            const id = hrefMatch[1];
            if (!allIds.includes(id)) {
              allIds.push(id);
            }
          }

          // Find all dates
          const allDates: string[] = [];
          const dateRegex = /(\d{2}\/\d{2}\/\d{4})/g;
          for (const dateMatch of html.matchAll(dateRegex)) {
            allDates.push(dateMatch[1]);
          }

          // Deduplicate IDs (each appears multiple times in the HTML)
          const uniqueIds = [...new Set(allIds)];

          logger.debug(
            `Last resort: found ${uniqueIds.length} unique IDs and ${allDates.length} dates on page ${page}`,
          );

          // Match unique IDs with dates (they appear in order in the HTML)
          // Each edicao card has one ID (appearing twice in the HTML) and one date
          for (
            let i = 0;
            i < Math.min(uniqueIds.length, allDates.length);
            i++
          ) {
            const id = uniqueIds[i];
            if (seenIds.has(id)) continue;
            seenIds.add(id);

            const dateStr = allDates[i];
            const [day, month, year] = dateStr.split("/");
            const isoDate = `${year}-${month}-${day}`;
            const date = new Date(`${isoDate}T00:00:00.000Z`);

            publications.push({
              id,
              number: id,
              date,
              url: `${baseUrl}/dom/publicacao/${id}`,
            });

            foundInPage++;

            if (date < this.dateRange.startDate) {
              foundOutOfRange = true;
            }
          }
        }

        logger.debug(`Page ${page}: found ${foundInPage} publications`);

        // Check if there's a next page
        if (
          !html.includes("page=" + (page + 1)) &&
          !html.includes("PRÓXIMA PÁGINA") &&
          !html.includes("próxima página")
        ) {
          logger.debug(`No more pages after page ${page}`);
          break;
        }
      } catch (error) {
        logger.debug(`Error fetching editions page ${page}:`, error as Error);
        break;
      }
    }

    return publications;
  }

  /**
   * Fetch the PDF URL from a specific publication page
   */
  private async fetchPublicationPdfUrl(
    publicationId: string,
  ): Promise<string | null> {
    const baseUrl = this.mossoroConfig.baseUrl.replace(/\/$/, "");
    const url = `${baseUrl}/dom/publicacao/${publicationId}`;

    try {
      const response = await this.fetch(url);

      if (!response) {
        // If we can't fetch the page, construct the PDF URL pattern
        // Based on observed pattern, but we need the DOM number which we may not have
        logger.debug(
          `Could not fetch publication page ${publicationId}, skipping`,
        );
        return null;
      }

      // Find PDF link on the page
      // Pattern: https://dom.mossoro.rn.gov.br/pmm/uploads/publicacao/pdf/{id}/...pdf
      const pdfMatch = response.match(
        /https:\/\/dom\.mossoro\.rn\.gov\.br\/pmm\/uploads\/publicacao\/pdf\/\d+\/[^"'\s<>]+\.pdf/i,
      );

      if (pdfMatch) {
        // Clean up the URL (remove any HTML entities)
        return pdfMatch[0].replace(/&amp;/g, "&");
      }

      // Try alternative pattern (href with PDF)
      const hrefPdfMatch = response.match(
        /href=["']([^"']*\/pmm\/uploads\/publicacao\/pdf\/[^"']+\.pdf)["']/i,
      );
      if (hrefPdfMatch) {
        const pdfPath = hrefPdfMatch[1];
        if (pdfPath.startsWith("http")) {
          return pdfPath;
        }
        return `${baseUrl}${pdfPath.startsWith("/") ? "" : "/"}${pdfPath}`;
      }

      logger.debug(`No PDF link found on publication page ${publicationId}`);
      return null;
    } catch (error) {
      logger.debug(
        `Error fetching publication ${publicationId}:`,
        error as Error,
      );
      return null;
    }
  }
}
