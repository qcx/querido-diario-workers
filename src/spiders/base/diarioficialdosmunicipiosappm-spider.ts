import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  DiarioOficialDosMunicipiosAPPMConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
// @ts-ignore
import { parse } from "node-html-parser";

/**
 * Spider for Diário Oficial dos Municípios (APPM) platform (Piauí state)
 *
 * Platform URL: https://www.diarioficialdosmunicipios.org
 * Search URL: https://www.diarioficialdosmunicipios.org/consulta/ConPublicacaoGeral/ConPublicacaoGeral.php
 *
 * This is a centralized platform managed by APPM (Associação Piauiense de Municípios)
 * that publishes official gazettes for multiple municipalities in Piauí.
 *
 * Features:
 * - ScriptCase-based application with JavaScript dropdowns
 * - Search by municipality, entity type, edition, and date range
 * - PDF downloads with edition details
 *
 * Requires browser rendering for JavaScript content (ScriptCase framework)
 */
export class DiarioOficialDosMunicipiosAPPMSpider extends BaseSpider {
  private _baseUrl: string;
  private _cityName: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig =
      config.config as DiarioOficialDosMunicipiosAPPMConfig;
    this._baseUrl =
      platformConfig.baseUrl ||
      "https://www.diarioficialdosmunicipios.org/consulta/ConPublicacaoGeral/ConPublicacaoGeral.php";
    this._cityName = platformConfig.cityName || config.name.split(" - ")[0];
    this.browser = browser || null;

    logger.info(
      `Initializing DiarioOficialDosMunicipiosAPPMSpider for ${config.name} with city: ${this._cityName}`,
    );
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(
        `DiarioOficialDosMunicipiosAPPMSpider for ${this.config.name} requires browser binding`,
      );
      return [];
    }

    return this.crawlWithBrowser();
  }

  /**
   * Crawl using browser for JavaScript-rendered content
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();

      // Go to the search page
      const searchUrl = this._baseUrl;
      logger.debug(`Navigating to APPM search page: ${searchUrl}`);

      await page.goto(searchUrl, { waitUntil: "networkidle0", timeout: 60000 });
      this.requestCount++;

      // Wait for the page to fully load (ScriptCase needs more time)
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Try to interact with the ScriptCase form
      try {
        // Select "Prefeitura" as entity type (usually default)
        // The platform uses ScriptCase select dropdowns

        // Wait for select elements to be available
        await page.waitForSelector("select", {
          timeout: 15000,
        });

        // ScriptCase uses standard <select> elements
        // Find all select elements on the page
        const selectElements = await page.$$("select");
        logger.debug(
          `Found ${selectElements.length} select elements on APPM page`,
        );

        // Try to select the municipality - look for select with municipality options
        for (const selectEl of selectElements) {
          try {
            // Get all options in this select
            const options = await page.evaluate((sel) => {
              const opts = sel.querySelectorAll("option");
              return Array.from(opts).map((opt) => ({
                value: opt.value,
                text: opt.textContent?.trim() || "",
              }));
            }, selectEl);

            // Check if this is the municipality dropdown
            const cityOption = options.find(
              (opt) =>
                opt.text.toLowerCase() === this._cityName.toLowerCase() ||
                opt.text.toLowerCase().includes(this._cityName.toLowerCase()),
            );

            if (cityOption) {
              logger.debug(
                `Found city "${this._cityName}" in dropdown with value: ${cityOption.value}`,
              );
              await page.evaluate(
                (sel, value) => {
                  sel.value = value;
                  // Trigger change event for ScriptCase
                  sel.dispatchEvent(new Event("change", { bubbles: true }));
                },
                selectEl,
                cityOption.value,
              );
              await new Promise((resolve) => setTimeout(resolve, 2000));
              logger.debug(`Successfully selected city: ${this._cityName}`);
              break;
            }
          } catch (e) {
            // Continue to next select
          }
        }

        // Try to set date range if date inputs are available
        const dateInputs = await page.$$(
          'input[type="text"][id*="data"], input[id*="Data"]',
        );
        if (dateInputs.length >= 2) {
          const startDateStr = this.formatDateBR(this.startDate);
          const endDateStr = this.formatDateBR(this.endDate);

          await dateInputs[0].click({ clickCount: 3 });
          await page.keyboard.type(startDateStr);

          await dateInputs[1].click({ clickCount: 3 });
          await page.keyboard.type(endDateStr);
        }

        // Click search/filter button - ScriptCase uses various button types
        const searchButtonSelectors = [
          'button[type="submit"]',
          'input[type="submit"]',
          'button[id*="pesquis"]',
          'a[id*="pesquis"]',
          'input[value*="Pesquis"]',
          'button:contains("Pesquisar")',
          'a:contains("Pesquisar")',
          'input[type="button"][value*="Pesquis"]',
          "#sc_btns_Pesq", // Common ScriptCase pattern
          "[id*='btns'][id*='Pesq']",
          "a.scButton",
        ];

        let clicked = false;
        for (const selector of searchButtonSelectors) {
          try {
            const searchButton = await page.$(selector);
            if (searchButton) {
              await searchButton.click();
              clicked = true;
              logger.debug(`Clicked search button with selector: ${selector}`);
              await new Promise((resolve) => setTimeout(resolve, 5000));
              break;
            }
          } catch (e) {
            // Try next selector
          }
        }

        if (!clicked) {
          // Try to find any button or link that might trigger search
          logger.debug(
            "No standard search button found, trying to find any search-like element",
          );
        }
      } catch (error) {
        logger.warn(
          `Could not interact with APPM form, trying to parse current content: ${error}`,
        );
      }

      // Get page content and extract gazettes
      const html = await page.content();
      gazettes.push(...this.parseGazettes(html));

      // Try pagination if available
      let hasNextPage = true;
      let pageNum = 1;
      const maxPages = 50; // Safety limit

      while (hasNextPage && pageNum < maxPages) {
        try {
          // Look for pagination links
          const nextPageButton = await page.$(
            'a[href*="pagina"], a[href*="page"], button[class*="next"], a.next, a[title*="próxima"]',
          );

          if (nextPageButton) {
            const isDisabled = await page.evaluate((el) => {
              return (
                el.classList.contains("disabled") ||
                el.getAttribute("disabled") !== null
              );
            }, nextPageButton);

            if (isDisabled) {
              hasNextPage = false;
              break;
            }

            await nextPageButton.click();
            await new Promise((resolve) => setTimeout(resolve, 3000));
            this.requestCount++;
            pageNum++;

            const newHtml = await page.content();
            const newGazettes = this.parseGazettes(newHtml);

            if (newGazettes.length === 0) {
              hasNextPage = false;
            } else {
              for (const g of newGazettes) {
                const exists = gazettes.some(
                  (existing) => existing.fileUrl === g.fileUrl,
                );
                if (!exists) {
                  gazettes.push(g);
                }
              }
            }
          } else {
            hasNextPage = false;
          }
        } catch (error) {
          logger.debug(`Pagination ended: ${error}`);
          hasNextPage = false;
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes for ${this.config.name} from APPM`,
      );
    } catch (error) {
      logger.error(
        `Error crawling ${this.config.name} from APPM:`,
        error as Error,
      );
    } finally {
      if (page) await page.close();
      if (browserInstance) await browserInstance.close();
    }

    return gazettes;
  }

  /**
   * Parse gazettes from HTML content
   */
  private parseGazettes(html: string): Gazette[] {
    const gazettes: Gazette[] = [];
    const root = parse(html);

    // Find gazette entries - APPM uses tables or divs with PDF links
    const pdfLinks = root.querySelectorAll(
      'a[href*=".pdf"], a[href*="download"], a[href*="visualizar"], a[onclick*="pdf"]',
    );

    for (const link of pdfLinks) {
      try {
        const href = link.getAttribute("href") || "";
        const onclick = link.getAttribute("onclick") || "";
        const linkText = link.text?.trim() || "";

        // Skip if no valid URL
        if (!href && !onclick.includes("pdf")) continue;

        // Find date in text or nearby elements
        let dateStr = "";
        let parentNode = link.parentNode;
        let searchText = linkText;
        let maxDepth = 8;

        const datePatterns = [
          /(\d{2})\/(\d{2})\/(\d{4})/, // DD/MM/YYYY
          /(\d{4})-(\d{2})-(\d{2})/, // YYYY-MM-DD
        ];

        while (maxDepth > 0 && !dateStr) {
          for (const pattern of datePatterns) {
            const match = searchText.match(pattern);
            if (match) {
              if (pattern.source.startsWith("(\\d{2})")) {
                // DD/MM/YYYY format
                const [, day, month, year] = match;
                dateStr = `${year}-${month}-${day}`;
              } else {
                // YYYY-MM-DD format
                dateStr = match[0];
              }
              break;
            }
          }

          if (parentNode) {
            searchText = parentNode.text || "";
            // Also check for sibling elements
            const siblingText = parentNode.parentNode?.text || "";
            if (!dateStr && siblingText) {
              searchText = siblingText;
            }
            parentNode = parentNode.parentNode;
          }
          maxDepth--;
        }

        // Try to extract from URL if not found in text
        if (!dateStr) {
          const urlMatch = href.match(/(\d{4})-(\d{2})-(\d{2})/);
          if (urlMatch) {
            dateStr = urlMatch[0];
          }
        }

        if (!dateStr) {
          continue;
        }

        const gazetteDate = new Date(dateStr);

        if (isNaN(gazetteDate.getTime())) continue;
        if (gazetteDate < this.startDate) continue;
        if (gazetteDate > this.endDate) continue;

        // Check if this gazette is for our city
        const textToCheck =
          linkText.toLowerCase() + " " + (parentNode?.text || "").toLowerCase();

        // For APPM, if we successfully filtered by city, we can accept all results
        // Otherwise, check for city name in the context
        if (
          !textToCheck.includes(this._cityName.toLowerCase()) &&
          !textToCheck.includes("prefeitura")
        ) {
          // Only skip if we're sure it's not our city
          const row = link.closest("tr");
          if (
            row &&
            !row.text?.toLowerCase().includes(this._cityName.toLowerCase())
          ) {
            continue;
          }
        }

        let pdfUrl = href;
        if (!pdfUrl.startsWith("http")) {
          pdfUrl = new URL(pdfUrl, "https://www.diarioficialdosmunicipios.org")
            .href;
        }

        // Extract edition number if available
        let editionNumber: string | undefined;
        const editionMatch = textToCheck.match(
          /edi[çc][ãa]o?\s*[:\s]*(?:n[°º]?)?\s*(\d+)/i,
        );
        if (editionMatch) {
          editionNumber = editionMatch[1];
        }

        const gazette = this.createGazetteSync(gazetteDate, pdfUrl, {
          editionNumber,
          isExtraEdition:
            textToCheck.includes("extra") ||
            textToCheck.includes("_b") ||
            textToCheck.includes("_c"),
          power: "executive_legislative",
        });

        if (gazette) {
          const exists = gazettes.some((g) => g.fileUrl === pdfUrl);
          if (!exists) {
            gazettes.push(gazette);
          }
        }
      } catch (error) {
        logger.error(`Error processing APPM gazette:`, error as Error);
      }
    }

    return gazettes;
  }

  /**
   * Create gazette synchronously (for use in parseGazettes)
   */
  private createGazetteSync(
    date: Date,
    pdfUrl: string,
    options?: {
      editionNumber?: string;
      isExtraEdition?: boolean;
      power?: string;
    },
  ): Gazette | null {
    try {
      return {
        date: date.toISOString().split("T")[0],
        fileUrl: pdfUrl,
        territoryId: this.config.territoryId,
        territoryName: this.config.name,
        stateCode: this.config.stateCode || "PI",
        scraped_at: new Date().toISOString(),
        edition_number: options?.editionNumber,
        is_extra_edition: options?.isExtraEdition || false,
        power: options?.power || "executive",
      } as Gazette;
    } catch (error) {
      logger.error(`Error creating gazette:`, error as Error);
      return null;
    }
  }

  /**
   * Format date as DD/MM/YYYY for Brazilian date inputs
   */
  private formatDateBR(date: Date): string {
    const day = date.getDate().toString().padStart(2, "0");
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }
}
