import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  SogoTecnologiaConfig,
} from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse, HTMLElement } from "node-html-parser";
import { toISODate } from "../../utils/date-utils";

/**
 * SOGO Tecnologia WordPress Spider
 *
 * Used by municipalities with WordPress sites built by SOGO Tecnologia.
 * These sites organize official gazettes by year pages with direct PDF links.
 *
 * URL pattern: {baseUrl}diario-oficial-{year}/
 * PDF pattern: wp-content/uploads/YEAR/MONTH/EDICAO-No-XXX-DE-DD-DE-MES-DE-YYYY.pdf
 *
 * HTML Structure:
 * - Each gazette entry has a heading with the date in Portuguese (e.g., "TERÇA-FEIRA, 27 DE JANEIRO DE 2026")
 * - Link with date in DD/MM/YYYY format pointing to PDF
 * - Pagination with page/N pattern
 *
 * Example: https://trindade.pe.gov.br/diario-oficial/diario-oficial-2026/
 */
export class SogoTecnologiaSpider extends BaseSpider {
  protected platformConfig: SogoTecnologiaConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.platformConfig = spiderConfig.config as SogoTecnologiaConfig;

    if (!this.platformConfig.baseUrl) {
      throw new Error(
        `SogoTecnologiaSpider requires a baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing SogoTecnologiaSpider for ${spiderConfig.name} with URL: ${this.platformConfig.baseUrl}`,
    );
  }

  /**
   * Month names in Portuguese
   */
  private readonly monthNames: Record<string, number> = {
    janeiro: 1,
    fevereiro: 2,
    março: 3,
    marco: 3,
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

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.platformConfig.baseUrl} for ${this.spiderConfig.name}...`,
    );

    const gazettes: Gazette[] = [];
    const startYear = this.platformConfig.startYear || 2019;
    const endYear = new Date(this.dateRange.end).getFullYear();
    const startDateObj = new Date(this.dateRange.start);
    const endDateObj = new Date(this.dateRange.end);

    // Iterate through years (newest to oldest for efficiency)
    for (let year = endYear; year >= startYear; year--) {
      // Skip years that are entirely outside our date range
      const yearStart = new Date(`${year}-01-01`);
      const yearEnd = new Date(`${year}-12-31`);

      if (yearEnd < startDateObj) {
        logger.debug(`Skipping year ${year} - before date range`);
        break; // All subsequent years will also be before range
      }

      if (yearStart > endDateObj) {
        logger.debug(`Skipping year ${year} - after date range`);
        continue;
      }

      const yearGazettes = await this.crawlYear(year);
      gazettes.push(...yearGazettes);
    }

    logger.info(
      `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
    );

    return gazettes;
  }

  /**
   * Build URL for a specific year page
   */
  private buildYearUrl(year: number, page: number = 1): string {
    const basePattern =
      this.platformConfig.yearUrlPattern || "{baseUrl}diario-oficial-{year}/";
    const baseUrl = basePattern
      .replace("{baseUrl}", this.platformConfig.baseUrl)
      .replace("{year}", String(year));

    return page === 1 ? baseUrl : `${baseUrl}page/${page}/`;
  }

  /**
   * Crawl all pages for a specific year
   */
  private async crawlYear(year: number): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let page = 1;
    let hasMorePages = true;
    const maxPages = 50; // Safety limit

    while (hasMorePages && page <= maxPages) {
      const pageUrl = this.buildYearUrl(year, page);

      try {
        logger.debug(`Fetching ${pageUrl}`);
        const html = await this.fetch(pageUrl);
        const root = parse(html);

        const pageGazettes = await this.extractGazettesFromPage(root, year);

        if (pageGazettes.length === 0) {
          logger.debug(`No gazettes found on page ${page} of year ${year}`);
          hasMorePages = false;
          continue;
        }

        // Filter by date range and add to results
        for (const gazette of pageGazettes) {
          const gazetteDate = new Date(gazette.date);
          if (this.isInDateRange(gazetteDate)) {
            gazettes.push(gazette);
          }
        }

        // Check if we've gone past our date range (for optimization)
        const oldestOnPage = pageGazettes.reduce((oldest, g) => {
          const date = new Date(g.date);
          return date < oldest ? date : oldest;
        }, new Date());

        if (oldestOnPage < new Date(this.dateRange.start)) {
          logger.debug(
            `Found gazettes older than date range on page ${page}, stopping year ${year}`,
          );
          hasMorePages = false;
          continue;
        }

        // Check for next page
        const paginationLinks = root.querySelectorAll(
          'a[href*="/page/"], .pagination a, .nav-links a',
        );
        const nextPageLink = Array.from(paginationLinks).find(
          (link: HTMLElement) => {
            const href = link.getAttribute("href") || "";
            return href.includes(`/page/${page + 1}`);
          },
        );

        if (!nextPageLink) {
          hasMorePages = false;
        }

        page++;
      } catch (error) {
        if ((error as any)?.message?.includes("404")) {
          logger.debug(`Year ${year} page ${page} not found (404), stopping`);
          hasMorePages = false;
        } else {
          logger.error(
            `Error fetching page ${page} for year ${year}:`,
            error as Error,
          );
          hasMorePages = false;
        }
      }
    }

    logger.debug(`Found ${gazettes.length} gazettes for year ${year}`);
    return gazettes;
  }

  /**
   * Extract gazettes from a page
   */
  private async extractGazettesFromPage(
    root: HTMLElement,
    year: number,
  ): Promise<Gazette[]> {
    // Use detail pages mode if configured
    if (this.platformConfig.usesDetailPages) {
      return this.extractGazettesFromDetailPageLinks(root, year);
    }

    return this.extractGazettesFromDirectPdfLinks(root, year);
  }

  /**
   * Extract gazettes from direct PDF links (original pattern)
   */
  private async extractGazettesFromDirectPdfLinks(
    root: HTMLElement,
    year: number,
  ): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    // Pattern 1: Look for headings with date followed by links
    // The SOGO pattern typically has:
    // <h1/h2/h3>TERÇA-FEIRA, 27 DE JANEIRO DE 2026</h1>
    // <a href="...pdf">27/01/2026</a>

    // Find all links that contain dates in DD/MM/YYYY format
    const allLinks = root.querySelectorAll("a[href]");

    for (const link of allLinks) {
      try {
        const href = link.getAttribute("href") || "";
        // Try multiple methods to get text content (different parsers behave differently)
        const linkText = (
          link.textContent ||
          link.text ||
          link.innerText ||
          link.rawText ||
          ""
        ).trim();

        // Check if this is a PDF link or a link to a gazette
        if (!href.includes(".pdf") && !href.includes("wp-content/uploads")) {
          continue;
        }

        // Try to extract date from link text (DD/MM/YYYY)
        const dateMatch = linkText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        let gazetteDate: Date | null = null;

        if (dateMatch) {
          const [, day, month, yearStr] = dateMatch;
          gazetteDate = new Date(`${yearStr}-${month}-${day}`);
        } else {
          // Try to extract date from PDF filename
          // Pattern 1: EDICAO-No-XXX-DE-DD-DE-MES-DE-YYYY.pdf
          const filenameMatch = href.match(
            /DE-(\d{2})-DE-(\w+)-DE-(\d{4})(?:-\d+)?\.pdf/i,
          );
          if (filenameMatch) {
            const [, day, monthName, yearStr] = filenameMatch;
            const month = this.monthNames[monthName.toLowerCase()];
            if (month) {
              gazetteDate = new Date(
                `${yearStr}-${String(month).padStart(2, "0")}-${day}`,
              );
            }
          }

          // Pattern 2: D.O-DD-MM-YY-EDITION.pdf (Conde-PB pattern)
          // Example: D.O-27-01-26-2.686.pdf -> 27/01/2026
          if (!gazetteDate) {
            const condeDateMatch = href.match(
              /D\.O-(\d{2})-(\d{2})-(\d{2})-[\d.]+(?:[_-][A-Za-z]+)?\.pdf/i,
            );
            if (condeDateMatch) {
              const [, day, month, yearShort] = condeDateMatch;
              const yearFull =
                parseInt(yearShort) > 50 ? `19${yearShort}` : `20${yearShort}`;
              gazetteDate = new Date(`${yearFull}-${month}-${day}`);
            }
          }
        }

        if (!gazetteDate || isNaN(gazetteDate.getTime())) {
          // If no date found, try to get it from a nearby heading
          const parentElement = link.parentNode;
          if (parentElement) {
            const siblingHeading = parentElement.querySelector(
              "h1, h2, h3, h4, h5, h6",
            );
            if (siblingHeading) {
              gazetteDate = this.parseDateFromHeading(
                siblingHeading.text || "",
              );
            }
          }
        }

        if (!gazetteDate || isNaN(gazetteDate.getTime())) {
          logger.debug(`Could not parse date from link: ${linkText} (${href})`);
          continue;
        }

        // Construct full PDF URL
        let pdfUrl = href;
        if (!pdfUrl.startsWith("http")) {
          const baseUrlObj = new URL(this.platformConfig.baseUrl);
          pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith("/") ? "" : "/"}${pdfUrl}`;
        }

        // Extract edition number from filename
        let editionNumber: string | undefined;
        const editionMatch = href.match(/EDICAO[_-]?N[oº]?[_-]?(\d+)/i);
        if (editionMatch) {
          editionNumber = editionMatch[1];
        } else {
          // Pattern: D.O-DD-MM-YY-EDITION.pdf (Conde-PB pattern)
          // Example: D.O-27-01-26-2.686.pdf -> edition 2686
          const condeEditionMatch = href.match(
            /D\.O-\d{2}-\d{2}-\d{2}-([\d.]+)(?:[_-][A-Za-z]+)?\.pdf/i,
          );
          if (condeEditionMatch) {
            editionNumber = condeEditionMatch[1].replace(/\./g, "");
          }
        }

        // Check if extra edition
        const isExtraEdition =
          href.toLowerCase().includes("extra") ||
          href.toLowerCase().includes("suplementar") ||
          href.includes("-A.pdf") ||
          href.includes("-B.pdf");

        // Create gazette
        const gazette = await this.createGazette(gazetteDate, pdfUrl, {
          editionNumber,
          isExtraEdition,
          power: "executive_legislative",
          sourceText: `Edição ${editionNumber || "N/A"} - ${toISODate(gazetteDate)}`,
        });

        if (gazette) {
          gazettes.push(gazette);
        }
      } catch (error) {
        logger.error(`Error processing link:`, error as Error);
      }
    }

    // Deduplicate by PDF URL
    const uniqueGazettes = gazettes.reduce((acc, gazette) => {
      const existing = acc.find((g) => g.fileUrl === gazette.fileUrl);
      if (!existing) {
        acc.push(gazette);
      }
      return acc;
    }, [] as Gazette[]);

    return uniqueGazettes;
  }

  /**
   * Extract gazettes from detail page links (e.g., Campina Grande pattern)
   * Links point to article pages that contain PDF downloads
   *
   * Pattern: Link text contains title like "SEMANÁRIO OFICIAL Nº 2.971 – 19 A 23 DE JANEIRO DE 2026"
   * or "SEPARATA DO SEMANÁRIO OFICIAL – 28 DE JANEIRO DE 2026"
   */
  private async extractGazettesFromDetailPageLinks(
    root: HTMLElement,
    year: number,
  ): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const allLinks = root.querySelectorAll("a[href]");
    const baseUrlObj = new URL(this.platformConfig.baseUrl);
    const detailUrls: {
      url: string;
      date: Date;
      editionNumber?: string;
      isExtraEdition: boolean;
      title: string;
    }[] = [];

    // First pass: collect all gazette detail page URLs with dates
    for (const link of allLinks) {
      try {
        const href = link.getAttribute("href") || "";
        const linkText = link.text?.trim() || "";

        // Skip PDFs, external links, and pagination
        if (
          href.includes(".pdf") ||
          href.includes("/page/") ||
          !href.includes(baseUrlObj.hostname.replace("www.", ""))
        ) {
          continue;
        }

        // Match gazette titles like:
        // "SEMANÁRIO OFICIAL Nº 2.971 – 19 A 23 DE JANEIRO DE 2026"
        // "SEPARATA DO SEMANÁRIO OFICIAL – 28 DE JANEIRO DE 2026"
        const gazettePatterns = [
          /SEMANÁRIO\s+OFICIAL.*?(\d{1,2})\s*(?:A\s*\d{1,2})?\s+DE\s+(\w+)\s+DE\s+(\d{4})/i,
          /SEPARATA.*?(\d{1,2})\s+DE\s+(\w+)\s+DE\s+(\d{4})/i,
          /DIÁRIO\s+OFICIAL.*?(\d{1,2})\s*(?:A\s*\d{1,2})?\s+DE\s+(\w+)\s+DE\s+(\d{4})/i,
        ];

        let gazetteDate: Date | null = null;
        let matched = false;

        for (const pattern of gazettePatterns) {
          const match = linkText.match(pattern);
          if (match) {
            const [, day, monthName, yearStr] = match;
            const month = this.monthNames[monthName.toLowerCase()];
            if (month) {
              gazetteDate = new Date(
                `${yearStr}-${String(month).padStart(2, "0")}-${day.padStart(2, "0")}`,
              );
              matched = true;
              break;
            }
          }
        }

        // Also try DD/MM/YYYY or DD/MM/YY format in link text
        if (!matched) {
          // First try 4-digit year
          let dateMatch = linkText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (dateMatch) {
            const [, day, month, yearStr] = dateMatch;
            gazetteDate = new Date(`${yearStr}-${month}-${day}`);
            matched = true;
          } else {
            // Try 2-digit year (e.g., "30/12/25" -> "2025-12-30")
            dateMatch = linkText.match(/(\d{2})\/(\d{2})\/(\d{2})\b/);
            if (dateMatch) {
              const [, day, month, yearShort] = dateMatch;
              const yearFull =
                parseInt(yearShort) > 50 ? `19${yearShort}` : `20${yearShort}`;
              gazetteDate = new Date(`${yearFull}-${month}-${day}`);
              matched = true;
            }
          }
        }

        if (!gazetteDate || isNaN(gazetteDate.getTime())) {
          continue;
        }

        // Extract edition number
        const editionMatch = linkText.match(/N[ºo°]\s*([\d.,]+)/i);
        const editionNumber = editionMatch
          ? editionMatch[1].replace(/[.,]/g, "")
          : undefined;

        // Check if extra edition (SEPARATA)
        const isExtraEdition =
          linkText.toLowerCase().includes("separata") ||
          linkText.toLowerCase().includes("extra") ||
          linkText.toLowerCase().includes("suplemento");

        let fullUrl = href;
        if (!fullUrl.startsWith("http")) {
          fullUrl = `${baseUrlObj.origin}${fullUrl.startsWith("/") ? "" : "/"}${fullUrl}`;
        }

        detailUrls.push({
          url: fullUrl,
          date: gazetteDate,
          editionNumber,
          isExtraEdition,
          title: linkText,
        });
      } catch (error) {
        logger.debug(`Error processing detail link:`, error);
      }
    }

    logger.debug(`Found ${detailUrls.length} detail page URLs to process`);

    // Second pass: fetch each detail page and extract PDF links
    for (const detail of detailUrls) {
      try {
        logger.debug(`Fetching detail page: ${detail.url}`);
        const detailHtml = await this.fetch(detail.url);
        const detailRoot = parse(detailHtml);

        // Look for PDF links in the detail page
        const pdfLinks = detailRoot.querySelectorAll(
          'a[href*=".pdf"], a[href*="wp-content/uploads"]',
        );

        if (pdfLinks.length === 0) {
          logger.debug(`No PDF links found on detail page: ${detail.url}`);
          continue;
        }

        for (const pdfLink of pdfLinks) {
          const pdfHref = pdfLink.getAttribute("href") || "";
          if (!pdfHref.includes(".pdf")) {
            continue;
          }

          let pdfUrl = pdfHref;
          if (!pdfUrl.startsWith("http")) {
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith("/") ? "" : "/"}${pdfUrl}`;
          }

          const gazette = await this.createGazette(detail.date, pdfUrl, {
            editionNumber: detail.editionNumber,
            isExtraEdition: detail.isExtraEdition,
            power: "executive_legislative",
            sourceText: detail.title,
          });

          if (gazette) {
            gazettes.push(gazette);
          }
        }
      } catch (error) {
        logger.debug(`Error fetching detail page ${detail.url}:`, error);
      }
    }

    // Deduplicate by PDF URL
    const uniqueGazettes = gazettes.reduce((acc, gazette) => {
      const existing = acc.find((g) => g.fileUrl === gazette.fileUrl);
      if (!existing) {
        acc.push(gazette);
      }
      return acc;
    }, [] as Gazette[]);

    return uniqueGazettes;
  }

  /**
   * Parse date from a heading like "TERÇA-FEIRA, 27 DE JANEIRO DE 2026"
   */
  private parseDateFromHeading(text: string): Date | null {
    try {
      // Pattern: DIA DA SEMANA, DD DE MÊS DE YYYY
      const match = text.match(/(\d{1,2})\s+DE\s+(\w+)\s+DE\s+(\d{4})/i);
      if (!match) {
        return null;
      }

      const [, day, monthName, year] = match;
      const month = this.monthNames[monthName.toLowerCase()];

      if (!month) {
        return null;
      }

      return new Date(
        `${year}-${String(month).padStart(2, "0")}-${day.padStart(2, "0")}`,
      );
    } catch (error) {
      return null;
    }
  }
}
