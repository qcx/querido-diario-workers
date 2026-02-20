import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  PrefeiturasantaluziamaConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse } from "node-html-parser";

/**
 * Spider for Prefeitura de Santa Luzia - MA
 * (Not to be confused with Santa Luzia - MG)
 *
 * Site: santaluzia.ma.gov.br/edicoes
 *
 * Custom CMS with:
 * - Card-based edition listing (12-15 recent editions)
 * - Each card shows: Title, Volume/Number, Date, Download link
 *
 * PDF pattern: /upload/diario_oficial/{hash}.pdf
 */
export class PrefeiturasantaluziamaSpider extends BaseSpider {
  protected config: PrefeiturasantaluziamaConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeiturasantaluziamaConfig;

    if (!this.config.baseUrl) {
      throw new Error(
        `PrefeiturasantaluziamaSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeiturasantaluziamaSpider for ${spiderConfig.name} with URL: ${this.config.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.config.baseUrl} for ${this.spiderConfig.name}...`,
    );

    const gazettes: Gazette[] = [];

    try {
      const response = await fetch(this.config.baseUrl, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      });

      if (!response.ok) {
        logger.error(
          `Failed to fetch page: ${response.status} ${response.statusText}`,
        );
        return gazettes;
      }

      const html = await response.text();
      const root = parse(html);
      const baseUrl = new URL(this.config.baseUrl);

      // Find edition cards
      // Structure: Cards with title "DIÁRIO OFICIAL ELETRÔNICO", Volume/Number, Date, Download link
      const cards = root.querySelectorAll(
        '[class*="card"], [class*="item"], [class*="edicao"], article',
      );

      logger.debug(`Found ${cards.length} cards on page`);

      for (const card of cards) {
        const cardText = card.text || "";

        // Check if this is a gazette card
        if (
          !cardText.toLowerCase().includes("diário") &&
          !cardText.toLowerCase().includes("edicao") &&
          !cardText.toLowerCase().includes("edição")
        ) {
          continue;
        }

        // Find PDF link
        const pdfLink = card.querySelector(
          'a[href*=".pdf"], a[href*="download"], a[href*="baixar"]',
        );
        let href = pdfLink?.getAttribute("href");

        // If no direct PDF link, look for any link
        if (!href) {
          const anyLink = card.querySelector("a");
          href = anyLink?.getAttribute("href");
        }

        if (!href) continue;

        // Extract date
        const dateMatch = cardText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (!dateMatch) continue;

        const [, day, month, year] = dateMatch;
        const date = `${year}-${month}-${day}`;

        if (!this.isInDateRange(new Date(date))) continue;

        // Extract edition number
        const editionMatch =
          cardText.match(/N[°º.]?\s*(\d+)/i) || cardText.match(/(\d+)\/\d{4}/);
        const editionNumber = editionMatch ? editionMatch[1] : undefined;

        // Construct full URL
        const fullUrl = href.startsWith("http")
          ? href
          : `${baseUrl.origin}${href.startsWith("/") ? "" : "/"}${href}`;

        gazettes.push({
          date,
          fileUrl: fullUrl,
          territoryId: this.spiderConfig.territoryId,
          editionNumber,
          power: "executive",
          scrapedAt: new Date().toISOString(),
        });
      }

      // If no cards found, try alternative parsing
      if (gazettes.length === 0) {
        logger.info("No gazettes in cards, trying alternative parsing...");

        // Look for all PDF links
        const pdfLinks = root.querySelectorAll('a[href*=".pdf"]');

        for (const link of pdfLinks) {
          const href = link.getAttribute("href");
          if (!href) continue;

          // Get context text
          let contextText = link.text || "";
          let parent = link.parentNode;
          for (let i = 0; i < 5 && parent; i++) {
            contextText += " " + (parent.text || "");
            parent = parent.parentNode;
          }

          // Extract date
          const dateMatch = contextText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) continue;

          const [, day, month, year] = dateMatch;
          const date = `${year}-${month}-${day}`;

          if (!this.isInDateRange(new Date(date))) continue;

          // Extract edition number
          const editionMatch = contextText.match(/N[°º.]?\s*(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;

          const fullUrl = href.startsWith("http")
            ? href
            : `${baseUrl.origin}${href.startsWith("/") ? "" : "/"}${href}`;

          gazettes.push({
            date,
            fileUrl: fullUrl,
            territoryId: this.spiderConfig.territoryId,
            editionNumber,
            power: "executive",
            scrapedAt: new Date().toISOString(),
          });
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
      );
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
      throw error;
    }

    return gazettes;
  }
}
