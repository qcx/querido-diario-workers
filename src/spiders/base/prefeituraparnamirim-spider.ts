import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeituraParnamirimConfig,
} from "../../types";
import { logger } from "../../utils/logger";

/**
 * PrefeituraParnamirimSpider implementation
 *
 * Crawls the official gazette from Parnamirim, RN.
 * Frontend URL: https://diariooficial.parnamirim.rn.gov.br/
 * API URL: https://sgidom.parnamirim.rn.gov.br/rest/
 *
 * The site is an Angular SPA that fetches gazette data from a REST API.
 *
 * API Endpoints:
 * - GET /sgidiario_diario_service/diarios_por_mes?data=YYYY-MM - List gazettes by month
 * - POST https://diariooficial.parnamirim.rn.gov.br/export - Generate PDF
 *
 * PDF Generation requires POST with JSON body:
 * {
 *   domQueryParams: "id_diario=X&publicar=false",
 *   domDataCabecalho: "DD/MM/YYYY",
 *   domOrigin: "https://sgidom.parnamirim.rn.gov.br",
 *   diarioId: X
 * }
 */
export class PrefeituraParnamirimSpider extends BaseSpider {
  protected parnamirimConfig: PrefeituraParnamirimConfig;
  private readonly API_BASE_URL = "https://sgidom.parnamirim.rn.gov.br/rest";
  private readonly EXPORT_URL =
    "https://diariooficial.parnamirim.rn.gov.br/export";
  private readonly DOM_ORIGIN = "https://sgidom.parnamirim.rn.gov.br";

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.parnamirimConfig = spiderConfig.config as PrefeituraParnamirimConfig;

    if (!this.parnamirimConfig.baseUrl) {
      throw new Error(
        `PrefeituraParnamirimSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeituraParnamirimSpider for ${spiderConfig.name}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.parnamirimConfig.baseUrl} for ${this.spiderConfig.name}...`,
    );
    const gazettes: Gazette[] = [];

    try {
      // Iterate through each month in the date range
      const startDate = new Date(this.startDate);
      const endDate = new Date(this.endDate);

      const monthsToProcess: Array<{ month: number; year: number }> = [];

      let currentDate = new Date(
        startDate.getFullYear(),
        startDate.getMonth(),
        1,
      );
      while (currentDate <= endDate) {
        monthsToProcess.push({
          month: currentDate.getMonth() + 1, // 1-12
          year: currentDate.getFullYear(),
        });
        currentDate.setMonth(currentDate.getMonth() + 1);
      }

      for (const { month, year } of monthsToProcess) {
        const monthGazettes = await this.fetchMonthGazettes(month, year);
        gazettes.push(...monthGazettes);
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
   * Fetch gazettes for a specific month and year from the API
   */
  private async fetchMonthGazettes(
    month: number,
    year: number,
  ): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const monthStr = month.toString().padStart(2, "0");

    // Construct API URL with year-month format
    const apiUrl = `${this.API_BASE_URL}/sgidiario_diario_service/diarios_por_mes?data=${year}-${monthStr}`;

    logger.debug(`Fetching gazettes for ${month}/${year}: ${apiUrl}`);

    try {
      const response = await this.fetch(apiUrl);

      if (!response) {
        logger.debug(`Empty response for ${month}/${year}`);
        return gazettes;
      }

      // Parse JSON response
      let diarios: DiarioEntry[];
      try {
        diarios = JSON.parse(response);
      } catch (parseError) {
        logger.error(
          `Failed to parse API response for ${month}/${year}:`,
          parseError as Error,
        );
        return gazettes;
      }

      if (!Array.isArray(diarios)) {
        logger.debug(`Response is not an array for ${month}/${year}`);
        return gazettes;
      }

      for (const diario of diarios) {
        // data_publicacao is a timestamp in milliseconds
        const gazetteDate = new Date(diario.data_publicacao);

        // Check if date is in range
        if (!this.isInDateRange(gazetteDate)) {
          continue;
        }

        // Generate PDF URL using the export endpoint
        const pdfUrl = await this.generatePdfUrl(diario.id, gazetteDate);

        if (!pdfUrl) {
          logger.debug(`Could not generate PDF URL for diario ${diario.id}`);
          continue;
        }

        const gazette = await this.createGazette(gazetteDate, pdfUrl, {
          isExtraEdition: false,
          power: "executive",
          skipUrlResolution: true, // PDF is generated dynamically via POST
        });

        if (gazette) {
          const dateStr = gazetteDate.toLocaleDateString("pt-BR");
          gazette.sourceText = `Diário Oficial de Parnamirim - ${diario.numero} - ${dateStr}`;
          gazettes.push(gazette);
          logger.info(
            `Found gazette for ${gazette.date}: ${gazette.sourceText}`,
          );
        }
      }

      logger.debug(`Found ${gazettes.length} gazettes for ${month}/${year}`);
    } catch (error) {
      logger.error(
        `Error fetching gazettes for ${month}/${year}:`,
        error as Error,
      );
    }

    return gazettes;
  }

  /**
   * Generate PDF URL by calling the export endpoint
   * The PDF is generated dynamically, so we construct the export URL with the required parameters
   */
  private async generatePdfUrl(
    diarioId: number,
    date: Date,
  ): Promise<string | null> {
    try {
      // Format date as DD/MM/YYYY
      const day = date.getDate().toString().padStart(2, "0");
      const month = (date.getMonth() + 1).toString().padStart(2, "0");
      const year = date.getFullYear();
      const dateStr = `${day}/${month}/${year}`;

      // The export endpoint requires a POST request with JSON body
      // Since we can't make POST requests directly to get PDF, we'll construct the URL
      // with query params that the spider can use to fetch the PDF

      // Create a URL that encodes all the necessary parameters for the export
      const queryParams = new URLSearchParams({
        id_diario: diarioId.toString(),
        publicar: "false",
      });

      // Build the export URL with all necessary data
      const exportData = {
        domQueryParams: queryParams.toString(),
        domDataCabecalho: dateStr,
        domOrigin: this.DOM_ORIGIN,
        diarioId: diarioId,
      };

      // For the spider, we'll create a special URL format that can be parsed later
      // to make the POST request for PDF generation
      // Using the export URL with encoded JSON as a query parameter
      const encodedData = encodeURIComponent(JSON.stringify(exportData));
      return `${this.EXPORT_URL}?data=${encodedData}`;
    } catch (error) {
      logger.debug(
        `Error generating PDF URL for diario ${diarioId}:`,
        error as Error,
      );
      return null;
    }
  }

  /**
   * Override the fetch method to handle POST requests for PDF export
   */
  protected async fetchPdf(url: string): Promise<Buffer | null> {
    try {
      // Check if this is an export URL with encoded data
      if (url.includes(this.EXPORT_URL) && url.includes("data=")) {
        const urlObj = new URL(url);
        const encodedData = urlObj.searchParams.get("data");

        if (encodedData) {
          const exportData = JSON.parse(decodeURIComponent(encodedData));

          // Make POST request to export endpoint
          const response = await fetch(this.EXPORT_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(exportData),
          });

          if (!response.ok) {
            logger.error(
              `Failed to fetch PDF: ${response.status} ${response.statusText}`,
            );
            return null;
          }

          const buffer = await response.arrayBuffer();
          return Buffer.from(buffer);
        }
      }

      // Fall back to default fetch behavior
      return super.fetchPdf ? await super.fetchPdf(url) : null;
    } catch (error) {
      logger.error(`Error fetching PDF from ${url}:`, error as Error);
      return null;
    }
  }
}

/**
 * Interface for the API response entries
 */
interface DiarioEntry {
  id: number;
  numero: string;
  log_user: number;
  log_date: number;
  status: boolean;
  data_publicacao: number;
  totalDiarios: number | null;
  nome_criador_diario: string | null;
}
