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
      // Order: 1) Entidade = Prefeitura, 2) Município = city, 3) Data (date range), 4) Search
      try {
        await page.waitForSelector("select", { timeout: 15000 });
        const selectElements = await page.$$("select");
        logger.debug(
          `Found ${selectElements.length} select elements on APPM page`,
        );

        // 1) Set Entidade = "Prefeitura" first (required by the form)
        let entidadeSelectSet = false;
        for (const selectEl of selectElements) {
          const options = await page.evaluate((sel) => {
            const opts = sel.querySelectorAll("option");
            return Array.from(opts).map((opt) => ({
              value: opt.value,
              text: opt.textContent?.trim() || "",
            }));
          }, selectEl);
          const prefeituraOption = options.find(
            (opt) =>
              opt.text.toLowerCase() === "prefeitura" ||
              opt.text.toLowerCase().includes("prefeitura"),
          );
          if (prefeituraOption && prefeituraOption.value) {
            await page.evaluate(
              (sel, value) => {
                sel.value = value;
                sel.dispatchEvent(new Event("change", { bubbles: true }));
              },
              selectEl,
              prefeituraOption.value,
            );
            await new Promise((resolve) => setTimeout(resolve, 2000));
            entidadeSelectSet = true;
            logger.debug("Set Entidade to Prefeitura");
            break;
          }
        }
        if (!entidadeSelectSet) {
          logger.warn("Could not find Entidade Prefeitura dropdown");
        }

        // 2) Select municipality (city) - find select that has city name
        for (const selectEl of selectElements) {
          const options = await page.evaluate((sel) => {
            const opts = sel.querySelectorAll("option");
            return Array.from(opts).map((opt) => ({
              value: opt.value,
              text: opt.textContent?.trim() || "",
            }));
          }, selectEl);
          const cityOption = options.find(
            (opt) =>
              opt.text &&
              opt.text.toLowerCase() !== "prefeitura" &&
              (opt.text.toLowerCase() === this._cityName.toLowerCase() ||
                opt.text.toLowerCase().includes(this._cityName.toLowerCase())),
          );
          if (cityOption && cityOption.value) {
            await page.evaluate(
              (sel, value) => {
                sel.value = value;
                sel.dispatchEvent(new Event("change", { bubbles: true }));
              },
              selectEl,
              cityOption.value,
            );
            await new Promise((resolve) => setTimeout(resolve, 2000));
            logger.debug(`Selected city: ${this._cityName}`);
            break;
          }
        }

        // 3) Set date range (Data* - required) via evaluate to avoid "not clickable" errors
        const startDateStr = this.formatDateBR(this.startDate);
        const endDateStr = this.formatDateBR(this.endDate);
        try {
          const dateSet = await page.evaluate(
            (start, end) => {
              const inputs = Array.from(
                document.querySelectorAll(
                  'input[type="text"][id*="data"], input[id*="Data"], input[type="text"]',
                ),
              ).filter((el) => {
                const vis = (el as HTMLElement).offsetParent !== null;
                const rect = el.getBoundingClientRect();
                return vis && rect.width > 0 && rect.height > 0;
              });
              if (inputs.length >= 2) {
                (inputs[0] as HTMLInputElement).value = start;
                (inputs[0] as HTMLInputElement).dispatchEvent(
                  new Event("input", { bubbles: true }),
                );
                (inputs[0] as HTMLInputElement).dispatchEvent(
                  new Event("change", { bubbles: true }),
                );
                (inputs[1] as HTMLInputElement).value = end;
                (inputs[1] as HTMLInputElement).dispatchEvent(
                  new Event("input", { bubbles: true }),
                );
                (inputs[1] as HTMLInputElement).dispatchEvent(
                  new Event("change", { bubbles: true }),
                );
                return true;
              }
              return false;
            },
            startDateStr,
            endDateStr,
          );
          if (dateSet) {
            logger.debug("Set date range via evaluate");
            await new Promise((resolve) => setTimeout(resolve, 800));
            // Trigger blur on last date input (ScriptCase may run search on blur)
            await page.evaluate(() => {
              const inputs = document.querySelectorAll(
                'input[type="text"][id*="data"], input[id*="Data"]',
              );
              if (inputs.length >= 2) {
                (inputs[1] as HTMLInputElement).dispatchEvent(
                  new FocusEvent("blur", { bubbles: true }),
                );
              }
            });
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        } catch (dateErr) {
          logger.debug(`Could not set date range: ${dateErr}`);
        }

        // 4) Trigger search - ScriptCase may use "Pesquisa Avançada" or form submit
        const searchButtonSelectors = [
          'input[value*="Pesquisa"]',
          'input[value*="Pesquisar"]',
          'button[value*="Pesquisa"]',
          'button[type="submit"]',
          'input[type="submit"]',
          'button[id*="pesquis"]',
          'a[id*="pesquis"]',
          'input[value*="Pesquis"]',
          'input[type="button"][value*="Pesquis"]',
          "#sc_btns_Pesq",
          "[id*='btns'][id*='Pesq']",
          "a.scButton",
        ];

        let clicked = false;
        for (const selector of searchButtonSelectors) {
          try {
            clicked = await page.evaluate((sel) => {
              const el = document.querySelector(sel) as HTMLElement | null;
              if (el && !el.hasAttribute("disabled")) {
                el.click();
                return true;
              }
              return false;
            }, selector);
            if (clicked) {
              logger.debug(`Clicked search button with selector: ${selector}`);
              await new Promise((resolve) => setTimeout(resolve, 5000));
              break;
            }
          } catch (_) {
            // try next selector
          }
        }

        // Fallback: find by visible text "Pesquisa" / "Pesquisa Avançada" (ScriptCase labels)
        if (!clicked) {
          clicked = await page.evaluate(() => {
            const candidates = Array.from(
              document.querySelectorAll(
                "input[type='button'], input[type='submit'], button, a.scButton, a[href='#'], a[href*='javascript'], a.btn, a[onclick]",
              ),
            ).filter((el) => {
              const r = (el as HTMLElement).getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            }) as HTMLElement[];
            for (const el of candidates) {
              const value = ((el as HTMLInputElement).value || "").toLowerCase();
              const text = (el.textContent || "").trim().toLowerCase();
              const label = value + " " + text;
              if (
                label.includes("pesquisa") ||
                label.includes("pesquisar") ||
                label.includes("avancada")
              ) {
                el.click();
                return true;
              }
            }
            return false;
          });
          if (clicked) {
            logger.debug("Clicked search button by text (Pesquisa Avançada)");
            await new Promise((resolve) => setTimeout(resolve, 5000));
          }
        }

        // Fallback: submit the form that contains the date/entity filters
        if (!clicked) {
          clicked = await page.evaluate(() => {
            const forms = document.querySelectorAll("form");
            for (const form of forms) {
              const hasDate =
                form.querySelector('input[id*="data"]') ||
                form.querySelector('input[id*="Data"]') ||
                form.querySelector('input[type="text"]');
              if (hasDate) {
                (form as HTMLFormElement).submit();
                return true;
              }
            }
            return false;
          });
          if (clicked) {
            logger.debug("Submitted form to trigger search");
            await new Promise((resolve) => setTimeout(resolve, 5000));
          }
        }

        if (!clicked) {
          logger.debug(
            "No search button found, continuing with current page",
          );
        }
      } catch (error) {
        logger.warn(
          `Could not interact with APPM form, trying to parse current content: ${error}`,
        );
      }

      // Wait for results table/grid to load (ScriptCase often loads via AJAX)
      try {
        await Promise.race([
          page.waitForSelector(
            'table a[href*=".pdf"], table a[href*="download"], table td a[href], table td a[onclick], [id*="grid"] a[href], [id*="Grid"] a[href]',
            { timeout: 15000 },
          ),
          page.waitForFunction(
            () => {
              const tables = document.querySelectorAll("table");
              for (const t of tables) {
                const rows = t.querySelectorAll("tbody tr, tr");
                if (rows.length >= 5) return true;
              }
              return document.body?.innerText?.includes(" de ") === true;
            },
            { timeout: 15000 },
          ),
        ]).catch(() => null);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } catch (_) {
        // continue with current content
      }

      // Get page content and extract gazettes
      let html = await page.content();
      gazettes.push(...this.parseGazettes(html));

      // Optionally increase "Visualizar" (items per page) to reduce number of pages
      try {
        const visualizarSelect = await page.$(
          'select[id*="visualizar"], select[name*="visualizar"], select[id*="per_page"], select[name*="per_page"]',
        );
        if (visualizarSelect) {
          const options = await page.evaluate((sel) => {
            const opts = sel.querySelectorAll("option");
            return Array.from(opts)
              .map((opt) => ({ value: opt.value, text: opt.textContent?.trim() || "" }))
              .filter((o) => o.value && /^\d+$/.test(o.value));
          }, visualizarSelect);
          const higher = options.find((o) => parseInt(o.value, 10) >= 50) || options[options.length - 1];
          if (higher && higher.value) {
            await page.evaluate(
              (sel, value) => {
                sel.value = value;
                sel.dispatchEvent(new Event("change", { bubbles: true }));
              },
              visualizarSelect,
              higher.value,
            );
            await new Promise((resolve) => setTimeout(resolve, 3000));
            html = await page.content();
            const reparse = this.parseGazettes(html);
            for (const g of reparse) {
              if (!gazettes.some((existing) => existing.fileUrl === g.fileUrl)) {
                gazettes.push(g);
              }
            }
          }
        }
      } catch (_) {
        // ignore
      }

      // Pagination: go to next page until no more (ScriptCase: next link/button)
      let hasNextPage = true;
      let pageNum = 1;
      const maxPages = 100;

      while (hasNextPage && pageNum < maxPages) {
        try {
          const nextPageButton = await page.$(
            'a[href*="pagina"], a[href*="page"], button[class*="next"], a.next, a[title*="próxima"], a[title*="Próxima"], [title*="próxima"]',
          );

          if (!nextPageButton) {
            hasNextPage = false;
            break;
          }

          const isDisabled = await page.evaluate((el) => {
            return (
              el.classList?.contains("disabled") === true ||
              el.getAttribute("disabled") !== null ||
              el.getAttribute("aria-disabled") === "true"
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
              if (!gazettes.some((existing) => existing.fileUrl === g.fileUrl)) {
                gazettes.push(g);
              }
            }
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
   * Parse gazettes from HTML content.
   * Prefer results table (N° Edição, Ano, Data, Município, Entidade, Categoria, Documento, Arquivo, Identificador)
   * then fallback to any PDF link with date in context.
   */
  private parseGazettes(html: string): Gazette[] {
    const gazettes: Gazette[] = [];
    const root = parse(html);
    const baseOrigin = "https://www.diarioficialdosmunicipios.org";
    const datePattern = /(\d{2})\/(\d{2})\/(\d{4})/; // DD/MM/YYYY

    // 1) Parse results table (AgruparPDFs) - columns: N° Edição, Ano, Data, Município, Entidade, Categoria, Documento, Arquivo, Identificador
    const tables = root.querySelectorAll("table");
    for (const table of tables) {
      const headerRow = table.querySelector("thead tr, tr");
      if (!headerRow) continue;
      const headers = headerRow.querySelectorAll("th, td");
      const headerTexts = Array.from(headers).map((h) =>
        (h.text?.trim() || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, ""),
      );
      const dataIdx = headerTexts.findIndex(
        (t) => t === "data" || t.includes("data"),
      );
      const arquivoIdx = headerTexts.findIndex(
        (t) => t === "arquivo" || t.includes("arquivo"),
      );
      if (dataIdx === -1 || arquivoIdx === -1) continue;

      const rows = table.querySelectorAll("tbody tr, tr");
      for (const row of rows) {
        if (row === headerRow || row.querySelector("th")) continue;
        const cells = row.querySelectorAll("td");
        if (cells.length <= Math.max(dataIdx, arquivoIdx)) continue;

        const dataCell = cells[dataIdx];
        const arquivoCell = cells[arquivoIdx];
        const dateMatch = (dataCell?.text || "").match(datePattern);
        if (!dateMatch) continue;
        const [, day, month, year] = dateMatch;
        const dateStr = `${year}-${month}-${day}`;
        const gazetteDate = new Date(dateStr);
        if (isNaN(gazetteDate.getTime())) continue;
        if (gazetteDate < this.startDate || gazetteDate > this.endDate) continue;

        const link = arquivoCell?.querySelector("a[href], a[onclick]");
        const rawHref = link?.getAttribute("href") || "";
        const onclick = link?.getAttribute("onclick") || "";
        const href =
          rawHref ||
          (onclick.match(/['"]([^'"]*(?:pdf|download|visualizar|file|get)[^'"]*)['"]/i) || [])[1] ||
          (onclick.match(/['"](https?:\/\/[^'"]+)['"]/) || [])[1] ||
          (onclick.match(/['"]([^'"]+\.pdf[^'"]*)['"]/i) || [])[1];
        if (!href) continue;

        let pdfUrl = href.startsWith("http") ? href : new URL(href, baseOrigin).href;
        const rowText = (row.text || "").toLowerCase();
        const editionMatch = rowText.match(/(\d{4,})\s*\|?\s*data/i) || rowText.match(/edi[çc][ãa]o?\s*[:\s]*(?:n[°º]?)?\s*(\d+)/i);
        const editionNumber = editionMatch ? editionMatch[1] : undefined;

        const gazette = this.createGazetteSync(gazetteDate, pdfUrl, {
          editionNumber,
          isExtraEdition: rowText.includes("_b") || rowText.includes("_c") || rowText.includes("extra"),
          power: "executive_legislative",
        });
        if (gazette) {
          const exists = gazettes.some((g) => g.fileUrl === pdfUrl);
          if (!exists) gazettes.push(gazette);
        }
      }
      if (gazettes.length > 0) return gazettes;
    }

    // 2) Fallback: any table row that has both a date (dd/mm/yyyy) and a link (PDF/download/any)
    for (const table of root.querySelectorAll("table")) {
      for (const row of table.querySelectorAll("tr")) {
        if (row.querySelector("th")) continue;
        const rowText = row.text || "";
        const dateMatch = rowText.match(datePattern);
        if (!dateMatch) continue;
        const [, day, month, year] = dateMatch;
        const gazetteDate = new Date(`${year}-${month}-${day}`);
        if (isNaN(gazetteDate.getTime()) || gazetteDate < this.startDate || gazetteDate > this.endDate) continue;
        const link = row.querySelector('a[href], a[onclick]');
        const rawHref = link?.getAttribute("href") || "";
        const onclick = link?.getAttribute("onclick") || "";
        const href =
          rawHref ||
          (onclick.match(/['"]([^'"]*(?:pdf|download|visualizar|file|get)[^'"]*)['"]/i) || [])[1] ||
          (onclick.match(/['"](https?:\/\/[^'"]+)['"]/) || [])[1] ||
          (onclick.match(/['"]([^'"]+\.pdf[^'"]*)['"]/i) || [])[1];
        if (!href || href.startsWith("javascript:")) continue;
        const pdfUrl = href.startsWith("http") ? href : new URL(href, baseOrigin).href;
        const editionNumber = (rowText.match(/(\d{4,})\s*\|?\s*data/i) || rowText.match(/edi[çc][ãa]o?\s*[:\s]*(?:n[°º]?)?\s*(\d+)/i))?.[1];
        const gazette = this.createGazetteSync(gazetteDate, pdfUrl, {
          editionNumber,
          isExtraEdition: rowText.toLowerCase().includes("_b") || rowText.toLowerCase().includes("_c") || rowText.toLowerCase().includes("extra"),
          power: "executive_legislative",
        });
        if (gazette && !gazettes.some((g) => g.fileUrl === pdfUrl)) gazettes.push(gazette);
      }
      if (gazettes.length > 0) return gazettes;
    }

    // 3) Fallback: find any PDF link with date in context
    const pdfLinks = root.querySelectorAll(
      'a[href*=".pdf"], a[href*="download"], a[href*="visualizar"], a[onclick*="pdf"]',
    );
    for (const link of pdfLinks) {
      try {
        const href = link.getAttribute("href") || "";
        const onclick = link.getAttribute("onclick") || "";
        if (!href && !onclick.includes("pdf")) continue;

        let dateStr = "";
        let parentNode: typeof link.parentNode = link.parentNode;
        let searchText = (link.text?.trim() || "") + " " + (parentNode?.text || "");
        const datePatterns = [/(\d{2})\/(\d{2})\/(\d{4})/, /(\d{4})-(\d{2})-(\d{2})/];
        for (let d = 0; d < 8 && !dateStr; d++) {
          for (const pattern of datePatterns) {
            const m = searchText.match(pattern);
            if (m) {
              dateStr = pattern.source.startsWith("(\\d{2})") ? `${m[3]}-${m[2]}-${m[1]}` : m[0];
              break;
            }
          }
          if (parentNode) {
            searchText = parentNode.parentNode?.text || "";
            parentNode = parentNode.parentNode;
          }
        }
        if (!dateStr && href) {
          const um = href.match(/(\d{4})-(\d{2})-(\d{2})/);
          if (um) dateStr = um[0];
        }
        if (!dateStr) continue;

        const gazetteDate = new Date(dateStr);
        if (isNaN(gazetteDate.getTime()) || gazetteDate < this.startDate || gazetteDate > this.endDate) continue;

        const textToCheck = (link.text || "").toLowerCase() + " " + (parentNode?.text || "").toLowerCase();
        if (!textToCheck.includes(this._cityName.toLowerCase()) && !textToCheck.includes("prefeitura")) {
          const row = link.closest("tr");
          if (row && !row.text?.toLowerCase().includes(this._cityName.toLowerCase())) continue;
        }

        let pdfUrl = href || (onclick.match(/['"]([^'"]+\.pdf[^'"]*)['"]/) || [])[1];
        if (!pdfUrl) continue;
        if (!pdfUrl.startsWith("http")) pdfUrl = new URL(pdfUrl, baseOrigin).href;

        const editionNumber = (textToCheck.match(/edi[çc][ãa]o?\s*[:\s]*(?:n[°º]?)?\s*(\d+)/i) || [])[1];
        const gazette = this.createGazetteSync(gazetteDate, pdfUrl, {
          editionNumber,
          isExtraEdition: textToCheck.includes("extra") || textToCheck.includes("_b") || textToCheck.includes("_c"),
          power: "executive_legislative",
        });
        if (gazette) {
          if (!gazettes.some((g) => g.fileUrl === pdfUrl)) gazettes.push(gazette);
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
