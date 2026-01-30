import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeituramacaurnConfig,
} from "../../types";
import { logger } from "../../utils/logger";
import { toISODate } from "../../utils/date-utils";

/**
 * PrefeituramacaurnSpider implementation
 *
 * Crawls the official gazette from Macau, RN.
 * URL: https://macau.rn.gov.br/diario/
 *
 * The site uses Apache directory listing with the following structure:
 * - Root: /diario/ - lists year folders
 * - Year folder: /diario/2026 - Diário Oficial de Macau/
 * - Month folder: /diario/2026 - Diário Oficial de Macau/A - Janeiro - 2026/
 * - PDFs: diário{number}-{DD}-{MM}-{YYYY}.pdf or diário{number}-EDIÇÃO-EXTRA-{DD}-{MM}-{YYYY}.pdf
 *
 * Month prefixes: A=Janeiro, B=Fevereiro, C=Março, D=Abril, E=Maio, F=Junho,
 *                 G=Julho, H=Agosto, I=Setembro, J=Outubro, K=Novembro, L=Dezembro
 */
export class PrefeituramacaurnSpider extends BaseSpider {
  protected macauConfig: PrefeituramacaurnConfig;

  private readonly monthNames: Record<number, { letter: string; name: string }> = {
    1: { letter: "A", name: "Janeiro" },
    2: { letter: "B", name: "Fevereiro" },
    3: { letter: "C", name: "Março" },
    4: { letter: "D", name: "Abril" },
    5: { letter: "E", name: "Maio" },
    6: { letter: "F", name: "Junho" },
    7: { letter: "G", name: "Julho" },
    8: { letter: "H", name: "Agosto" },
    9: { letter: "I", name: "Setembro" },
    10: { letter: "J", name: "Outubro" },
    11: { letter: "K", name: "Novembro" },
    12: { letter: "L", name: "Dezembro" },
  };

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.macauConfig = spiderConfig.config as PrefeituramacaurnConfig;

    if (!this.macauConfig.baseUrl) {
      throw new Error(
        `PrefeituramacaurnSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(`Initializing PrefeituramacaurnSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.macauConfig.baseUrl} for ${this.spiderConfig.name}...`,
    );

    const gazettes: Gazette[] = [];
    const startDate = this.startDate;
    const endDate = this.endDate;

    // Calculate months to fetch based on date range
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
      try {
        const monthGazettes = await this.crawlMonth(year, month);

        for (const gazette of monthGazettes) {
          if (seenUrls.has(gazette.fileUrl)) {
            continue;
          }
          seenUrls.add(gazette.fileUrl);

          const gazetteDate = new Date(gazette.date);
          if (this.isInDateRange(gazetteDate)) {
            gazettes.push(gazette);
          }
        }
      } catch (error) {
        logger.debug(
          `Error fetching month ${month}/${year}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    logger.info(
      `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
    );

    return gazettes;
  }

  /**
   * Crawl a specific month's directory
   */
  private async crawlMonth(year: number, month: number): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const monthInfo = this.monthNames[month];

    if (!monthInfo) {
      logger.warn(`Invalid month: ${month}`);
      return gazettes;
    }

    // Build the month folder URL
    // Format: /diario/2026 - Diário Oficial de Macau/A  - Janeiro - 2026/
    // Note: There might be variations like "A - Janeiro - 2026" or "A  - Janeiro - 2026" (double space)
    const yearFolder = encodeURIComponent(`${year} - Diário Oficial de Macau`);
    
    // Try different month folder patterns
    const monthPatterns = [
      `${monthInfo.letter}  - ${monthInfo.name} - ${year}`,  // Double space pattern
      `${monthInfo.letter} - ${monthInfo.name} - ${year}`,   // Single space pattern
      `${monthInfo.letter} - ${monthInfo.name.toUpperCase()}`, // Without year, uppercase (e.g., "K - NOVEMBRO")
    ];

    let html: string | null = null;
    let successfulUrl: string = "";

    for (const pattern of monthPatterns) {
      const monthFolder = encodeURIComponent(pattern);
      const url = `${this.macauConfig.baseUrl}${yearFolder}/${monthFolder}/`;

      try {
        logger.debug(`Trying month URL: ${url}`);
        html = await this.fetch(url);
        successfulUrl = url;
        break;
      } catch (error) {
        logger.debug(`Month pattern "${pattern}" not found, trying next...`);
        continue;
      }
    }

    if (!html) {
      logger.debug(`No gazettes found for ${month}/${year} - folder not accessible`);
      return gazettes;
    }

    logger.debug(`Found month folder for ${month}/${year}`);

    // Parse the Apache directory listing
    // Pattern: <a href="diário{number}-{DD}-{MM}-{YYYY}.pdf">
    // Also handles: <a href="diário{number}-EDIÇÃO-EXTRA-{DD}-{MM}-{YYYY}.pdf">
    
    // Match both encoded and non-encoded links
    // The server returns links like: href="di%c3%a1rio2874-27-01-2026.pdf"
    const linkPattern = /<a\s+href="([^"]*(?:di%c3%a1rio|diário)[^"]*\.pdf)"[^>]*>/gi;
    
    let match;
    while ((match = linkPattern.exec(html)) !== null) {
      try {
        const encodedFilename = match[1];
        // Decode the filename to extract date info
        const filename = decodeURIComponent(encodedFilename);
        
        // Extract date from filename
        // Pattern: diário{number}-{DD}-{MM}-{YYYY}.pdf
        // Or: diário{number}-EDIÇÃO-EXTRA-{DD}-{MM}-{YYYY}.pdf
        const dateMatch = filename.match(/diário(\d+)-(?:EDIÇÃO-EXTRA-)?(\d{2})-(\d{2})-(\d{4})\.pdf/i);
        
        if (!dateMatch) {
          logger.debug(`Could not parse date from filename: ${filename}`);
          continue;
        }

        const [, editionNumber, day, monthNum, yearStr] = dateMatch;
        const isoDate = `${yearStr}-${monthNum}-${day}`;
        const gazetteDate = new Date(`${isoDate}T00:00:00.000Z`);

        // Check for extra edition
        const isExtraEdition = filename.toLowerCase().includes("extra");

        // Build full PDF URL
        const pdfUrl = `${successfulUrl}${encodedFilename}`;

        const gazette = await this.createGazette(gazetteDate, pdfUrl, {
          editionNumber,
          isExtraEdition,
          power: "executive",
          sourceText: `Edição ${editionNumber} - ${toISODate(gazetteDate)}${isExtraEdition ? " (Extra)" : ""}`,
          skipUrlResolution: true, // These are direct links, no need to resolve
        });

        if (gazette) {
          gazettes.push(gazette);
          logger.debug(
            `Found gazette: Edition ${editionNumber} - ${toISODate(gazetteDate)}${isExtraEdition ? " (Extra)" : ""}`,
          );
        }
      } catch (error) {
        logger.debug(`Error parsing gazette link: ${error}`);
      }
    }

    logger.debug(`Found ${gazettes.length} gazettes for ${month}/${year}`);
    return gazettes;
  }
}
