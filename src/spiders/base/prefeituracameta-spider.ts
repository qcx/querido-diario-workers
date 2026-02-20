import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange, PrefeituracametaConfig } from "../../types";
import { logger } from "../../utils/logger";

/**
 * Spider for Diário Oficial de Cametá-PA.
 * Site: https://prefeituradecameta.pa.gov.br/diario-oficial-do-municipio/
 * WordPress page with direct PDF links: Edicao-XXX-DD-de-Mês-de-YYYY.pdf
 */
export class PrefeituracametaSpider extends BaseSpider {
  private baseUrl: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    const cfg = spiderConfig.config as PrefeituracametaConfig;
    this.baseUrl = cfg.baseUrl.replace(/\/$/, "");
    if (!this.baseUrl) {
      throw new Error(`PrefeituracametaSpider requires baseUrl for ${spiderConfig.name}`);
    }
    logger.info(`Initializing PrefeituracametaSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const seen = new Set<string>();
    const months: Record<string, string> = {
      Janeiro: "01", Fevereiro: "02", Março: "03", Marco: "03", Abril: "04", Maio: "05",
      Junho: "06", Julho: "07", Agosto: "08", Setembro: "09", Outubro: "10",
      Novembro: "11", Dezembro: "12", JANEIRO: "01", DEZEMBRO: "12",
    };

    const html = await this.fetch(this.baseUrl);

    // Links like: .../Edicao-546-08-de-Janeiro-de-2026.pdf or Edicao-544-31-de-Dezembro-de-2025.pdf
    const linkRegex = /href="(https?:\/\/[^"]*Edicao-(\d+)-(\d+)-de-([A-Zaçã]+)-de-(\d{4})\.pdf)"/gi;
    let m: RegExpExecArray | null;
    while ((m = linkRegex.exec(html)) !== null) {
      const pdfUrl = m[1];
      const day = m[3].padStart(2, "0");
      const monthName = m[4].replace(/ç/g, "c").replace(/ã/g, "a");
      const month = months[monthName] || months[monthName.charAt(0).toUpperCase() + monthName.slice(1).toLowerCase()];
      if (!month) continue;
      const year = m[5];
      const dateStr = `${year}-${month}-${day}`;
      const gazetteDate = new Date(dateStr + "T12:00:00Z");
      if (!this.isInDateRange(gazetteDate)) continue;
      if (seen.has(pdfUrl)) continue;
      seen.add(pdfUrl);

      const g = await this.createGazette(gazetteDate, pdfUrl, {
        editionNumber: m[2],
        power: "executive",
      });
      if (g) gazettes.push(g);
    }

    logger.info(`PrefeituracametaSpider found ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    return gazettes;
  }
}
