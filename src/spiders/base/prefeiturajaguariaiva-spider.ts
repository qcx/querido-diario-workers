import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig } from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
import * as cheerio from "cheerio";

interface PrefeituraJaguariaivaConfig {
  type: "prefeiturajaguariaiva";
  baseUrl: string;
}

/**
 * Spider for Jaguariaíva PR official gazette
 * Platform: Joomla (jaguariaiva.pr.gov.br)
 *
 * Structure: List of article links containing edition numbers and dates
 * URL pattern: /index.php/diario-oficial
 * Article links: /index.php/{id}-diario-oficial-eletronico-edicao-{edition}-{DD}-{MM}-{YYYY}
 * PDF pattern: /images/semanario/pdfs/{edition}_assinado.pdf
 */
export class PrefeiturajaguariaivaSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraJaguariaivaConfig;
    this.baseUrl = platformConfig.baseUrl;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Jaguariaíva gazette for ${this.config.name}...`);

    try {
      const response = await fetch(this.baseUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      if (!response.ok) {
        logger.warn(`Failed to fetch Jaguariaíva page: ${response.status}`);
        return gazettes;
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      const editionPattern =
        /diario-oficial-eletronico-edicao-(\d+)-(\d{2})-(\d{2})-(\d{4})/i;

      $('a[href*="diario-oficial-eletronico-edicao"]').each((_i, el) => {
        try {
          const href = $(el).attr("href") || "";
          const match = href.match(editionPattern);

          if (!match) return;

          const [, edition, day, month, year] = match;
          const gazetteDate = `${year}-${month}-${day}`;

          if (gazetteDate < this.startDate || gazetteDate > this.endDate)
            return;

          const pdfUrl = `https://www.jaguariaiva.pr.gov.br/images/semanario/pdfs/${edition}_assinado.pdf`;

          if (gazettes.some((g) => g.fileUrl === pdfUrl)) return;

          gazettes.push({
            date: gazetteDate,
            fileUrl: pdfUrl,
            territoryId: this.config.territoryId,
            editionNumber: edition,
            isExtraEdition: false,
            power: "executive",
            scrapedAt: new Date().toISOString(),
          });
        } catch (err) {
          logger.warn(`Error parsing Jaguariaíva link: ${err}`);
        }
      });

      if (gazettes.length === 0) {
        logger.info("No gazettes found on main page, trying pagination...");
        await this.crawlPaginated($, gazettes);
      }

      logger.info(
        `Found ${gazettes.length} gazette(s) for ${this.config.name}`,
      );
    } catch (error) {
      logger.error(`Error crawling Jaguariaíva gazette: ${error}`);
    }

    return gazettes;
  }

  private async crawlPaginated(
    $: cheerio.CheerioAPI,
    gazettes: Gazette[],
  ): Promise<void> {
    const paginationLinks = $('a[href*="start="]')
      .map((_i, el) => $(el).attr("href"))
      .get();

    const uniqueLinks = [...new Set(paginationLinks)].slice(0, 10);

    for (const link of uniqueLinks) {
      try {
        const url = link.startsWith("http")
          ? link
          : `https://www.jaguariaiva.pr.gov.br${link}`;

        const response = await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });

        if (!response.ok) continue;

        const html = await response.text();
        const page$ = cheerio.load(html);
        const editionPattern =
          /diario-oficial-eletronico-edicao-(\d+)-(\d{2})-(\d{2})-(\d{4})/i;

        page$('a[href*="diario-oficial-eletronico-edicao"]').each((_i, el) => {
          const href = page$(el).attr("href") || "";
          const match = href.match(editionPattern);
          if (!match) return;

          const [, edition, day, month, year] = match;
          const gazetteDate = `${year}-${month}-${day}`;

          if (gazetteDate < this.startDate || gazetteDate > this.endDate)
            return;

          const pdfUrl = `https://www.jaguariaiva.pr.gov.br/images/semanario/pdfs/${edition}_assinado.pdf`;

          if (gazettes.some((g) => g.fileUrl === pdfUrl)) return;

          gazettes.push({
            date: gazetteDate,
            fileUrl: pdfUrl,
            territoryId: this.config.territoryId,
            editionNumber: edition,
            isExtraEdition: false,
            power: "executive",
            scrapedAt: new Date().toISOString(),
          });
        });
      } catch (err) {
        logger.warn(`Error crawling pagination: ${err}`);
      }
    }
  }
}
