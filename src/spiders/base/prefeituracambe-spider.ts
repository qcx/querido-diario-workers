import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig } from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";

interface PrefeituracambeConfig {
  type: "prefeituracambe";
  baseUrl: string;
}

/**
 * Spider for Prefeitura de Cambé - PR
 *
 * WordPress site with WordPress Download Manager plugin.
 * URL: https://jornal.cambe.pr.gov.br/
 * Pagination: /index.php/page/N/
 * PDF via data-downloadurl on .wpdm-download-link elements.
 * Title pattern: "Edição XXXX – DD.MM.YYYY"
 */
export class PrefeituracambeSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituracambeConfig;
    this.baseUrl = platformConfig.baseUrl;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Cambé gazette for ${this.config.name}...`);

    try {
      let page = 1;
      let hasMore = true;
      let foundBeforeRange = false;

      while (hasMore && !foundBeforeRange) {
        const url =
          page === 1
            ? `${this.baseUrl}/`
            : `${this.baseUrl}/index.php/page/${page}/`;
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
          if (response.status === 404) {
            hasMore = false;
            break;
          }
          logger.warn(`Failed to fetch page ${page}: ${response.status}`);
          break;
        }

        const html = await response.text();

        const titlePattern =
          /Edi[çc][ãa]o\s+(\d+)\s*[–\-]\s*(\d{2})\.(\d{2})\.(\d{4})/gi;
        const downloadUrlPattern = /data-downloadurl="([^"]+)"/gi;

        const titles = [...html.matchAll(titlePattern)];
        const downloadUrls = [...html.matchAll(downloadUrlPattern)];

        if (titles.length === 0) {
          hasMore = false;
          break;
        }

        const downloadUrlMap = new Map<string, string>();
        for (const dlMatch of downloadUrls) {
          const dlUrl = dlMatch[1];
          const editionMatch = dlUrl.match(/edicao-(\d+)/);
          if (editionMatch) {
            downloadUrlMap.set(editionMatch[1], dlUrl);
          }
        }

        for (const match of titles) {
          const edition = match[1];
          const day = match[2];
          const month = match[3];
          const year = match[4];
          const isoDate = `${year}-${month}-${day}`;

          if (isoDate < this.dateRange.start) {
            foundBeforeRange = true;
            continue;
          }

          if (isoDate > this.dateRange.end) continue;

          let pdfUrl = downloadUrlMap.get(edition);
          if (!pdfUrl) {
            pdfUrl = `${this.baseUrl}/index.php/download/edicao-${edition}-${day}-${month}-${year}/`;
          }

          pdfUrl = pdfUrl.replace(/&amp;/g, "&");

          gazettes.push({
            date: isoDate,
            editionNumber: edition,
            isExtraEdition: false,
            power: "executive",
            fileUrl: pdfUrl,
            scrapedAt: new Date().toISOString(),
            territoryId: this.config.territoryId,
            sourceText: `Edição ${edition} – ${day}.${month}.${year}`,
          });
        }

        page++;
        if (page > 200) break;
      }

      logger.info(`Found ${gazettes.length} gazettes for Cambé`);
    } catch (error) {
      logger.error(`Error crawling Cambé: ${error}`);
    }

    return gazettes;
  }
}
