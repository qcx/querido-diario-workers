import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse } from "node-html-parser";
import type { DiarioOficialCaldasNovasConfig } from "../../types/spider-config";

/**
 * Spider for Diário Oficial de Caldas Novas - GO
 *
 * URL: https://diariooficialcal1.websiteseguro.com
 * Calendário por data: ?data=DD/MM/YYYY
 * Página exibe "Exibindo edições do dia: DD/MM/YYYY" e links para PDFs quando há edições.
 */
export class DiarioOficialCaldasnovasSpider extends BaseSpider {
  private baseUrl: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    const cfg =
      spiderConfig.config as unknown as DiarioOficialCaldasNovasConfig;
    this.baseUrl = cfg.baseUrl.replace(/\/$/, "");
    logger.info(
      `Initializing DiarioOficialCaldasnovasSpider for ${spiderConfig.name} (${this.baseUrl})`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let currentDate = new Date(this.startDate);
    const endDate = new Date(this.endDate);

    logger.info(`Crawling ${this.baseUrl} for ${this.spiderConfig.name}...`);

    while (currentDate <= endDate) {
      const day = currentDate.getUTCDate().toString().padStart(2, "0");
      const month = (currentDate.getUTCMonth() + 1).toString().padStart(2, "0");
      const year = currentDate.getUTCFullYear();
      const dataParam = `${day}/${month}/${year}`;
      const url = `${this.baseUrl}/?data=${dataParam}`;

      try {
        const html = await this.fetch(url);
        const root = parse(html);

        const pdfLinks = root.querySelectorAll('a[href*=".pdf"]');
        for (const link of pdfLinks) {
          const href = link.getAttribute("href");
          if (!href || !href.trim().toLowerCase().includes(".pdf")) continue;

          let pdfUrl = href.trim();
          if (!pdfUrl.startsWith("http")) {
            pdfUrl = new URL(pdfUrl, this.baseUrl).toString();
          }

          const gazette = await this.createGazette(currentDate, pdfUrl, {
            isExtraEdition: false,
            power: "executive",
            sourceText: `Diário Oficial Caldas Novas - GO (${dataParam})`,
          });
          if (gazette) gazettes.push(gazette);
        }

        // Fallback: regex for href="...pdf" in case structure differs
        if (pdfLinks.length === 0) {
          const htmlStr = root.toString();
          const pdfRegex = /href=["']([^"']+\.pdf[^"']*)["']/gi;
          let match: RegExpExecArray | null;
          while ((match = pdfRegex.exec(htmlStr)) !== null) {
            let pdfUrl = match[1].replace(/&amp;/g, "&");
            if (!pdfUrl.startsWith("http")) {
              pdfUrl = new URL(pdfUrl, this.baseUrl).toString();
            }
            const gazette = await this.createGazette(currentDate, pdfUrl, {
              isExtraEdition: false,
              power: "executive",
              sourceText: `Diário Oficial Caldas Novas - GO (${dataParam})`,
            });
            if (gazette) gazettes.push(gazette);
          }
        }
      } catch (err) {
        logger.debug(
          `Error or no gazette for ${dataParam}: ${(err as Error).message}`,
        );
      }

      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }

    logger.info(
      `Found ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
    );
    return gazettes;
  }
}
