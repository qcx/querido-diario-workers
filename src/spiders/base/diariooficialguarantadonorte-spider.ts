import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse } from "node-html-parser";
import type { DiarioOficialGuarantadonorteConfig } from "../../types/spider-config";

/**
 * Spider for Diário Oficial de Guarantã do Norte - MT
 *
 * URL: https://diariooficial.guarantadonorte.mt.gov.br/edicoes/
 *
 * HTML: table with columns "Edição | Data da edição | Baixar arquivo PDF"
 * Pagination: /edicoes/?p=1, ?p=2, ...
 * Date format: "9 de Fevereiro de 2026"
 */
export class DiarioOficialGuarantadonorteSpider extends BaseSpider {
  private baseUrl: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    const cfg = spiderConfig.config as DiarioOficialGuarantadonorteConfig;
    this.baseUrl = cfg.baseUrl.replace(/\/$/, "");
    logger.info(
      `Initializing DiarioOficialGuarantadonorteSpider for ${spiderConfig.name} (${this.baseUrl})`,
    );
  }

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

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let page = 1;
    const maxPages = 200;
    const startTime = this.startDate.getTime();
    const endTime = this.endDate.getTime();

    logger.info(`Crawling ${this.baseUrl} for ${this.spiderConfig.name}...`);

    while (page <= maxPages) {
      const pageUrl =
        page === 1
          ? `${this.baseUrl}/edicoes/`
          : `${this.baseUrl}/edicoes/?p=${page}`;

      try {
        const html = await this.fetch(pageUrl);
        const root = parse(html);

        const rows = root.querySelectorAll("table tr");
        let foundOlderThanRange = false;
        let foundAny = false;

        for (const row of rows) {
          const link = row.querySelector('a[href*=".pdf"]');
          if (!link) continue;

          const href = link.getAttribute("href");
          if (!href || !href.includes("/media/publicacoes/")) continue;

          const rowText = row.text?.trim() || "";
          const dateMatch = rowText.match(
            /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i,
          );
          if (!dateMatch) continue;

          const [, dayStr, monthName, yearStr] = dateMatch;
          const month = this.parseMonthName(monthName);
          if (month === -1) continue;

          const gazetteDate = new Date(
            parseInt(yearStr, 10),
            month,
            parseInt(dayStr, 10),
          );
          const itemTime = gazetteDate.getTime();

          if (itemTime < startTime) {
            foundOlderThanRange = true;
            continue;
          }
          if (itemTime > endTime) continue;

          foundAny = true;
          let pdfUrl = href;
          if (!pdfUrl.startsWith("http")) {
            pdfUrl = new URL(pdfUrl, this.baseUrl).toString();
          }
          const editionMatch = rowText.match(/\b(\d{3,5})\b/);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;

          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber,
            isExtraEdition: false,
            power: "executive",
            sourceText: `Diário Oficial Guarantã do Norte - Edição ${editionNumber || ""}`,
          });
          if (gazette) gazettes.push(gazette);
        }

        if (!foundAny && foundOlderThanRange) {
          logger.debug("Reached editions older than range, stopping");
          break;
        }
        if (!foundAny && page > 1) break;

        const nextLink = root.querySelector(
          `a[href*="/edicoes/?p=${page + 1}"], a[href*="?p=${page + 1}"]`,
        );
        if (!nextLink && page > 1) break;
        page++;
      } catch (err) {
        logger.warn(`Error fetching ${pageUrl}: ${(err as Error).message}`);
        break;
      }
    }

    logger.info(
      `Found ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
    );
    return gazettes;
  }
}
