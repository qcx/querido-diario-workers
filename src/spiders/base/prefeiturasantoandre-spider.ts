import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  PrefeiturasantoandreConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
import { toISODate } from "../../utils/date-utils";

/**
 * Spider for Prefeitura de Santo André
 *
 * Site Structure:
 * - URL: https://web.santoandre.sp.gov.br/portal/diario-oficial
 * - Search form with fields: Palavra-Chave, Edição, Data inicial, Data final
 * - List of editions with links containing: "Edição nº XXXX", date, "Ler online", "Baixar"
 *
 * Based on Instar-like pattern with custom implementation
 */
export class PrefeiturasantoandreSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeiturasantoandreConfig;
    this.baseUrl = platformConfig.baseUrl;
    if (!this.baseUrl) {
      throw new Error(
        `PrefeiturasantoandreSpider requires baseUrl in config for ${config.name}`
      );
    }
    logger.debug(
      `PrefeiturasantoandreSpider initialized with baseUrl: ${this.baseUrl} for ${config.name}`
    );
    this.browser = browser || null;
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(
        `PrefeiturasantoandreSpider for ${this.config.name} requires browser binding`
      );
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura Santo André for ${this.config.name}...`);

    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();

      // Navigate to the diário oficial page
      logger.info(`Navigating to: ${this.baseUrl}`);
      await page.goto(this.baseUrl, { waitUntil: "networkidle0", timeout: 60000 });
      this.requestCount++;

      // Wait for the page to load
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Format dates for the form (DD/MM/YYYY)
      const startDate = this.formatDateForForm(new Date(this.startDate));
      const endDate = this.formatDateForForm(new Date(this.endDate));

      logger.info(`Searching for gazettes from ${startDate} to ${endDate}`);

      // Fill the date range form
      await this.fillDateForm(page, startDate, endDate);

      // Wait for results to load
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Extract all gazettes from the page
      const pageGazettes = await this.extractGazettes(page);
      
      // Filter by date range
      for (const gazette of pageGazettes) {
        if (gazette && this.isInDateRange(new Date(gazette.date))) {
          gazettes.push(gazette);
        }
      }

      logger.info(
        `Found ${gazettes.length} gazettes within date range for ${this.config.name}`
      );
    } catch (error) {
      logger.error(
        `Error crawling Prefeitura Santo André for ${this.config.name}:`,
        error as Error
      );
    } finally {
      // Clean up
      if (page) {
        try {
          await page.close();
        } catch (e) {
          logger.warn("Error closing page", {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (e) {
          logger.warn("Error closing browser", {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    return gazettes;
  }

  /**
   * Format date for the form input (DD/MM/YYYY)
   */
  private formatDateForForm(date: Date): string {
    const day = date.getDate().toString().padStart(2, "0");
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }

  /**
   * Fill the date range form and submit
   */
  private async fillDateForm(
    page: any,
    startDate: string,
    endDate: string
  ): Promise<void> {
    try {
      // Wait for form to be available
      await page.waitForSelector('input[name*="data"], input[placeholder*="Data"]', {
        timeout: 10000,
      });

      // Find and fill date inputs
      // The form has "Data inicial" and "Data final" fields
      const dateInputs = await page.$$('input[type="text"]');
      
      for (const input of dateInputs) {
        const placeholder = await input.evaluate((el: HTMLInputElement) => 
          el.placeholder || el.getAttribute('aria-label') || ''
        );
        const name = await input.evaluate((el: HTMLInputElement) => el.name || '');
        
        if (placeholder.toLowerCase().includes('inicial') || name.toLowerCase().includes('inicial')) {
          await input.click({ clickCount: 3 });
          await input.type(startDate);
          logger.debug(`Filled start date: ${startDate}`);
        } else if (placeholder.toLowerCase().includes('final') || name.toLowerCase().includes('final')) {
          await input.click({ clickCount: 3 });
          await input.type(endDate);
          logger.debug(`Filled end date: ${endDate}`);
        }
      }

      // Click the search button
      const searchButton = await page.$('button[type="submit"], button:has-text("BUSCAR"), input[type="submit"]');
      if (searchButton) {
        await searchButton.click();
        logger.debug("Clicked search button");
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    } catch (error) {
      logger.warn("Could not fill date form, proceeding with default results", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Extract gazettes from the page
   */
  private async extractGazettes(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      // Extract gazette data from the page
      const gazetteData = await page.evaluate(() => {
        const results: Array<{
          editionNumber: string;
          date: string;
          downloadUrl: string;
          viewUrl: string;
        }> = [];

        // Find all gazette links - they contain "Edição nº" pattern
        const links = document.querySelectorAll('a[href*="download"], a[href*="visualizar"], a[href*="pdf"]');
        const processedEditions = new Set<string>();

        // Also look for the gazette entries by their container
        const entries = document.querySelectorAll('[class*="edicao"], [class*="diario"], .list-group-item, article, .card');
        
        for (const entry of entries) {
          const text = entry.textContent || '';
          
          // Extract edition number: "Edição nº 3715"
          const editionMatch = text.match(/Edição\s*n[º°]?\s*(\d+)/i);
          if (!editionMatch) continue;
          
          const editionNumber = editionMatch[1];
          if (processedEditions.has(editionNumber)) continue;
          processedEditions.add(editionNumber);
          
          // Extract date: "Postagem: DD/MM/YYYY" or just "DD/MM/YYYY"
          const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{4})/);
          if (!dateMatch) continue;
          
          // Find download link within entry or nearby
          const downloadLink = entry.querySelector('a[href*="download"]') as HTMLAnchorElement;
          const viewLink = entry.querySelector('a[href*="visualizar"], a[href*="ler"]') as HTMLAnchorElement;
          
          // Get any link from the entry
          const anyLink = entry.querySelector('a[href]') as HTMLAnchorElement;
          
          results.push({
            editionNumber,
            date: dateMatch[1],
            downloadUrl: downloadLink?.href || anyLink?.href || '',
            viewUrl: viewLink?.href || '',
          });
        }

        // If no entries found with structure, try parsing links directly
        if (results.length === 0) {
          for (const link of links) {
            const text = (link as HTMLAnchorElement).textContent || '';
            const href = (link as HTMLAnchorElement).href || '';
            
            // Look for edition pattern in link text or parent
            const parent = link.closest('li, div, article, tr');
            const fullText = parent?.textContent || text;
            
            const editionMatch = fullText.match(/Edição\s*n[º°]?\s*(\d+)/i);
            const dateMatch = fullText.match(/(\d{2}\/\d{2}\/\d{4})/);
            
            if (editionMatch && dateMatch) {
              const editionNumber = editionMatch[1];
              if (!processedEditions.has(editionNumber)) {
                processedEditions.add(editionNumber);
                results.push({
                  editionNumber,
                  date: dateMatch[1],
                  downloadUrl: href,
                  viewUrl: '',
                });
              }
            }
          }
        }

        return results;
      });

      logger.info(`Extracted ${gazetteData.length} gazette entries from page`);

      // Convert to Gazette objects
      for (const data of gazetteData) {
        try {
          // Parse date from DD/MM/YYYY to YYYY-MM-DD
          const [day, month, year] = data.date.split('/');
          const isoDate = `${year}-${month}-${day}`;

          // Determine if it's an extra edition
          const isExtraEdition = false; // Could check for "Extra" in text

          const gazette: Gazette = {
            date: isoDate,
            fileUrl: data.downloadUrl || data.viewUrl,
            territoryId: this.config.territoryId,
            scrapedAt: new Date().toISOString(),
            editionNumber: data.editionNumber,
            isExtraEdition,
            power: "executive",
          };

          if (gazette.fileUrl) {
            gazettes.push(gazette);
          }
        } catch (error) {
          logger.warn(`Error parsing gazette data: ${JSON.stringify(data)}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      logger.error("Error extracting gazettes:", error as Error);
    }

    return gazettes;
  }
}

