import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig } from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";

interface PrefeituratoledoConfig {
  type: "prefeituratoledo";
  baseUrl: string;
}

/**
 * Spider for Prefeitura de Toledo - PR
 *
 * Drupal 9 site with Views-based gazette listing.
 * URL: https://www.toledo.pr.gov.br/municipio/orgao_oficial/edicoes_anteriores
 * Pagination: ?page=N (20 items per page)
 * PDF pattern: /sites/default/files/orgaooficial-YYYY-MM/orgaooficial_{edition}_{DDMMYYYY}_assinado.pdf
 */
export class PrefeituratoledoSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituratoledoConfig;
    this.baseUrl = platformConfig.baseUrl;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Toledo gazette for ${this.config.name}...`);

    try {
      let page = 0;
      let hasMore = true;
      let foundBeforeRange = false;

      while (hasMore && !foundBeforeRange) {
        const url = `${this.baseUrl}?page=${page}`;
        logger.debug(`Fetching page ${page}: ${url}`);

        const response = await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        });

        if (!response.ok) {
          logger.warn(`Failed to fetch page ${page}: ${response.status}`);
          break;
        }

        const html = await response.text();

        const pdfLinkPattern =
          /<a\s+href="([^"]*\.pdf)"[^>]*target="_blank"[^>]*>\s*(.*?)\s*<\/a>/gi;
        const matches = [...html.matchAll(pdfLinkPattern)];

        if (matches.length === 0) {
          hasMore = false;
          break;
        }

        for (const match of matches) {
          const pdfPath = match[1];
          const titleText = match[2].replace(/<[^>]*>/g, "").trim();

          const dateMatch = titleText.match(
            /(\d{1,2})\s+de\s+([a-zA-ZçÇãÃõÕáÁéÉíÍóÓúÚâÂêÊ]+)\s+de\s+(\d{4})/i,
          );
          if (!dateMatch) continue;

          const day = dateMatch[1].padStart(2, "0");
          const monthName = dateMatch[2].toLowerCase();
          const year = dateMatch[3];

          const monthMap: Record<string, string> = {
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

          const month = monthMap[monthName];
          if (!month) continue;

          const isoDate = `${year}-${month}-${day}`;

          if (isoDate < this.dateRange.start) {
            foundBeforeRange = true;
            continue;
          }

          if (isoDate > this.dateRange.end) continue;

          const pdfUrl = pdfPath.startsWith("http")
            ? pdfPath
            : `https://www.toledo.pr.gov.br${pdfPath}`;

          const editionMatch = titleText.match(/Edi[çc][ãa]o\s+(\d+)/i);
          const edition = editionMatch ? editionMatch[1] : "";

          gazettes.push({
            date: isoDate,
            editionNumber: edition,
            isExtraEdition: titleText.toLowerCase().includes("extraordin"),
            power: "executive",
            fileUrl: pdfUrl,
            scrapedAt: new Date().toISOString(),
            territoryId: this.config.territoryId,
            sourceText: titleText,
          });
        }

        page++;
        if (page > 300) break;
      }

      logger.info(`Found ${gazettes.length} gazettes for Toledo`);
    } catch (error) {
      logger.error(`Error crawling Toledo: ${error}`);
    }

    return gazettes;
  }
}
