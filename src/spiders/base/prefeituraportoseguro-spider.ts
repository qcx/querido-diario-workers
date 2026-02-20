import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeituraPortoSeguroConfig,
} from "../../types";
import { logger } from "../../utils/logger";
import { getCurrentTimestamp } from "../../utils/date-utils";

/**
 * PrefeituraPortoSeguroSpider implementation
 *
 * Crawls the official gazette from Porto Seguro, BA
 * Site: https://www.acessoinformacao.com.br/ba/portoseguro/diario-externo.php
 *
 * The site is an IBDM Modernização platform with:
 * - A search form with date filters
 * - Accordion panels organized by year and month
 * - Table rows with class "row-master" containing date, edition and download link
 * - Download links with class "diariooficial-download-btn"
 */
export class PrefeituraPortoSeguroSpider extends BaseSpider {
  protected portoSeguroConfig: PrefeituraPortoSeguroConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.portoSeguroConfig = spiderConfig.config as PrefeituraPortoSeguroConfig;

    if (!this.portoSeguroConfig.baseUrl) {
      throw new Error(
        `PrefeituraPortoSeguroSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeituraPortoSeguroSpider for ${spiderConfig.name}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.portoSeguroConfig.baseUrl} for ${this.spiderConfig.name}...`,
    );
    const gazettes: Gazette[] = [];

    try {
      // Build URL with date filters
      const startDateStr = this.formatDateForUrl(this.startDate);
      const endDateStr = this.formatDateForUrl(this.endDate);

      const url = this.buildUrl(startDateStr, endDateStr);
      logger.info(`Crawling: ${url}`);

      const html = await this.fetch(url);
      const $ = this.loadHTML(html);

      // Find all gazette entries in row-master rows
      const entries = $("tr.row-master").toArray();
      logger.info(`Found ${entries.length} gazette entries`);

      // Debug: log first entry HTML structure
      if (entries.length > 0) {
        const firstEntry = $(entries[0]);
        logger.debug(`First entry HTML sample:`, {
          html: firstEntry.html()?.substring(0, 500),
          text: firstEntry.text()?.substring(0, 200),
        });
      }

      // Track the last date found - some sites have master/detail structure
      // where the date row doesn't have download link and vice-versa
      let lastDate: string | null = null;
      let lastEdition: string | undefined = undefined;

      for (const entry of entries) {
        try {
          // First, check if this entry has a date - update lastDate BEFORE parsing
          // This way entries without date can use the date from a previous entry
          const entryText = $(entry).text();
          const dateMatch = entryText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (dateMatch) {
            const [, day, month, year] = dateMatch;
            lastDate = `${year}-${month}-${day}`;
          }
          const editionMatch = entryText.match(/Edi[çc][aã]o[:\s]*([\d.]+)/i);
          if (editionMatch) {
            lastEdition = editionMatch[1].replace(/\./g, "");
          }

          const gazette = this.parseGazetteEntry(
            $,
            $(entry),
            lastDate,
            lastEdition,
          );

          if (gazette && this.isInDateRange(new Date(gazette.date))) {
            gazettes.push(gazette);
            logger.info(
              `Found gazette: ${gazette.date} - Edition: ${gazette.editionNumber}`,
            );
          }
        } catch (error) {
          logger.warn(`Error processing gazette entry:`, {
            error: (error as Error).message,
          });
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

  private buildUrl(startDate: string, endDate: string): string {
    const baseUrl = this.portoSeguroConfig.baseUrl;
    const params = new URLSearchParams();

    params.set("_f[data_inicial]", startDate);
    params.set("_f[data_final]", endDate);

    return `${baseUrl}?${params.toString()}#diario-oficial`;
  }

  private formatDateForUrl(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private parseGazetteEntry(
    $: any,
    $entry: any,
    lastDate: string | null = null,
    lastEdition: string | undefined = undefined,
  ): Gazette | null {
    try {
      // Debug: log all links found in entry
      const allLinks = $entry.find("a").toArray();
      if (allLinks.length > 0) {
        const linkInfo = allLinks.slice(0, 3).map((a: any) => ({
          href: $(a).attr("href")?.substring(0, 100),
          text: $(a).text()?.substring(0, 50),
          class: $(a).attr("class"),
        }));
        logger.debug("Links in entry:", { links: linkInfo });
      }

      // Find PDF download link - try multiple selectors
      let downloadLink = $entry.find("a.diariooficial-download-btn").first();
      let pdfLink = downloadLink.attr("href");

      // Fallback: look for link containing "Baixar" text or with downloader.php
      if (!pdfLink) {
        downloadLink = $entry.find('a[href*="downloader.php"]').first();
        pdfLink = downloadLink.attr("href");
      }
      if (!pdfLink) {
        downloadLink = $entry.find('a:contains("Baixar")').first();
        pdfLink = downloadLink.attr("href");
      }
      // Fallback: any link with PDF extension or containing "download"
      if (!pdfLink) {
        downloadLink = $entry
          .find('a[href*=".pdf"], a[href*="download"]')
          .first();
        pdfLink = downloadLink.attr("href");
      }

      if (!pdfLink) {
        // This might be a header row with date but no download - skip
        return null;
      }

      // Try to find date and edition - multiple formats supported
      let date: string | null = null;
      let editionNumber: string | undefined;

      // Format 1: Porto Seguro style - "23/01/2026, Edição: 10.502" in span.diariooficial-edicao
      const editionSpan = $entry
        .find("span.diariooficial-edicao")
        .text()
        .trim();
      if (editionSpan) {
        const dateMatch = editionSpan.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (dateMatch) {
          const [, day, month, year] = dateMatch;
          date = `${year}-${month}-${day}`;
        }
        const editionMatch = editionSpan.match(/Edi[çc][aã]o:\s*([\d.]+)/i);
        editionNumber = editionMatch
          ? editionMatch[1].replace(/\./g, "")
          : undefined;
      }

      // Format 2: Jacobina style - date and edition in separate cells/spans
      if (!date) {
        // Look for date in the row text or in separate spans
        const rowText = $entry.text();
        const dateMatch = rowText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (dateMatch) {
          const [, day, month, year] = dateMatch;
          date = `${year}-${month}-${day}`;
        }

        // Look for edition in row text
        const editionMatch = rowText.match(/Edi[çc][aã]o[:\s]*([\d.]+)/i);
        editionNumber = editionMatch
          ? editionMatch[1].replace(/\./g, "")
          : undefined;
      }

      // Format 3: São Desidério style - master/detail rows
      // The download link row might not have the date, use the previous row's date
      if (!date && lastDate) {
        date = lastDate;
        logger.debug(`Using previous row date for entry: ${lastDate}`);
      }
      if (!editionNumber && lastEdition) {
        editionNumber = lastEdition;
      }

      if (!date) {
        logger.warn(`Could not parse date from entry`);
        return null;
      }

      // Ensure URL is absolute
      const fileUrl = pdfLink.startsWith("http")
        ? pdfLink
        : pdfLink.startsWith("//")
          ? `https:${pdfLink}`
          : new URL(pdfLink, this.portoSeguroConfig.baseUrl).href;

      return {
        date,
        fileUrl,
        territoryId: this.spiderConfig.territoryId,
        scrapedAt: getCurrentTimestamp(),
        isExtraEdition: false,
        power: "executive_legislative",
        editionNumber,
        sourceText: `Diário Oficial - ${date}${editionNumber ? `, Edição: ${editionNumber}` : ""}`,
      };
    } catch (error) {
      logger.warn(`Error parsing gazette entry:`, {
        error: (error as Error).message,
      });
      return null;
    }
  }
}
