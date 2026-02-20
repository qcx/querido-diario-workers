import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  TransparenciaOficialBaConfig,
} from "../../types";
import { logger } from "../../utils/logger";
import { getCurrentTimestamp, fromISODate } from "../../utils/date-utils";

/**
 * Transparência Oficial BA Spider implementation
 *
 * Crawls gazette data from transparenciaoficialba.com platform.
 * Used by municipalities in Bahia (e.g., Casa Nova).
 *
 * URL Structure:
 * - Main page: https://{subdomain}.transparenciaoficialba.com/diariooficial/
 * - Monthly archive with filter: ?ano={year}&mes={month}&filtro={category}
 * - PDF links: ../arquivos/publicacoes/{year}/FILE.pdf
 *
 * HTML Structure:
 * - Each publication is in <div id="grupo-publicacoes">
 * - PDF link: <a href="../arquivos/publicacoes/YYYY/...pdf" target="_blank">
 * - Date: <span><strong>Data:</strong> DD/MM/YYYY</span>
 * - Title: <p><strong>Título:</strong> ...</p>
 *
 * Categories (filtro parameter):
 * - atos: Atos Oficiais
 * - contratos: Contratos na Íntegra
 * - editais: Editais
 * - leis: Leis
 * - licitacoes: Licitações e Contratos
 * - relatorio: Relatório de Responsabilidade Fiscal
 */
export class TransparenciaOficialBaSpider extends BaseSpider {
  protected config: TransparenciaOficialBaConfig;
  private baseUrl: string;

  // Categories to crawl
  private readonly CATEGORIES = [
    "atos",
    "contratos",
    "editais",
    "leis",
    "licitacoes",
  ];

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as TransparenciaOficialBaConfig;

    if (!this.config.subdomain) {
      throw new Error(
        `TransparenciaOficialBaSpider requires subdomain in config for ${spiderConfig.name}`,
      );
    }

    this.baseUrl = `https://${this.config.subdomain}.transparenciaoficialba.com`;

    logger.info(
      `Initializing TransparenciaOficialBaSpider for ${spiderConfig.name} with subdomain: ${this.config.subdomain}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling Transparência Oficial BA for ${this.spiderConfig.name}...`,
    );
    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();

    try {
      // Crawl each month in the date range
      const months = this.getMonthsInRange();

      for (const { year, month } of months) {
        // For each month, crawl all categories
        for (const category of this.CATEGORIES) {
          const categoryGazettes = await this.crawlMonthCategory(
            year,
            month,
            category,
          );

          // Add unique gazettes
          for (const gazette of categoryGazettes) {
            if (
              !seenUrls.has(gazette.fileUrl) &&
              this.isDateInRange(gazette.date)
            ) {
              seenUrls.add(gazette.fileUrl);
              gazettes.push(gazette);
              logger.debug(
                `Found gazette for ${gazette.date}: ${gazette.sourceText}`,
              );
            }
          }
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
      );
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Get all months in the date range
   */
  private getMonthsInRange(): Array<{ year: number; month: number }> {
    const months: Array<{ year: number; month: number }> = [];

    const startYear = this.startDate.getFullYear();
    const startMonth = this.startDate.getMonth() + 1;
    const endYear = this.endDate.getFullYear();
    const endMonth = this.endDate.getMonth() + 1;

    let currentYear = startYear;
    let currentMonth = startMonth;

    while (
      currentYear < endYear ||
      (currentYear === endYear && currentMonth <= endMonth)
    ) {
      months.push({ year: currentYear, month: currentMonth });

      currentMonth++;
      if (currentMonth > 12) {
        currentMonth = 1;
        currentYear++;
      }
    }

    return months;
  }

  /**
   * Crawl gazettes for a specific month and category
   */
  private async crawlMonthCategory(
    year: number,
    month: number,
    category: string,
  ): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      const monthStr = month.toString().padStart(2, "0");
      const pageUrl = `${this.baseUrl}/diariooficial/?ano=${year}&mes=${monthStr}&filtro=${category}`;
      logger.debug(
        `Fetching page for ${category} ${month}/${year}: ${pageUrl}`,
      );

      const response = await fetch(pageUrl, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      });

      if (!response.ok) {
        logger.warn(
          `Failed to fetch page for ${category} ${month}/${year}: ${response.status}`,
        );
        return gazettes;
      }

      const html = await response.text();

      // Parse the HTML to find gazette links
      const parsedGazettes = this.parsePublicationsPage(html, category);
      gazettes.push(...parsedGazettes);
    } catch (error) {
      logger.error(
        `Error crawling ${category} ${month}/${year}:`,
        error as Error,
      );
    }

    return gazettes;
  }

  /**
   * Parse a page to extract gazette entries from "grupo-publicacoes" divs
   */
  private parsePublicationsPage(html: string, category: string): Gazette[] {
    const gazettes: Gazette[] = [];

    // Pattern to match each publication block
    // <div id="grupo-publicacoes">...<a href="../arquivos/publicacoes/YYYY/...pdf"...>...Data: DD/MM/YYYY...
    const publicationPattern =
      /<div\s+id="grupo-publicacoes"[\s\S]*?<a\s+href="([^"]*\.pdf)"[^>]*>[\s\S]*?<strong>Data:<\/strong>\s*(\d{2})\/(\d{2})\/(\d{4})[\s\S]*?<strong>Título:<\/strong>\s*([^<]*)</gi;

    let match;
    while ((match = publicationPattern.exec(html)) !== null) {
      const pdfPath = match[1];
      const day = match[2];
      const month = match[3];
      const year = match[4];
      const title = match[5].trim();

      const gazetteDate = `${year}-${month}-${day}`;

      // Build full URL - handle relative paths
      // ../arquivos/publicacoes/2024/... -> https://subdomain.transparenciaoficialba.com/arquivos/publicacoes/2024/...
      let fullUrl: string;
      if (pdfPath.startsWith("http")) {
        fullUrl = pdfPath;
      } else if (pdfPath.startsWith("../")) {
        // Remove ../ and append to base URL
        fullUrl = `${this.baseUrl}/${pdfPath.replace(/^\.\.\//, "")}`;
      } else if (pdfPath.startsWith("/")) {
        fullUrl = `${this.baseUrl}${pdfPath}`;
      } else {
        fullUrl = `${this.baseUrl}/diariooficial/${pdfPath}`;
      }

      const gazette: Gazette = {
        date: gazetteDate,
        fileUrl: fullUrl,
        territoryId: this.spiderConfig.territoryId,
        scrapedAt: getCurrentTimestamp(),
        isExtraEdition: false,
        power: "executive_legislative",
        sourceText: `${this.getCategoryName(category)} - ${title}`,
      };

      gazettes.push(gazette);
    }

    // Fallback: simpler pattern if the above doesn't match
    if (gazettes.length === 0) {
      const simplePattern =
        /<a\s+href="([^"]*arquivos\/publicacoes[^"]*\.pdf)"[^>]*>[\s\S]*?<span><strong>Data:<\/strong>\s*(\d{2})\/(\d{2})\/(\d{4})<\/span>/gi;

      while ((match = simplePattern.exec(html)) !== null) {
        const pdfPath = match[1];
        const day = match[2];
        const month = match[3];
        const year = match[4];

        const gazetteDate = `${year}-${month}-${day}`;

        let fullUrl: string;
        if (pdfPath.startsWith("http")) {
          fullUrl = pdfPath;
        } else if (pdfPath.startsWith("../")) {
          fullUrl = `${this.baseUrl}/${pdfPath.replace(/^\.\.\//, "")}`;
        } else if (pdfPath.startsWith("/")) {
          fullUrl = `${this.baseUrl}${pdfPath}`;
        } else {
          fullUrl = `${this.baseUrl}/diariooficial/${pdfPath}`;
        }

        const gazette: Gazette = {
          date: gazetteDate,
          fileUrl: fullUrl,
          territoryId: this.spiderConfig.territoryId,
          scrapedAt: getCurrentTimestamp(),
          isExtraEdition: false,
          power: "executive_legislative",
          sourceText: `Diário Oficial - ${this.getCategoryName(category)}`,
        };

        gazettes.push(gazette);
      }
    }

    return gazettes;
  }

  /**
   * Get human-readable category name
   */
  private getCategoryName(category: string): string {
    const names: Record<string, string> = {
      atos: "Atos Oficiais",
      contratos: "Contratos",
      editais: "Editais",
      leis: "Leis",
      licitacoes: "Licitações",
      relatorio: "Relatório Fiscal",
    };
    return names[category] || category;
  }

  /**
   * Check if a date string (YYYY-MM-DD) is within the search range
   */
  private isDateInRange(dateStr: string): boolean {
    try {
      const date = fromISODate(dateStr);
      return date >= this.startDate && date <= this.endDate;
    } catch {
      return false;
    }
  }
}
