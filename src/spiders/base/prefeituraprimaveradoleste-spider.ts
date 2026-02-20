import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse } from "node-html-parser";

/**
 * Configuration for Prefeitura de Primavera do Leste (DIOPRIMA) spider
 */
export interface PrefeituraprimaveradolesteConfig {
  type: "prefeituraprimaveradoleste";
  baseUrl: string;
  listPath?: string;
  requiresClientRendering?: boolean;
}

/**
 * Spider for Diário Oficial de Primavera do Leste - MT (DIOPRIMA)
 *
 * URL: https://www.primaveradoleste.mt.gov.br/Publicacoes/Dioprima-71
 *
 * HTML Structure:
 * - List/cards with Nº: XXXX, Data: DD/MM/YYYY
 * - PDF links: /Publicacoes/fotos_downloads/{id}.pdf
 * - Title pattern: "Edição XXXX de DD/MM/YYYY" or "Edição Extraordinária XXXX de DD/MM/YYYY"
 */
export class PrefeituraprimaveradolesteSpider extends BaseSpider {
  constructor(
    spiderConfig: SpiderConfig,
    dateRange: DateRange,
    _browser?: Fetcher,
  ) {
    super(spiderConfig, dateRange);

    const config = this.config.config as PrefeituraprimaveradolesteConfig;
    if (!config.baseUrl) {
      throw new Error(
        `PrefeituraprimaveradolesteSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeituraprimaveradolesteSpider for ${spiderConfig.name} with URL: ${config.baseUrl}`,
    );
  }

  private get baseUrl(): string {
    return (
      this.config.config as PrefeituraprimaveradolesteConfig
    ).baseUrl.replace(/\/$/, "");
  }

  private get listPath(): string {
    return (
      (this.config.config as PrefeituraprimaveradolesteConfig).listPath ||
      "/Publicacoes/Dioprima-71"
    );
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let page = 1;
    const maxPages = 50;

    logger.info(
      `Crawling DIOPRIMA (Primavera do Leste) for ${this.config.name}`,
    );

    while (page <= maxPages) {
      const listUrl =
        page === 1
          ? `${this.baseUrl}${this.listPath}`
          : `${this.baseUrl}${this.listPath}?page=${page}`;

      try {
        const html = await this.fetch(listUrl);
        const root = parse(html);

        // Find all links to fotos_downloads/*.pdf
        const pdfLinks = root.querySelectorAll(
          'a[href*="fotos_downloads"][href*=".pdf"]',
        );
        if (pdfLinks.length === 0 && page === 1) {
          logger.warn("No PDF links found on DIOPRIMA page");
          break;
        }
        if (pdfLinks.length === 0) break;

        let foundOlderThanRange = false;

        for (const link of pdfLinks) {
          const href = link.getAttribute("href");
          if (!href || !href.includes(".pdf")) continue;

          const pdfUrl = href.startsWith("http")
            ? href
            : `${this.baseUrl}${href.startsWith("/") ? "" : "/"}${href}`;

          // Get parent container to find date/number (e.g. table row or card)
          let container = link.parentNode;
          let contextText = link.text?.trim() || "";
          for (let i = 0; i < 5 && container; i++) {
            const text = container.text?.trim() || "";
            if (text.length > contextText.length) contextText = text;
            container = container.parentNode;
          }

          // Extract date: "Data: DD/MM/YYYY" or "Edição XXXX de DD/MM/YYYY"
          const dateMatch =
            contextText.match(/Data:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i) ||
            contextText.match(
              /Edi[cç][aã]o\s+(?:Extraordin[aá]ria\s+)?\d+\s+de\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i,
            ) ||
            contextText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);

          if (!dateMatch) continue;

          const d = dateMatch[1];
          const m = dateMatch[2];
          const y = dateMatch[3];
          const gazetteDate = new Date(
            parseInt(y, 10),
            parseInt(m, 10) - 1,
            parseInt(d, 10),
          );

          if (gazetteDate < this.startDate) {
            foundOlderThanRange = true;
            continue;
          }
          if (!this.isInDateRange(gazetteDate)) continue;

          const editionMatch =
            contextText.match(/N[º°]:\s*(\d+)/i) ||
            contextText.match(/Edi[cç][aã]o\s+(?:Extraordin[aá]ria\s+)?(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;
          const isExtra = /extraordin[aá]ria|extra/i.test(contextText);

          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber,
            isExtraEdition: isExtra,
            power: "executive",
            sourceText: contextText.substring(0, 200),
          });
          if (gazette) gazettes.push(gazette);
        }

        if (foundOlderThanRange) break;

        // Check for next page - DIOPRIMA may use different pagination
        const nextLink = root.querySelector(
          'a[href*="page="], a[rel="next"], .pagination a',
        );
        if (!nextLink || page === 1) {
          // Single page or no obvious next
          if (page > 1 || pdfLinks.length < 10) break;
        }
        page++;
      } catch (error) {
        logger.warn(`Error fetching DIOPRIMA page ${page}:`, error as Error);
        break;
      }
    }

    logger.info(`Crawled ${gazettes.length} gazettes for ${this.config.name}`);
    return gazettes;
  }
}
