import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import type { DocCastanhalConfig } from "../../types/spider-config";
import { logger } from "../../utils/logger";
import { parseBrazilianDate } from "../../utils/date-utils";

/**
 * Spider for Diário Oficial de Castanhal (PA) - Google Sites.
 *
 * URL: https://sites.google.com/castanhal.pa.gov.br/doc-diario-oficial-castanhal/inicio
 *
 * Page structure: list of PDF links with text like "ed.2556 - 13_02.pdf"
 * and date on the next line "13 de fevereiro de 2026".
 * PDFs may be hosted on Google Drive or linked directly.
 */
export class DocCastanhalSpider extends BaseSpider {
  private config: DocCastanhalConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as DocCastanhalConfig;
    if (!this.config.url) {
      throw new Error(
        `DocCastanhalSpider requires url in config for ${spiderConfig.name}`,
      );
    }
    logger.info(
      `Initializing DocCastanhalSpider for ${spiderConfig.name} (${this.config.url})`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const baseUrl = this.config.url.replace(/\/$/, "");

    try {
      const html = await this.fetch(this.config.url);
      const $ = this.loadHTML(html);

      const brazilianDatePattern =
        /(\d{1,2})\s+de\s+(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})/i;
      const editionFromFilename = /ed\.?\s*(\d+)\s*-\s*(\d+)_(\d+)\.pdf/i;

      const items: Array<{
        pdfUrl: string;
        parsedDate: Date;
        editionNumber?: string;
      }> = [];

      $("a[href*='.pdf'], a[href*='drive.google.com/file/d/']").each(
        (_i, el) => {
          const $el = $(el);
          const href = $el.attr("href");
          const linkText = $el.text().trim();
          if (!href) return;

          const isGazetteLink =
            /ed\.?\s*\d+\s*-\s*\d+_\d+\.pdf/i.test(linkText) ||
            editionFromFilename.test(linkText);
          if (!isGazetteLink) return;

          let pdfUrl = href.startsWith("http")
            ? href
            : new URL(href, baseUrl).href;
          const driveIdMatch = pdfUrl.match(
            /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/,
          );
          if (driveIdMatch) {
            pdfUrl = `https://drive.google.com/uc?export=download&id=${driveIdMatch[1]}`;
          }

          let parsedDate: Date | null = null;
          const $parent = $el.parent();
          const parentText = $parent.text();
          const dateMatch = parentText.match(brazilianDatePattern);
          if (dateMatch) {
            const monthStr =
              dateMatch[2].toLowerCase() === "marco" ? "março" : dateMatch[2];
            const dateStr = `${dateMatch[1]} de ${monthStr} de ${dateMatch[3]}`;
            parsedDate = parseBrazilianDate(dateStr);
          }
          if (!parsedDate || isNaN(parsedDate.getTime())) {
            const filenameMatch = linkText.match(editionFromFilename);
            if (filenameMatch) {
              const day = parseInt(filenameMatch[2], 10);
              const month = parseInt(filenameMatch[3], 10);
              const year =
                this.endDate.getFullYear() || new Date().getFullYear();
              if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
                parsedDate = new Date(year, month - 1, day);
              }
            }
          }

          if (
            !parsedDate ||
            isNaN(parsedDate.getTime()) ||
            !this.isInDateRange(parsedDate)
          ) {
            return;
          }

          const editionMatch = linkText.match(/ed\.?\s*(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;
          items.push({ pdfUrl, parsedDate, editionNumber });
        },
      );

      for (const { pdfUrl, parsedDate, editionNumber } of items) {
        const gazette = await this.createGazette(parsedDate, pdfUrl, {
          editionNumber,
          power: "executive",
          sourceText: `Diário Oficial - Castanhal (PA) - ${baseUrl}`,
        });
        if (gazette) gazettes.push(gazette);
      }

      logger.info(
        `DocCastanhalSpider found ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
      );
    } catch (error) {
      logger.error(
        `DocCastanhalSpider error for ${this.spiderConfig.name}:`,
        error as Error,
      );
    }

    return gazettes;
  }
}
