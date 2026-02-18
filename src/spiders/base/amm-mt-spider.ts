import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";
import { toISODate } from "../../utils/date-utils";

/**
 * Spider para o AMM-MT - Jornal Oficial da Associação Mato-grossense dos Municípios
 *
 * Portal novo: https://amm.diariomunicipal.org/edicoes/?dex=YYYY-MM-DD
 * Para cada data no intervalo, busca a página de edições e extrai links PDF (edição principal e extra oficial).
 * PDFs em: cdn-amm.diariomunicipal.org/edicoes/YYYY/MM/DD/edicao-*.pdf
 */

interface AmmMtConfig {
  url: string;
  cityName: string;
}

const PDF_REGEX =
  /https:\/\/cdn-amm\.diariomunicipal\.org\/edicoes\/\d{4}\/\d{2}\/\d{2}\/edicao-[^"'\s]+\.pdf/gi;

export class AmmMtSpider extends BaseSpider {
  protected ammMtConfig: AmmMtConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.ammMtConfig = spiderConfig.config as AmmMtConfig;
    logger.info(
      `Initializing AmmMtSpider for ${spiderConfig.name} (${this.ammMtConfig.url})`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const baseUrl = this.ammMtConfig.url.replace(/\/$/, "");

    logger.info(`Crawling AMM-MT for ${this.spiderConfig.name}...`);

    let currentDate = new Date(this.startDate);
    const endDate = new Date(this.endDate);

    while (currentDate <= endDate) {
      const dateStr = toISODate(currentDate);
      const url = `${baseUrl}/edicoes/?dex=${dateStr}`;

      try {
        const html = await this.fetch(url);
        const matches = [...html.matchAll(PDF_REGEX)];
        const seen = new Set<string>();

        for (let i = 0; i < matches.length; i++) {
          const pdfUrl = matches[i][0];
          if (seen.has(pdfUrl)) continue;
          seen.add(pdfUrl);

          const isExtra = /extra|8b22724b/i.test(pdfUrl);
          const editionMatch = pdfUrl.match(/edicao-(\d+)-/);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;

          const gazette = await this.createGazette(currentDate, pdfUrl, {
            editionNumber,
            isExtraEdition: isExtra,
            power: "executive",
            sourceText: `Jornal Oficial AMM-MT (${this.ammMtConfig.cityName})`,
          });
          if (gazette) gazettes.push(gazette);
        }
      } catch (err) {
        logger.debug(
          `AMM-MT no edition or error for ${dateStr}: ${(err as Error).message}`,
        );
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    logger.info(
      `Found ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
    );
    return gazettes;
  }
}
