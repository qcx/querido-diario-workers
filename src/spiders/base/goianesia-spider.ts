import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse } from "node-html-parser";
import type { GoianesiaConfig } from "../../types/spider-config";

const DEFAULT_LIST_PATHS = ["editais-e-publicacoes", "editais-e-publicacoes2"];

/**
 * Spider for Diário Oficial / Editais e Publicações de Goianésia - GO.
 *
 * Goianésia não utiliza AGM; publica em goianesia.go.gov.br/editais-e-publicacoes/
 * e editais-e-publicacoes2/. Extrai links de PDF e infere data pelo path
 * (uploads/YYYY/MM quando disponível).
 */
export class GoianesiaSpider extends BaseSpider {
  private baseUrl: string;
  private listPaths: string[];

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    const cfg = spiderConfig.config as GoianesiaConfig;
    this.baseUrl = cfg.baseUrl.replace(/\/$/, "");
    this.listPaths = cfg.listPaths?.length ? cfg.listPaths : DEFAULT_LIST_PATHS;
    logger.info(
      `Initializing GoianesiaSpider for ${spiderConfig.name} (${this.baseUrl})`,
    );
  }

  /**
   * Extract year and month from PDF URL path (e.g. /uploads/2025/04/arquivo.pdf).
   * Returns date with day 1 when only year/month available.
   */
  private parseDateFromPdfUrl(url: string): Date | null {
    const match = url.match(/\/uploads\/(\d{4})\/(\d{2})\//);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1;
      if (month >= 0 && month <= 11) {
        return new Date(year, month, 1);
      }
    }
    return null;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const seenKeys = new Set<string>();
    const startTime = this.startDate.getTime();
    const endTime = this.endDate.getTime();

    logger.info(
      `Crawling Goianésia (${this.baseUrl}) for ${this.spiderConfig.name}...`,
    );

    for (const path of this.listPaths) {
      const pageUrl = `${this.baseUrl}/${path}/`;
      try {
        const html = await this.fetch(pageUrl);
        const root = parse(html);
        const links = root.querySelectorAll('a[href*=".pdf"]');

        for (const a of links) {
          let href = a.getAttribute("href");
          if (!href || !href.trim()) continue;

          href = href.replace(/&#038;/g, "&").trim();
          if (!href.endsWith(".pdf")) continue;

          let fullUrl = href;
          if (!href.startsWith("http")) {
            fullUrl = href.startsWith("/")
              ? `${this.baseUrl}${href}`
              : `${this.baseUrl}/${href.replace(/^\.\//, "")}`;
          }

          const gazetteDate = this.parseDateFromPdfUrl(fullUrl);
          if (!gazetteDate) continue;

          const itemTime = gazetteDate.getTime();
          if (itemTime < startTime || itemTime > endTime) continue;

          const dateStr = gazetteDate.toISOString().slice(0, 10);
          const key = `${dateStr}-${fullUrl}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);

          const g = await this.createGazette(gazetteDate, fullUrl, {
            power: "executive",
          });
          if (g) gazettes.push(g);
        }
      } catch (err) {
        logger.warn(`Error fetching ${pageUrl}: ${(err as Error).message}`);
      }
    }

    logger.info(
      `Crawled ${gazettes.length} gazettes for ${this.spiderConfig.name} (Goianésia)`,
    );
    return gazettes;
  }
}
