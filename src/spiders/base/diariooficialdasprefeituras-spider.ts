import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  DiarioOficialDasPrefeiturasConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse } from "node-html-parser";

/**
 * Spider for Diário Oficial das Prefeituras platform (Piauí state)
 *
 * Platform URL: https://diariooficialdasprefeituras.org/piaui/
 *
 * This is a centralized platform that publishes official gazettes for multiple
 * municipalities in Piauí. Each city has its own section/filter on the platform.
 *
 * Features:
 * - Search by Unidade Gestora (municipality name)
 * - Filter by date period
 * - PDF downloads with edition details
 *
 * Uses fetch-based scraping (no browser required)
 */
export class DiarioOficialDasPrefeiturasSpider extends BaseSpider {
  private _baseUrl: string;
  private _cityName: string;
  private _entidade?: "Câmara" | "Empresa privada" | "Prefeitura";
  private _classificacaoAto?: string | string[];
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as DiarioOficialDasPrefeiturasConfig;
    this._baseUrl =
      platformConfig.baseUrl ||
      "https://diariooficialdasprefeituras.org/piaui/buscas";
    this._cityName = platformConfig.cityName || config.name.split(" - ")[0];
    this._entidade = platformConfig.entidade;
    this._classificacaoAto = platformConfig.classificacaoAto;
    this.browser = browser || null;

    logger.info(
      `Initializing DiarioOficialDasPrefeiturasSpider for ${this._cityName}` +
        (this._entidade ? `, entidade: ${this._entidade}` : "") +
        (this._classificacaoAto
          ? `, classificacaoAto: ${Array.isArray(this._classificacaoAto) ? this._classificacaoAto.join(", ") : this._classificacaoAto}`
          : ""),
    );
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    // Use fetch-based approach - no browser required
    return this.crawlWithFetch();
  }

  /**
   * Format date as DD-MM-YYYY for the platform's expected format.
   * Uses UTC methods since BaseSpider stores dates at UTC midnight.
   */
  private formatDateForSearch(date: Date): string {
    const day = date.getUTCDate().toString().padStart(2, "0");
    const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
    const year = date.getUTCFullYear();
    return `${day}-${month}-${year}`;
  }

  /**
   * Parse date from DD-MM-YYYY format, returning UTC midnight.
   */
  private parseDateFromFormat(dateStr: string): Date | null {
    // Try DD-MM-YYYY format
    const ddmmyyyy = dateStr.match(/(\d{2})-(\d{2})-(\d{4})/);
    if (ddmmyyyy) {
      const [, day, month, year] = ddmmyyyy;
      return new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));
    }

    // Try YYYY-MM-DD format
    const yyyymmdd = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (yyyymmdd) {
      const [, year, month, day] = yyyymmdd;
      return new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));
    }

    return null;
  }

  /**
   * Crawl using fetch for server-rendered content
   */
  private async crawlWithFetch(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      // Build search URL with the platform's actual Ransack query params.
      // The server-side city filter (q[unidade_id_eq]) requires a numeric ID
      // that is loaded via JS, so we filter by city name client-side instead.
      // Date field: q[edicao_data_gteq] / q[edicao_data_lteq] (not data_publicacao).
      const startDateStr = this.formatDateForSearch(this.startDate);
      const endDateStr = this.formatDateForSearch(this.endDate);

      const searchParams = new URLSearchParams();
      searchParams.append("utf8", "✓");
      searchParams.append("q[busca_avancada]", "true");
      searchParams.append("q[edicao_data_gteq]", startDateStr);
      searchParams.append("q[edicao_data_lteq]", endDateStr);
      // Keyword search scoped to city name to reduce irrelevant pages
      searchParams.append("q[nome_or_arquivos_texto_cont]", this._cityName);

      let currentPage = 1;
      let hasMorePages = true;
      const maxPages = 50;
      let consecutiveEmptyPages = 0;
      const maxConsecutiveEmpty = 3;

      const filterInfo = [
        `city: ${this._cityName}`,
        `date range: ${startDateStr} to ${endDateStr}`,
        this._entidade ? `entidade: ${this._entidade}` : null,
        this._classificacaoAto
          ? `classificação: ${Array.isArray(this._classificacaoAto) ? this._classificacaoAto.join(", ") : this._classificacaoAto}`
          : null,
      ]
        .filter(Boolean)
        .join(", ");

      logger.info(
        `DiarioOficialDasPrefeituras: Starting crawl with filters - ${filterInfo}`,
      );

      while (hasMorePages && currentPage <= maxPages) {
        const searchUrl = `${this._baseUrl}/search?${searchParams.toString()}&page=${currentPage}`;

        logger.info(
          `DiarioOficialDasPrefeituras: Fetching page ${currentPage}: ${searchUrl}`,
        );

        const response = await fetch(searchUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
        });
        this.requestCount++;

        if (!response.ok) {
          logger.warn(
            `DiarioOficialDasPrefeituras: Failed to fetch page ${currentPage}: ${response.status}`,
          );
          break;
        }

        const html = await response.text();
        const root = parse(html);

        // Find table rows with gazette data
        const tableRows = root.querySelectorAll("table tbody tr");

        logger.info(
          `DiarioOficialDasPrefeituras: Found ${tableRows.length} table rows on page ${currentPage}`,
        );

        if (tableRows.length === 0) {
          // No more results - check if there's any table at all
          const tables = root.querySelectorAll("table");
          logger.debug(
            `DiarioOficialDasPrefeituras: Found ${tables.length} tables on page`,
          );
          hasMorePages = false;
          break;
        }

        let foundGazettesOnPage = 0;
        let matchingRowsCount = 0;

        for (const row of tableRows) {
          try {
            const cells = row.querySelectorAll("td");
            if (cells.length < 5) {
              logger.debug(
                `DiarioOficialDasPrefeituras: Skipping row with only ${cells.length} cells`,
              );
              continue;
            }

            // Parse row data:
            // Column 0: Edition number (with link)
            // Column 1: Document name
            // Column 2: Publication date (DD-MM-YYYY)
            // Column 3: Entity
            // Column 4: Unidade Gestora (city name)
            // Column 5: Classification
            // Column 6: File link

            const editionCell = cells[0];
            const documentCell = cells[1];
            const dateCell = cells[2];
            const unidadeGestoraCell = cells[4];
            const fileCell = cells[cells.length - 1]; // Last cell has the file link

            // Check if this row matches our city (case-insensitive partial match)
            const unidadeGestora = unidadeGestoraCell?.text?.trim() || "";
            const documentName = documentCell?.text?.trim() || "";

            // Log first few rows for debugging
            if (matchingRowsCount < 3) {
              logger.debug(
                `DiarioOficialDasPrefeituras: Row - UnidadeGestora: "${unidadeGestora}", Document: "${documentName}"`,
              );
            }

            if (
              !unidadeGestora
                .toLowerCase()
                .includes(this._cityName.toLowerCase())
            ) {
              continue;
            }

            matchingRowsCount++;

            // Extract publication date
            const dateText = dateCell?.text?.trim() || "";
            const gazetteDate = this.parseDateFromFormat(dateText);

            if (!gazetteDate) {
              logger.debug(
                `DiarioOficialDasPrefeituras: Could not parse date from: "${dateText}"`,
              );
              continue;
            }

            // Validate date is within range
            if (gazetteDate < this.startDate || gazetteDate > this.endDate) {
              logger.debug(
                `DiarioOficialDasPrefeituras: Date ${dateText} outside range`,
              );
              continue;
            }

            // Extract PDF URL - look for detail link in the file cell
            const allLinks = fileCell?.querySelectorAll("a") || [];
            let detailUrl = "";
            let pdfUrl = "";

            for (const link of allLinks) {
              const href = link.getAttribute("href") || "";
              const text = link.text?.toLowerCase() || "";

              if (href.includes("/doc/") || text.includes("detalhe")) {
                detailUrl = href;
              }
              // Only accept real PDF URLs, not javascript: or void(0)
              if (
                ((href.includes(".pdf") ||
                  href.includes("download") ||
                  text.includes("baixar")) &&
                  !href.includes("javascript:") &&
                  !href.includes("void(0)") &&
                  href.startsWith("/")) ||
                href.startsWith("http")
              ) {
                pdfUrl = href;
              }
            }

            logger.debug(
              `DiarioOficialDasPrefeituras: Found links - detail: "${detailUrl}", pdf: "${pdfUrl}"`,
            );

            // If we have a detail link but no valid direct PDF URL, fetch the detail page to find it
            // Note: javascript:void(0) links require fetching the detail page
            const needsDetailFetch =
              detailUrl && (!pdfUrl || pdfUrl.includes("javascript:"));
            if (needsDetailFetch) {
              if (!detailUrl.startsWith("http")) {
                detailUrl = new URL(
                  detailUrl,
                  "https://diariooficialdasprefeituras.org",
                ).href;
              }

              // Fetch detail page to get actual PDF URL
              try {
                logger.debug(
                  `DiarioOficialDasPrefeituras: Fetching detail page: ${detailUrl}`,
                );
                const detailResponse = await fetch(detailUrl, {
                  headers: {
                    "User-Agent":
                      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                  },
                });
                this.requestCount++;

                if (detailResponse.ok) {
                  const detailHtml = await detailResponse.text();
                  const detailRoot = parse(detailHtml);

                  // Priority 1: Look for fileLink with data-href attribute (contains direct PDF URL)
                  // Example: <a href="javascript:void(0)" data-href="/uploads/files/2026/1/27/...pdf?hash=130692" class="fileLink">
                  // Try multiple selectors for flexibility
                  let fileLink = detailRoot.querySelector(
                    "a.fileLink[data-href]",
                  );
                  if (!fileLink) {
                    fileLink = detailRoot.querySelector('a[data-href*=".pdf"]');
                  }
                  if (!fileLink) {
                    // Try to find any link with data-href attribute
                    const allLinksWithDataHref =
                      detailRoot.querySelectorAll("a[data-href]");
                    for (const link of allLinksWithDataHref) {
                      const dataHref = link.getAttribute("data-href") || "";
                      if (
                        dataHref.includes(".pdf") ||
                        dataHref.includes("/uploads/")
                      ) {
                        fileLink = link;
                        break;
                      }
                    }
                  }

                  if (fileLink) {
                    const dataHref = fileLink.getAttribute("data-href") || "";
                    logger.debug(
                      `DiarioOficialDasPrefeituras: Found fileLink with data-href: "${dataHref}"`,
                    );
                    if (
                      dataHref.includes(".pdf") ||
                      dataHref.includes("/uploads/")
                    ) {
                      // Remove query string hash if present
                      pdfUrl = dataHref.split("?")[0];
                      logger.info(
                        `DiarioOficialDasPrefeituras: Found PDF via data-href: ${pdfUrl}`,
                      );
                    }
                  } else {
                    logger.debug(
                      `DiarioOficialDasPrefeituras: No fileLink with data-href found in detail page`,
                    );
                  }

                  // Priority 2: Look for iframe with PDF viewer
                  // Example: <iframe class="iframeDoc" src="/pdfjs/full?file=/uploads/files/...pdf">
                  if (!pdfUrl) {
                    const iframe = detailRoot.querySelector(
                      'iframe.iframeDoc, iframe[src*="pdfjs"]',
                    );
                    if (iframe) {
                      const iframeSrc = iframe.getAttribute("src") || "";
                      // Extract PDF path from /pdfjs/full?file=/uploads/...
                      const fileMatch = iframeSrc.match(/file=([^&]+\.pdf)/);
                      if (fileMatch) {
                        pdfUrl = decodeURIComponent(fileMatch[1]);
                        logger.debug(
                          `DiarioOficialDasPrefeituras: Found PDF via iframe: ${pdfUrl}`,
                        );
                      }
                    }
                  }

                  // Priority 3: Look for any direct PDF links
                  if (!pdfUrl) {
                    const pdfLinks =
                      detailRoot.querySelectorAll('a[href*=".pdf"]');
                    for (const link of pdfLinks) {
                      const href = link.getAttribute("href") || "";
                      if (
                        href.includes(".pdf") &&
                        !href.includes("javascript:")
                      ) {
                        pdfUrl = href;
                        logger.debug(
                          `DiarioOficialDasPrefeituras: Found PDF via direct link: ${pdfUrl}`,
                        );
                        break;
                      }
                    }
                  }

                  // Priority 4: Try looking for embed/object elements
                  if (!pdfUrl) {
                    const embed = detailRoot.querySelector(
                      'embed[src*=".pdf"], object[data*=".pdf"]',
                    );
                    if (embed) {
                      pdfUrl =
                        embed.getAttribute("src") ||
                        embed.getAttribute("data") ||
                        "";
                    }
                  }
                }
              } catch (detailError) {
                logger.debug(
                  `DiarioOficialDasPrefeituras: Could not fetch detail page: ${detailUrl}`,
                );
              }
            }

            if (!pdfUrl) {
              logger.debug(
                `DiarioOficialDasPrefeituras: No PDF URL found for gazette on ${dateText}`,
              );
              continue;
            }

            // Ensure absolute URL
            if (!pdfUrl.startsWith("http")) {
              pdfUrl = new URL(
                pdfUrl,
                "https://diariooficialdasprefeituras.org",
              ).href;
            }

            // Extract edition number
            const editionText = editionCell?.text?.trim() || "";
            const editionMatch = editionText.match(/(\d+)/);
            const editionNumber = editionMatch ? editionMatch[1] : undefined;

            // Check if it's an extra edition
            const docNameLower = documentName.toLowerCase();
            const isExtraEdition =
              docNameLower.includes("extra") ||
              docNameLower.includes("suplemento") ||
              docNameLower.includes("extraordin");

            logger.info(
              `DiarioOficialDasPrefeituras: Found gazette - Date: ${dateText}, Edition: ${editionNumber}, PDF: ${pdfUrl}`,
            );

            const gazette = await this.createGazette(gazetteDate, pdfUrl, {
              editionNumber,
              isExtraEdition,
              power: "executive_legislative",
            });

            if (gazette) {
              // Check for duplicates
              const exists = gazettes.some((g) => g.fileUrl === pdfUrl);
              if (!exists) {
                gazettes.push(gazette);
                foundGazettesOnPage++;
              }
            }
          } catch (rowError) {
            logger.debug(
              `DiarioOficialDasPrefeituras: Error processing row: ${rowError}`,
            );
          }
        }

        logger.info(
          `DiarioOficialDasPrefeituras: Page ${currentPage}: found ${foundGazettesOnPage} gazettes for ${this._cityName} (${matchingRowsCount} matching rows)`,
        );

        // Check for pagination - look for "next" link
        const nextLink = root.querySelector(
          'a[rel="next"], a.next_page, .pagination a[href*="page="]',
        );
        const nextLinkHref = nextLink?.getAttribute("href") || "";

        // Also check if there are pagination links
        const paginationLinks = root.querySelectorAll(
          '.pagination a, nav[aria-label="pager"] a',
        );
        logger.debug(
          `DiarioOficialDasPrefeituras: Found ${paginationLinks.length} pagination links, next: ${nextLinkHref}`,
        );

        if (!nextLink) {
          hasMorePages = false;
        } else if (foundGazettesOnPage === 0) {
          consecutiveEmptyPages++;
          if (consecutiveEmptyPages >= maxConsecutiveEmpty) {
            logger.info(
              `DiarioOficialDasPrefeituras: Stopping after ${maxConsecutiveEmpty} consecutive pages with no matches for ${this._cityName}`,
            );
            hasMorePages = false;
          } else {
            currentPage++;
          }
        } else {
          consecutiveEmptyPages = 0;
          currentPage++;
        }
      }

      logger.info(
        `DiarioOficialDasPrefeituras: Successfully crawled ${gazettes.length} gazettes for ${this._cityName}`,
      );
    } catch (error) {
      logger.error(
        `DiarioOficialDasPrefeituras: Error crawling ${this._cityName}:`,
        error as Error,
      );
    }

    return gazettes;
  }
}
