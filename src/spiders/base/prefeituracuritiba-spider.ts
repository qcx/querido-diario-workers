import puppeteer from "@cloudflare/puppeteer";
import type { Fetcher } from "@cloudflare/workers-types";
import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig, DateRange } from "../../types";
import { logger } from "../../utils/logger";

interface PrefeituracuritibaConfig {
  type: "prefeituracuritiba";
  baseUrl: string;
}

interface CuritibaRow {
  editionNumber: string;
  dateStr: string;
  linkId: string;
}

export class PrefeituracuritibaSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as unknown as PrefeituracuritibaConfig;
    this.baseUrl = platformConfig.baseUrl;
    this.browser = browser ?? null;
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    if (this.browser) {
      return this.crawlWithBrowser();
    }
    return this.crawlWithFetch();
  }

  /**
   * Crawl using Puppeteer: click "Visualizar" and intercept the actual PDF/document URL.
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance: unknown = null;
    let page: unknown = null;

    try {
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();

      const startDate = new Date(this.dateRange.start);
      const endDate = new Date(this.dateRange.end);
      let currentDate = new Date(
        startDate.getFullYear(),
        startDate.getMonth(),
        1,
      );

      while (currentDate <= endDate) {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        logger.info(
          `Fetching Curitiba gazettes for ${year}/${month} (browser)`,
        );

        await page.goto(this.baseUrl, {
          waitUntil: "networkidle0",
          timeout: 30000,
        });
        await new Promise((r) => setTimeout(r, 1500));

        // Select year using the correct selector: ddlGrAno
        await page.select(
          'select[id*="ddlGrAno"], select[name*="ddlGrAno"]',
          year.toString(),
        );
        await new Promise((r) => setTimeout(r, 800));

        // Click the month tab (months are tabs, not dropdown; 0=Jan, 1=Feb, etc.)
        const monthIndex = month - 1;
        await page.evaluate((idx: number) => {
          const tabs = document.querySelectorAll(
            '[id*="__tab_ctl00_cphMasterPrincipal_TabContainer1_tabPanel_"]',
          );
          if (tabs[idx]) (tabs[idx] as HTMLElement).click();
        }, monthIndex);
        await new Promise((r) => setTimeout(r, 2500));

        const rows = await page.evaluate((): CuritibaRow[] => {
          const result: CuritibaRow[] = [];
          const trs = document.querySelectorAll(
            'table[id*="gdvGrid2"] tr.grid_Row, table[id*="gdvGrid"] tr',
          );
          trs.forEach((tr) => {
            const tds = tr.querySelectorAll("td");
            if (tds.length < 3) return;
            const editionNumber = (tds[0].textContent || "").trim();
            const dateStr = (tds[1].textContent || "").trim();
            if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) return;
            const link = tr.querySelector('a[id*="lnkVisualizar"]');
            if (!link) return;
            const linkId = link.getAttribute("id") || "";
            if (linkId) result.push({ editionNumber, dateStr, linkId });
          });
          return result;
        });

        for (const row of rows) {
          const [day, monthStr, yearStr] = row.dateStr.split("/");
          const isoDate = `${yearStr}-${monthStr}-${day}`;
          if (isoDate < this.dateRange.start || isoDate > this.dateRange.end)
            continue;

          const pdfUrl = await this.clickVisualizarAndGetPdfUrl(
            page,
            row.linkId,
          );
          if (!pdfUrl) {
            logger.warn(
              `Could not get PDF URL for Curitiba ${row.dateStr} ed. ${row.editionNumber}`,
            );
            continue;
          }

          gazettes.push({
            date: isoDate,
            editionNumber: row.editionNumber,
            fileUrl: pdfUrl,
            territoryId: this.config.territoryId,
            isExtraEdition: row.editionNumber.toLowerCase().includes("supl"),
            power: "executive",
            scrapedAt: new Date().toISOString(),
          });
          await new Promise((r) => setTimeout(r, 400));
        }

        currentDate.setMonth(currentDate.getMonth() + 1);
        await new Promise((r) => setTimeout(r, 600));
      }

      logger.info(`Found ${gazettes.length} gazettes for Curitiba (browser)`);
    } catch (error) {
      logger.error(`Error crawling Curitiba with browser: ${error}`);
    } finally {
      if (page)
        try {
          await page.close();
        } catch (e) {
          /* ignore */
        }
      if (browserInstance)
        try {
          await browserInstance.close();
        } catch (e) {
          /* ignore */
        }
    }
    return gazettes;
  }

  private async clickVisualizarAndGetPdfUrl(
    page: any,
    linkId: string,
  ): Promise<string | null> {
    const baseOrigin = new URL(this.baseUrl).origin;

    const pdfPromise = page
      .waitForResponse(
        (res: {
          url: () => string;
          status: () => number;
          headers: () => Record<string, string>;
        }) => {
          const url = res.url();
          const ct = (res.headers() || {})["content-type"] || "";
          return (
            res.status() === 200 &&
            (url.includes(".pdf") ||
              ct.includes("application/pdf") ||
              ct.includes("application/octet-stream"))
          );
        },
        { timeout: 15000 },
      )
      .catch(() => null);

    const navPromise = page
      .waitForNavigation({ waitUntil: "load", timeout: 15000 })
      .catch(() => null);

    await page.evaluate((id: string) => {
      const el = document.getElementById(id) as HTMLElement | null;
      if (el) el.click();
    }, linkId);

    const pdfRes = await pdfPromise;
    if (pdfRes) return pdfRes.url();

    await navPromise;
    const currentUrl = page.url();
    let result: string | null = null;
    if (currentUrl && currentUrl !== this.baseUrl) {
      if (currentUrl.includes(".pdf")) {
        result = currentUrl;
      } else {
        const html = await page.evaluate(
          () => document.documentElement.outerHTML,
        );
        const iframeMatch =
          html.match(/<iframe[^>]+src=["']([^"']+)["']/i) ??
          html.match(/<embed[^>]+src=["']([^"']+)["']/i);
        if (iframeMatch) {
          const src = iframeMatch[1].trim();
          if (src && (src.includes(".pdf") || src.includes("pdf"))) {
            result = src.startsWith("http")
              ? src
              : `${baseOrigin}${src.startsWith("/") ? "" : "/"}${src}`;
          }
        }
        if (!result) {
          const objectMatch = html.match(/<object[^>]+data=["']([^"']+)["']/i);
          if (objectMatch) {
            const data = objectMatch[1].trim();
            if (data)
              result = data.startsWith("http")
                ? data
                : `${baseOrigin}${data.startsWith("/") ? "" : "/"}${data}`;
          }
        }
        if (!result) {
          const pdfLinkMatch = html.match(
            /<a[^>]+href=["']([^"']*\.pdf[^"']*)["']/i,
          );
          if (pdfLinkMatch) {
            const href = pdfLinkMatch[1].trim();
            if (href)
              result = href.startsWith("http")
                ? href
                : `${baseOrigin}${href.startsWith("/") ? "" : "/"}${href}`;
          }
        }
        if (
          !result &&
          (currentUrl.toLowerCase().includes("exibir") ||
            currentUrl.toLowerCase().includes("visualizar"))
        ) {
          result = currentUrl;
        }
      }
      if (result) {
        try {
          await page.goBack({ waitUntil: "load", timeout: 10000 });
          await new Promise((r) => setTimeout(r, 800));
        } catch {
          // ignore
        }
      }
    }
    return result;
  }

  /**
   * Fallback: crawl with fetch + POST (may still get list page if site uses popup/session for PDF).
   */
  private async crawlWithFetch(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(
      `Crawling Curitiba Legisladoc for ${this.config.name} (fetch – use browser for real PDFs)...`,
    );

    try {
      const startDate = new Date(this.dateRange.start);
      const endDate = new Date(this.dateRange.end);
      let currentDate = new Date(
        startDate.getFullYear(),
        startDate.getMonth(),
        1,
      );

      while (currentDate <= endDate) {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        logger.info(`Fetching Curitiba gazettes for ${year}/${month}`);

        const response = await fetch(this.baseUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });
        if (!response.ok) break;
        const html = await response.text();

        const viewStateMatch = html.match(/id="__VIEWSTATE"\s+value="([^"]*)"/);
        const eventValidationMatch = html.match(
          /id="__EVENTVALIDATION"\s+value="([^"]*)"/,
        );
        const viewStateGeneratorMatch = html.match(
          /id="__VIEWSTATEGENERATOR"\s+value="([^"]*)"/,
        );
        if (!viewStateMatch || !eventValidationMatch) break;

        const formData = new URLSearchParams();
        formData.append("__VIEWSTATE", viewStateMatch[1]);
        formData.append("__EVENTVALIDATION", eventValidationMatch[1]);
        if (viewStateGeneratorMatch)
          formData.append("__VIEWSTATEGENERATOR", viewStateGeneratorMatch[1]);
        formData.append("ctl00$cphMasterPrincipal$ddlGrAno", year.toString());
        formData.append(
          "ctl00$cphMasterPrincipal$TabContainer1_ClientState",
          `activeTabIndex:${month - 1}`,
        );
        formData.append(
          "ctl00$cphMasterPrincipal$TabContainer1",
          `ctl00$cphMasterPrincipal$TabContainer1$tabPanel_${this.getMonthName(month)}`,
        );

        const searchResponse = await fetch(this.baseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            ...(response.headers.get("set-cookie") && {
              Cookie: response.headers.get("set-cookie") ?? "",
            }),
          },
          body: formData.toString(),
        });
        if (!searchResponse.ok) {
          currentDate.setMonth(currentDate.getMonth() + 1);
          continue;
        }

        const searchHtml = await searchResponse.text();
        const sessionCookie =
          searchResponse.headers.get("set-cookie") ??
          response.headers.get("set-cookie") ??
          "";
        const searchViewStateMatch = searchHtml.match(
          /id="__VIEWSTATE"\s+value="([^"]*)"/,
        );
        const searchEventValidationMatch = searchHtml.match(
          /id="__EVENTVALIDATION"\s+value="([^"]*)"/,
        );
        const searchViewStateGeneratorMatch = searchHtml.match(
          /id="__VIEWSTATEGENERATOR"\s+value="([^"]*)"/,
        );

        const rowRegex =
          /<tr[^>]*class="grid_Row"[^>]*>[\s\S]*?<td[^>]*>([^<]*)<\/td>[\s\S]*?<td[^>]*>(\d{2}\/\d{2}\/\d{4})<\/td>[\s\S]*?__doPostBack\s*\(\s*(?:&#39;|')([^'&]+)(?:&#39;|')/g;
        const rows: Array<{
          editionNumber: string;
          dateStr: string;
          eventTarget: string;
        }> = [];
        let match;
        while ((match = rowRegex.exec(searchHtml)) !== null) {
          rows.push({
            editionNumber: match[1].trim(),
            dateStr: match[2],
            eventTarget: match[3],
          });
        }

        const viewState = searchViewStateMatch?.[1] ?? viewStateMatch[1];
        const eventValidation =
          searchEventValidationMatch?.[1] ?? eventValidationMatch[1];
        const viewStateGenerator =
          searchViewStateGeneratorMatch?.[1] ?? viewStateGeneratorMatch?.[1];

        for (const row of rows) {
          const [day, monthStr, yearStr] = row.dateStr.split("/");
          const isoDate = `${yearStr}-${monthStr}-${day}`;
          if (isoDate < this.dateRange.start || isoDate > this.dateRange.end)
            continue;

          const pdfUrl = await this.getGazetteUrlFromPostback(
            row.eventTarget,
            viewState,
            eventValidation,
            viewStateGenerator,
            sessionCookie,
          );
          if (!pdfUrl) continue;

          gazettes.push({
            date: isoDate,
            editionNumber: row.editionNumber,
            fileUrl: pdfUrl,
            territoryId: this.config.territoryId,
            isExtraEdition: row.editionNumber.toLowerCase().includes("supl"),
            power: "executive",
            scrapedAt: new Date().toISOString(),
          });
          await new Promise((r) => setTimeout(r, 300));
        }

        if (gazettes.length === 0 && rows.length === 0) {
          const simpleDateRegex = /(\d{2})\/(\d{2})\/(\d{4})/g;
          let dateMatch;
          const dates = new Set<string>();
          while ((dateMatch = simpleDateRegex.exec(searchHtml)) !== null) {
            const [, d, m, yr] = dateMatch;
            const isoDate = `${yr}-${m}-${d}`;
            if (
              isoDate >= this.dateRange.start &&
              isoDate <= this.dateRange.end &&
              !dates.has(isoDate)
            ) {
              dates.add(isoDate);
              gazettes.push({
                date: isoDate,
                fileUrl: `${this.baseUrl}#date=${isoDate}`,
                territoryId: this.config.territoryId,
                isExtraEdition: false,
                power: "executive",
                scrapedAt: new Date().toISOString(),
              });
            }
          }
        }

        currentDate.setMonth(currentDate.getMonth() + 1);
        await new Promise((r) => setTimeout(r, 500));
      }
      logger.info(`Found ${gazettes.length} gazettes for Curitiba`);
    } catch (error) {
      logger.error(`Error crawling Curitiba: ${error}`);
    }
    return gazettes;
  }

  private getMonthName(monthNum: number): string {
    const months = [
      "Janeiro",
      "Fevereiro",
      "Marco",
      "Abril",
      "Maio",
      "Junho",
      "Julho",
      "Agosto",
      "Setembro",
      "Outubro",
      "Novembro",
      "Dezembro",
    ];
    return months[monthNum - 1] || "Janeiro";
  }

  private async getGazetteUrlFromPostback(
    eventTarget: string,
    viewState: string,
    eventValidation: string,
    viewStateGenerator: string | undefined,
    sessionCookie: string,
  ): Promise<string | null> {
    const formData = new URLSearchParams();
    formData.append("__EVENTTARGET", eventTarget);
    formData.append("__EVENTARGUMENT", "");
    formData.append("__VIEWSTATE", viewState);
    formData.append("__EVENTVALIDATION", eventValidation);
    if (viewStateGenerator)
      formData.append("__VIEWSTATEGENERATOR", viewStateGenerator);

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    };
    if (sessionCookie) headers.Cookie = sessionCookie;

    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers,
      body: formData.toString(),
      redirect: "follow",
    });

    const contentType = res.headers.get("content-type") ?? "";
    const finalUrl = res.url;

    if (
      finalUrl &&
      finalUrl !== this.baseUrl &&
      (contentType.includes("application/pdf") ||
        finalUrl.toLowerCase().includes(".pdf"))
    )
      return finalUrl;
    if (contentType.includes("application/pdf")) return null;

    const html = await res.text();
    const baseOrigin = new URL(this.baseUrl).origin;

    const iframeMatch =
      html.match(/<iframe[^>]+src=["']([^"']+)["']/i) ??
      html.match(/<embed[^>]+src=["']([^"']+)["']/i);
    if (iframeMatch) {
      const src = iframeMatch[1].trim();
      if (
        src &&
        (src.includes(".pdf") ||
          src.includes("pdf") ||
          src.includes("Visualizar") ||
          src.includes("viewer"))
      )
        return src.startsWith("http")
          ? src
          : `${baseOrigin}${src.startsWith("/") ? "" : "/"}${src}`;
    }
    const objectMatch = html.match(/<object[^>]+data=["']([^"']+)["']/i);
    if (objectMatch) {
      const data = objectMatch[1].trim();
      if (data)
        return data.startsWith("http")
          ? data
          : `${baseOrigin}${data.startsWith("/") ? "" : "/"}${data}`;
    }
    const pdfLinkMatch =
      html.match(/<a[^>]+href=["']([^"']*\.pdf[^"']*)["']/i) ??
      html.match(/href=["']([^"']*(?:download|getfile|pdf)[^"']*)["']/i);
    if (pdfLinkMatch) {
      const href = pdfLinkMatch[1].trim();
      if (href)
        return href.startsWith("http")
          ? href
          : `${baseOrigin}${href.startsWith("/") ? "" : "/"}${href}`;
    }
    if (finalUrl && finalUrl !== this.baseUrl) return finalUrl;
    return null;
  }
}
