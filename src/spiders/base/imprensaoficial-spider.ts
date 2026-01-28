import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  ImprensaOficialConfig,
} from "../../types";
import { logger } from "../../utils/logger";
import {
  toISODate,
  getCurrentTimestamp,
  fromISODate,
} from "../../utils/date-utils";

/**
 * Imprensa Oficial Spider implementation
 *
 * Crawls gazette data from Open T.I. / Imprensa Oficial platform.
 * Uses Knack-based platform for municipalities in Bahia (e.g., Serrinha).
 *
 * URL Structure:
 * - Main page: https://{subdomain}.imprensaoficial.org/
 * - Content is loaded via Knack iframes
 * - Requires browser rendering to access dynamic content
 *
 * Search strategy:
 * - Navigate to "últimos diários" page
 * - Wait for Knack iframe content to load
 * - Extract gazette information from the rendered content
 * - Parse PDF links and dates
 */
export class ImprensaOficialSpider extends BaseSpider {
  protected config: ImprensaOficialConfig;
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(
    spiderConfig: SpiderConfig,
    dateRange: DateRange,
    browser?: Fetcher,
  ) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as ImprensaOficialConfig;

    if (!this.config.subdomain) {
      throw new Error(
        `ImprensaOficialSpider requires subdomain in config for ${spiderConfig.name}`,
      );
    }

    this.baseUrl = `https://${this.config.subdomain}.imprensaoficial.org`;
    this.browser = browser || null;

    logger.info(
      `Initializing ImprensaOficialSpider for ${spiderConfig.name} with subdomain: ${this.config.subdomain}`,
    );
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling Imprensa Oficial for ${this.spiderConfig.name}...`);

    // Check if browser rendering is required
    if (this.config.requiresClientRendering) {
      if (!this.browser) {
        logger.warn(
          `ImprensaOficialSpider for ${this.spiderConfig.name} requires browser rendering but no browser is available. Trying static fetch as fallback.`,
        );
        return this.crawlStatic();
      }
      return this.crawlWithBrowser();
    }

    // Try static crawl first
    return this.crawlStatic();
  }

  /**
   * Crawl using browser rendering (Puppeteer)
   * Required for Knack-based sites that load content via iframes
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    if (!this.browser) {
      logger.error(`Browser is required for ${this.spiderConfig.name}`);
      return gazettes;
    }

    let browserInstance = null;
    let page = null;

    try {
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();

      // Set viewport and user agent
      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      );

      // Navigate to últimos diários page
      const diariosUrl = `${this.baseUrl}/ultimos-diarios`;
      logger.info(`Navigating to: ${diariosUrl}`);

      await page.goto(diariosUrl, {
        waitUntil: "networkidle0",
        timeout: 60000,
      });
      this.requestCount++;

      // Wait for content to load (Knack iframe)
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Try to access iframe content
      const frames = page.frames();
      logger.info(`Found ${frames.length} frames on page`);

      let gazetteData: Array<{
        date: string;
        pdfUrl: string;
        edition: string;
      }> = [];

      // Try to extract from main frame first
      gazetteData = await this.extractGazettesFromPage(page);

      // If no data found, try iframes
      if (gazetteData.length === 0) {
        for (const frame of frames) {
          if (frame !== page.mainFrame()) {
            try {
              const frameData = await this.extractGazettesFromFrame(frame);
              gazetteData.push(...frameData);
            } catch (error) {
              logger.debug(`Error extracting from frame: ${error}`);
            }
          }
        }
      }

      // Convert to gazette objects
      for (const item of gazetteData) {
        if (this.isDateInRange(item.date)) {
          // Normalize the URL: ensure HTTPS and remove double slashes
          const normalizedUrl = this.normalizeUrl(item.pdfUrl);
          const gazette: Gazette = {
            date: item.date,
            fileUrl: normalizedUrl,
            territoryId: this.spiderConfig.territoryId,
            scrapedAt: getCurrentTimestamp(),
            editionNumber: item.edition,
            isExtraEdition: false,
            power: "executive_legislative",
            sourceText: `Diário Oficial - Edição ${item.edition}`,
          };
          gazettes.push(gazette);
          logger.info(
            `Found gazette for ${item.date}: Edition ${item.edition}`,
          );
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
      );
    } catch (error) {
      logger.error(
        `Error crawling with browser for ${this.spiderConfig.name}:`,
        error as Error,
      );
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (e) {
          logger.warn("Error closing page", e as Error);
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (e) {
          logger.warn("Error closing browser", e as Error);
        }
      }
    }

    return gazettes;
  }

  /**
   * Extract gazette data from a Puppeteer page
   */
  private async extractGazettesFromPage(
    page: any,
  ): Promise<Array<{ date: string; pdfUrl: string; edition: string }>> {
    try {
      return await page.evaluate(() => {
        const results: Array<{
          date: string;
          pdfUrl: string;
          edition: string;
        }> = [];

        // Look for gazette entries in various possible structures
        // Knack typically renders data in tables or lists

        // Try to find links to PDFs
        const pdfLinks = document.querySelectorAll('a[href*=".pdf"]');

        for (const link of pdfLinks) {
          const pdfUrl = (link as HTMLAnchorElement).href;
          const container = link.closest("tr, li, div, article");

          if (container) {
            const text = container.textContent || "";

            // Extract date (DD/MM/YYYY format)
            const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            // Extract edition number
            const editionMatch =
              text.match(/(?:Edição|Ed\.?|N[º°]?)\s*(\d+)/i) ||
              text.match(/Diário\s+(\d+)/i);

            if (dateMatch) {
              const day = dateMatch[1];
              const month = dateMatch[2];
              const year = dateMatch[3];
              const isoDate = `${year}-${month}-${day}`;

              results.push({
                date: isoDate,
                pdfUrl: pdfUrl,
                edition: editionMatch ? editionMatch[1] : "N/A",
              });
            }
          }
        }

        // Also try to find structured data from Knack tables
        const rows = document.querySelectorAll("table tbody tr, .kn-list-item");

        for (const row of rows) {
          const text = row.textContent || "";
          const pdfLink = row.querySelector(
            'a[href*=".pdf"]',
          ) as HTMLAnchorElement;

          if (pdfLink) {
            const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            const editionMatch = text.match(/(?:Edição|Ed\.?|N[º°]?)\s*(\d+)/i);

            if (dateMatch) {
              const day = dateMatch[1];
              const month = dateMatch[2];
              const year = dateMatch[3];
              const isoDate = `${year}-${month}-${day}`;

              // Avoid duplicates
              if (!results.find((r) => r.pdfUrl === pdfLink.href)) {
                results.push({
                  date: isoDate,
                  pdfUrl: pdfLink.href,
                  edition: editionMatch ? editionMatch[1] : "N/A",
                });
              }
            }
          }
        }

        return results;
      });
    } catch (error) {
      logger.error("Error extracting gazettes from page:", error as Error);
      return [];
    }
  }

  /**
   * Extract gazette data from an iframe
   */
  private async extractGazettesFromFrame(
    frame: any,
  ): Promise<Array<{ date: string; pdfUrl: string; edition: string }>> {
    try {
      return await frame.evaluate(() => {
        const results: Array<{
          date: string;
          pdfUrl: string;
          edition: string;
        }> = [];

        // Look for gazette entries
        const pdfLinks = document.querySelectorAll(
          'a[href*=".pdf"], a[href*="download"]',
        );

        for (const link of pdfLinks) {
          const href = (link as HTMLAnchorElement).href;
          const container = link.closest("tr, li, div, article");

          if (container) {
            const text = container.textContent || "";

            // Extract date (DD/MM/YYYY format)
            const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            const editionMatch = text.match(/(?:Edição|Ed\.?|N[º°]?)\s*(\d+)/i);

            if (dateMatch) {
              const day = dateMatch[1];
              const month = dateMatch[2];
              const year = dateMatch[3];
              const isoDate = `${year}-${month}-${day}`;

              results.push({
                date: isoDate,
                pdfUrl: href,
                edition: editionMatch ? editionMatch[1] : "N/A",
              });
            }
          }
        }

        return results;
      });
    } catch (error) {
      logger.debug("Error extracting from frame:", error as Error);
      return [];
    }
  }

  /**
   * Static crawl (legacy WordPress-like approach)
   * Kept as fallback for sites that don't require browser rendering
   */
  private async crawlStatic(): Promise<Gazette[]> {
    let gazettes: Gazette[] = [];

    try {
      // First, try to extract from the "Últimos Diários" page
      // This works better for Open T.I. platform sites
      logger.info(
        `Trying static extraction from últimos diários page for ${this.spiderConfig.name}`,
      );
      gazettes = await this.crawlUltimosDiarios();

      if (gazettes.length > 0) {
        logger.info(
          `Successfully crawled ${gazettes.length} gazettes from últimos diários for ${this.spiderConfig.name}`,
        );
        return gazettes;
      }

      // Fallback to month-by-month crawl
      logger.info(
        `No gazettes from últimos diários, trying month crawl for ${this.spiderConfig.name}`,
      );
      const months = this.getMonthsInRange();

      for (const { year, month } of months) {
        const monthGazettes = await this.crawlMonth(year, month);
        gazettes.push(...monthGazettes);
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
   * Crawl from the "Últimos Diários" page
   * This is more reliable for Open T.I. platform sites
   */
  private async crawlUltimosDiarios(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      const ultimosDiariosUrl = `${this.baseUrl}/ultimos-diarios/`;
      logger.info(`Fetching últimos diários: ${ultimosDiariosUrl}`);

      const response = await fetch(ultimosDiariosUrl, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      });

      if (!response.ok) {
        logger.warn(`Failed to fetch últimos diários page: ${response.status}`);
        return gazettes;
      }

      const html = await response.text();

      // Extract edition links from the sidebar (Open T.I. platform)
      // Pattern: href="/edicao-no-XXXX/" or similar
      const editionLinks = this.extractEditionLinks(html);

      logger.info(
        `Found ${editionLinks.length} edition links on últimos diários page`,
      );

      // Fetch each edition page to get PDF links and dates
      for (const link of editionLinks) {
        try {
          const gazette = await this.fetchEditionPage(link);
          if (gazette && this.isDateInRange(gazette.date)) {
            gazettes.push(gazette);
            logger.info(
              `Found gazette for ${gazette.date}: Edition ${gazette.editionNumber}`,
            );
          }
        } catch (error) {
          logger.debug(`Error fetching edition page ${link}: ${error}`);
        }
      }
    } catch (error) {
      logger.error(`Error crawling últimos diários:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Extract edition links from the HTML
   */
  private extractEditionLinks(html: string): string[] {
    const links: string[] = [];

    // Pattern 1: /edicao-no-XXXX/ (Open T.I. standard)
    const editionPattern1 = /href="([^"]*\/edicao-no?-\d+\/?[^"]*)"/gi;
    let match;
    while ((match = editionPattern1.exec(html)) !== null) {
      const url = match[1];
      if (!links.includes(url)) {
        links.push(url);
      }
    }

    // Pattern 2: /edicao/XXXX/ (alternative)
    const editionPattern2 = /href="([^"]*\/edicao\/\d+\/?[^"]*)"/gi;
    while ((match = editionPattern2.exec(html)) !== null) {
      const url = match[1];
      if (!links.includes(url)) {
        links.push(url);
      }
    }

    // Pattern 3: Direct PDF links in sidebar
    const pdfPattern =
      /href="(https?:\/\/[^"]*\.imprensaoficial\.org[^"]*\/pub\/[^"]*\.pdf)"/gi;
    while ((match = pdfPattern.exec(html)) !== null) {
      const url = match[1];
      if (!links.includes(url)) {
        links.push(url);
      }
    }

    return links;
  }

  /**
   * Fetch an edition page and extract gazette info
   */
  private async fetchEditionPage(url: string): Promise<Gazette | null> {
    try {
      const fullUrl = url.startsWith("http") ? url : `${this.baseUrl}${url}`;

      // If it's a direct PDF link, try to extract info from URL
      if (fullUrl.toLowerCase().endsWith(".pdf")) {
        return this.parseDirectPdfUrl(fullUrl);
      }

      const response = await fetch(fullUrl, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      if (!response.ok) {
        return null;
      }

      const html = await response.text();

      // Extract edition number from URL or page content
      const editionMatch =
        url.match(/edicao-?n?o?-?(\d+)/i) ||
        html.match(/Edição\s*N[º°]?\s*(\d+)/i);

      // Extract date - multiple patterns
      // Pattern 1: "DD de MES de YYYY"
      const dateMatch1 = html.match(
        /(\d{1,2})\s*de\s*(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*de\s*(\d{4})/i,
      );
      // Pattern 2: "DD/MM/YYYY"
      const dateMatch2 = html.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      // Pattern 3: From meta tags or structured data
      const dateMatch3 = html.match(
        /(?:publicado|data)[^>]*>?\s*(\d{2})\/(\d{2})\/(\d{4})/i,
      );

      let gazetteDate: string | null = null;

      if (dateMatch1) {
        const day = dateMatch1[1].padStart(2, "0");
        const monthName = dateMatch1[2].toLowerCase();
        const year = dateMatch1[3];
        const month = this.monthNameToNumber(monthName);
        gazetteDate = `${year}-${month.toString().padStart(2, "0")}-${day}`;
      } else if (dateMatch2) {
        gazetteDate = `${dateMatch2[3]}-${dateMatch2[2]}-${dateMatch2[1]}`;
      } else if (dateMatch3) {
        gazetteDate = `${dateMatch3[3]}-${dateMatch3[2]}-${dateMatch3[1]}`;
      }

      // Find PDF link
      const pdfMatch =
        html.match(/href="([^"]+\.pdf)"/i) ||
        html.match(/href='([^']+\.pdf)'/i) ||
        html.match(/(https?:\/\/[^"'\s]+\.pdf)/i);

      if (gazetteDate && pdfMatch) {
        let pdfUrl = pdfMatch[1];
        if (!pdfUrl.startsWith("http")) {
          pdfUrl = pdfUrl.startsWith("/")
            ? `${this.baseUrl.replace(/\/$/, "")}${pdfUrl}`
            : `${this.baseUrl}/${pdfUrl}`;
        }

        return {
          date: gazetteDate,
          fileUrl: pdfUrl,
          territoryId: this.spiderConfig.territoryId,
          scrapedAt: getCurrentTimestamp(),
          editionNumber: editionMatch ? editionMatch[1] : "N/A",
          isExtraEdition: false,
          power: "executive_legislative",
          sourceText: `Diário Oficial - Edição Nº ${editionMatch ? editionMatch[1] : "N/A"}`,
        };
      }

      return null;
    } catch (error) {
      logger.debug(`Error fetching edition page ${url}:`, error as Error);
      return null;
    }
  }

  /**
   * Parse gazette info from a direct PDF URL
   */
  private parseDirectPdfUrl(pdfUrl: string): Gazette | null {
    try {
      // Extract edition number from URL if possible
      // Pattern: /pub/prefeituras/ba/veracruz/2026/proprio/5378.pdf
      const editionMatch = pdfUrl.match(/\/(\d+)\.pdf$/i);
      const yearMatch = pdfUrl.match(/\/(\d{4})\//);

      if (editionMatch && yearMatch) {
        // We don't have the exact date from the URL, so we'll use today's date
        // The date will be validated when processing
        const today = new Date();
        const gazetteDate = toISODate(today);

        return {
          date: gazetteDate,
          fileUrl: pdfUrl,
          territoryId: this.spiderConfig.territoryId,
          scrapedAt: getCurrentTimestamp(),
          editionNumber: editionMatch[1],
          isExtraEdition: false,
          power: "executive_legislative",
          sourceText: `Diário Oficial - Edição ${editionMatch[1]}`,
        };
      }

      return null;
    } catch (error) {
      logger.debug(`Error parsing direct PDF URL ${pdfUrl}:`, error as Error);
      return null;
    }
  }

  /**
   * Get all months in the date range
   */
  private getMonthsInRange(): Array<{ year: number; month: number }> {
    const months: Array<{ year: number; month: number }> = [];

    const startYear = this.startDate.getFullYear();
    const startMonth = this.startDate.getMonth() + 1;
    const endYear = this.endDate.getFullYear();
    const endMonth = this.endDate.getMonth() + 1;

    let currentYear = startYear;
    let currentMonth = startMonth;

    while (
      currentYear < endYear ||
      (currentYear === endYear && currentMonth <= endMonth)
    ) {
      months.push({ year: currentYear, month: currentMonth });

      currentMonth++;
      if (currentMonth > 12) {
        currentMonth = 1;
        currentYear++;
      }
    }

    return months;
  }

  /**
   * Crawl gazettes for a specific month (static approach)
   */
  private async crawlMonth(year: number, month: number): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      // Try to fetch the calendar page for this month
      const calendarUrl = `${this.baseUrl}/calendario/?y=${year}&m=${month}`;
      logger.info(`Fetching calendar for ${month}/${year}: ${calendarUrl}`);

      const response = await fetch(calendarUrl, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      });

      if (!response.ok) {
        // Try alternative: main page with month filter
        const mainPageUrl = `${this.baseUrl}/${year}/${month.toString().padStart(2, "0")}/`;
        logger.info(
          `Calendar failed, trying main page archive: ${mainPageUrl}`,
        );

        const mainResponse = await fetch(mainPageUrl, {
          method: "GET",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        });

        if (mainResponse.ok) {
          const html = await mainResponse.text();
          const monthGazettes = this.parseArchivePage(html, year, month);
          gazettes.push(...monthGazettes);
        }

        return gazettes;
      }

      const html = await response.text();

      // Parse the calendar to find gazette links
      const gazetteLinks = this.parseCalendar(html);

      // Fetch each gazette page to get PDF links
      for (const link of gazetteLinks) {
        const gazette = await this.fetchGazettePage(link);
        if (gazette && this.isDateInRange(gazette.date)) {
          gazettes.push(gazette);
        }
      }
    } catch (error) {
      logger.error(`Error crawling month ${month}/${year}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Parse archive page to extract gazette entries
   */
  private parseArchivePage(
    html: string,
    year: number,
    month: number,
  ): Gazette[] {
    const gazettes: Gazette[] = [];

    // Look for article links with gazette editions
    const articleRegex = /<article[^>]*>[\s\S]*?<\/article>/gi;
    const articles = html.match(articleRegex) || [];

    for (const article of articles) {
      const editionMatch = article.match(/Edição\s*N[º°]\s*(\d+)/i);
      const linkMatch = article.match(/href="([^"]+)"/);
      const dateMatch = article.match(
        /(\d{1,2})\s*de\s*(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*de\s*(\d{4})/i,
      );

      if (editionMatch && linkMatch) {
        const editionNumber = editionMatch[1];

        let gazetteDate: string | null = null;

        if (dateMatch) {
          const day = dateMatch[1].padStart(2, "0");
          const monthName = dateMatch[2].toLowerCase();
          const yearStr = dateMatch[3];
          const monthNum = this.monthNameToNumber(monthName);
          gazetteDate = `${yearStr}-${monthNum.toString().padStart(2, "0")}-${day}`;
        }

        if (gazetteDate && this.isDateInRange(gazetteDate)) {
          const pdfMatch = article.match(/href="([^"]+\.pdf)"/i);

          if (pdfMatch) {
            const gazette: Gazette = {
              date: gazetteDate,
              fileUrl: pdfMatch[1].startsWith("http")
                ? pdfMatch[1]
                : `${this.baseUrl}${pdfMatch[1]}`,
              territoryId: this.spiderConfig.territoryId,
              scrapedAt: getCurrentTimestamp(),
              editionNumber: editionNumber,
              isExtraEdition: false,
              power: "executive_legislative",
              sourceText: `Diário Oficial - Edição Nº ${editionNumber}`,
            };
            gazettes.push(gazette);
            logger.info(
              `Found gazette for ${gazetteDate}: Edition ${editionNumber}`,
            );
          }
        }
      }
    }

    return gazettes;
  }

  /**
   * Parse calendar HTML to extract gazette links
   */
  private parseCalendar(html: string): string[] {
    const links: string[] = [];

    const linkRegex = /href="([^"]+edicao[^"]+)"/gi;
    let match;

    while ((match = linkRegex.exec(html)) !== null) {
      const url = match[1];
      if (!links.includes(url)) {
        links.push(url);
      }
    }

    return links;
  }

  /**
   * Fetch a gazette page and extract the PDF link
   */
  private async fetchGazettePage(url: string): Promise<Gazette | null> {
    try {
      const fullUrl = url.startsWith("http") ? url : `${this.baseUrl}${url}`;

      const response = await fetch(fullUrl, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      if (!response.ok) {
        return null;
      }

      const html = await response.text();

      const editionMatch = html.match(/Edição\s*N[º°]\s*(\d+)/i);
      const dateMatch = html.match(
        /(\d{1,2})\s*de\s*(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*de\s*(\d{4})/i,
      );
      const pdfMatch = html.match(/href="([^"]+\.pdf)"/i);

      if (editionMatch && dateMatch && pdfMatch) {
        const editionNumber = editionMatch[1];
        const day = dateMatch[1].padStart(2, "0");
        const monthName = dateMatch[2].toLowerCase();
        const year = dateMatch[3];
        const month = this.monthNameToNumber(monthName);
        const gazetteDate = `${year}-${month.toString().padStart(2, "0")}-${day}`;

        const pdfUrl = pdfMatch[1].startsWith("http")
          ? pdfMatch[1]
          : `${this.baseUrl}${pdfMatch[1]}`;

        return {
          date: gazetteDate,
          fileUrl: pdfUrl,
          territoryId: this.spiderConfig.territoryId,
          scrapedAt: getCurrentTimestamp(),
          editionNumber: editionNumber,
          isExtraEdition: false,
          power: "executive_legislative",
          sourceText: `Diário Oficial - Edição Nº ${editionNumber}`,
        };
      }

      return null;
    } catch (error) {
      logger.error(`Error fetching gazette page ${url}:`, error as Error);
      return null;
    }
  }

  /**
   * Convert Portuguese month name to number
   */
  private monthNameToNumber(monthName: string): number {
    const months: Record<string, number> = {
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
    return months[monthName.toLowerCase()] || 1;
  }

  /**
   * Check if a date string (YYYY-MM-DD) is within the search range
   */
  private isDateInRange(dateStr: string): boolean {
    try {
      const date = fromISODate(dateStr);
      return date >= this.startDate && date <= this.endDate;
    } catch {
      return false;
    }
  }

  /**
   * Normalize URL: ensure HTTPS and remove double slashes in path
   */
  private normalizeUrl(url: string): string {
    // Convert http:// to https://
    let normalized = url.replace(/^http:\/\//i, "https://");
    // Remove double slashes in path (but not after protocol)
    normalized = normalized.replace(/([^:])\/\/+/g, "$1/");
    return normalized;
  }
}
