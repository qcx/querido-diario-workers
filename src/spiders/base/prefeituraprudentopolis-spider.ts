import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig } from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";

interface PrefeituraprudentopolisConfig {
  type: "prefeituraprudentopolis";
  baseUrl: string;
}

/**
 * Spider for Prefeitura de Prudentópolis - PR
 *
 * Custom PHP system at diario.prudentopolis.pr.gov.br
 * Listing: table with edition name, date, and actions
 * PDFs: /file.php?s={hash}&download=1
 * View: /view.php?s={hash}
 * Date format: DD/MM/YYYY HH:MM
 * Search: text input for edition search
 */
export class PrefeituraprudentopolisSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraprudentopolisConfig;
    this.baseUrl = platformConfig.baseUrl;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prudentópolis gazette for ${this.config.name}...`);

    try {
      const response = await fetch(`${this.baseUrl}/`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      if (!response.ok) {
        logger.warn(`Failed to fetch Prudentópolis: ${response.status}`);
        return gazettes;
      }

      const html = await response.text();

      const rowPattern =
        /(?:Edi[çc][ãa]o\s*(\d+))[^]*?(\d{2})\/(\d{2})\/(\d{4})\s+\d{2}:\d{2}[^]*?file\.php\?(?:download=1&)?s=([a-f0-9]+)/gi;

      let match;
      while ((match = rowPattern.exec(html)) !== null) {
        const editionNumber = match[1];
        const day = match[2];
        const month = match[3];
        const year = match[4];
        const hash = match[5];
        const isoDate = `${year}-${month}-${day}`;

        if (isoDate < this.dateRange.start || isoDate > this.dateRange.end) {
          continue;
        }

        const pdfUrl = `${this.baseUrl}/file.php?download=1&s=${hash}`;

        gazettes.push({
          date: isoDate,
          editionNumber,
          isExtraEdition: false,
          power: "executive",
          fileUrl: pdfUrl,
          scrapedAt: new Date().toISOString(),
          territoryId: this.config.territoryId,
          sourceText: `Edição ${editionNumber} - ${day}/${month}/${year}`,
        });
      }

      if (gazettes.length === 0) {
        const altPattern =
          /file\.php\?(?:download=1&)?s=([a-f0-9]+)[\s\S]*?(\d{2})\/(\d{2})\/(\d{4})/gi;
        const titlePattern = /Edi[çc][ãa]o\s*(\d+)/gi;

        const fileMatches = [
          ...html.matchAll(
            /href="(?:file|view)\.php\?(?:download=1&)?s=([a-f0-9]+)"[\s\S]*?(\d{2})\/(\d{2})\/(\d{4})/gi,
          ),
        ];

        for (const fm of fileMatches) {
          const hash = fm[1];
          const day = fm[2];
          const month = fm[3];
          const year = fm[4];
          const isoDate = `${year}-${month}-${day}`;

          if (isoDate < this.dateRange.start || isoDate > this.dateRange.end) {
            continue;
          }

          const pdfUrl = `${this.baseUrl}/file.php?download=1&s=${hash}`;

          gazettes.push({
            date: isoDate,
            editionNumber: "",
            isExtraEdition: false,
            power: "executive",
            fileUrl: pdfUrl,
            scrapedAt: new Date().toISOString(),
            territoryId: this.config.territoryId,
            sourceText: `Diário Oficial - ${day}/${month}/${year}`,
          });
        }
      }

      logger.info(`Found ${gazettes.length} gazettes for Prudentópolis`);
    } catch (error) {
      logger.error(`Error crawling Prudentópolis: ${error}`);
    }

    return gazettes;
  }
}
