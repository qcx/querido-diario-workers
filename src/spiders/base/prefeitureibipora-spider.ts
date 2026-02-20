import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig } from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";

interface PrefeitureibiporaConfig {
  type: "prefeitureibipora";
  baseUrl: string;
}

const MONTH_MAP: Record<string, string> = {
  janeiro: "01",
  fevereiro: "02",
  "mar\u00E7o": "03",
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
 * Spider for Prefeitura de Ibiporã - PR
 *
 * Yii2-based gazette system at diario.ibipora.pr.gov.br
 * The server has an incomplete TLS certificate chain, so we must use
 * browser-based fetching (puppeteer) instead of plain fetch.
 *
 * HTML structure: .box-publicacao[data-key] divs each containing
 *   - h4 with "Edição nº {number}/{year}"
 *   - Portuguese long-form date: "Sexta-feira, 13 de fevereiro de 2026"
 *   - PDF link: /diario-oficial/versao-pdf/{id}
 * Search: GET /diario-oficial?BuscaSearch[data_inicio]=YYYY-MM-DD&BuscaSearch[data_fim]=YYYY-MM-DD
 *
 * NOTE: The BuscaSearch date filter only works for page 1; subsequent pages
 * return older results. We stop pagination once entries older than the range appear.
 */
export class PrefeitureibiporaSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeitureibiporaConfig;
    this.baseUrl = platformConfig.baseUrl;
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  private parsePtBrDate(text: string): string | null {
    const match = text.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
    if (!match) return null;
    const day = match[1].padStart(2, "0");
    const monthName = match[2].toLowerCase();
    const year = match[3];
    const month = MONTH_MAP[monthName];
    if (!month) return null;
    return `${year}-${month}-${day}`;
  }

  private buildPageUrl(page: number): string {
    const start = encodeURIComponent(this.dateRange.start);
    const end = encodeURIComponent(this.dateRange.end);
    let url = `${this.baseUrl}/diario-oficial?BuscaSearch%5Bdata_inicio%5D=${start}&BuscaSearch%5Bdata_fim%5D=${end}`;
    if (page > 1) {
      url += `&page=${page}`;
    }
    return url;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      throw new Error(
        "PrefeitureibiporaSpider requires a browser (TLS issue on domain)",
      );
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling Ibiporã gazette for ${this.config.name}...`);

    let browserInstance = null;
    let browserPage = null;

    try {
      browserInstance = await puppeteer.launch(this.browser);
      browserPage = await browserInstance.newPage();

      const client = await browserPage.createCDPSession();
      await client.send("Security.setIgnoreCertificateErrors", {
        ignore: true,
      });

      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const url = this.buildPageUrl(page);
        logger.debug(`Fetching page ${page}: ${url}`);

        await browserPage.goto(url, {
          waitUntil: "networkidle0",
          timeout: 30000,
        });
        const html = await browserPage.content();
        const sections = html.split(/box-publicacao[^>]*data-key="/).slice(1);

        if (sections.length === 0) {
          break;
        }

        let foundOlderThanRange = false;

        for (const section of sections) {
          const keyMatch = section.match(/^(\d+)/);
          if (!keyMatch) continue;

          const pdfMatch = section.match(
            /href="\/diario-oficial\/versao-pdf\/(\d+)"/,
          );
          if (!pdfMatch) continue;
          const pdfId = pdfMatch[1];

          const isoDate = this.parsePtBrDate(section);
          if (!isoDate) continue;

          if (isoDate < this.dateRange.start) {
            foundOlderThanRange = true;
            continue;
          }
          if (isoDate > this.dateRange.end) {
            continue;
          }

          const editionMatch = section.match(
            /Edi[çc][ãa]o\s+n[ºo°]\s*(\d[\d.\/]*)/i,
          );
          const editionNumber = editionMatch
            ? editionMatch[1].replace(/\/\d{4}$/, "").replace(/\./g, "")
            : pdfId;

          const pdfUrl = `${this.baseUrl}/diario-oficial/versao-pdf/${pdfId}`;

          gazettes.push({
            date: isoDate,
            editionNumber,
            isExtraEdition: false,
            power: "executive",
            fileUrl: pdfUrl,
            scrapedAt: new Date().toISOString(),
            territoryId: this.config.territoryId,
            sourceText: `Edição ${editionNumber} - ${isoDate}`,
          });
        }

        if (foundOlderThanRange) {
          break;
        }

        const hasNextPage = html.includes(`page=${page + 1}`);
        if (!hasNextPage) {
          hasMore = false;
        }

        page++;
        if (page > 50) break;
      }

      logger.info(`Found ${gazettes.length} gazettes for Ibiporã`);
    } catch (error) {
      logger.error(`Error crawling Ibiporã: ${error}`);
    } finally {
      if (browserPage) {
        try {
          await browserPage.close();
        } catch (_) {}
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (_) {}
      }
    }

    return gazettes;
  }
}
