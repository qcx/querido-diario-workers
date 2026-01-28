import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig } from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
import { getCurrentTimestamp } from "../../utils/date-utils";

/**
 * Configuration for IBDM Transparência spider
 */
export interface IbdmTransparenciaConfig {
  type: "ibdmtransparencia";
  /** Base URL of the transparency portal (e.g., https://transparencia.capimgrosso.ba.gov.br) */
  baseUrl: string;
  /** City slug for identifying the municipality */
  citySlug?: string;
  /** Whether client rendering is required (typically false for this platform) */
  requiresClientRendering: boolean;
}

/**
 * Spider for IBDM Transparência platform (transparencia.*.ba.gov.br)
 *
 * This platform is used by several municipalities in Bahia.
 * The site displays official gazettes with PDF download links.
 *
 * URL Pattern for PDF downloads:
 * https://transparencia.{city}.ba.gov.br/wp-includes/ExternalApps/downloader.php?hurl={base64_encoded_url}
 *
 * The hurl parameter contains a base64-encoded URL pointing to doem.org.br
 *
 * Page structure:
 * - Main page lists publications grouped by month/year
 * - Each publication has: date, edition number, type (EDITAL, CONTRATO, etc.), and PDF link
 */
export class IbdmTransparenciaSpider extends BaseSpider {
  private ibdmConfig: IbdmTransparenciaConfig;
  protected browser?: Fetcher;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    this.ibdmConfig = config.config as IbdmTransparenciaConfig;

    if (!this.ibdmConfig.baseUrl) {
      throw new Error(
        `IbdmTransparenciaSpider requires baseUrl in config for ${config.name}`,
      );
    }

    logger.info(
      `Initializing IbdmTransparenciaSpider for ${config.name} with baseUrl: ${this.ibdmConfig.baseUrl}`,
    );
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  /**
   * Check if date is within the date range
   */
  private isDateInRange(dateStr: string): boolean {
    return dateStr >= this.dateRange.start && dateStr <= this.dateRange.end;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling IBDM Transparência for ${this.config.name}...`);
    return this.crawlWithHttp();
  }

  /**
   * HTTP-based crawling - extracts gazette information using direct HTTP requests
   */
  private async crawlWithHttp(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();

    try {
      const url = this.ibdmConfig.baseUrl;
      logger.info(`Fetching main page: ${url}`);

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
        logger.warn(`Failed to fetch main page: ${response.status}`);
        return gazettes;
      }

      const html = await response.text();

      // Parse the gazette listings
      // Pattern: Look for date headers like [**]()26/01/2026|
      // followed by edition info and PDF links

      // Extract publication blocks
      // The HTML structure shows dates followed by editions and PDF links
      // Example: [**]()26/01/2026| ... [**Baixar diário](url)

      // First, let's extract all PDF download links with their associated dates
      // Pattern for PDF links: downloader.php?hurl=...
      const pdfPattern = /href="([^"]*downloader\.php\?hurl=[^"]+)"/gi;

      // Parse the HTML to find publications
      // Split by date headers and process each section
      const lines = html.split("\n");
      let currentDate: string | null = null;

      for (const line of lines) {
        // Check for date patterns
        const dateMatch = line.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (dateMatch) {
          const [, day, month, year] = dateMatch;
          const parsedDate = `${year}-${month}-${day}`;
          // Only update current date if this looks like a date header (not just a random date in content)
          if (line.includes("|") || line.includes("**")) {
            currentDate = parsedDate;
          }
        }

        // Check for PDF links
        const pdfMatches = line.matchAll(pdfPattern);
        for (const pdfMatch of pdfMatches) {
          let pdfUrl = pdfMatch[1];

          // Make URL absolute if needed
          if (pdfUrl.startsWith("/")) {
            const baseUrlObj = new URL(this.ibdmConfig.baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl}`;
          } else if (!pdfUrl.startsWith("http")) {
            pdfUrl = `${this.ibdmConfig.baseUrl}/${pdfUrl}`;
          }

          // Skip if we've already seen this URL
          if (seenUrls.has(pdfUrl)) {
            continue;
          }
          seenUrls.add(pdfUrl);

          // Try to extract date from the URL or use current date
          let gazetteDate = currentDate;

          // Try to extract date from the hurl parameter (base64 encoded URL)
          const hurlMatch = pdfUrl.match(/hurl=([^&]+)/);
          if (hurlMatch) {
            try {
              const decodedUrl = Buffer.from(hurlMatch[1], "base64").toString(
                "utf-8",
              );
              // Extract date from decoded URL if possible
              const urlDateMatch = decodedUrl.match(
                /(\d{2})\.(\d{2})\.(\d{4})/,
              );
              if (urlDateMatch) {
                const [, day, month, year] = urlDateMatch;
                gazetteDate = `${year}-${month}-${day}`;
              }
            } catch (e) {
              // Ignore decode errors
            }
          }

          // If we still don't have a date, skip this entry
          if (!gazetteDate) {
            continue;
          }

          // Check if date is in range
          if (!this.isDateInRange(gazetteDate)) {
            continue;
          }

          // Detect if it's an extra edition based on URL patterns
          const isExtraEdition =
            pdfUrl.toLowerCase().includes("extra") ||
            pdfUrl.toLowerCase().includes("suplemento");

          gazettes.push({
            date: gazetteDate,
            fileUrl: pdfUrl,
            territoryId: this.config.territoryId,
            isExtraEdition,
            power: "executive",
            scrapedAt: getCurrentTimestamp(),
          });
        }
      }

      // If the simple parsing didn't work, try a more structured approach
      if (gazettes.length === 0) {
        gazettes.push(...this.parseStructuredHtml(html));
      }

      logger.info(`HTTP crawl found ${gazettes.length} gazettes`);
    } catch (error) {
      logger.error(`Error fetching IBDM page:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Parse structured HTML to extract gazette information
   */
  private parseStructuredHtml(html: string): Gazette[] {
    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();

    // Look for patterns like:
    // [**]()26/01/2026|
    // [**]()Edição: 8.423
    // [**Baixar diário](https://...downloader.php?hurl=...)

    // Find all blocks that contain gazette info
    // Pattern: date followed by edition and download link

    // Match the complete gazette entry pattern
    const blockPattern =
      /\[?\*?\*?\]?\(?\)?(\d{2})\/(\d{2})\/(\d{4})\|[^]*?(?:Edição:\s*[\d.,]+)?[^]*?(?:Baixar diário|Baixar)\]\((https?:\/\/[^\s\)]+downloader\.php\?hurl=[^\s\)]+)\)/gi;

    let match;
    while ((match = blockPattern.exec(html)) !== null) {
      const day = match[1];
      const month = match[2];
      const year = match[3];
      const pdfUrl = match[4];

      const gazetteDate = `${year}-${month}-${day}`;

      // Skip if out of range
      if (!this.isDateInRange(gazetteDate)) {
        continue;
      }

      // Skip duplicates
      if (seenUrls.has(pdfUrl)) {
        continue;
      }
      seenUrls.add(pdfUrl);

      gazettes.push({
        date: gazetteDate,
        fileUrl: pdfUrl,
        territoryId: this.config.territoryId,
        isExtraEdition: false,
        power: "executive",
        scrapedAt: getCurrentTimestamp(),
      });
    }

    // If still no results, try finding all downloader.php links and extracting dates
    if (gazettes.length === 0) {
      const allLinksPattern =
        /href="(https?:\/\/[^\s"]+downloader\.php\?hurl=[^"]+)"/gi;

      const htmlChunks = html.split(/(?=\d{2}\/\d{2}\/\d{4})/);

      for (const chunk of htmlChunks) {
        const dateMatch = chunk.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
        if (!dateMatch) continue;

        const day = dateMatch[1];
        const month = dateMatch[2];
        const year = dateMatch[3];
        const gazetteDate = `${year}-${month}-${day}`;

        if (!this.isDateInRange(gazetteDate)) {
          continue;
        }

        // Find PDF links in this chunk
        const linksInChunk = chunk.matchAll(allLinksPattern);
        for (const chunkMatch of linksInChunk) {
          const pdfUrl = chunkMatch[1];

          if (seenUrls.has(pdfUrl)) {
            continue;
          }
          seenUrls.add(pdfUrl);

          gazettes.push({
            date: gazetteDate,
            fileUrl: pdfUrl,
            territoryId: this.config.territoryId,
            isExtraEdition: false,
            power: "executive",
            scrapedAt: getCurrentTimestamp(),
          });
        }
      }
    }

    return gazettes;
  }
}
