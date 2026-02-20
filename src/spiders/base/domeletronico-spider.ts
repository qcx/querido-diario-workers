import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig } from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";

interface DomeletronicConfig {
  type: "domeletronico";
  baseUrl: string;
  municipioCode?: string;
  nomePasta?: string;
}

export class DomeletronicSpider extends BaseSpider {
  private baseUrl: string;
  private municipioCode: string;
  private nomePasta: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as DomeletronicConfig;
    this.baseUrl = platformConfig.baseUrl.replace(/\/$/, "");
    this.municipioCode = platformConfig.municipioCode || "";

    if (platformConfig.nomePasta) {
      this.nomePasta = platformConfig.nomePasta;
    } else {
      try {
        const hostname = new URL(this.baseUrl).hostname;
        const subdomain = hostname.split(".")[0];
        this.nomePasta = `do${subdomain}`;
      } catch {
        this.nomePasta = "";
      }
    }
  }

  private formatDateBR(dateStr: string): string {
    const [year, month, day] = dateStr.split("-");
    return `${day}/${month}/${year}`;
  }

  private parseDateBR(dateBR: string): string {
    const [day, month, year] = dateBR.split("/");
    return `${year}-${month}-${day}`;
  }

  private dateToBase64(date: string): string {
    return Buffer.from(date).toString("base64");
  }

  private async fetchAllEditions(): Promise<
    Array<{ date: string; ticket: string }>
  > {
    const editions: Array<{ date: string; ticket: string }> = [];
    const startDateBR = this.formatDateBR(this.dateRange.start);

    const url = `${this.baseUrl}/controllers/lista_edicoes.php`;
    logger.info(`Fetching editions list from ${url}`);

    try {
      const body = new URLSearchParams({
        data: startDateBR,
        nroedi: "",
        pchave: "",
        pasta: this.nomePasta,
        tudo: "tudo",
      });

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "text/html",
        },
        body: body.toString(),
      });

      if (!response.ok) {
        logger.warn(`Failed to fetch editions list: ${response.status}`);
        return editions;
      }

      const html = await response.text();

      const editionRegex =
        /procuraEdicaoData\('(\d{2}\/\d{2}\/\d{4})'\s*,\s*'(\d+)'\)/g;
      let match;
      const seen = new Set<string>();

      while ((match = editionRegex.exec(html)) !== null) {
        const dateBR = match[1];
        const ticket = match[2];
        const dateISO = this.parseDateBR(dateBR);

        if (dateISO < this.dateRange.start || dateISO > this.dateRange.end) {
          continue;
        }

        const key = `${dateISO}-${ticket}`;
        if (seen.has(key)) continue;
        seen.add(key);

        editions.push({ date: dateISO, ticket });
      }
    } catch (error) {
      logger.error(`Error fetching editions list: ${error}`);
    }

    return editions;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Dom Eletrônico gazette for ${this.config.name}...`);

    try {
      const editions = await this.fetchAllEditions();
      logger.info(
        `Found ${editions.length} editions in date range for ${this.config.name}`,
      );

      for (const edition of editions) {
        const base64Date = this.dateToBase64(edition.date);
        const fileUrl = `${this.baseUrl}/views/site/diario_pdf.php?data=${base64Date}&ticket=${edition.ticket}`;

        gazettes.push({
          date: edition.date,
          fileUrl,
          territoryId: this.config.territoryId,
          power: "executive",
          scrapedAt: new Date().toISOString(),
        });
      }

      logger.info(
        `Found ${gazettes.length} gazettes for Dom Eletrônico (${this.config.name})`,
      );
    } catch (error) {
      logger.error(`Error crawling Dom Eletrônico: ${error}`);
    }

    return gazettes;
  }
}
