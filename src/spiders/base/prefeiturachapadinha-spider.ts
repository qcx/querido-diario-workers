import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  PrefeiturachapadinhaConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse } from "node-html-parser";

/**
 * Spider for Prefeitura de Chapadinha - MA
 *
 * Site: chapadinha.ma.gov.br/transparencia/diario-oficial
 *
 * Custom platform with:
 * - HTML table listing all 1226+ editions
 * - Columns: Número, Volume, Exercício, Data, Competência, Esfera, Ver
 * - Direct PDF links without intermediate pages
 *
 * PDF URL patterns:
 * - Recent: /anexos-dom/{ano}/a_{numero}_{numeroEdicao}_{ESFERA}_{hash}.pdf
 * - Older: /anexos-bkp/diarios/1_{numero}_{hash}.pdf
 * - Some specific: /anexos/diarios/Diário_{data}_PMCP_{hash}.pdf
 */
export class PrefeiturachapadinhaSpider extends BaseSpider {
  protected config: PrefeiturachapadinhaConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeiturachapadinhaConfig;

    if (!this.config.baseUrl) {
      throw new Error(
        `PrefeiturachapadinhaSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeiturachapadinhaSpider for ${spiderConfig.name} with URL: ${this.config.baseUrl}`,
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

      // Find all table rows with edition data
      // The table has columns: Número, Volume, Exercício, Data, Competência, Esfera, Ver
      const tableRows = root.querySelectorAll("table tbody tr, table tr");

      logger.debug(`Found ${tableRows.length} table rows`);

      for (const row of tableRows) {
        const cells = row.querySelectorAll("td");

        // Skip header rows
        if (cells.length < 4) continue;

        // Try to find the link to PDF
        const link = row.querySelector('a[href*=".pdf"], a[href*="Ver"], a');
        const href = link?.getAttribute("href");

        if (!href) continue;

        // Try to extract date from cells
        // Date format is usually DD/MM/YYYY
        let date: string | null = null;
        let editionNumber: string | undefined;
        let sphere: string | undefined;

        for (let i = 0; i < cells.length; i++) {
          const cellText = cells[i].text?.trim() || "";

          // Check for date pattern
          const dateMatch = cellText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (dateMatch) {
            const [, day, month, year] = dateMatch;
            date = `${year}-${month}-${day}`;
          }

          // Check for edition number (usually first column)
          if (i === 0) {
            const numMatch = cellText.match(/(\d+)/);
            if (numMatch) {
              editionNumber = numMatch[1];
            }
          }

          // Check for sphere (EXECUTIVO/LEGISLATIVO)
          if (
            cellText.toUpperCase().includes("EXECUTIVO") ||
            cellText.toUpperCase().includes("LEGISLATIVO")
          ) {
            sphere = cellText.toUpperCase().includes("LEGISLATIVO")
              ? "legislative"
              : "executive";
          }
        }

        if (!date) {
          // Try to extract date from href
          const urlDateMatch =
            href.match(/(\d{4})-(\d{2})-(\d{2})/) ||
            href.match(/(\d{4})(\d{2})(\d{2})/);
          if (urlDateMatch) {
            date = `${urlDateMatch[1]}-${urlDateMatch[2]}-${urlDateMatch[3]}`;
          }
        }

        if (!date) continue;

        // Check if in date range
        if (!this.isInDateRange(new Date(date))) continue;

        // Construct full URL
        const fullUrl = href.startsWith("http")
          ? href
          : `${baseUrl.origin}${href.startsWith("/") ? "" : "/"}${href}`;

        gazettes.push({
          date,
          fileUrl: fullUrl,
          territoryId: this.spiderConfig.territoryId,
          editionNumber,
          power: sphere || "executive",
          scrapedAt: new Date().toISOString(),
        });
      }

      // If table parsing didn't work, try finding direct PDF links
      if (gazettes.length === 0) {
        logger.info(
          "No gazettes found in table, trying alternative parsing...",
        );

        const allLinks = root.querySelectorAll('a[href*=".pdf"]');

        for (const link of allLinks) {
          const href = link.getAttribute("href");
          if (!href) continue;

          const text = link.text?.trim() || "";
          const parentText = link.parentNode?.text || "";
          const combinedText = `${text} ${parentText}`;

          // Try to extract date
          const dateMatch = combinedText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) continue;

          const [, day, month, year] = dateMatch;
          const date = `${year}-${month}-${day}`;

          if (!this.isInDateRange(new Date(date))) continue;

          const fullUrl = href.startsWith("http")
            ? href
            : `${baseUrl.origin}${href.startsWith("/") ? "" : "/"}${href}`;

          gazettes.push({
            date,
            fileUrl: fullUrl,
            territoryId: this.spiderConfig.territoryId,
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
