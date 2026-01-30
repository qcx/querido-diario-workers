import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  VFMTransparenciaConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";

/**
 * Spider for VFM (Veno File Manager) based transparency portals
 *
 * Platform: websiteseguro.com (commonly used by municipalities in MA)
 *
 * Used by: Monção-MA (moncao3.websiteseguro.com/transparencia)
 *
 * Structure:
 * - Base: {baseUrl}/?dir=uploads/{diretorioDiario}
 * - Years: {baseUrl}/?dir=uploads/{diretorioDiario}/{ano}
 * - Months: {baseUrl}/?dir=uploads/{diretorioDiario}/{ano}/{mesNome} (e.g., 01-JAN, 02-FEV)
 * - Files: DIÁRIO-OFICIAL_N{edição}_{dia}_{mês}_{ano}.pdf
 *
 * Download URL: {baseUrl}/vfm-admin/vfm-downloader.php?q={base64}&h={hash}
 */
export class VFMTransparenciaSpider extends BaseSpider {
  private vfmConfig: VFMTransparenciaConfig;

  // Month name mappings for URL parsing
  private static readonly MONTH_NAMES: Record<string, string> = {
    "01-JAN": "01",
    "02-FEV": "02",
    "03-MAR": "03",
    "04-ABR": "04",
    "05-MAI": "05",
    "06-JUN": "06",
    "07-JUL": "07",
    "08-AGO": "08",
    "09-SET": "09",
    "10-OUT": "10",
    "11-NOV": "11",
    "12-DEZ": "12",
    JAN: "01",
    FEV: "02",
    MAR: "03",
    ABR: "04",
    MAI: "05",
    JUN: "06",
    JUL: "07",
    AGO: "08",
    SET: "09",
    OUT: "10",
    NOV: "11",
    DEZ: "12",
  };

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.vfmConfig = spiderConfig.config as VFMTransparenciaConfig;

    if (!this.vfmConfig.baseUrl) {
      throw new Error(
        `VFMTransparenciaSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing VFMTransparenciaSpider for ${spiderConfig.name} with URL: ${this.vfmConfig.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.vfmConfig.baseUrl} for ${this.spiderConfig.name}...`,
    );

    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();

    try {
      const diretorio = this.vfmConfig.diretorioDiario || "DIÁRIO-OFICIAL";
      const baseUrl = this.vfmConfig.baseUrl.replace(/\/$/, "");

      // Parse date range (strings in ISO format)
      const startDate = new Date(this.dateRange.start);
      const endDate = new Date(this.dateRange.end);

      // Get years in date range
      const startYear = startDate.getFullYear();
      const endYear = endDate.getFullYear();

      for (let year = startYear; year <= endYear; year++) {
        const yearDir = encodeURIComponent(`uploads/${diretorio}/${year}`);
        const yearUrl = `${baseUrl}/?dir=${yearDir}`;

        logger.debug(`Fetching year directory: ${yearUrl}`);

        const yearHtml = await this.fetchWithRetry(yearUrl);
        if (!yearHtml) {
          logger.debug(`No content for year ${year}`);
          continue;
        }

        // Extract month directories
        const monthDirs = this.extractDirectories(yearHtml, year);

        for (const monthDir of monthDirs) {
          const monthNum = this.getMonthNumber(monthDir.name);
          if (!monthNum) continue;

          // Check if month is in range
          const monthStart = new Date(year, parseInt(monthNum) - 1, 1);
          const monthEnd = new Date(year, parseInt(monthNum), 0);

          if (monthEnd < startDate || monthStart > endDate) {
            continue;
          }

          const monthUrl = monthDir.url;
          logger.debug(`Fetching month directory: ${monthUrl}`);

          const monthHtml = await this.fetchWithRetry(monthUrl);
          if (!monthHtml) continue;

          // Extract PDF files
          const pdfFiles = this.extractPdfFiles(monthHtml, year);

          for (const pdf of pdfFiles) {
            const pdfDate = new Date(pdf.date);
            if (!this.isInDateRange(pdfDate)) continue;

            if (seenUrls.has(pdf.downloadUrl)) continue;
            seenUrls.add(pdf.downloadUrl);

            gazettes.push({
              date: pdf.date,
              fileUrl: pdf.downloadUrl,
              territoryId: this.spiderConfig.territoryId,
              editionNumber: pdf.editionNumber,
              isExtraEdition: false,
              power: "executive",
              scrapedAt: new Date().toISOString(),
            });
          }
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
      );
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, { error });
      throw error;
    }

    return gazettes;
  }

  private async fetchWithRetry(
    url: string,
    retries = 3,
  ): Promise<string | null> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept: "text/html,application/xhtml+xml",
          },
        });

        if (response.ok) {
          return await response.text();
        }

        logger.debug(
          `Attempt ${attempt} failed for ${url}: ${response.status}`,
        );
      } catch (error) {
        logger.debug(`Attempt ${attempt} failed for ${url}:`, { error });
      }

      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }

    return null;
  }

  private extractDirectories(
    html: string,
    year: number,
  ): Array<{ name: string; url: string }> {
    const directories: Array<{ name: string; url: string }> = [];

    const diretorio = this.vfmConfig.diretorioDiario || "DIÁRIO-OFICIAL";
    const baseUrl = this.vfmConfig.baseUrl.replace(/\/$/, "");

    // Match month directory links
    // Pattern: href="...?dir=uploads/DIÁRIO-OFICIAL/2023/01-JAN"
    const monthPattern =
      /href="([^"]*\?dir=[^"]*(?:uploads[/\\%].*?[/\\%](\d{4})[/\\%]([^"\/\\%]+)|dir=([^"]+)))"/gi;
    let match;

    while ((match = monthPattern.exec(html)) !== null) {
      const fullUrl = match[1];
      const urlYear = match[2];
      const monthName = match[3];

      if (urlYear && parseInt(urlYear) === year && monthName) {
        // Decode and clean the month name
        const decodedMonth = decodeURIComponent(monthName);

        // Only process if it looks like a month directory
        if (this.getMonthNumber(decodedMonth)) {
          const absoluteUrl = fullUrl.startsWith("http")
            ? fullUrl
            : `${baseUrl}${fullUrl.startsWith("/") ? "" : "/"}${fullUrl}`;

          directories.push({
            name: decodedMonth,
            url: absoluteUrl,
          });
        }
      }
    }

    // Fallback: Look for simple month links with known patterns
    const simpleMonthPattern = /\[(\d{2}-[A-Z]{3})\]\([^)]+\)/gi;
    while ((match = simpleMonthPattern.exec(html)) !== null) {
      const monthName = match[1];
      const monthNum = this.getMonthNumber(monthName);

      if (monthNum && !directories.some((d) => d.name === monthName)) {
        const encodedDir = encodeURIComponent(
          `uploads/${diretorio}/${year}/${monthName}`,
        );
        directories.push({
          name: monthName,
          url: `${baseUrl}/?dir=${encodedDir}`,
        });
      }
    }

    return directories;
  }

  private extractPdfFiles(
    html: string,
    year: number,
  ): Array<{ downloadUrl: string; date: string; editionNumber?: string }> {
    const files: Array<{
      downloadUrl: string;
      date: string;
      editionNumber?: string;
    }> = [];

    const baseUrl = this.vfmConfig.baseUrl.replace(/\/$/, "");

    // Pattern for VFM download links
    // href="...vfm-admin/vfm-downloader.php?q=...&h=..."
    const downloadPattern =
      /href="([^"]*vfm-admin\/vfm-downloader\.php\?q=[^"&]+&h=[^"]+)"/gi;

    // Also pattern for file names mentioned in page
    // DIÁRIO-OFICIAL_N1156_01_12_23.pdf
    const fileNamePattern =
      /DI[ÁA]RIO[-_]?OFICIAL[-_]?N?(\d+)[-_](\d{2})[-_](\d{2})[-_](\d{2,4})\.pdf/gi;

    let match;
    const baseUrlParsed = new URL(baseUrl);

    // Extract download URLs
    const downloadUrls: string[] = [];
    while ((match = downloadPattern.exec(html)) !== null) {
      let url = match[1];

      // Make absolute URL
      if (!url.startsWith("http")) {
        url = `${baseUrlParsed.origin}${url.startsWith("/") ? "" : "/"}${url}`;
      }

      // Decode HTML entities
      url = url.replace(/&amp;/g, "&");

      downloadUrls.push(url);
    }

    // Extract file info from file names in the HTML
    while ((match = fileNamePattern.exec(html)) !== null) {
      const editionNumber = match[1];
      const day = match[2];
      const month = match[3];
      let yearPart = match[4];

      // Handle 2-digit years
      if (yearPart.length === 2) {
        yearPart = `20${yearPart}`;
      }

      const fileYear = parseInt(yearPart);
      const fileMonth = parseInt(month);
      const fileDay = parseInt(day);

      // Validate date parts
      if (fileYear !== year) continue;
      if (fileMonth < 1 || fileMonth > 12) continue;
      if (fileDay < 1 || fileDay > 31) continue;

      // Format date as ISO string
      const date = `${fileYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;

      // Find matching download URL (uses base64 encoding that contains the filename)
      const fileName = match[0];
      const matchingUrl = downloadUrls.find((url) => {
        // The 'q' parameter is base64 encoded path
        const qMatch = url.match(/q=([^&]+)/);
        if (qMatch) {
          try {
            const decoded = atob(qMatch[1]);
            return (
              decoded.includes(fileName) || decoded.includes(editionNumber)
            );
          } catch {
            return false;
          }
        }
        return false;
      });

      if (matchingUrl) {
        files.push({
          downloadUrl: matchingUrl,
          date,
          editionNumber,
        });
      }
    }

    // If no files extracted, try a simpler approach with all download links
    if (files.length === 0 && downloadUrls.length > 0) {
      for (const url of downloadUrls) {
        // Try to extract date from base64 encoded path
        const qMatch = url.match(/q=([^&]+)/);
        if (!qMatch) continue;

        try {
          const decoded = atob(qMatch[1]);

          // Match date patterns in decoded path
          const dateMatch = decoded.match(
            /(?:N(\d+)[-_])?(\d{2})[-_](\d{2})[-_](\d{2,4})/,
          );

          if (dateMatch) {
            const editionNumber = dateMatch[1];
            const day = parseInt(dateMatch[2]);
            const month = parseInt(dateMatch[3]);
            let yearStr = dateMatch[4];

            if (yearStr.length === 2) {
              yearStr = `20${yearStr}`;
            }

            const fileYear = parseInt(yearStr);

            if (
              fileYear === year &&
              month >= 1 &&
              month <= 12 &&
              day >= 1 &&
              day <= 31
            ) {
              const date = `${fileYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              files.push({
                downloadUrl: url,
                date,
                editionNumber,
              });
            }
          }
        } catch {
          // Invalid base64, skip
        }
      }
    }

    return files;
  }

  private getMonthNumber(monthName: string): string | null {
    const normalized = monthName.toUpperCase().trim();
    return VFMTransparenciaSpider.MONTH_NAMES[normalized] || null;
  }
}
