import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse } from "node-html-parser";
import type { CristalinaGoConfig } from "../../types/spider-config";

const DEFAULT_LIST_PATHS = [""];

/**
 * Spider for Diário Oficial de Cristalina - GO.
 *
 * Cristalina não utiliza AGM. Publicações em prefeitura-de-cristalina.webnode.page/diario-oficial/
 * (Webnode). Extrai links de PDF das páginas configuradas e infere data pelo path quando
 * disponível (ex: /uploads/YYYY/MM/ ou YYYY-MM-DD no nome do arquivo).
 */
export class CristalinaGoSpider extends BaseSpider {
  private baseUrl: string;
  private listPaths: string[];

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    const cfg = spiderConfig.config as CristalinaGoConfig;
    this.baseUrl = cfg.baseUrl.replace(/\/$/, "");
    this.listPaths =
      cfg.listPaths !== undefined && cfg.listPaths.length > 0
        ? cfg.listPaths
        : DEFAULT_LIST_PATHS;
    logger.info(
      `Initializing CristalinaGoSpider for ${spiderConfig.name} (${this.baseUrl})`,
    );
  }

  /**
   * Extract date from PDF URL path (e.g. /uploads/2025/04/arquivo.pdf or .../2025-04-15_do.pdf).
   * Returns null when no date can be inferred.
   */
  private parseDateFromPdfUrl(url: string): Date | null {
    // Pattern: /YYYY/MM/ in path
    const pathMatch = url.match(/\/(\d{4})\/(\d{2})\//);
    if (pathMatch) {
      const year = parseInt(pathMatch[1], 10);
      const month = parseInt(pathMatch[2], 10) - 1;
      if (month >= 0 && month <= 11) {
        return new Date(Date.UTC(year, month, 1));
      }
    }
    // Pattern: YYYY-MM-DD in URL (e.g. filename)
    const dashMatch = url.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (dashMatch) {
      const year = parseInt(dashMatch[1], 10);
      const month = parseInt(dashMatch[2], 10) - 1;
      const day = parseInt(dashMatch[3], 10);
      if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
        return new Date(Date.UTC(year, month, day));
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
      `Crawling Cristalina GO (${this.baseUrl}) for ${this.spiderConfig.name}...`,
    );

    for (const path of this.listPaths) {
      const pageUrl = path
        ? `${this.baseUrl}/${path.replace(/^\//, "")}`
        : this.baseUrl;
      try {
        const html = await this.fetch(pageUrl);
        const root = parse(html);
        const links = root.querySelectorAll('a[href*=".pdf"]');

        for (const a of links) {
          let href = a.getAttribute("href");
          if (!href || !href.trim()) continue;

          href = href
            .replace(/&#038;/g, "&")
            .replace(/&amp;/g, "&")
            .trim();
          if (!href.toLowerCase().includes(".pdf")) continue;

          let fullUrl = href;
          if (!href.startsWith("http")) {
            fullUrl = href.startsWith("/")
              ? new URL(href, this.baseUrl).toString()
              : new URL(href, pageUrl).toString();
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

        // Fallback: regex for href containing .pdf in case structure differs
        if (links.length === 0) {
          const htmlStr = root.toString();
          const pdfRegex = /href=["']([^"']*\.pdf[^"']*)["']/gi;
          let match: RegExpExecArray | null;
          while ((match = pdfRegex.exec(htmlStr)) !== null) {
            let fullUrl = match[1]
              .replace(/&amp;/g, "&")
              .replace(/&#038;/g, "&");
            if (!fullUrl.startsWith("http")) {
              fullUrl = new URL(fullUrl, pageUrl).toString();
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
        }
      } catch (err) {
        logger.warn(`Error fetching ${pageUrl}: ${(err as Error).message}`);
      }
    }

    logger.info(
      `Crawled ${gazettes.length} gazettes for ${this.spiderConfig.name} (Cristalina GO)`,
    );
    return gazettes;
  }
}
