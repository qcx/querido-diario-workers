import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeituraAssuConfig,
} from "../../types";
import { logger } from "../../utils/logger";

/**
 * PrefeituraAssuSpider implementation
 *
 * Crawls the official gazette from Assú (Açu), RN.
 * URL: https://assu.rn.gov.br/diario_oficial/
 *
 * The site uses WordPress with Jet Engine plugin to dynamically load gazette listings.
 * Requires browser rendering to extract PDF links.
 *
 * Structure:
 * - Edition number in: .jet-listing-dynamic-field__content (e.g., "5292")
 * - Edition text: "EDIÇÃO ANO XXII – N° 5292 - TERÇA-FEIRA, 27 DE JANEIRO DE 2026"
 * - Date: DD/MM/YYYY format
 * - Download: "Baixar" button links to PDF
 */
export class PrefeituraAssuSpider extends BaseSpider {
  protected assuConfig: PrefeituraAssuConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.assuConfig = spiderConfig.config as PrefeituraAssuConfig;

    if (!this.assuConfig.baseUrl) {
      throw new Error(
        `PrefeituraAssuSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(`Initializing PrefeituraAssuSpider for ${spiderConfig.name}`);
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.assuConfig.baseUrl} for ${this.spiderConfig.name}...`,
    );

    if (this.browser && this.assuConfig.requiresClientRendering) {
      return this.crawlWithBrowser();
    }

    // Fallback to direct fetch
    logger.info(
      "Browser not available or not required, trying direct fetch...",
    );
    return this.crawlWithFetch();
  }

  /**
   * Crawl using Puppeteer browser
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      // @ts-expect-error - Cloudflare Puppeteer has different API
      const browserInstance = await puppeteer.launch(this.browser);
      const page = await browserInstance.newPage();

      // Set viewport
      await page.setViewport({ width: 1280, height: 800 });

      // Calculate months to fetch based on date range
      // Note: dateRange uses .start and .end (not .startDate/.endDate)
      const startDate = this.startDate;
      const endDate = this.endDate;

      const months: { year: number; month: number }[] = [];
      const current = new Date(startDate.getFullYear(), startDate.getMonth());

      while (current <= endDate) {
        months.push({
          year: current.getFullYear(),
          month: current.getMonth() + 1,
        });
        current.setMonth(current.getMonth() + 1);
      }

      const seenUrls = new Set<string>();

      for (const { year, month } of months) {
        const url = `${this.assuConfig.baseUrl}?mes=${month}&exercicio=${year}`;
        logger.debug(`Navigating to ${url}`);

        try {
          await page.goto(url, {
            waitUntil: "networkidle0",
            timeout: 30000,
          });

          // Wait for the content to load
          await page.waitForSelector(".jet-listing-grid", { timeout: 10000 });

          // Extract gazette data from the rendered page
          const pageGazettes = await page.evaluate(() => {
            const items: Array<{
              editionNumber: string;
              editionText: string;
              date: string;
              pdfUrl: string;
            }> = [];

            // Find all gazette rows - they're in jet-listing containers
            const listingItems = document.querySelectorAll(
              ".jet-listing-grid__item",
            );

            for (const item of listingItems) {
              try {
                // Get all dynamic field contents
                const dynamicFields = item.querySelectorAll(
                  ".jet-listing-dynamic-field__content",
                );

                if (dynamicFields.length < 3) continue;

                // First field: Edition number (e.g., "5292")
                const editionNumber = dynamicFields[0]?.textContent?.trim();
                // Second field: Edition text (e.g., "EDIÇÃO ANO XXII – N° 5292 - TERÇA-FEIRA, 27 DE JANEIRO DE 2026")
                const editionText = dynamicFields[1]?.textContent?.trim();
                // Third field: Date (e.g., "27/01/2026")
                const dateStr = dynamicFields[2]?.textContent?.trim();

                if (!editionNumber || !dateStr) continue;

                // Find the download link (Baixar button)
                const downloadLink = item.querySelector(
                  'a[href*=".pdf"], a[href*="download"], a.elementor-button',
                );
                const pdfUrl = downloadLink?.getAttribute("href");

                if (!pdfUrl) continue;

                items.push({
                  editionNumber: editionNumber,
                  editionText: editionText || `Edição ${editionNumber}`,
                  date: dateStr,
                  pdfUrl: pdfUrl,
                });
              } catch (e) {
                // Skip items that fail to parse
              }
            }

            return items;
          });

          logger.debug(
            `Found ${pageGazettes.length} gazettes on page for ${month}/${year}`,
          );

          for (const item of pageGazettes) {
            if (seenUrls.has(item.pdfUrl)) {
              continue;
            }
            seenUrls.add(item.pdfUrl);

            // Parse date DD/MM/YYYY
            const dateParts = item.date.split("/");
            if (dateParts.length !== 3) continue;

            const [day, monthNum, yearNum] = dateParts;
            const isoDate = `${yearNum}-${monthNum}-${day}`;
            const gazetteDate = new Date(`${isoDate}T00:00:00.000Z`);

            if (this.isInDateRange(gazetteDate)) {
              // Make URL absolute if needed
              let pdfUrl = item.pdfUrl;
              if (pdfUrl.startsWith("/")) {
                const baseOrigin = new URL(this.assuConfig.baseUrl).origin;
                pdfUrl = baseOrigin + pdfUrl;
              } else if (!pdfUrl.startsWith("http")) {
                pdfUrl = new URL(pdfUrl, this.assuConfig.baseUrl).href;
              }

              const gazette = await this.createGazette(gazetteDate, pdfUrl, {
                editionNumber: item.editionNumber,
                isExtraEdition: false,
                power: "executive",
              });

              if (gazette) {
                gazette.sourceText = item.editionText;
                gazettes.push(gazette);
                logger.info(
                  `Found gazette for ${gazette.date}: Edition ${item.editionNumber}`,
                );
              }
            }
          }
        } catch (error) {
          logger.debug(
            `Error fetching ${url}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      await browserInstance.close();

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name} using browser`,
      );
    } catch (error) {
      logger.error(
        `Error crawling ${this.spiderConfig.name} with browser:`,
        error as Error,
      );
    }

    return gazettes;
  }

  /**
   * Crawl using direct HTTP fetch (fallback)
   */
  private async crawlWithFetch(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      // Calculate months to fetch based on date range
      // Note: dateRange uses .start and .end (not .startDate/.endDate)
      const startDate = this.startDate;
      const endDate = this.endDate;

      const months: { year: number; month: number }[] = [];
      const current = new Date(startDate.getFullYear(), startDate.getMonth());

      while (current <= endDate) {
        months.push({
          year: current.getFullYear(),
          month: current.getMonth() + 1,
        });
        current.setMonth(current.getMonth() + 1);
      }

      const seenUrls = new Set<string>();

      for (const { year, month } of months) {
        const url = `${this.assuConfig.baseUrl}?mes=${month}&exercicio=${year}`;
        logger.debug(`Fetching ${url}`);

        try {
          const response = await this.fetch(url);

          // The site uses Jet Engine which loads content dynamically
          // Try to extract from the static HTML what we can

          // Look for gazette entries in the page
          // Pattern: Edition number + Edition text + Date + PDF link
          const gazettesExtracted = this.extractGazettesFromHtml(response);

          for (const item of gazettesExtracted) {
            if (seenUrls.has(item.pdfUrl)) {
              continue;
            }
            seenUrls.add(item.pdfUrl);

            if (this.isInDateRange(item.date)) {
              const gazette = await this.createGazette(item.date, item.pdfUrl, {
                editionNumber: item.editionNumber,
                isExtraEdition: false,
                power: "executive",
              });

              if (gazette) {
                gazette.sourceText = item.editionText;
                gazettes.push(gazette);
                logger.info(
                  `Found gazette for ${gazette.date}: Edition ${item.editionNumber}`,
                );
              }
            }
          }
        } catch (error) {
          logger.debug(
            `Error fetching ${url}: ${error instanceof Error ? error.message : String(error)}`,
          );
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
   * Extract gazette info from static HTML
   *
   * The site content IS available server-side (not dynamically loaded).
   * Each gazette entry follows this pattern in HTML:
   *
   * <div class="jet-listing-grid__item">
   *   ...
   *   <div class="jet-listing-dynamic-field__content">5292 </div>  (Edition number)
   *   <div class="jet-listing-dynamic-field__content">EDIÇÃO ANO XXII – N° 5292 - TERÇA-FEIRA, 27 DE JANEIRO DE 2026</div>  (Edition text)
   *   <div class="jet-listing-dynamic-field__content">27/01/2026</div>  (Date)
   *   ...
   *   <a class="elementor-button elementor-button-link" href="https://drive.google.com/file/d/...">Baixar</a>  (Download link)
   * </div>
   */
  private extractGazettesFromHtml(html: string): Array<{
    editionNumber: string;
    editionText: string;
    date: Date;
    pdfUrl: string;
  }> {
    const gazettes: Array<{
      editionNumber: string;
      editionText: string;
      date: Date;
      pdfUrl: string;
    }> = [];

    // Split HTML by each gazette item
    const itemPattern =
      /jet-listing-grid__item[^>]*>([\s\S]*?)(?=jet-listing-grid__item|<\/div>\s*<\/div>\s*<\/div>\s*<footer)/gi;

    // Find all jet-listing-grid__item sections
    const itemMatches = html.match(itemPattern);

    if (!itemMatches) {
      logger.debug("No gazette items found in HTML");
      return gazettes;
    }

    for (const itemHtml of itemMatches) {
      try {
        // Extract all dynamic field contents
        const fieldPattern =
          /jet-listing-dynamic-field__content">([^<]+)<\/div>/gi;
        const fields: string[] = [];
        let fieldMatch;

        while ((fieldMatch = fieldPattern.exec(itemHtml)) !== null) {
          fields.push(fieldMatch[1].trim());
        }

        if (fields.length < 3) continue;

        // First field: Edition number (e.g., "5292")
        const editionNumber = fields[0];
        // Second field: Edition text (e.g., "EDIÇÃO ANO XXII – N° 5292 - TERÇA-FEIRA, 27 DE JANEIRO DE 2026")
        const editionText = fields[1];
        // Third field: Date (e.g., "27/01/2026")
        const dateStr = fields[2];

        // Validate edition number (should be 4-5 digits)
        if (!/^\d{4,5}$/.test(editionNumber)) continue;

        // Validate date format
        if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) continue;

        // Find the download link (elementor-button with "Baixar" text)
        // The href can be Google Drive or direct PDF
        const linkPattern =
          /<a[^>]*class="elementor-button[^"]*"[^>]*href="([^"]+)"[^>]*>[\s\S]*?Baixar[\s\S]*?<\/a>/i;
        const linkMatch = itemHtml.match(linkPattern);

        if (!linkMatch) {
          // Try alternative pattern - href before class
          const altLinkPattern =
            /<a[^>]*href="([^"]+)"[^>]*class="elementor-button[^"]*"[^>]*>[\s\S]*?Baixar[\s\S]*?<\/a>/i;
          const altLinkMatch = itemHtml.match(altLinkPattern);
          if (!altLinkMatch) continue;
          // Use the alt match
          const pdfUrl = altLinkMatch[1];

          // Parse date DD/MM/YYYY
          const [day, monthNum, yearNum] = dateStr.split("/");
          const isoDate = `${yearNum}-${monthNum.padStart(2, "0")}-${day.padStart(2, "0")}`;
          const gazetteDate = new Date(`${isoDate}T00:00:00.000Z`);

          gazettes.push({
            editionNumber,
            editionText,
            date: gazetteDate,
            pdfUrl,
          });
          continue;
        }

        let pdfUrl = linkMatch[1];

        // Parse date DD/MM/YYYY
        const [day, monthNum, yearNum] = dateStr.split("/");
        const isoDate = `${yearNum}-${monthNum.padStart(2, "0")}-${day.padStart(2, "0")}`;
        const gazetteDate = new Date(`${isoDate}T00:00:00.000Z`);

        // Make URL absolute if relative
        if (pdfUrl.startsWith("/")) {
          const baseOrigin = new URL(this.assuConfig.baseUrl).origin;
          pdfUrl = baseOrigin + pdfUrl;
        } else if (!pdfUrl.startsWith("http")) {
          pdfUrl = new URL(pdfUrl, this.assuConfig.baseUrl).href;
        }

        gazettes.push({
          editionNumber,
          editionText,
          date: gazetteDate,
          pdfUrl,
        });
      } catch (error) {
        // Skip items that fail to parse
        logger.debug(`Error parsing gazette item: ${error}`);
      }
    }

    logger.debug(`Extracted ${gazettes.length} gazettes from HTML`);
    return gazettes;
  }
}
