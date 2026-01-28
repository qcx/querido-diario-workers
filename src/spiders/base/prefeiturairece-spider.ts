import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeituraIreceConfig,
} from "../../types";
import { logger } from "../../utils/logger";
import {
  toISODate,
  getCurrentTimestamp,
  fromISODate,
} from "../../utils/date-utils";

/**
 * Prefeitura Irecê Spider implementation
 *
 * Crawls gazette data from Irecê's custom platform.
 *
 * URL Structure:
 * - Main page: https://irece.ba.gov.br/diario_oficial
 * - Search page: https://irece.ba.gov.br/busca-avancada
 *
 * HTML Structure:
 * - Calendar-based navigation by month/year dropdown
 * - List of gazette editions with dates
 * - PDF download links
 *
 * Note: The platform uses dynamic JavaScript for the calendar.
 * We scrape the archive pages directly using month/year parameters.
 */
export class PrefeituraIreceSpider extends BaseSpider {
  protected config: PrefeituraIreceConfig;
  private baseUrl: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeituraIreceConfig;

    this.baseUrl = this.config.baseUrl || "https://irece.ba.gov.br";

    logger.info(`Initializing PrefeituraIreceSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling Irecê gazette for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Crawl each month in the date range
      const months = this.getMonthsInRange();

      for (const { year, month } of months) {
        const monthGazettes = await this.crawlMonth(year, month);
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
   * Crawl gazettes for a specific month
   */
  private async crawlMonth(year: number, month: number): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      // The platform uses a dropdown selector for month/year
      // We can query the archive directly
      const monthNames = [
        "Janeiro",
        "Fevereiro",
        "Março",
        "Abril",
        "Maio",
        "Junho",
        "Julho",
        "Agosto",
        "Setembro",
        "Outubro",
        "Novembro",
        "Dezembro",
      ];
      const monthName = monthNames[month - 1];

      // Try the archive page with month/year filter
      // The platform may require form submission, so we try multiple approaches
      const archiveUrl = `${this.baseUrl}/diario_oficial`;
      logger.info(`Fetching page for ${monthName}/${year}: ${archiveUrl}`);

      const response = await fetch(archiveUrl, {
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
          `Failed to fetch page for ${month}/${year}: ${response.status}`,
        );
        return gazettes;
      }

      const html = await response.text();

      // Try to POST to the page to get month-specific results
      const monthGazettes = await this.fetchMonthData(year, month, monthName);
      gazettes.push(...monthGazettes);

      // Also parse the main page for any visible gazettes
      if (gazettes.length === 0) {
        const parsedGazettes = this.parseMainPage(html, year, month);
        gazettes.push(...parsedGazettes);
      }
    } catch (error) {
      logger.error(`Error crawling month ${month}/${year}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Fetch month-specific data using POST request
   */
  private async fetchMonthData(
    year: number,
    month: number,
    monthName: string,
  ): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      // The platform uses AJAX to load calendar data
      // Try to fetch the month selection directly
      const monthStr = month.toString().padStart(2, "0");
      const calendarUrl = `${this.baseUrl}/diario_oficial?mes=${monthStr}&ano=${year}`;

      const response = await fetch(calendarUrl, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "X-Requested-With": "XMLHttpRequest",
        },
      });

      if (!response.ok) {
        return gazettes;
      }

      const html = await response.text();

      // Parse gazette links from the response
      const parsedGazettes = this.parseCalendarResponse(html, year, month);
      gazettes.push(...parsedGazettes);
    } catch (error) {
      logger.error(
        `Error fetching month data for ${month}/${year}:`,
        error as Error,
      );
    }

    return gazettes;
  }

  /**
   * Parse the main page to extract gazette links
   */
  private parseMainPage(html: string, year: number, month: number): Gazette[] {
    const gazettes: Gazette[] = [];

    // Look for links to gazette PDFs
    // The platform may have different structures

    // Pattern 1: Links with date in URL or text
    const pdfRegex =
      /<a[^>]*href="([^"]*(?:diario|gazette|official)[^"]*\.pdf)"[^>]*>([^<]*)<\/a>/gi;
    let match;

    while ((match = pdfRegex.exec(html)) !== null) {
      const pdfUrl = match[1];
      const linkText = match[2].trim();

      const dateMatch =
        this.extractDateFromUrl(pdfUrl) || this.extractDateFromText(linkText);

      if (dateMatch && this.isDateInRange(dateMatch)) {
        const fullUrl = pdfUrl.startsWith("http")
          ? pdfUrl
          : `${this.baseUrl}${pdfUrl.startsWith("/") ? "" : "/"}${pdfUrl}`;

        const gazette: Gazette = {
          date: dateMatch,
          fileUrl: fullUrl,
          territoryId: this.spiderConfig.territoryId,
          scrapedAt: getCurrentTimestamp(),
          editionNumber: this.extractEditionNumber(linkText) || undefined,
          isExtraEdition: false,
          power: "executive_legislative",
          sourceText: `Diário Oficial${linkText ? ` - ${linkText}` : ""}`,
        };

        if (!gazettes.find((g) => g.fileUrl === gazette.fileUrl)) {
          gazettes.push(gazette);
        }
      }
    }

    // Pattern 2: General PDF links with nearby dates
    const generalPdfRegex = /<a[^>]*href="([^"]*\.pdf)"[^>]*>/gi;

    while ((match = generalPdfRegex.exec(html)) !== null) {
      const pdfUrl = match[1];

      // Look for date in surrounding context
      const context = html.substring(
        Math.max(0, match.index - 300),
        match.index + 100,
      );
      const dateMatch = this.extractDateFromContext(context);

      if (dateMatch && this.isDateInRange(dateMatch)) {
        const fullUrl = pdfUrl.startsWith("http")
          ? pdfUrl
          : `${this.baseUrl}${pdfUrl.startsWith("/") ? "" : "/"}${pdfUrl}`;

        // Skip if already added
        if (gazettes.find((g) => g.fileUrl === fullUrl)) {
          continue;
        }

        const gazette: Gazette = {
          date: dateMatch,
          fileUrl: fullUrl,
          territoryId: this.spiderConfig.territoryId,
          scrapedAt: getCurrentTimestamp(),
          isExtraEdition: false,
          power: "executive_legislative",
          sourceText: `Diário Oficial de Irecê`,
        };

        gazettes.push(gazette);
      }
    }

    return gazettes;
  }

  /**
   * Parse calendar response for gazette links
   */
  private parseCalendarResponse(
    html: string,
    year: number,
    month: number,
  ): Gazette[] {
    const gazettes: Gazette[] = [];

    // Look for calendar cells with gazette links
    const cellRegex =
      /<td[^>]*data-date="(\d{4}-\d{2}-\d{2})"[^>]*>[\s\S]*?<a[^>]*href="([^"]*\.pdf)"[^>]*>/gi;
    let match;

    while ((match = cellRegex.exec(html)) !== null) {
      const gazetteDate = match[1];
      const pdfUrl = match[2];

      if (this.isDateInRange(gazetteDate)) {
        const fullUrl = pdfUrl.startsWith("http")
          ? pdfUrl
          : `${this.baseUrl}${pdfUrl.startsWith("/") ? "" : "/"}${pdfUrl}`;

        const gazette: Gazette = {
          date: gazetteDate,
          fileUrl: fullUrl,
          territoryId: this.spiderConfig.territoryId,
          scrapedAt: getCurrentTimestamp(),
          isExtraEdition: false,
          power: "executive_legislative",
          sourceText: `Diário Oficial de Irecê`,
        };

        gazettes.push(gazette);
      }
    }

    // Alternative: Look for list items with dates and PDF links
    const listRegex =
      /(\d{2})\/(\d{2})\/(\d{4})[\s\S]*?<a[^>]*href="([^"]*\.pdf)"[^>]*>/gi;

    while ((match = listRegex.exec(html)) !== null) {
      const day = match[1];
      const monthNum = match[2];
      const yearNum = match[3];
      const pdfUrl = match[4];

      const gazetteDate = `${yearNum}-${monthNum}-${day}`;

      if (this.isDateInRange(gazetteDate)) {
        const fullUrl = pdfUrl.startsWith("http")
          ? pdfUrl
          : `${this.baseUrl}${pdfUrl.startsWith("/") ? "" : "/"}${pdfUrl}`;

        if (!gazettes.find((g) => g.fileUrl === fullUrl)) {
          const gazette: Gazette = {
            date: gazetteDate,
            fileUrl: fullUrl,
            territoryId: this.spiderConfig.territoryId,
            scrapedAt: getCurrentTimestamp(),
            isExtraEdition: false,
            power: "executive_legislative",
            sourceText: `Diário Oficial de Irecê`,
          };

          gazettes.push(gazette);
        }
      }
    }

    return gazettes;
  }

  /**
   * Extract date from URL
   */
  private extractDateFromUrl(url: string): string | null {
    // Try YYYY-MM-DD format
    const isoMatch = url.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    }

    // Try DD-MM-YYYY or DD_MM_YYYY format
    const ddmmyyyyMatch = url.match(/(\d{2})[-_](\d{2})[-_](\d{4})/);
    if (ddmmyyyyMatch) {
      return `${ddmmyyyyMatch[3]}-${ddmmyyyyMatch[2]}-${ddmmyyyyMatch[1]}`;
    }

    return null;
  }

  /**
   * Extract date from text
   */
  private extractDateFromText(text: string): string | null {
    // Try DD/MM/YYYY format
    const ddmmyyyyMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (ddmmyyyyMatch) {
      return `${ddmmyyyyMatch[3]}-${ddmmyyyyMatch[2]}-${ddmmyyyyMatch[1]}`;
    }

    // Try "DD de Mês de YYYY" format
    const monthNames = [
      "janeiro",
      "fevereiro",
      "março",
      "abril",
      "maio",
      "junho",
      "julho",
      "agosto",
      "setembro",
      "outubro",
      "novembro",
      "dezembro",
    ];
    const dateTextMatch = text.match(
      /(\d{1,2})\s*de\s*(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*de\s*(\d{4})/i,
    );
    if (dateTextMatch) {
      const day = dateTextMatch[1].padStart(2, "0");
      const monthName = dateTextMatch[2].toLowerCase();
      const monthNum = (monthNames.indexOf(monthName) + 1)
        .toString()
        .padStart(2, "0");
      return `${dateTextMatch[3]}-${monthNum}-${day}`;
    }

    return null;
  }

  /**
   * Extract date from context
   */
  private extractDateFromContext(context: string): string | null {
    // Try DD/MM/YYYY format
    const ddmmyyyyMatch = context.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (ddmmyyyyMatch) {
      return `${ddmmyyyyMatch[3]}-${ddmmyyyyMatch[2]}-${ddmmyyyyMatch[1]}`;
    }

    // Try "Mês - YYYY" format from dropdown
    const monthYearMatch = context.match(
      /(Janeiro|Fevereiro|Março|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro)\s*-\s*(\d{4})/i,
    );
    if (monthYearMatch) {
      const monthNames = [
        "janeiro",
        "fevereiro",
        "março",
        "abril",
        "maio",
        "junho",
        "julho",
        "agosto",
        "setembro",
        "outubro",
        "novembro",
        "dezembro",
      ];
      const monthNum = (monthNames.indexOf(monthYearMatch[1].toLowerCase()) + 1)
        .toString()
        .padStart(2, "0");
      // Return first day of month as fallback
      return `${monthYearMatch[2]}-${monthNum}-01`;
    }

    return null;
  }

  /**
   * Extract edition number from text
   */
  private extractEditionNumber(text: string): string | null {
    const match = text.match(/(?:Edição|Ed\.?|N[º°]?)\s*(\d+)/i);
    return match ? match[1] : null;
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
