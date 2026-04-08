import { format } from "date-fns";
import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange, SigpubConfig } from "../../../types";
import { fetchWithRetry } from "../../../utils/http-client";
import { logger } from "../../../utils/logger";
import { parseBrazilianDate } from "../../../utils/date-utils";

/**
 * SigpubCsrfSpider — generic spider for SIGPub/Vox Tecnologia portals that expose
 * a per-entity search form at `{baseUrl}/pesquisar` protected by a CSRF token.
 *
 * Unlike the consolidated-PDF approach used by the base SigpubSpider, this spider
 * fetches individual publications per municipality/entity by:
 *   1. Performing a GET to `{baseUrl}/pesquisar` to obtain a session cookie and
 *      the hidden `_token` field (CSRF token).
 *   2. Paginating through search results using that token and the configured
 *      `entityId`, which maps to the `entidadeUsuaria` query parameter.
 *
 * Compatible with any SIGPub instance that follows this pattern, including:
 *   - AMR  (diariomunicipal.com.br/amr)
 *   - AMA  (diariomunicipal.com.br/ama)
 *   - and other regional associations on the same platform.
 *
 * Two crawl strategies are available:
 *   - crawlWithDirectUrls: fetch-based, extracts CSRF token then paginates GET requests
 *   - crawlWithBrowser: browser-rendering (Puppeteer) for environments where JS execution
 *     is required or the fetch approach is blocked
 *
 * The `crawl()` method uses fetch by default; pass `{ useBrowser: true }` in the config
 * `extras` field to switch to browser rendering.
 */
export class SigpubCsrfSpider extends BaseSpider {
  protected sigpubConfig: SigpubConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.sigpubConfig = spiderConfig.config as SigpubConfig;
    const cityName = this.sigpubConfig.cityName || this.spiderConfig.name;
    logger.info(
      `Initializing SigpubCsrfSpider for ${cityName} (entityId: ${this.sigpubConfig.entityId}, url: ${this.sigpubConfig.url})`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    const cityName = this.sigpubConfig.cityName || this.spiderConfig.name;
    logger.info(`Crawling SIGPub/CSRF for ${cityName}...`);

    try {
      return await this.crawlWithDirectUrls();
    } catch (error) {
      logger.error(`Error crawling ${cityName}:`, error as Error);
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Derives the search endpoint from the configured base URL.
   * e.g. "https://www.diariomunicipal.com.br/amr/" → "https://www.diariomunicipal.com.br/amr/pesquisar"
   */
  private buildSearchUrl(): string {
    const base = this.sigpubConfig.url.replace(/\/?$/, "/");
    return `${base}pesquisar`;
  }

  /**
   * Returns the host origin from the base URL (e.g. "https://www.diariomunicipal.com.br").
   */
  private buildOrigin(): string {
    try {
      return new URL(this.sigpubConfig.url).origin;
    } catch {
      return "https://www.diariomunicipal.com.br";
    }
  }

  /**
   * Fetches the search page and extracts the CSRF token + session cookies.
   * The CSRF token is tied to the server-side session, so we must forward
   * the session cookie on every subsequent request.
   */
  private async fetchCsrfTokenAndCookies(searchUrl: string): Promise<{ token: string; cookies: string }> {
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:108.0) Gecko/20100101 Firefox/108.0",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch search page: HTTP ${response.status}`);
    }

    const setCookieHeader = response.headers.get("set-cookie") || "";
    const cookies = setCookieHeader
      .split(/,(?=\s*\w+=)/)
      .map((c) => c.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");

    const html = await response.text();
    const $ = this.loadHTML(html);
    const token = $("input#busca_avancada__token").attr("value") || "";

    if (!token) {
      logger.warn("Could not extract CSRF token from search page");
    } else {
      logger.debug(`Extracted CSRF token: ${token.substring(0, 20)}...`);
    }

    if (!cookies) {
      logger.warn("No session cookies received from search page");
    } else {
      logger.debug(`Captured session cookies: ${cookies.substring(0, 40)}...`);
    }

    return { token, cookies };
  }

  /**
   * Parses one search-results page and returns the gazettes found plus whether
   * a next page exists.
   */
  private async parsePage(
    html: string,
    origin: string,
  ): Promise<{ gazettes: Gazette[]; hasNextPage: boolean }> {
    const $ = this.loadHTML(html);
    const gazettes: Gazette[] = [];

    const rows = $("#datatable tbody tr");

    if (rows.length === 0) {
      return { gazettes: [], hasNextPage: false };
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows.eq(i);

      // First <td> contains the entity name link; second contains the title; fourth contains the date
      const allLinks = row.find("td a");
      if (allLinks.length === 0) continue;

      // href is like "/amr/load/FD29F56A" — present on every cell link
      const href = allLinks.first().attr("href") || "";
      const hash = href.match(/\/load\/([A-F0-9]+)$/i)?.[1];
      if (!hash) continue;

      // The date cell is the 4th td (index 3)
      const dateTd = row.find("td").eq(3);
      const dateText = dateTd.text().trim();
      if (!dateText) continue;

      const gazetteDate = parseBrazilianDate(dateText);
      if (isNaN(gazetteDate.getTime())) {
        logger.warn(`Could not parse date: "${dateText}"`);
        continue;
      }

      if (!this.isInDateRange(gazetteDate)) continue;

      // Title is in the second td
      const title = row.find("td").eq(1).text().trim();

      const fileUrl = `${origin}${href}`;

      const gazette = await this.createGazette(gazetteDate, fileUrl, {
        isExtraEdition: false,
        power: "executive",
        sourceText: title,
        skipUrlResolution: true,
        requiresClientRendering: true,
      });

      if (gazette) {
        gazettes.push(gazette);
      }
    }

    // Check whether the "Próxima" pagination button is NOT disabled
    const nextBtn = $("a#datatable_next");
    const hasNextPage =
      nextBtn.length > 0 && !nextBtn.hasClass("disabled");

    return { gazettes, hasNextPage };
  }

  // ---------------------------------------------------------------------------
  // Strategy 1: Fetch-based crawl
  // ---------------------------------------------------------------------------

  /**
   * Crawls the SIGPub search API using plain HTTP requests.
   *
   * Flow:
   *   1. GET {searchUrl} → extract CSRF token
   *   2. Loop pages with GET + query params until the results table is empty
   *   3. Parse each result row into a Gazette
   */
  async crawlWithDirectUrls(): Promise<Gazette[]> {
    const cityName = this.sigpubConfig.cityName || this.spiderConfig.name;
    const searchUrl = this.buildSearchUrl();
    const origin = this.buildOrigin();

    logger.info(`[fetch] Crawling ${searchUrl} for ${cityName} (entityId: ${this.sigpubConfig.entityId})`);

    const { token, cookies } = await this.fetchCsrfTokenAndCookies(searchUrl);
    const formattedStart = format(this.startDate, "dd/MM/yyyy");
    const formattedEnd = format(this.endDate, "dd/MM/yyyy");

    const allGazettes: Gazette[] = [];
    let page = 1;
    let keepGoing = true;

    while (keepGoing) {
      const params = new URLSearchParams({
        "busca_avancada[page]": String(page),
        "busca_avancada[entidadeUsuaria]": this.sigpubConfig.entityId,
        "busca_avancada[nome_orgao]": "",
        "busca_avancada[titulo]": "",
        "busca_avancada[texto]": "",
        "busca_avancada[dataInicio]": formattedStart,
        "busca_avancada[dataFim]": formattedEnd,
        "busca_avancada[Enviar]": "",
        "busca_avancada[_token]": token,
      });

      const pageUrl = `${searchUrl}?${params.toString()}`;
      logger.debug(`[fetch] Fetching page ${page}: ${pageUrl}`);

      let html: string;
      try {
        html = await fetchWithRetry(pageUrl, {
          headers: {
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "pt-BR,pt;q=0.9",
            Cookie: cookies,
            Referer: searchUrl,
          },
        });
      } catch (error) {
        logger.error(`[fetch] Failed to fetch page ${page}:`, error as Error);
        break;
      }

      const { gazettes, hasNextPage } = await this.parsePage(html, origin);

      allGazettes.push(...gazettes);

      logger.info(`[fetch] Page ${page}: found ${gazettes.length} gazettes in range`);

      if (!hasNextPage) {
        keepGoing = false;
      } else {
        page++;
      }
    }

    logger.info(
      `[fetch] Finished. Total gazettes found for ${cityName}: ${allGazettes.length}`,
    );

    return allGazettes;
  }

  // ---------------------------------------------------------------------------
  // Strategy 2: Browser-rendering crawl (Cloudflare Browser Rendering / Puppeteer)
  // ---------------------------------------------------------------------------

  /**
   * Crawls the SIGPub search form using a headless browser.
   *
   * Requires a Puppeteer `browser` instance injected via the `browser` parameter.
   * This is intended for use with Cloudflare Browser Rendering bindings.
   *
   * Flow:
   *   1. Navigate to {searchUrl}
   *   2. Select entity from dropdown, fill date range inputs, submit form
   *   3. Wait for results table, extract rows
   *   4. Paginate by clicking "Próxima" until disabled
   *
   * @param browser - Puppeteer Browser instance from Cloudflare Browser Rendering
   */
  async crawlWithBrowser(browser: {
    newPage(): Promise<BrowserPage>;
  }): Promise<Gazette[]> {
    const cityName = this.sigpubConfig.cityName || this.spiderConfig.name;
    const searchUrl = this.buildSearchUrl();
    const origin = this.buildOrigin();
    const formattedStart = format(this.startDate, "dd/MM/yyyy");
    const formattedEnd = format(this.endDate, "dd/MM/yyyy");

    logger.info(`[browser] Crawling ${searchUrl} for ${cityName} (entityId: ${this.sigpubConfig.entityId})`);

    const page = await browser.newPage();

    try {
      await page.goto(searchUrl, { waitUntil: "networkidle0" });

      // Select the entity in the dropdown
      await page.select(
        "select#busca_avancada_entidadeUsuaria",
        this.sigpubConfig.entityId,
      );

      // Clear and fill the start date field
      await page.$eval(
        "input#busca_avancada_dataInicio",
        (el: HTMLInputElement, val: string) => {
          el.value = val;
        },
        formattedStart,
      );

      // Clear and fill the end date field
      await page.$eval(
        "input#busca_avancada_dataFim",
        (el: HTMLInputElement, val: string) => {
          el.value = val;
        },
        formattedEnd,
      );

      // Submit the form
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle0" }),
        page.click("button#busca_avancada_Enviar"),
      ]);

      const allGazettes: Gazette[] = [];
      const seenHashes = new Set<string>();
      let pageNum = 1;

      while (true) {
        // Wait for the results table
        try {
          await page.waitForSelector("#datatable tbody tr", { timeout: 10000 });
        } catch {
          logger.info(`[browser] No results table on page ${pageNum}`);
          break;
        }

        const html = await page.content();
        const { gazettes, hasNextPage } = await this.parsePage(html, origin);

        // Deduplicate by fileUrl hash across pages
        for (const gazette of gazettes) {
          const hash = gazette.fileUrl.split("/load/")[1];
          if (hash && !seenHashes.has(hash)) {
            seenHashes.add(hash);
            allGazettes.push(gazette);
          }
        }

        logger.info(`[browser] Page ${pageNum}: found ${gazettes.length} gazettes in range`);

        if (!hasNextPage) break;

        // Click the "Próxima" button and wait for navigation
        try {
          await Promise.all([
            page.waitForNavigation({ waitUntil: "networkidle0" }),
            page.click("a#datatable_next:not(.disabled)"),
          ]);
          pageNum++;
        } catch {
          logger.info("[browser] Could not navigate to next page, stopping");
          break;
        }
      }

      logger.info(
        `[browser] Finished. Total gazettes found for ${cityName}: ${allGazettes.length}`,
      );

      return allGazettes;
    } finally {
      await page.close();
    }
  }
}

/**
 * Minimal Puppeteer-compatible page interface for type safety without
 * requiring the full puppeteer package as a dependency.
 */
interface BrowserPage {
  goto(url: string, options?: { waitUntil?: string }): Promise<unknown>;
  select(selector: string, ...values: string[]): Promise<string[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $eval(selector: string, fn: (el: any, ...args: any[]) => any, ...args: any[]): Promise<any>;
  click(selector: string): Promise<void>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
  waitForNavigation(options?: { waitUntil?: string }): Promise<unknown>;
  content(): Promise<string>;
  close(): Promise<void>;
}
