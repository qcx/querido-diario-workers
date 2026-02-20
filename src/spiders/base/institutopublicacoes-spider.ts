import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";
import { getCurrentTimestamp } from "../../utils/date-utils";

/**
 * Configuration for Instituto de Publicações spider
 */
export interface InstitutoPublicacoesConfig {
  type: "institutopublicacoes";
  /** Full URL for the gazette page (e.g., "http://www.ruybarbosa.ba.gov.br/diario?codCategoria=0&codSubcategoria=0") */
  url: string;
  /** Whether the site requires client-side JavaScript rendering (default: true) */
  requiresClientRendering?: boolean;
}

/**
 * InstitutoPublicacoesSpider implementation for Cloudflare Workers
 *
 * Instituto de Publicações is a platform used by some municipalities for official gazettes.
 * The platform provides a paginated HTML list with PDF links.
 *
 * The site requires JavaScript rendering to load content (ASP.NET WebForms).
 *
 * The HTML structure contains:
 * - Links with "VER ARQUIVO" text pointing to PDF files
 * - Date in format DD/MM/YYYY in the row context
 * - Edition number in the link text or table cell
 * - Pagination with page numbers
 *
 * Currently used by: Ruy Barbosa (BA)
 */
export class InstitutoPublicacoesSpider extends BaseSpider {
  protected ipConfig: InstitutoPublicacoesConfig;
  protected browser?: Fetcher;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.ipConfig = spiderConfig.config as InstitutoPublicacoesConfig;

    if (!this.ipConfig.url) {
      throw new Error(
        `InstitutoPublicacoesSpider requires url in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing InstitutoPublicacoesSpider for ${spiderConfig.name}`,
    );
  }

  /**
   * Set browser instance for client-side rendering
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    const baseUrl = this.ipConfig.url;

    logger.info(`Crawling ${baseUrl} for ${this.spiderConfig.name}...`, {
      hasBrowser: !!this.browser,
      requiresClientRendering: this.ipConfig.requiresClientRendering,
    });

    // Use browser if available and requiresClientRendering is true
    if (this.browser && this.ipConfig.requiresClientRendering === true) {
      return this.crawlWithBrowser();
    }

    // Check if browser is required but not available
    if (this.ipConfig.requiresClientRendering === true && !this.browser) {
      logger.error(
        "Browser binding required but not available - cannot crawl site that requires JavaScript rendering. Make sure BROWSER binding is configured in wrangler.jsonc.",
      );
      return [];
    }

    // Fallback to direct fetch (will likely fail for JS-rendered sites)
    return this.crawlWithFetch();
  }

  /**
   * Crawl using browser for JavaScript-rendered sites
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    logger.info("Using browser-based crawling for JavaScript-rendered site");
    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();
    const baseUrl = this.ipConfig.url;

    try {
      let currentPage = 1;
      let hasMorePages = true;
      const maxPages = 50; // Reduced for browser crawling

      while (hasMorePages && currentPage <= maxPages) {
        // Build page URL - the site uses 'p' parameter for pagination
        const pageUrl =
          currentPage === 1 ? baseUrl : `${baseUrl}&p=${currentPage}`;

        logger.info(`Fetching page ${currentPage} with browser: ${pageUrl}`);

        try {
          // Use browser to fetch the page
          const response = await this.browser!.fetch(pageUrl, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              Accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
            },
          });

          if (!response.ok) {
            logger.error(`Browser fetch failed with status ${response.status}`);
            break;
          }

          const html = await response.text();
          const $ = this.loadHTML(html);

          // Find all PDF links (look for links containing .pdf or with "VER ARQUIVO" text)
          const pdfLinks = $(
            'a[href*=".pdf"], a:contains("VER ARQUIVO")',
          ).toArray();

          logger.debug(
            `Found ${pdfLinks.length} potential PDF links on page ${currentPage}`,
          );

          if (pdfLinks.length === 0 && currentPage > 1) {
            logger.info(
              `No PDF links found on page ${currentPage}, stopping pagination`,
            );
            hasMorePages = false;
            break;
          }

          let foundGazettesOnPage = 0;

          for (const link of pdfLinks) {
            try {
              const $link = $(link);
              let href = $link.attr("href");

              if (!href || !href.includes(".pdf")) {
                continue;
              }

              // Make URL absolute
              const urlObj = new URL(baseUrl);
              const baseOrigin = urlObj.origin;

              if (href.startsWith("//")) {
                href = `https:${href}`;
              } else if (!href.startsWith("http")) {
                href = new URL(href, baseOrigin).toString();
              }

              // Skip if already seen
              if (seenUrls.has(href)) {
                continue;
              }
              seenUrls.add(href);

              // Try to extract date from the row/context
              const $row = $link.closest(
                "tr, div, li, article, .item, .panel, .card",
              );
              const rowText = $row.text() || "";
              const linkText = $link.text().trim();

              // Try to find date in format DD/MM/YYYY
              const dateMatch = rowText.match(/(\d{2})\/(\d{2})\/(\d{4})/);

              if (!dateMatch) {
                logger.debug(`Could not extract date for: ${href}`);
                continue;
              }

              const [, day, month, year] = dateMatch;
              const dateStr = `${year}-${month}-${day}`;
              const gazetteDate = new Date(dateStr);

              // Check if date is in range
              if (!this.isInDateRange(gazetteDate)) {
                continue;
              }

              // Try to extract edition number
              const editionMatch = rowText.match(
                /(?:Edição|Ed\.?|Nº|N°|Número)\s*(\d+)/i,
              );
              const editionNumber = editionMatch ? editionMatch[1] : undefined;

              const gazette: Gazette = {
                date: dateStr,
                fileUrl: href,
                territoryId: this.spiderConfig.territoryId,
                scrapedAt: getCurrentTimestamp(),
                isExtraEdition: false,
                power: "executive_legislative",
                editionNumber,
                sourceText: linkText || `Diário Oficial ${dateStr}`,
              };

              gazettes.push(gazette);
              foundGazettesOnPage++;
              logger.debug(
                `Found gazette: ${dateStr} - Edition ${editionNumber || "N/A"} - ${href}`,
              );
            } catch (error) {
              logger.warn(`Error processing PDF link:`, {
                error: (error as Error).message,
              });
            }
          }

          logger.info(
            `Found ${foundGazettesOnPage} gazettes on page ${currentPage}`,
          );

          // Check for next page
          const nextPageLink = $(
            `a[href*="p=${currentPage + 1}"], a:contains("»"), a:contains("Próximo")`,
          ).first();

          if (nextPageLink.length === 0 || foundGazettesOnPage === 0) {
            hasMorePages = false;
          } else {
            currentPage++;
          }

          // Small delay between pages
          if (hasMorePages) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        } catch (error) {
          logger.error(
            `Error fetching page ${currentPage} with browser:`,
            error as Error,
          );
          hasMorePages = false;
        }
      }

      logger.info(
        `Browser crawl completed: ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
      );
    } catch (error) {
      logger.error(
        `Error in browser crawl for ${this.spiderConfig.name}:`,
        error as Error,
      );
    }

    return gazettes;
  }

  /**
   * Fallback to direct fetch (for sites that don't require JS rendering)
   */
  private async crawlWithFetch(): Promise<Gazette[]> {
    logger.info("Using fetch-based crawling");
    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();
    const baseUrl = this.ipConfig.url;

    try {
      let currentPage = 1;
      let hasMorePages = true;
      const maxPages = 100;

      while (hasMorePages && currentPage <= maxPages) {
        const pageUrl =
          currentPage === 1 ? baseUrl : `${baseUrl}&p=${currentPage}`;

        logger.info(`Fetching page ${currentPage}: ${pageUrl}`);

        try {
          const html = await this.fetch(pageUrl);
          const $ = this.loadHTML(html);

          const pdfLinks = $(
            'a[href*=".pdf"], a:contains("VER ARQUIVO")',
          ).toArray();

          if (pdfLinks.length === 0 && currentPage > 1) {
            logger.info(
              `No PDF links found on page ${currentPage}, stopping pagination`,
            );
            hasMorePages = false;
            break;
          }

          let foundGazettesOnPage = 0;

          for (const link of pdfLinks) {
            try {
              const $link = $(link);
              let href = $link.attr("href");

              if (!href || !href.includes(".pdf")) {
                continue;
              }

              const urlObj = new URL(baseUrl);
              const baseOrigin = urlObj.origin;

              if (href.startsWith("//")) {
                href = `https:${href}`;
              } else if (!href.startsWith("http")) {
                href = new URL(href, baseOrigin).toString();
              }

              if (seenUrls.has(href)) {
                continue;
              }
              seenUrls.add(href);

              const $row = $link.closest("tr, div, li, article, .item");
              const rowText = $row.text() || "";
              const linkText = $link.text().trim();

              const dateMatch = rowText.match(/(\d{2})\/(\d{2})\/(\d{4})/);

              if (!dateMatch) {
                logger.debug(`Could not extract date for: ${href}`);
                continue;
              }

              const [, day, month, year] = dateMatch;
              const dateStr = `${year}-${month}-${day}`;
              const gazetteDate = new Date(dateStr);

              if (!this.isInDateRange(gazetteDate)) {
                continue;
              }

              const editionMatch = rowText.match(
                /(?:Edição|Ed\.?|Nº|N°|Número)\s*(\d+)/i,
              );
              const editionNumber = editionMatch ? editionMatch[1] : undefined;

              const gazette: Gazette = {
                date: dateStr,
                fileUrl: href,
                territoryId: this.spiderConfig.territoryId,
                scrapedAt: getCurrentTimestamp(),
                isExtraEdition: false,
                power: "executive_legislative",
                editionNumber,
                sourceText: linkText || `Diário Oficial ${dateStr}`,
              };

              gazettes.push(gazette);
              foundGazettesOnPage++;
              logger.debug(
                `Found gazette: ${dateStr} - Edition ${editionNumber || "N/A"}`,
              );
            } catch (error) {
              logger.warn(`Error processing PDF link:`, {
                error: (error as Error).message,
              });
            }
          }

          logger.info(
            `Found ${foundGazettesOnPage} gazettes on page ${currentPage}`,
          );

          const nextPageLink = $(
            `a[href*="p=${currentPage + 1}"], a:contains("»"), a:contains("Próximo"), a:contains("${currentPage + 1}")`,
          ).first();

          if (nextPageLink.length === 0 || foundGazettesOnPage === 0) {
            hasMorePages = false;
          } else {
            currentPage++;
          }

          if (hasMorePages) {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        } catch (error) {
          logger.error(`Error fetching page ${currentPage}:`, error as Error);
          hasMorePages = false;
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
