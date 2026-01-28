import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig } from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
import { getCurrentTimestamp } from "../../utils/date-utils";

/**
 * Configuration for IM Publicações spider
 */
export interface ImpublicacoesConfig {
  type: "impublicacoes";
  /** IBGE territory ID (will be double base64 encoded for the municipio parameter) */
  territoryId: string;
  /** Type of entity: 'pref' for prefeitura, 'cama' for câmara */
  entityType?: "pref" | "cama";
  /** Whether client rendering is required (always true for this platform) */
  requiresClientRendering: boolean;
}

/**
 * Spider for IM Publicações platform (impublicacoes.org)
 *
 * This platform uses a calendar-based interface to display official gazettes.
 * The site is JavaScript-based but we can extract data using direct HTTP requests.
 *
 * URL Pattern for calendar:
 * https://impublicacoes.org/agenda/index.php?month=MM&year=YYYY&type=TYPE&municipio=ENCODED_ID
 *
 * URL Pattern for gazette details:
 * https://impublicacoes.org/agenda/janela_agenda.php?id=ID&dia=DD&mes=MM&ano=YYYY&type=TYPE&municipio=ENCODED_ID
 *
 * Where ENCODED_ID is double base64 encoded IBGE territory ID:
 * - First encode: btoa(territoryId)
 * - Second encode: btoa(firstEncode)
 *
 * The calendar shows dates with publications. Each date links to janela_agenda.php which contains
 * the actual PDF URLs in the format:
 * https://impublicacoes.org/trdados/arquivos_agenda_YYYY/MM/HASH.pdf
 */
export class ImpublicacoesSpider extends BaseSpider {
  private impublicacoesConfig: ImpublicacoesConfig;
  private readonly BASE_URL = "https://impublicacoes.org/agenda";
  protected browser?: Fetcher;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    this.impublicacoesConfig = config.config as ImpublicacoesConfig;

    if (!this.impublicacoesConfig.territoryId) {
      throw new Error(
        `ImpublicacoesSpider requires territoryId in config for ${config.name}`,
      );
    }

    logger.info(
      `Initializing ImpublicacoesSpider for ${config.name} with territoryId: ${this.impublicacoesConfig.territoryId}`,
    );
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  /**
   * Encode territory ID for use in URL (double base64 encoding)
   */
  private encodeTerrritoryId(territoryId: string): string {
    const firstEncode = Buffer.from(territoryId).toString("base64");
    return Buffer.from(firstEncode).toString("base64");
  }

  /**
   * Build URL for calendar page
   */
  private buildCalendarUrl(year: number, month: number): string {
    const encodedId = this.encodeTerrritoryId(
      this.impublicacoesConfig.territoryId,
    );
    const entityType = this.impublicacoesConfig.entityType || "pref";
    return `${this.BASE_URL}/index.php?month=${month}&year=${year}&type=${entityType}&municipio=${encodedId}`;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling IM Publicações for ${this.config.name}...`);

    // Use HTTP-based crawling - no browser needed
    return this.crawlWithHttp();
  }

  /**
   * HTTP-based crawling - extracts gazette information using direct HTTP requests
   */
  private async crawlWithHttp(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    // Generate months to crawl based on date range
    const startDate = new Date(this.dateRange.start);
    const endDate = new Date(this.dateRange.end);

    const currentDate = new Date(
      startDate.getFullYear(),
      startDate.getMonth(),
      1,
    );

    while (currentDate <= endDate) {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1;

      try {
        const url = this.buildCalendarUrl(year, month);
        logger.info(`Fetching calendar page: ${url}`);

        const response = await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
          },
        });

        if (!response.ok) {
          logger.warn(`Failed to fetch calendar page: ${response.status}`);
          currentDate.setMonth(currentDate.getMonth() + 1);
          continue;
        }

        const html = await response.text();

        // Extract dates that have publications from the calendar
        // Pattern: onclick=click_data('janela_agenda.php?id=ID&dia=DD&mes=MM&ano=YYYY&type=TYPE&municipio=ENCODED')
        const datePattern =
          /onclick=click_data\('janela_agenda\.php\?id=(\d+)&dia=(\d+)&mes=(\d+)&ano=(\d+)&type=(\w+)&municipio=([^']+)'\)/g;

        const matches = [...html.matchAll(datePattern)];
        logger.debug(
          `Found ${matches.length} publication dates in ${year}/${month}`,
        );

        for (const match of matches) {
          const [, id, day, monthStr, yearStr, type, municipio] = match;
          const dateStr = `${yearStr}-${String(monthStr).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

          // Check if date is in range
          if (dateStr < this.dateRange.start || dateStr > this.dateRange.end) {
            continue;
          }

          // Fetch the gazette details page to get the PDF URL
          const pdfUrls = await this.fetchGazetteDetails(
            id,
            day,
            monthStr,
            yearStr,
            type,
            municipio,
          );

          for (const pdfUrl of pdfUrls) {
            gazettes.push({
              date: dateStr,
              fileUrl: pdfUrl,
              territoryId: this.config.territoryId,
              isExtraEdition: false,
              power: "executive",
              scrapedAt: getCurrentTimestamp(),
            });
          }
        }
      } catch (error) {
        logger.error(
          `Error fetching calendar for ${year}/${month}:`,
          error as Error,
        );
      }

      // Move to next month
      currentDate.setMonth(currentDate.getMonth() + 1);
    }

    logger.info(`HTTP crawl found ${gazettes.length} gazettes`);
    return gazettes;
  }

  /**
   * Fetch gazette details page and extract PDF URLs
   */
  private async fetchGazetteDetails(
    id: string,
    day: string,
    month: string,
    year: string,
    type: string,
    municipio: string,
  ): Promise<string[]> {
    const pdfUrls: string[] = [];

    try {
      const detailsUrl = `${this.BASE_URL}/janela_agenda.php?id=${id}&dia=${day}&mes=${month}&ano=${year}&type=${type}&municipio=${municipio}`;
      logger.debug(`Fetching gazette details: ${detailsUrl}`);

      const response = await fetch(detailsUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      });

      if (!response.ok) {
        logger.warn(`Failed to fetch gazette details: ${response.status}`);
        return pdfUrls;
      }

      const html = await response.text();

      // Extract PDF URLs from the page
      // Pattern 1: Direct PDF links (preferred)
      // href="../trdados/../../trdados/arquivos_agenda_YYYY/MM/HASH.pdf"
      const directPdfPattern =
        /href="([^"]*trdados\/arquivos_agenda_\d{4}\/\d{2}\/[a-f0-9]+\.pdf)"/gi;
      const directMatches = [...html.matchAll(directPdfPattern)];

      for (const match of directMatches) {
        const relativePath = match[1];
        const absoluteUrl = this.resolveRelativePath(relativePath);
        if (absoluteUrl && !pdfUrls.includes(absoluteUrl)) {
          pdfUrls.push(absoluteUrl);
        }
      }

      // Pattern 2: If no direct links found, try ler_pdf.php links and convert them
      if (pdfUrls.length === 0) {
        const viewerPattern = /href="ler_pdf\.php\?uri_edicao=([^"]+\.pdf)"/gi;
        const viewerMatches = [...html.matchAll(viewerPattern)];

        for (const match of viewerMatches) {
          const uriEdicao = match[1];
          const absoluteUrl = this.resolveRelativePath(uriEdicao);
          if (absoluteUrl && !pdfUrls.includes(absoluteUrl)) {
            pdfUrls.push(absoluteUrl);
          }
        }
      }

      logger.debug(
        `Found ${pdfUrls.length} PDF URLs for ${year}-${month}-${day}`,
      );
    } catch (error) {
      logger.error(`Error fetching gazette details:`, error as Error);
    }

    return pdfUrls;
  }

  /**
   * Resolve relative path to absolute URL
   * Converts paths like "../trdados/../../trdados/arquivos_agenda_2026/01/HASH.pdf"
   * to "https://impublicacoes.org/trdados/arquivos_agenda_2026/01/HASH.pdf"
   */
  private resolveRelativePath(relativePath: string): string | null {
    try {
      // Extract the actual path from the relative path
      // The path typically contains "../trdados/../../trdados/arquivos_agenda_YYYY/MM/HASH.pdf"
      // We need to extract "trdados/arquivos_agenda_YYYY/MM/HASH.pdf"
      const match = relativePath.match(
        /trdados\/arquivos_agenda_\d{4}\/\d{2}\/[a-f0-9]+\.pdf/i,
      );
      if (match) {
        return `https://impublicacoes.org/${match[0]}`;
      }

      // Alternative: if the path starts with trdados/
      if (relativePath.includes("trdados/arquivos_agenda_")) {
        const cleanPath = relativePath.replace(/^[./]+/, "");
        const pathMatch = cleanPath.match(
          /trdados\/arquivos_agenda_\d{4}\/\d{2}\/[a-f0-9]+\.pdf/i,
        );
        if (pathMatch) {
          return `https://impublicacoes.org/${pathMatch[0]}`;
        }
      }

      return null;
    } catch (error) {
      logger.debug(`Error resolving relative path: ${error}`);
      return null;
    }
  }
}
