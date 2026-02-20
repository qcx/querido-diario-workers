import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  PrefeiturapacodolumiarConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse } from "node-html-parser";

/**
 * Spider for Prefeitura de Paço do Lumiar - MA
 *
 * Site: pacodolumiar.ma.gov.br/diariooficial/edicoes-anteriores
 *
 * Custom platform with:
 * - Table listing editions with columns: Edição Nº, Total de Páginas, Resumo, Data
 * - Each edition links to a detail page: /diariooficial/edicao/{numero}
 * - PDF download URL: /diariooficial/getFile/{numero}/{hash}?download=true
 *
 * The site requires JavaScript to render the table content.
 * We need to visit each edition's detail page to get the PDF download link with hash.
 */
export class PrefeiturapacodolumiarSpider extends BaseSpider {
  protected config: PrefeiturapacodolumiarConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeiturapacodolumiarConfig;

    if (!this.config.baseUrl) {
      throw new Error(
        `PrefeiturapacodolumiarSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeiturapacodolumiarSpider for ${spiderConfig.name} with URL: ${this.config.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.config.baseUrl} for ${this.spiderConfig.name}...`,
    );

    const gazettes: Gazette[] = [];

    try {
      const response = await fetch(this.config.baseUrl, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      });

      if (!response.ok) {
        logger.error(
          `Failed to fetch page: ${response.status} ${response.statusText}`,
        );
        return gazettes;
      }

      const html = await response.text();
      const root = parse(html);
      const baseUrl = new URL(this.config.baseUrl);

      // Parse the editions table
      // Table columns: Edição Nº, Total de Páginas, Resumo, Data
      const tableRows = root.querySelectorAll("table tbody tr, table tr");

      logger.debug(`Found ${tableRows.length} table rows`);

      const editionsToFetch: Array<{
        editionNumber: string;
        date: string;
        editionUrl: string;
      }> = [];

      for (const row of tableRows) {
        const cells = row.querySelectorAll("td");

        // Skip header rows or invalid rows
        // Some sites have 4 columns (Edition, Pages, Summary, Date)
        // Others have 3 columns (Edition, Pages, Date) - e.g., Açailândia
        if (cells.length < 3) continue;

        // First cell contains edition link like "Volume 6, Nº 1853/2026"
        // with href to /diariooficial/edicao/{numero}
        const editionLink = row.querySelector(
          'a[href*="/diariooficial/edicao/"]',
        );
        if (!editionLink) continue;

        const href = editionLink.getAttribute("href");
        if (!href) continue;

        // Extract edition number from URL - support both numeric and alphanumeric (e.g., 2389-A)
        const editionMatch = href.match(/\/edicao\/([^#\/?]+)/);
        if (!editionMatch) continue;
        const editionNumber = editionMatch[1];

        // Last cell contains date like "Terça-Feira, 27 - Janeiro - 2026"
        const lastCell = cells[cells.length - 1];
        const dateText = lastCell?.text?.trim() || "";

        // Parse Brazilian date format: "Terça-Feira, 27 - Janeiro - 2026"
        const date = this.parseBrazilianDate(dateText);
        if (!date) {
          logger.debug(`Could not parse date from: ${dateText}`);
          continue;
        }

        // Check if in date range
        if (!this.isInDateRange(new Date(date))) continue;

        // Construct full edition URL
        const editionUrl = href.startsWith("http")
          ? href
          : `${baseUrl.origin}${href}`;

        editionsToFetch.push({ editionNumber, date, editionUrl });
      }

      logger.info(`Found ${editionsToFetch.length} editions in date range`);

      // Fetch each edition page to get the PDF download link
      for (const edition of editionsToFetch) {
        try {
          const pdfUrl = await this.fetchPdfUrl(edition.editionUrl);

          if (pdfUrl) {
            // Edition numbers with "-A", "-B" etc. are extra editions
            const isExtraEdition = /[-][A-Z]$/i.test(edition.editionNumber);
            gazettes.push({
              date: edition.date,
              fileUrl: pdfUrl,
              territoryId: this.spiderConfig.territoryId,
              editionNumber: edition.editionNumber,
              power: "executive",
              isExtraEdition,
              scrapedAt: new Date().toISOString(),
            });
          }
        } catch (error) {
          logger.warn(
            `Failed to fetch PDF URL for edition ${edition.editionNumber}:`,
            error as Error,
          );
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
      );
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
      throw error;
    }

    return gazettes;
  }

  /**
   * Parse Brazilian date format like "Terça-Feira, 27 - Janeiro - 2026"
   * Returns ISO date string (YYYY-MM-DD) or null if parsing fails
   */
  private parseBrazilianDate(dateText: string): string | null {
    const months: Record<string, string> = {
      janeiro: "01",
      fevereiro: "02",
      março: "03",
      marco: "03",
      abril: "04",
      maio: "05",
      junho: "06",
      julho: "07",
      agosto: "08",
      setembro: "09",
      outubro: "10",
      novembro: "11",
      dezembro: "12",
    };

    const normalizedText = dateText
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    // Try pattern: "27 - janeiro - 2026" or "27 janeiro 2026"
    const match = normalizedText.match(
      /(\d{1,2})\s*[-\s]\s*(\w+)\s*[-\s]\s*(\d{4})/,
    );
    if (match) {
      const [, day, monthName, year] = match;
      const month = months[monthName];
      if (month) {
        return `${year}-${month}-${day.padStart(2, "0")}`;
      }
    }

    // Try DD/MM/YYYY format
    const slashMatch = dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (slashMatch) {
      const [, day, month, year] = slashMatch;
      return `${year}-${month}-${day}`;
    }

    return null;
  }

  /**
   * Fetch the edition detail page and extract the PDF download URL
   *
   * The site has multiple URL patterns:
   * 1. DEFAULT_URL in JavaScript: '/arquivos/diariooficial/{hash}/DiarioOficial_Edicao_{n}.pdf' - REAL PDF URL
   * 2. getFile URLs - redirects to the actual PDF but may not work directly
   *
   * We prioritize the DEFAULT_URL from JavaScript as it's the direct PDF link.
   */
  private async fetchPdfUrl(editionUrl: string): Promise<string | null> {
    const response = await fetch(editionUrl, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });

    if (!response.ok) {
      logger.warn(`Failed to fetch edition page: ${response.status}`);
      return null;
    }

    const html = await response.text();
    const baseUrl = new URL(editionUrl);

    // Priority 1: Extract DEFAULT_URL from JavaScript (the actual PDF URL)
    // Pattern: var DEFAULT_URL = '/arquivos/diariooficial/{hash}/DiarioOficial_Edicao_{n}.pdf?t=...'
    const defaultUrlMatch = html.match(
      /var\s+DEFAULT_URL\s*=\s*['"]([^'"]+\.pdf[^'"]*)['"]/,
    );
    if (defaultUrlMatch && defaultUrlMatch[1]) {
      const pdfPath = defaultUrlMatch[1];
      logger.debug(`Found DEFAULT_URL: ${pdfPath}`);
      return pdfPath.startsWith("http")
        ? pdfPath
        : `${baseUrl.origin}${pdfPath.startsWith("/") ? "" : "/"}${pdfPath}`;
    }

    // Priority 2: Look for direct PDF links in /arquivos/ path
    const root = parse(html);
    const arquivosLink = root.querySelector(
      'a[href*="/arquivos/"][href*=".pdf"]',
    );
    if (arquivosLink) {
      const href = arquivosLink.getAttribute("href");
      if (href) {
        logger.debug(`Found arquivos PDF link: ${href}`);
        return href.startsWith("http")
          ? href
          : `${baseUrl.origin}${href.startsWith("/") ? "" : "/"}${href}`;
      }
    }

    // Priority 3: Look for "Baixar PDF" button with getFile URL
    // This should be the last resort as getFile URLs may redirect
    const allLinks = root.querySelectorAll("a");
    for (const link of allLinks) {
      const text = link.text?.toLowerCase() || "";
      const buttonClass = link.getAttribute("class") || "";
      if (
        (text.includes("baixar") || buttonClass.includes("btn_dowload")) &&
        link.getAttribute("href")?.includes("getFile")
      ) {
        const href = link.getAttribute("href");
        if (href) {
          logger.debug(`Found Baixar PDF button: ${href}`);
          return href.startsWith("http")
            ? href
            : `${baseUrl.origin}${href.startsWith("/") ? "" : "/"}${href}`;
        }
      }
    }

    // Priority 4: Any getFile link
    const pdfLink = root.querySelector(
      'a[href*="getFile"][href*="download=true"]',
    );
    if (pdfLink) {
      const href = pdfLink.getAttribute("href");
      if (href) {
        logger.debug(`Found getFile link: ${href}`);
        return href.startsWith("http")
          ? href
          : `${baseUrl.origin}${href.startsWith("/") ? "" : "/"}${href}`;
      }
    }

    logger.warn(`Could not find PDF URL in edition page: ${editionUrl}`);
    return null;
  }
}
