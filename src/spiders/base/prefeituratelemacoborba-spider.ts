import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig } from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";

interface PrefeituratelemacoborbaConfig {
  type: "prefeituratelemacoborba";
  baseUrl: string;
}

const MONTH_MAP: Record<string, string> = {
  janeiro: "01",
  fevereiro: "02",
  março: "03",
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

/**
 * Spider for Prefeitura de Telêmaco Borba - PR
 *
 * Joomla-based site with category list pagination.
 * Listing: /informacoes/boletim-oficial?start=N (50 per page)
 * PDFs: /images/boletim/Edicao{N}.pdf
 * Date format in listing: "DD Mês YYYY"
 */
export class PrefeituratelemacoborbaSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituratelemacoborbaConfig;
    this.baseUrl = platformConfig.baseUrl;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Telêmaco Borba gazette for ${this.config.name}...`);

    try {
      let start = 0;
      let hasMore = true;
      let foundBeforeRange = false;

      while (hasMore && !foundBeforeRange) {
        const url =
          start === 0 ? this.baseUrl : `${this.baseUrl}?start=${start}`;
        logger.debug(`Fetching page at offset ${start}: ${url}`);

        const response = await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        });

        if (!response.ok) {
          logger.warn(`Failed to fetch offset ${start}: ${response.status}`);
          break;
        }

        const html = await response.text();

        const rowPattern =
          /cat-list-row[\s\S]*?href="([^"]*edicao[^"]*)"[^>]*>([^<]+)<[\s\S]*?list-date[^>]*>\s*(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})/gi;

        let match;
        let foundAny = false;

        while ((match = rowPattern.exec(html)) !== null) {
          foundAny = true;
          const day = match[3].padStart(2, "0");
          const monthName = match[4].toLowerCase();
          const year = match[5];
          const month = MONTH_MAP[monthName];

          if (!month) continue;

          const isoDate = `${year}-${month}-${day}`;

          if (isoDate < this.dateRange.start) {
            foundBeforeRange = true;
            continue;
          }
          if (isoDate > this.dateRange.end) continue;

          const title = match[2].trim();
          const editionMatch = title.match(/[Ee]di[çc][ãa]o\s*(\d+)/);
          const editionNumber = editionMatch ? editionMatch[1] : "";

          let pdfUrl = "";
          if (editionNumber) {
            pdfUrl = `https://telemacoborba.pr.gov.br/images/boletim/Edicao${editionNumber}.pdf`;
          }

          if (!pdfUrl) continue;

          gazettes.push({
            date: isoDate,
            editionNumber,
            isExtraEdition: false,
            power: "executive",
            fileUrl: pdfUrl,
            scrapedAt: new Date().toISOString(),
            territoryId: this.config.territoryId,
            sourceText: title,
          });
        }

        if (!foundAny) {
          hasMore = false;
          break;
        }

        start += 50;
        if (start > 5000) break;
      }

      logger.info(`Found ${gazettes.length} gazettes for Telêmaco Borba`);
    } catch (error) {
      logger.error(`Error crawling Telêmaco Borba: ${error}`);
    }

    return gazettes;
  }
}
