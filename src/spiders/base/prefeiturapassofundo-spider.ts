import puppeteer from "@cloudflare/puppeteer";
import type { Fetcher } from "@cloudflare/workers-types";
import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  PrefeiturapassofundoConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";

/**
 * Spider for Prefeitura de Passo Fundo - RS
 *
 * Platform: GRP (Sistema de Gestão de Recursos Públicos)
 * URL: grp.pmpf.rs.gov.br/grp/acessoexterno/programaAcessoExterno.faces?codigo=693795
 *
 * Technology: JSF + RichFaces with AJAX DataTable
 *
 * Flow:
 * 1. Entry URL redirects via JS form POST to diarioOficialEletronicoAcessoExterno.faces
 * 2. Search form with date filters (dd/MM/yyyy)
 * 3. RichFaces ExtendedDataTable with gazette rows
 * 4. "Visualizar" button triggers JSF AJAX that renders PDF in an <embed>
 * 5. PDF served via MediaOutputResource with encoded `do` parameter
 *
 * Table columns:
 *   - Número da Edição (edition number)
 *   - Referência (Normal / Extra)
 *   - Data da Publicação (dd/MM/yyyy)
 *   - Ações (Visualizar buttons)
 */
export class PrefeiturapassofundoSpider extends BaseSpider {
  private entryUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeiturapassofundoConfig;
    this.entryUrl = platformConfig.domUrl || platformConfig.baseUrl;
    this.browser = browser ?? null;
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.warn(
        `PrefeiturapassofundoSpider requires browser rendering, but no browser provided`,
      );
      return [];
    }
    return this.crawlWithBrowser();
  }

  private formatDateBR(date: Date): string {
    const d = date.getUTCDate().toString().padStart(2, "0");
    const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
    const y = date.getUTCFullYear();
    return `${d}/${m}/${y}`;
  }

  private parseDateBR(dateStr: string): string | null {
    const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!match) return null;
    const [, day, month, year] = match;
    return `${year}-${month}-${day}`;
  }

  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance: any = null;
    let page: any = null;

    try {
      logger.info(
        `Crawling Passo Fundo (GRP) with browser for ${this.config.name}...`,
      );

      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();

      await page.goto(this.entryUrl, {
        waitUntil: "networkidle0",
        timeout: 30000,
      });
      this.requestCount++;

      // The entry page does a JS redirect via form POST. Wait for the redirect.
      await new Promise((resolve) => setTimeout(resolve, 6000));

      const currentUrl = page.url();
      if (!currentUrl.includes("diarioOficialEletronico")) {
        // The redirect might not have happened; try waiting longer
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }

      logger.debug(`After redirect, current URL: ${page.url()}`);

      // Fill date filters
      const startDateBR = this.formatDateBR(this.startDate);
      const endDateBR = this.formatDateBR(this.endDate);

      logger.debug(`Setting date filter: ${startDateBR} - ${endDateBR}`);

      await this.fillDateField(
        page,
        "form:dataPublicacao:dataCalendario1InputDate",
        startDateBR,
      );
      await this.fillDateField(
        page,
        "form:dataPublicacao:dataCalendario2InputDate",
        endDateBR,
      );

      // Click search button
      const searchButton = await page.$('input[id="form:j_id_43:0:j_id_47"]');
      if (searchButton) {
        await searchButton.click();
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } else {
        logger.warn("Search button not found, trying alternative selectors...");
        const altButton = await page.$('input[value="Pesquisar"]');
        if (altButton) {
          await altButton.click();
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }

      // Extract total record count
      const totalRecords = await this.getTotalRecords(page);
      logger.info(`Found ${totalRecords} gazette records`);

      if (totalRecords === 0) {
        logger.info("No gazettes found for the given date range");
        return gazettes;
      }

      const totalPages = Math.ceil(totalRecords / 10);
      logger.info(`Total pages to process: ${totalPages}`);

      for (let currentPage = 1; currentPage <= totalPages; currentPage++) {
        logger.debug(`Processing page ${currentPage}/${totalPages}`);

        const pageGazettes = await this.extractGazettesFromTable(page);
        logger.debug(
          `Extracted ${pageGazettes.length} gazette metadata entries from page ${currentPage}`,
        );

        for (const meta of pageGazettes) {
          const gazette = await this.getGazettePdf(page, meta);
          if (gazette) {
            gazettes.push(gazette);
          }
        }

        // Navigate to next page if needed
        if (currentPage < totalPages) {
          const navigated = await this.goToNextPage(page, currentPage + 1);
          if (!navigated) {
            logger.warn(`Failed to navigate to page ${currentPage + 1}`);
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes from Passo Fundo GRP`,
      );
    } catch (error) {
      logger.error(
        `Error crawling PrefeiturapassofundoSpider:`,
        error as Error,
      );
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (_) {}
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (_) {}
      }
    }

    return gazettes;
  }

  private async fillDateField(
    page: any,
    inputId: string,
    value: string,
  ): Promise<void> {
    try {
      const selector = `input[id="${inputId}"]`;
      await page.waitForSelector(selector, { timeout: 5000 });
      await page.$eval(selector, (el: any) => {
        el.value = "";
      });
      await page.type(selector, value, { delay: 50 });
    } catch (error) {
      logger.warn(
        `Could not fill date field ${inputId}: ${(error as Error).message}`,
      );
    }
  }

  private async getTotalRecords(page: any): Promise<number> {
    try {
      const text = await page.evaluate(() => {
        const el = document.querySelector(".divRegistrosDataTable");
        if (el) return el.textContent?.trim() || "";
        const spans = Array.from(document.querySelectorAll("span"));
        for (const span of spans) {
          const t = span.textContent?.trim() || "";
          if (t.match(/\d+\s*registro/i)) return t;
        }
        return "";
      });

      const match = text.match(/(\d+)\s*registro/i);
      return match ? parseInt(match[1], 10) : 0;
    } catch {
      return 0;
    }
  }

  private async extractGazettesFromTable(
    page: any,
  ): Promise<GazetteMetadata[]> {
    const metadata: GazetteMetadata[] = [];

    try {
      const rows = await page.evaluate(() => {
        const results: any[] = [];

        for (let i = 0; i < 20; i++) {
          const rowId = `form:dataTableDiarioOficialEletronico:dataTable:${i}:n`;
          const row = document.getElementById(rowId);
          if (!row) break;

          const tds = row.querySelectorAll("td");
          if (tds.length < 3) continue;

          const edition = tds[0]?.textContent?.trim() || "";
          const reference = tds[1]?.textContent?.trim() || "";
          const date = tds[2]?.textContent?.trim() || "";

          results.push({ rowIndex: i, edition, reference, date });
        }

        if (results.length === 0) {
          const tableRows = document.querySelectorAll("tr.corSim, tr.corNao");
          let idx = 0;
          for (const row of Array.from(tableRows)) {
            const tds = row.querySelectorAll("td");
            if (tds.length < 3) continue;
            const edition = tds[0]?.textContent?.trim() || "";
            const reference = tds[1]?.textContent?.trim() || "";
            const date = tds[2]?.textContent?.trim() || "";
            results.push({ rowIndex: idx, edition, reference, date });
            idx++;
          }
        }

        return results;
      });

      for (const row of rows) {
        const isoDate = this.parseDateBR(row.date);
        if (!isoDate) {
          logger.debug(`Skipping row with unparseable date: ${row.date}`);
          continue;
        }

        const dateObj = new Date(isoDate);
        if (!this.isInDateRange(dateObj)) continue;

        metadata.push({
          rowIndex: row.rowIndex,
          editionNumber: row.edition,
          isExtra: row.reference.toLowerCase().includes("extra"),
          date: isoDate,
        });
      }
    } catch (error) {
      logger.error(`Error extracting gazette table:`, error as Error);
    }

    return metadata;
  }

  private async getGazettePdf(
    page: any,
    meta: GazetteMetadata,
  ): Promise<Gazette | null> {
    try {
      const vizBtnId = `form:dataTableDiarioOficialEletronico:dataTable:${meta.rowIndex}:j_id_74`;
      const vizBtn = await page.$(`input[id="${vizBtnId}"]`);

      if (!vizBtn) {
        logger.warn(
          `Visualizar button not found for row ${meta.rowIndex} (edition ${meta.editionNumber})`,
        );
        return null;
      }

      logger.debug(
        `Clicking Visualizar for edition ${meta.editionNumber} (row ${meta.rowIndex})`,
      );
      await vizBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 4000));

      // Extract PDF URL from the embed element
      let pdfUrl = await page.evaluate(() => {
        const embed = document.querySelector(
          'embed[src*="MediaOutputResource"]',
        ) as HTMLEmbedElement;
        if (embed) return embed.getAttribute("src");

        const iframe = document.querySelector(
          'iframe[src*="MediaOutputResource"]',
        ) as HTMLIFrameElement;
        if (iframe) return iframe.getAttribute("src");

        const object = document.querySelector(
          'object[data*="MediaOutputResource"]',
        ) as HTMLObjectElement;
        if (object) return object.getAttribute("data");

        const links = Array.from(
          document.querySelectorAll('a[href*="MediaOutputResource"]'),
        );
        if (links.length > 0) return (links[0] as HTMLAnchorElement).href;

        return null;
      });

      if (!pdfUrl) {
        // Wait a bit more and retry
        await new Promise((resolve) => setTimeout(resolve, 3000));
        pdfUrl = await page.evaluate(() => {
          const embed = document.querySelector(
            'embed[src*="MediaOutputResource"]',
          ) as HTMLEmbedElement;
          return embed ? embed.getAttribute("src") : null;
        });
      }

      if (!pdfUrl) {
        logger.warn(
          `Could not extract PDF URL for edition ${meta.editionNumber}`,
        );
        await this.goBackToList(page);
        return null;
      }

      // Make absolute URL
      if (!pdfUrl.startsWith("http")) {
        pdfUrl = `https://grp.pmpf.rs.gov.br${pdfUrl.startsWith("/") ? "" : "/"}${pdfUrl}`;
      }

      logger.debug(
        `Got PDF URL for edition ${meta.editionNumber}: ${pdfUrl.substring(0, 100)}...`,
      );

      // Navigate back to the list
      await this.goBackToList(page);

      const gazette = await this.createGazette(new Date(meta.date), pdfUrl, {
        editionNumber: meta.editionNumber,
        isExtraEdition: meta.isExtra,
        power: "executive_legislative",
        sourceText: `Edição ${meta.editionNumber}${meta.isExtra ? " (Extra)" : ""} - ${meta.date}`,
        skipUrlResolution: true,
        requiresClientRendering: true,
      });

      return gazette;
    } catch (error) {
      logger.error(
        `Error getting PDF for edition ${meta.editionNumber}:`,
        error as Error,
      );
      try {
        await this.goBackToList(page);
      } catch (_) {}
      return null;
    }
  }

  private async goBackToList(page: any): Promise<void> {
    try {
      // Look for a back button in the GRP interface
      const backBtn = await page.$('input[value="Voltar"]');
      if (backBtn) {
        await backBtn.click();
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return;
      }

      // Fallback: use browser back
      await page.goBack();
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } catch (error) {
      logger.warn(`Error going back to list: ${(error as Error).message}`);
    }
  }

  private async goToNextPage(page: any, targetPage: number): Promise<boolean> {
    try {
      // Try clicking the page number link in the DataScroller
      const pageLink = await page.evaluate((target: number) => {
        const scroller = document.querySelector(
          '[id*="dataTableDataScroller"]',
        );
        if (!scroller) return false;

        const links = scroller.querySelectorAll("a, span");
        for (const link of Array.from(links)) {
          if (link.textContent?.trim() === String(target)) {
            (link as HTMLElement).click();
            return true;
          }
        }
        return false;
      }, targetPage);

      if (pageLink) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return true;
      }

      // Try the "next" button
      const nextClicked = await page.evaluate(() => {
        const scroller = document.querySelector(
          '[id*="dataTableDataScroller"]',
        );
        if (!scroller) return false;
        const nextBtn = scroller.querySelector(
          '[class*="right"]',
        ) as HTMLElement;
        if (nextBtn) {
          nextBtn.click();
          return true;
        }
        return false;
      });

      if (nextClicked) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return true;
      }

      return false;
    } catch (error) {
      logger.warn(
        `Error navigating to page ${targetPage}: ${(error as Error).message}`,
      );
      return false;
    }
  }
}

interface GazetteMetadata {
  rowIndex: number;
  editionNumber: string;
  isExtra: boolean;
  date: string;
}
