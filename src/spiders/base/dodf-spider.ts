import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange, DODFConfig } from "../../types";
import { logger } from "../../utils/logger";

/**
 * DODFSpider implementation for Cloudflare Workers
 *
 * Handles the official gazette of Distrito Federal (https://dodf.df.gov.br)
 *
 * This spider collects gazettes from the DODF (Diário Oficial do Distrito Federal)
 * centralized state/district system.
 *
 * The site structure (updated Jan 2026):
 * 1. Main page: /dodf/jornal/pastas shows years as folders
 * 2. Year folder: ?pasta=YYYY shows months
 * 3. Month folder: ?pasta=YYYY/MM_MesNome shows days
 * 4. PDF URLs use visualizar-pdf endpoint with pipe (|) separators:
 *    /dodf/jornal/visualizar-pdf?pasta=YYYY|MM_MesNome|DODF NNN DD-MM-YYYY|&arquivo=DODF NNN DD-MM-YYYY INTEGRA.pdf
 *
 * The edition number (NNN) is sequential throughout the year and must be estimated
 * based on the day of year, then verified with HEAD requests.
 */
export class DODFSpider extends BaseSpider {
  private readonly BASE_URL = "https://dodf.df.gov.br";
  private readonly PDF_ENDPOINT = "/dodf/jornal/visualizar-pdf";
  private dodfConfig: DODFConfig;

  // Month names in Portuguese for folder construction
  private readonly MONTH_NAMES: Record<number, string> = {
    1: "01_Janeiro",
    2: "02_Fevereiro",
    3: "03_Marco",
    4: "04_Abril",
    5: "05_Maio",
    6: "06_Junho",
    7: "07_Julho",
    8: "08_Agosto",
    9: "09_Setembro",
    10: "10_Outubro",
    11: "11_Novembro",
    12: "12_Dezembro",
  };

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.dodfConfig = spiderConfig.config as DODFConfig;

    logger.info(`Initializing DODFSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling DODF gazette - date range: ${this.dateRange.start} to ${this.dateRange.end}`,
    );
    const gazettes: Gazette[] = [];

    try {
      // Generate date intervals (daily)
      const dates = this.generateDateRange();
      logger.info(`Generated ${dates.length} dates to check for DODF`);

      // Check each date for gazettes
      for (const date of dates) {
        const dateGazettes = await this.fetchGazettesForDate(date);
        gazettes.push(...dateGazettes);
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from DODF`);
    } catch (error) {
      logger.error(`Error crawling DODF gazette:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Generate array of dates to check (daily intervals)
   */
  private generateDateRange(): Date[] {
    const dates: Date[] = [];

    // Parse ISO dates correctly avoiding timezone issues
    const [startYear, startMonth, startDay] = this.dateRange.start
      .split("-")
      .map(Number);
    const [endYear, endMonth, endDay] = this.dateRange.end
      .split("-")
      .map(Number);

    const startDate = new Date(startYear, startMonth - 1, startDay); // month is 0-indexed
    const endDate = new Date(endYear, endMonth - 1, endDay);

    let currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      dates.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return dates;
  }

  /**
   * Fetch gazettes for a specific date
   *
   * The DODF site uses a visualizar-pdf endpoint with sequential edition numbers.
   * We estimate the edition number and search nearby values to find the correct one.
   */
  private async fetchGazettesForDate(date: Date): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      const month = date.getMonth() + 1;
      const monthFolder = this.MONTH_NAMES[month];

      logger.info(`Checking DODF for date ${this.formatDate(date)}`);

      // Try to find gazettes using edition number estimation
      const directGazettes = await this.tryDirectPdfUrls(date, monthFolder);
      gazettes.push(...directGazettes);
    } catch (error) {
      // Day might not have a gazette (weekends, holidays)
      logger.info(
        `No gazette found for date ${this.formatDate(date)}: ${(error as Error).message}`,
      );
    }

    return gazettes;
  }

  /**
   * Try constructing direct PDF URLs based on edition number estimation
   *
   * The DODF uses a sequential edition number throughout the year.
   * We estimate it based on workdays elapsed since Jan 1st, then search nearby values.
   */
  private async tryDirectPdfUrls(
    date: Date,
    monthFolder: string,
  ): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    const year = date.getFullYear();
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const dateStr = `${day}-${month}-${year}`;

    // Estimate edition number based on workdays (approx 5 per week)
    const startOfYear = new Date(year, 0, 1);
    const dayOfYear = Math.floor(
      (date.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24),
    );
    // Workdays estimate: ~5/7 of total days, accounting for holidays
    const estimatedEdition = Math.floor((dayOfYear * 5) / 7);

    // Search range: try 10 editions before and after the estimate
    const searchRange = 10;
    const editionsToTry: number[] = [];
    for (let offset = 0; offset <= searchRange; offset++) {
      editionsToTry.push(estimatedEdition + offset);
      if (offset > 0) {
        editionsToTry.push(estimatedEdition - offset);
      }
    }

    // Filter to positive numbers only
    const validEditions = editionsToTry.filter((e) => e > 0);

    logger.debug(
      `Estimated edition ${estimatedEdition} for ${dateStr}, trying ${validEditions.length} editions`,
    );

    for (const editionNum of validEditions) {
      const editionStr = String(editionNum).padStart(3, "0");
      const folderName = `DODF ${editionStr} ${dateStr}`;
      const fileName = `${folderName} INTEGRA.pdf`;

      const pdfUrl = this.constructPdfUrl(
        year,
        monthFolder,
        folderName,
        fileName,
      );

      if (await this.testPdfUrl(pdfUrl)) {
        const gazette = await this.createGazette(date, pdfUrl, {
          isExtraEdition: false,
          power: "executive",
        });

        if (gazette) {
          gazettes.push(gazette);
          logger.info(
            `Found DODF gazette: edition ${editionStr} for ${dateStr}`,
          );

          // Found main edition, now check for supplement/extra editions
          const extraPatterns = [
            `DODF ${editionStr} ${dateStr} SUPLEMENTO.pdf`,
            `DODF ${editionStr} ${dateStr} EXTRA.pdf`,
          ];

          for (const extraFileName of extraPatterns) {
            const extraUrl = this.constructPdfUrl(
              year,
              monthFolder,
              folderName,
              extraFileName,
            );
            if (await this.testPdfUrl(extraUrl)) {
              const extraGazette = await this.createGazette(date, extraUrl, {
                isExtraEdition: true,
                power: "executive",
              });
              if (extraGazette) {
                gazettes.push(extraGazette);
                logger.info(`Found DODF extra gazette: ${extraFileName}`);
              }
            }
          }

          // Once we find the correct edition, no need to try more
          break;
        }
      }
    }

    return gazettes;
  }

  /**
   * Construct the PDF URL using the visualizar-pdf endpoint with pipe separators
   *
   * Format: /dodf/jornal/visualizar-pdf?pasta=YYYY|MM_MesNome|DODF NNN DD-MM-YYYY|&arquivo=DODF NNN DD-MM-YYYY INTEGRA.pdf
   */
  private constructPdfUrl(
    year: number,
    monthFolder: string,
    folderName: string,
    fileName: string,
  ): string {
    // Use pipe (|) as separator instead of URL-encoded path
    const pasta = `${year}|${monthFolder}|${folderName}|`;
    const encodedPasta = encodeURIComponent(pasta);
    const encodedFile = encodeURIComponent(fileName);
    return `${this.BASE_URL}${this.PDF_ENDPOINT}?pasta=${encodedPasta}&arquivo=${encodedFile}`;
  }

  /**
   * Test if a PDF URL exists and is accessible
   * First tries HEAD request, then falls back to partial GET if needed
   */
  private async testPdfUrl(url: string): Promise<boolean> {
    try {
      // First try HEAD request
      const headResponse = await fetch(url, {
        method: "HEAD",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; GazetteCrawler/1.0)",
        },
      });

      if (headResponse.ok) {
        const contentType = headResponse.headers.get("content-type") || "";
        // Accept PDF or octet-stream (generic binary)
        if (
          contentType.includes("pdf") ||
          contentType.includes("octet-stream")
        ) {
          logger.debug(`PDF found via HEAD: ${url}`);
          return true;
        }
      }

      // HEAD might not be supported or return wrong content-type
      // Try a partial GET request to check the first bytes
      const getResponse = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; GazetteCrawler/1.0)",
          Range: "bytes=0-4",
        },
      });

      if (getResponse.ok || getResponse.status === 206) {
        const contentType = getResponse.headers.get("content-type") || "";
        const bytes = await getResponse.arrayBuffer();
        const header = new Uint8Array(bytes);

        // Check for PDF magic bytes (%PDF)
        if (
          header.length >= 4 &&
          header[0] === 0x25 &&
          header[1] === 0x50 &&
          header[2] === 0x44 &&
          header[3] === 0x46
        ) {
          logger.debug(`PDF found via GET magic bytes: ${url}`);
          return true;
        }

        // Also accept if content-type says PDF
        if (contentType.includes("pdf")) {
          logger.debug(`PDF found via content-type: ${url}`);
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.debug(`Error testing PDF URL ${url}: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Format date as YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
}
