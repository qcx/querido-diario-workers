import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse } from "node-html-parser";

/**
 * Configuration for Prefeitura de Gurupi spider
 */
export interface PrefeituragurupiConfig {
  type: "prefeituragurupi";
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/**
 * Spider for Diário Oficial de Gurupi - TO
 *
 * URL: https://diariooficial.gurupi.to.gov.br/
 *
 * This is a modern SPA-like site with calendar navigation.
 * The site loads editions dynamically but also has a list of recent editions.
 *
 * URL Patterns:
 * - Main page: {baseUrl}/
 * - PDF view: {baseUrl}/pdf/{editionNumber}_{date}.pdf (approximate pattern)
 *
 * HTML Structure:
 * - Recent editions list with "Edição Normal Nº XXXX" or "Edição Extra Nº XXXX"
 * - Links to "Visualizar PDF"
 * - Date shown as DD/MM/YYYY
 */
export class PrefeituragurupiSpider extends BaseSpider {
  protected config: PrefeituragurupiConfig;

  constructor(
    spiderConfig: SpiderConfig,
    dateRange: DateRange,
    browser?: Fetcher,
  ) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeituragurupiConfig;

    if (!this.config.baseUrl) {
      throw new Error(
        `PrefeituragurupiSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeituragurupiSpider for ${spiderConfig.name} with URL: ${this.config.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    logger.info(`Starting crawl for ${this.spiderConfig.name}`);

    try {
      // Fetch the main page
      const html = await this.fetch(this.config.baseUrl);
      const root = parse(html);

      // Find edition links - look for links containing "Edição" text
      const allLinks = root.querySelectorAll("a");
      const editionLinks: any[] = [];

      for (const link of allLinks) {
        const text = link.text?.trim() || "";
        const href = link.getAttribute("href") || "";

        // Match "Edição Normal Nº XXXX" or "Edição Extra Nº XXXX"
        if (text.match(/Edição\s+(Normal|Extra)\s+N[º°]?\s*\d+/i)) {
          editionLinks.push(link);
        }
      }

      logger.debug(`Found ${editionLinks.length} edition links`);

      // Also look for edition info in the page structure
      // The site shows editions with date info
      const editionContainers = root.querySelectorAll(
        '[class*="edition"], [class*="diario"], [class*="publicacao"]',
      );

      for (const container of editionContainers) {
        const text = container.text || "";
        if (text.match(/Edição\s+(Normal|Extra)\s+N[º°]?\s*\d+/i)) {
          // Extract info from container
          const gazette = await this.parseEditionContainer(container);
          if (gazette && this.isInDateRange(new Date(gazette.date))) {
            gazettes.push(gazette);
          }
        }
      }

      // Process edition links
      for (const link of editionLinks) {
        try {
          const gazette = await this.parseEditionLink(link);
          if (gazette && this.isInDateRange(new Date(gazette.date))) {
            // Check for duplicates
            const isDuplicate = gazettes.some(
              (g) => g.date === gazette.date && g.pdfUrl === gazette.pdfUrl,
            );
            if (!isDuplicate) {
              gazettes.push(gazette);
            }
          }
        } catch (error) {
          logger.error(`Error parsing edition link:`, error as Error);
        }
      }
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    logger.info(
      `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
    );
    return gazettes;
  }

  /**
   * Parse an edition container element
   */
  private async parseEditionContainer(container: any): Promise<Gazette | null> {
    try {
      const text = container.text?.trim() || "";

      // Extract edition number and type
      const editionMatch = text.match(
        /Edição\s+(Normal|Extra)\s+N[º°]?\s*(\d+)/i,
      );
      if (!editionMatch) return null;

      const [, editionType, editionNumber] = editionMatch;
      const isExtraEdition = editionType.toLowerCase() === "extra";

      // Extract date - look for DD/MM/YYYY pattern
      const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (!dateMatch) {
        logger.warn(
          `Could not find date in container: ${text.substring(0, 100)}`,
        );
        return null;
      }

      const [, day, month, year] = dateMatch;
      const gazetteDate = new Date(`${year}-${month}-${day}`);

      // Find PDF link
      const pdfLink = container.querySelector(
        'a[href*="pdf"], a[href*="Visualizar"]',
      );
      let pdfUrl = pdfLink?.getAttribute("href");

      if (!pdfUrl) {
        // Try to construct PDF URL based on edition info
        // Pattern: /pdf/YYYYMMDD.pdf or similar
        const dateStr = `${year}${month}${day}`;
        pdfUrl = `${this.config.baseUrl}/pdf/${dateStr}.pdf`;
      }

      // Make absolute URL if relative
      if (pdfUrl && !pdfUrl.startsWith("http")) {
        pdfUrl = `${this.config.baseUrl}${pdfUrl.startsWith("/") ? "" : "/"}${pdfUrl}`;
      }

      if (!pdfUrl) {
        logger.warn(`No PDF URL found for edition ${editionNumber}`);
        return null;
      }

      return await this.createGazette(gazetteDate, pdfUrl, {
        editionNumber,
        isExtraEdition,
        power: "executive_legislative",
        sourceText: text.substring(0, 200),
      });
    } catch (error) {
      logger.error(`Error parsing edition container:`, error as Error);
      return null;
    }
  }

  /**
   * Parse an edition link element
   */
  private async parseEditionLink(link: any): Promise<Gazette | null> {
    try {
      const linkText = link.text?.trim() || "";
      const href = link.getAttribute("href") || "";

      // Extract edition number and type
      const editionMatch = linkText.match(
        /Edição\s+(Normal|Extra)\s+N[º°]?\s*(\d+)/i,
      );
      if (!editionMatch) return null;

      const [, editionType, editionNumber] = editionMatch;
      const isExtraEdition = editionType.toLowerCase() === "extra";

      // Try to find date in parent/sibling elements
      let gazetteDate: Date | null = null;

      // Look in parent container
      let parent = link.parentNode;
      for (let i = 0; i < 5 && parent; i++) {
        const parentText = parent.text || "";
        const dateMatch = parentText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (dateMatch) {
          const [, day, month, year] = dateMatch;
          gazetteDate = new Date(`${year}-${month}-${day}`);
          break;
        }
        parent = parent.parentNode;
      }

      if (!gazetteDate) {
        logger.warn(`Could not find date for edition ${editionNumber}`);
        return null;
      }

      // Get PDF URL from link or construct it
      let pdfUrl = href;

      // If link is to view page, try to get PDF URL
      if (href.includes("Visualizar") || !href.includes(".pdf")) {
        // Construct PDF URL based on date
        const year = gazetteDate.getFullYear();
        const month = String(gazetteDate.getMonth() + 1).padStart(2, "0");
        const day = String(gazetteDate.getDate()).padStart(2, "0");
        pdfUrl = `${this.config.baseUrl}/pdf/${year}${month}${day}.pdf`;
      }

      // Make absolute URL if relative
      if (!pdfUrl.startsWith("http")) {
        pdfUrl = `${this.config.baseUrl}${pdfUrl.startsWith("/") ? "" : "/"}${pdfUrl}`;
      }

      return await this.createGazette(gazetteDate, pdfUrl, {
        editionNumber,
        isExtraEdition,
        power: "executive_legislative",
        sourceText: linkText,
      });
    } catch (error) {
      logger.error(`Error parsing edition link:`, error as Error);
      return null;
    }
  }
}
