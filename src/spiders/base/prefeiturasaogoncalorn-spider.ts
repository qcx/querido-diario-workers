import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeituraSaoGoncaloRNConfig,
} from "../../types";
import { logger } from "../../utils/logger";
import { toISODate } from "../../utils/date-utils";

/**
 * PrefeituraSaoGoncaloRNSpider implementation
 *
 * Crawls the official gazette from São Gonçalo do Amarante, RN.
 * URL: https://www.saogoncalo.rn.gov.br/diariooficial
 *
 * The site uses a custom CMS with a list of editions.
 * Each edition has a detail page: https://www.saogoncalo.rn.gov.br/diariooficial.php?id=XXXX
 * PDF download URL: https://www.saogoncalo.rn.gov.br/arquivos_download.php?id=XXXX&pg=diariooficial
 *
 * HTML Structure:
 * - Each edition block contains:
 *   - Title: "Diário Oficial: XXX/YYYY - Ano XX Edição Nº ... de DD de Month de YYYY - EXECUTIVO"
 *   - Link: href='diariooficial.php?id=XXXX'
 *   - Date: <span class="calendarioIcon">DD/MM/YYYY</span>
 *   - Edition EXTRA indicated in title text
 */
export class PrefeituraSaoGoncaloRNSpider extends BaseSpider {
  protected sgaConfig: PrefeituraSaoGoncaloRNConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.sgaConfig = spiderConfig.config as PrefeituraSaoGoncaloRNConfig;

    if (!this.sgaConfig.baseUrl) {
      throw new Error(
        `PrefeituraSaoGoncaloRNSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeituraSaoGoncaloRNSpider for ${spiderConfig.name}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.sgaConfig.baseUrl} for ${this.spiderConfig.name}...`,
    );
    const gazettes: Gazette[] = [];

    try {
      // The site shows all editions on the main page with pagination via query params
      // We'll fetch pages until we go past our date range
      let page = 1;
      let hasMore = true;
      const seenIds = new Set<string>();

      while (hasMore) {
        // Pagination uses ?pagina= parameter (0-indexed: pagina=0 is page 1, pagina=1 is page 2, etc.)
        const url =
          page === 1
            ? this.sgaConfig.baseUrl
            : `${this.sgaConfig.baseUrl}?pagina=${page - 1}`;

        logger.debug(`Fetching page ${page}: ${url}`);
        const response = await this.fetch(url);

        // Extract editions from this page
        // Pattern captures: edition block with title, ID and date
        // Title example: "Diário Oficial: 017/2026 - Ano XX Edição Nº XVII de 27 de Janeiro de 2026 - EXECUTIVO"
        // The date also appears in format DD/MM/YYYY in calendarioIcon span

        const editionBlocks = this.extractEditionBlocks(response);

        if (editionBlocks.length === 0) {
          hasMore = false;
          break;
        }

        const startDateObj = new Date(this.startDate);
        let allBeforeStartDate = true;

        for (const block of editionBlocks) {
          if (seenIds.has(block.editionId)) {
            continue;
          }
          seenIds.add(block.editionId);

          const gazetteDate = new Date(`${block.dateStr}T00:00:00.000Z`);

          // Check if this edition is before our start date
          // Editions are sorted newest first, so if we find editions before startDate,
          // all remaining editions (on next pages) will also be before startDate
          if (gazetteDate < startDateObj) {
            // This edition is before our range, but keep track
            continue;
          }

          // This edition is not before startDate
          allBeforeStartDate = false;

          if (this.isInDateRange(gazetteDate)) {
            const gazette = await this.createGazetteFromEdition(block);
            if (gazette) {
              gazettes.push(gazette);
              logger.info(
                `Found gazette for ${toISODate(gazetteDate)}${block.isExtra ? " (EXTRA)" : ""}: ${gazette.url}`,
              );
            }
          }
          // If gazetteDate > endDate, we continue to next pages (editions are newest first)
        }

        // Stop if all editions on this page are before our start date
        // This means all subsequent pages will also have editions before our range
        if (allBeforeStartDate && editionBlocks.length > 0) {
          logger.debug(
            `All editions on page ${page} are before start date, stopping pagination`,
          );
          hasMore = false;
        } else {
          page++;
          // Safety limit to avoid infinite loops
          if (page > 100) {
            logger.warn("Reached page limit of 100, stopping pagination");
            hasMore = false;
          }
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
   * Extract edition blocks from the HTML response
   */
  private extractEditionBlocks(html: string): Array<{
    editionId: string;
    editionNumber: string;
    dateStr: string;
    isExtra: boolean;
    power: "executive" | "legislative" | "executive_legislative";
  }> {
    const blocks: Array<{
      editionId: string;
      editionNumber: string;
      dateStr: string;
      isExtra: boolean;
      power: "executive" | "legislative" | "executive_legislative";
    }> = [];

    // The HTML structure is:
    // <strong>...Diário Oficial: 017/2026 </strong> - Ano XX Edição Nº XVII de 27 de Janeiro de 2026 - EXECUTIVO</span>
    // <br id="diario_br" style="display:none;">
    // <a ... href='diariooficial.php?id=3382'>...</a>
    // <span class="calendarioIcon">... 27/01/2026</span>
    //
    // We'll use a more flexible approach: find all edition IDs first, then look for date nearby

    const seenIds = new Set<string>();

    // Find all edition links with the btnVisuEd class (these are the "Visualizar edição" buttons)
    // HTML structure: <a class='...btnVisuEd...' style="..." href='diariooficial.php?id=XXXX'>
    // Between class and href there can be other attributes like style
    const linkRegex =
      /class=['"][^'"]*btnVisuEd[^'"]*['"][\s\S]*?href=['"]diariooficial\.php\?id=(\d+)['"]/gi;

    for (const match of html.matchAll(linkRegex)) {
      // Match can be in group 1 (class before href) or group 2 (href before class)
      const editionId = match[1] || match[2];
      if (!editionId || seenIds.has(editionId)) continue;
      seenIds.add(editionId);

      // Use match.index to get the exact position of THIS match (not indexOf which finds first occurrence)
      // This is crucial because there may be multiple links with the same ID (e.g., "Edição atual" and "Visualizar edição")
      const matchIndex = match.index ?? 0;
      const contextStart = Math.max(0, matchIndex - 500);
      const contextEnd = Math.min(
        html.length,
        matchIndex + match[0].length + 300,
      );
      const context = html.substring(contextStart, contextEnd);

      // Extract date from calendarioIcon span - format: DD/MM/YYYY
      const dateMatch = context.match(
        /calendarioIcon[^>]*>[^<]*?(\d{2})\/(\d{2})\/(\d{4})/i,
      );
      if (!dateMatch) {
        // Fallback: any date in DD/MM/YYYY format after the link position in context
        const linkPosInContext = matchIndex - contextStart;
        const simpleDateMatch = context
          .substring(linkPosInContext)
          .match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (!simpleDateMatch) continue;

        const [, day, month, year] = simpleDateMatch;
        blocks.push({
          editionId,
          editionNumber: "",
          dateStr: `${year}-${month}-${day}`,
          isExtra: /EDIÇÃO[_ ]EXTRA/i.test(context),
          power: "executive",
        });
        continue;
      }

      const day = dateMatch[1];
      const month = dateMatch[2];
      const year = dateMatch[3];

      // Extract edition number from title - format: "Diário Oficial: XXX/YYYY"
      const editionMatch = context.match(/Diário Oficial:\s*(\d+\/\d{4})/i);
      const editionNumber = editionMatch ? editionMatch[1] : "";

      // Check if it's an extra edition
      const isExtra = /EDIÇÃO[_ ]EXTRA/i.test(context);

      // Check power (EXECUTIVO or LEGISLATIVO)
      const power: "executive" | "legislative" = /LEGISLATIVO/i.test(context)
        ? "legislative"
        : "executive";

      blocks.push({
        editionId,
        editionNumber,
        dateStr: `${year}-${month}-${day}`,
        isExtra,
        power,
      });
    }

    // Fallback: if no btnVisuEd links found, try any diariooficial.php?id link
    if (blocks.length === 0) {
      const fallbackRegex = /href=['"]diariooficial\.php\?id=(\d+)['"][^>]*>/gi;

      for (const match of html.matchAll(fallbackRegex)) {
        const editionId = match[1];
        if (seenIds.has(editionId)) continue;
        seenIds.add(editionId);

        // Find context
        const linkIndex = html.indexOf(`id=${editionId}`);
        const contextStart = Math.max(0, linkIndex - 300);
        const contextEnd = Math.min(html.length, linkIndex + 300);
        const context = html.substring(contextStart, contextEnd);

        // Look for date after the link
        const dateMatch = context
          .substring(context.indexOf(`id=${editionId}`))
          .match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (!dateMatch) continue;

        const [, day, month, year] = dateMatch;

        blocks.push({
          editionId,
          editionNumber: "",
          dateStr: `${year}-${month}-${day}`,
          isExtra: /EDIÇÃO[_ ]EXTRA/i.test(context),
          power: "executive",
        });
      }
    }

    return blocks;
  }

  /**
   * Create gazette from edition block
   */
  private async createGazetteFromEdition(block: {
    editionId: string;
    editionNumber: string;
    dateStr: string;
    isExtra: boolean;
    power: "executive" | "legislative" | "executive_legislative";
  }): Promise<Gazette | null> {
    const baseUrl = this.sgaConfig.baseUrl.replace(/\/diariooficial$/, "");

    // Build PDF download URL - the site uses arquivos_download.php endpoint
    const pdfUrl = `${baseUrl}/arquivos_download.php?id=${block.editionId}&pg=diariooficial`;

    const gazetteDate = new Date(`${block.dateStr}T00:00:00.000Z`);

    const gazette = await this.createGazette(gazetteDate, pdfUrl, {
      isExtraEdition: block.isExtra,
      power: block.power,
      editionNumber: block.editionNumber || undefined,
    });

    if (gazette) {
      const [year, month, day] = block.dateStr.split("-");
      gazette.sourceText = `Diário Oficial de São Gonçalo do Amarante - ${day}/${month}/${year}${block.isExtra ? " - Edição Extra" : ""}`;
    }

    return gazette;
  }
}
