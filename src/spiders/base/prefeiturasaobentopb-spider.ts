import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeiturasaobentopbConfig,
} from "../../types";
import { logger } from "../../utils/logger";
import { toISODate, fromISODate } from "../../utils/date-utils";

/**
 * Spider for Prefeitura de São Bento - PB
 *
 * Website: https://transparencia.saobento.pb.gov.br/diario-oficial
 *
 * Platform: Laravel/Inertia.js with embedded JSON data
 *
 * Structure:
 * - Main page: /diario-oficial with filterable years and months
 * - Journals list embedded as JSON in HTML (data-page attribute)
 * - PDF access: /diario-oficial/{slug} where slug is YYYY-MM-DD format
 * - PDFs are served directly without redirect
 *
 * URL Pattern:
 * - List: https://transparencia.saobento.pb.gov.br/diario-oficial?year=YYYY&month=MM
 * - PDF: https://transparencia.saobento.pb.gov.br/diario-oficial/YYYY-MM-DD
 */
export class PrefeiturasaobentopbSpider extends BaseSpider {
  protected saobentopbConfig: PrefeiturasaobentopbConfig;
  private baseApiUrl: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.saobentopbConfig = spiderConfig.config as PrefeiturasaobentopbConfig;

    if (!this.saobentopbConfig.baseUrl) {
      throw new Error(
        `PrefeiturasaobentopbSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    // Base URL should be the main diario-oficial page
    this.baseApiUrl = this.saobentopbConfig.baseUrl.replace(/\/$/, "");

    logger.info(
      `Initializing PrefeiturasaobentopbSpider for ${spiderConfig.name}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.baseApiUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];
    const processedUrls = new Set<string>();

    try {
      // Get the years to crawl based on date range
      const startYear = this.startDate.getFullYear();
      const endYear = this.endDate.getFullYear();

      // Process each year in the range
      for (let year = endYear; year >= startYear; year--) {
        // Determine months to process for this year
        const startMonth =
          year === startYear ? this.startDate.getMonth() + 1 : 1;
        const endMonth = year === endYear ? this.endDate.getMonth() + 1 : 12;

        // Process each month in the year (in reverse to get newest first)
        for (let month = endMonth; month >= startMonth; month--) {
          try {
            const monthGazettes = await this.crawlMonth(
              year,
              month,
              processedUrls,
            );
            gazettes.push(...monthGazettes);
          } catch (error) {
            logger.error(`Error crawling ${year}/${month}:`, error as Error);
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
   * Crawl a specific month
   */
  private async crawlMonth(
    year: number,
    month: number,
    processedUrls: Set<string>,
  ): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    // Fetch the page with year and month filters
    const url = `${this.baseApiUrl}?year=${year}&month=${month}`;
    logger.debug(`Fetching: ${url}`);

    const html = await this.fetch(url);

    // Extract the Inertia.js JSON data from the page
    const journals = this.extractJournalsFromHtml(html);

    if (journals.length === 0) {
      logger.debug(`No journals found for ${year}/${month}`);
      return gazettes;
    }

    logger.debug(`Found ${journals.length} journals for ${year}/${month}`);

    // Process each journal
    for (const journal of journals) {
      try {
        // Extract date from URL (format: /diario-oficial/YYYY-MM-DD)
        const dateMatch = journal.url.match(
          /diario-oficial\/(\d{4}-\d{2}-\d{2})/,
        );
        if (!dateMatch) {
          logger.debug(`Could not extract date from URL: ${journal.url}`);
          continue;
        }

        const dateStr = dateMatch[1];
        const gazetteDate = fromISODate(dateStr);

        // Check if date is in our crawl range
        if (!this.isInDateRange(gazetteDate)) {
          logger.debug(`Gazette date ${dateStr} is outside crawl range`);
          continue;
        }

        // The PDF URL is the journal URL itself (it serves PDF directly)
        const pdfUrl = journal.url.startsWith("http")
          ? journal.url
          : `https://transparencia.saobento.pb.gov.br${journal.url}`;

        // Skip if already processed
        if (processedUrls.has(pdfUrl)) {
          logger.debug(`Skipping duplicate PDF URL: ${pdfUrl}`);
          continue;
        }

        processedUrls.add(pdfUrl);

        // Create the gazette
        const gazette = await this.createGazette(gazetteDate, pdfUrl, {
          power: "executive_legislative",
          sourceText:
            journal.title ||
            `Diário Oficial de São Bento - ${toISODate(gazetteDate)}`,
          skipUrlResolution: true, // URL serves PDF directly
        });

        if (gazette) {
          gazettes.push(gazette);
          logger.debug(`Added gazette: ${journal.title} - ${dateStr}`);
        }
      } catch (error) {
        logger.error(`Error processing journal:`, error as Error);
      }
    }

    return gazettes;
  }

  /**
   * Extract journal data from the Inertia.js JSON embedded in the HTML
   */
  private extractJournalsFromHtml(
    html: string,
  ): Array<{ id: number; title: string; url: string }> {
    const journals: Array<{ id: number; title: string; url: string }> = [];

    try {
      // The Inertia.js data is embedded in a div with id="app" as data-page attribute
      // Format: <div id="app" data-page="{...JSON...}"></div>
      const dataPageMatch = html.match(/data-page="([^"]+)"/);

      if (!dataPageMatch) {
        logger.debug("Could not find data-page attribute in HTML");
        return journals;
      }

      // Decode HTML entities and parse JSON
      const jsonStr = dataPageMatch[1]
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#039;/g, "'");

      const pageData = JSON.parse(jsonStr);

      // Extract journals from the props
      if (
        pageData.props &&
        pageData.props.journals &&
        Array.isArray(pageData.props.journals)
      ) {
        for (const journal of pageData.props.journals) {
          if (journal.id && journal.url) {
            journals.push({
              id: journal.id,
              title: journal.title || "",
              url: journal.url,
            });
          }
        }
      }
    } catch (error) {
      logger.error("Error extracting journals from HTML:", error as Error);
    }

    return journals;
  }
}
