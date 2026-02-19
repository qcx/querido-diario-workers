import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig } from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";

interface DioemsConfig {
  type: "dioems";
  baseUrl: string;
  municipalityId: string;
  stateCode: string;
}

const PT_MONTHS: Record<string, string> = {
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
 * Spider for DIOEMS - Diário Oficial Eletrônico dos Municípios
 * Platform: dioems.com.br (HUNER Ti Colaborativa)
 *
 * Uses /edicoes.php to list full edition PDFs with date filters.
 * Falls back to /pesquisa.php for individual document extraction.
 * PDF pattern: /edicoes/{entGrupo}/{paddedId}/{id}-{hash}.pdf
 */
export class DioemsSpider extends BaseSpider {
  private baseUrl: string;
  private municipalityId: string;
  private stateCode: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as DioemsConfig;
    this.baseUrl = platformConfig.baseUrl;
    this.municipalityId = platformConfig.municipalityId;
    this.stateCode = platformConfig.stateCode;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling DIOEMS gazette for ${this.config.name}...`);

    try {
      await this.crawlEditions(gazettes);

      if (gazettes.length === 0) {
        logger.info(
          `No gazettes from edicoes.php, falling back to pesquisa.php`,
        );
        await this.crawlSearch(gazettes);
      }

      logger.info(
        `Found ${gazettes.length} gazettes for ${this.config.name} via DIOEMS`,
      );
    } catch (error) {
      logger.error(`Error crawling DIOEMS for ${this.config.name}: ${error}`);
    }

    return gazettes;
  }

  private async crawlEditions(gazettes: Gazette[]): Promise<void> {
    const body = new URLSearchParams({
      dataIni: this.dateRange.start,
      dataFin: this.dateRange.end,
    });

    const response = await fetch(`${this.baseUrl}/edicoes.php`, {
      method: "POST",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      logger.warn(
        `Failed to fetch DIOEMS edicoes page: ${response.status}`,
      );
      return;
    }

    const html = await response.text();
    this.extractEditions(html, gazettes);
  }

  private extractEditions(html: string, gazettes: Gazette[]): void {
    const editionPattern =
      /Edi[çc][ãa]o\s*N[ºo°]\s*(\d+)\s+publicada\s+[^,]+,\s*(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})[\s\S]*?href="([^"]*\.pdf)"\s*download/gi;

    let match;
    while ((match = editionPattern.exec(html)) !== null) {
      const editionNumber = match[1];
      const day = match[2].padStart(2, "0");
      const monthName = match[3].toLowerCase();
      const year = match[4];
      let pdfUrl = match[5];

      const month = PT_MONTHS[monthName];
      if (!month) continue;

      const isoDate = `${year}-${month}-${day}`;
      if (isoDate < this.dateRange.start || isoDate > this.dateRange.end) {
        continue;
      }

      if (!pdfUrl.startsWith("http")) {
        pdfUrl = `${this.baseUrl}/${pdfUrl.replace(/^\//, "")}`;
      }

      const alreadyExists = gazettes.some(
        (g) => g.editionNumber === editionNumber && g.date === isoDate,
      );
      if (alreadyExists) continue;

      gazettes.push({
        date: isoDate,
        editionNumber,
        isExtraEdition: false,
        power: "executive",
        fileUrl: pdfUrl,
        scrapedAt: new Date().toISOString(),
        territoryId: this.config.territoryId,
        sourceText: `Edição Nº ${editionNumber} - ${day}/${month}/${year}`,
      });
    }
  }

  private async crawlSearch(gazettes: Gazette[]): Promise<void> {
    let offset = 0;
    const limit = 10;
    let hasMore = true;

    const searchParams = JSON.stringify({
      dtIni: this.dateRange.start,
      dtEnd: this.dateRange.end,
      uf: this.stateCode,
      mun: this.municipalityId,
      ent: null,
      catDoc: null,
      doc: null,
      pesq: null,
    });

    const initialBody = new URLSearchParams({
      dataEd: this.dateRange.start,
      dataFn: this.dateRange.end,
      ufEd: this.stateCode,
      muniEd: this.municipalityId,
      entiEd: "0",
      catDoc: "0",
      tpDoc: "0",
    });

    const initialResponse = await fetch(`${this.baseUrl}/pesquisa.php`, {
      method: "POST",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: initialBody.toString(),
    });

    if (!initialResponse.ok) {
      logger.warn(
        `Failed to fetch DIOEMS search page: ${initialResponse.status}`,
      );
      return;
    }

    const html = await initialResponse.text();
    this.extractSearchResults(html, gazettes);

    while (hasMore) {
      offset += limit;
      const ajaxBody = new URLSearchParams({
        tipo: "infinityPsq",
        parsPsq: searchParams,
        ofsPq: offset.toString(),
        lmtPq: limit.toString(),
      });

      const ajaxResponse = await fetch(`${this.baseUrl}/funcoes/ajax.php`, {
        method: "POST",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: ajaxBody.toString(),
      });

      if (!ajaxResponse.ok) {
        hasMore = false;
        break;
      }

      const contentType = ajaxResponse.headers.get("content-type") || "";
      let pageHtml: string;

      if (contentType.includes("application/json")) {
        const json = await ajaxResponse.json();
        pageHtml = json.html || "";
      } else {
        pageHtml = await ajaxResponse.text();
      }

      if (!pageHtml || pageHtml.trim().length < 10) {
        hasMore = false;
        break;
      }

      const beforeCount = gazettes.length;
      this.extractSearchResults(pageHtml, gazettes);

      if (gazettes.length === beforeCount) {
        hasMore = false;
      }

      if (offset > 500) break;
    }
  }

  private extractSearchResults(html: string, gazettes: Gazette[]): void {
    const resultPattern =
      /href="(edicoes\/[^"]*\.pdf)"[\s\S]*?Edi[çc][ãa]o\s*(?:N[ºo°]?\s*)?(\d+)\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/gi;

    let match;
    while ((match = resultPattern.exec(html)) !== null) {
      let pdfUrl = match[1];
      const editionNumber = match[2];
      const day = match[3];
      const month = match[4];
      const year = match[5];
      const isoDate = `${year}-${month}-${day}`;

      if (isoDate < this.dateRange.start || isoDate > this.dateRange.end) {
        continue;
      }

      if (!pdfUrl.startsWith("http")) {
        pdfUrl = `${this.baseUrl}/${pdfUrl.replace(/^\//, "")}`;
      }

      const alreadyExists = gazettes.some(
        (g) => g.editionNumber === editionNumber && g.date === isoDate,
      );
      if (alreadyExists) continue;

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
  }
}
