import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse } from "node-html-parser";

/**
 * Configuration for Plataforma de Diagramação spider
 */
export interface DiagramacaoConfig {
  type: "diagramacao";
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/**
 * Spider for "Plataforma de Diagramação" used by municipalities in Tocantins
 *
 * This platform is used by:
 * - Colinas do Tocantins (diario.colinas.to.gov.br)
 * - Araguatins (www.araguatins.to.gov.br/diariooficial)
 *
 * URL Patterns:
 * - List page: {baseUrl}/diariooficial/pesquisa/all/all/all/all/{page}
 * - Download: {baseUrl}/download/diariooficial/edition/{editionId}
 * - View: {baseUrl}/diariooficial/view/{editionId}
 *
 * HTML Structure:
 * - Edition cards with "Edição Nº XXXX" headings
 * - Date in format "dia, DD de mês de YYYY"
 * - Links to "Visualizar" and "Matérias"
 */
export class DiagramacaoSpider extends BaseSpider {
  protected config: DiagramacaoConfig;

  constructor(
    spiderConfig: SpiderConfig,
    dateRange: DateRange,
    browser?: Fetcher,
  ) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as DiagramacaoConfig;

    if (!this.config.baseUrl) {
      throw new Error(
        `DiagramacaoSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing DiagramacaoSpider for ${spiderConfig.name} with URL: ${this.config.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let page = 1;
    let hasMorePages = true;
    const maxPages = 50;

    logger.info(`Starting crawl for ${this.spiderConfig.name}`);

    while (hasMorePages && page <= maxPages) {
      try {
        const pageUrl = `${this.config.baseUrl}/diariooficial/pesquisa/all/all/all/all/${page}`;
        logger.debug(`Fetching page ${page}: ${pageUrl}`);

        const html = await this.fetch(pageUrl);
        const root = parse(html);

        // Find all edition cards - they have headings like "Edição Nº XXXX"
        const editionHeadings = root.querySelectorAll(
          'h3[class*="heading"], h5[class*="heading"], .card h3, .card h5',
        );

        // Also try to find by pattern in text
        const allHeadings = root.querySelectorAll("h3, h5");
        const editionElements: any[] = [];

        for (const heading of allHeadings) {
          const text = heading.text?.trim() || "";
          if (text.match(/Edição\s+N[º°]?\s*\d+/i)) {
            editionElements.push(heading);
          }
        }

        if (editionElements.length === 0) {
          logger.debug(`No editions found on page ${page}, stopping`);
          hasMorePages = false;
          continue;
        }

        logger.debug(
          `Found ${editionElements.length} editions on page ${page}`,
        );

        let foundOlderThanRange = false;

        for (const heading of editionElements) {
          try {
            const gazette = await this.parseEditionElement(heading);
            if (gazette) {
              // Check if gazette is older than our date range
              const gazetteDate = new Date(gazette.date);
              const startDate = new Date(this.dateRange.start);

              if (gazetteDate < startDate) {
                foundOlderThanRange = true;
                continue;
              }

              if (this.isInDateRange(gazetteDate)) {
                gazettes.push(gazette);
              }
            }
          } catch (error) {
            logger.error(`Error parsing edition:`, error as Error);
          }
        }

        // Stop if we found gazettes older than our date range
        if (foundOlderThanRange) {
          logger.debug(
            `Found editions older than date range, stopping pagination`,
          );
          hasMorePages = false;
          continue;
        }

        // Check for next page
        const paginationLinks = root.querySelectorAll('a[href*="pesquisa"]');
        const nextPageLink = Array.from(paginationLinks).find((link) => {
          const href = link.getAttribute("href") || "";
          return href.includes(`/${page + 1}`);
        });

        if (!nextPageLink) {
          hasMorePages = false;
        }

        page++;
      } catch (error) {
        logger.error(`Error fetching page ${page}:`, error as Error);
        hasMorePages = false;
      }
    }

    logger.info(
      `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
    );
    return gazettes;
  }

  /**
   * Parse an edition element to extract gazette information
   */
  private async parseEditionElement(heading: any): Promise<Gazette | null> {
    try {
      const headingText = heading.text?.trim() || "";

      // Extract edition number
      const editionMatch = headingText.match(/Edição\s+N[º°]?\s*(\d+)/i);
      const editionNumber = editionMatch ? editionMatch[1] : undefined;

      // Find the parent card/container
      let container = heading.parentNode;
      for (let i = 0; i < 5 && container; i++) {
        if (
          container.classList?.contains("card") ||
          container.classList?.contains("edition") ||
          container.querySelector?.('a[href*="view"]')
        ) {
          break;
        }
        container = container.parentNode;
      }

      if (!container) {
        container = heading.parentNode;
      }

      // Extract date - look for text like "dia, DD de mês de YYYY"
      let gazetteDate: Date | null = null;
      const containerText = container?.text || "";

      // Try different date patterns
      // Pattern 1: "dia, DD de mês de YYYY"
      const dateMatch1 = containerText.match(
        /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i,
      );
      if (dateMatch1) {
        const [, day, monthName, year] = dateMatch1;
        const month = this.parseMonthName(monthName);
        if (month !== -1) {
          gazetteDate = new Date(parseInt(year), month, parseInt(day));
        }
      }

      // Pattern 2: DD/MM/YYYY
      if (!gazetteDate) {
        const dateMatch2 = containerText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (dateMatch2) {
          const [, day, month, year] = dateMatch2;
          gazetteDate = new Date(`${year}-${month}-${day}`);
        }
      }

      if (!gazetteDate) {
        logger.warn(
          `Could not parse date for edition ${editionNumber}: ${containerText.substring(0, 100)}`,
        );
        return null;
      }

      // Extract view/download link
      const viewLink = container?.querySelector?.(
        'a[href*="view"], a[href*="download"]',
      );
      let viewHref = viewLink?.getAttribute?.("href");

      if (!viewHref) {
        // Try to find link in sibling elements
        const links = container?.querySelectorAll?.("a") || [];
        for (const link of links) {
          const href = link.getAttribute?.("href") || "";
          if (href.includes("view") || href.includes("download")) {
            viewHref = href;
            break;
          }
        }
      }

      if (!viewHref) {
        logger.warn(`No view/download link found for edition ${editionNumber}`);
        return null;
      }

      // Extract edition ID from the view URL
      const editionIdMatch = viewHref.match(/\/(\d+)$/);
      const editionId = editionIdMatch ? editionIdMatch[1] : null;

      if (!editionId) {
        logger.warn(`Could not extract edition ID from URL: ${viewHref}`);
        return null;
      }

      // Fetch the view page to get the actual PDF URL
      // The /download/diariooficial/edition/ endpoint redirects to /ops/501 error
      // We need to extract the PDF URL from the view page JavaScript
      const viewUrl = viewHref.startsWith("http")
        ? viewHref
        : `${this.config.baseUrl}/diariooficial/view/${editionId}`;

      let pdfUrl: string | null = null;

      try {
        const viewHtml = await this.fetch(viewUrl);
        // Extract PDF URL from JavaScript in the view page
        // Format: 'https://www.araguatins.to.gov.br/storage/diarios/2026/01/diario484-signed.pdf'
        const pdfUrlMatch = viewHtml.match(
          /'(https?:\/\/[^']*\/storage\/diarios\/[^']+\.pdf)'/i,
        );

        if (pdfUrlMatch) {
          pdfUrl = pdfUrlMatch[1];
          logger.debug(
            `Extracted PDF URL from view page: ${pdfUrl} for edition ${editionNumber}`,
          );
        } else {
          // Fallback: try to find any PDF URL
          const fallbackMatch = viewHtml.match(
            /'(https?:\/\/[^']*\.pdf)'/i,
          );
          if (fallbackMatch) {
            pdfUrl = fallbackMatch[1];
            logger.debug(
              `Extracted fallback PDF URL: ${pdfUrl} for edition ${editionNumber}`,
            );
          }
        }
      } catch (viewError) {
        logger.warn(
          `Failed to fetch view page for edition ${editionNumber}: ${viewError}`,
        );
      }

      // If we couldn't extract the PDF URL, fall back to the download endpoint
      // (which may work for some municipalities)
      if (!pdfUrl) {
        pdfUrl = `${this.config.baseUrl}/download/diariooficial/edition/${editionId}`;
        logger.debug(
          `Using fallback download URL for edition ${editionNumber}: ${pdfUrl}`,
        );
      }

      // Check if it's an extra edition
      const isExtraEdition =
        headingText.toLowerCase().includes("extra") ||
        headingText.toLowerCase().includes("suplementar");

      return await this.createGazette(gazetteDate, pdfUrl, {
        editionNumber,
        isExtraEdition,
        power: "executive_legislative",
        sourceText: headingText,
      });
    } catch (error) {
      logger.error(`Error parsing edition element:`, error as Error);
      return null;
    }
  }

  /**
   * Parse Portuguese month name to month index (0-11)
   */
  private parseMonthName(monthName: string): number {
    const months: { [key: string]: number } = {
      janeiro: 0,
      fevereiro: 1,
      março: 2,
      marco: 2,
      abril: 3,
      maio: 4,
      junho: 5,
      julho: 6,
      agosto: 7,
      setembro: 8,
      outubro: 9,
      novembro: 10,
      dezembro: 11,
    };

    return months[monthName.toLowerCase()] ?? -1;
  }
}
