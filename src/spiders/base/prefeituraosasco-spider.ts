import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraosascoConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

interface OsascoGazetteEntry {
  url: string;
  title: string;
  thumbnail: boolean;
  year: string;
  month: string;
  date: string;
}

/**
 * Spider for Prefeitura de Osasco - IOMO (Imprensa Oficial do Município de Osasco)
 * 
 * Site Structure:
 * - URL: https://osasco.sp.gov.br/imprensa-oficial/
 * - Year tabs for filtering
 * - List of IOMO editions with links to PDFs
 * 
 * Data is embedded as JSON in the HTML page as a JavaScript variable.
 * The JSON contains objects with: url, title, thumbnail, year, month, date
 * 
 * Date format in data: "DD / MM / YYYY"
 * PDF URLs are direct links to wp-content/uploads/
 */
export class PrefeituraosascoSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const osascoConfig = config.config as PrefeituraosascoConfig;
    this.baseUrl = osascoConfig.baseUrl || 'https://osasco.sp.gov.br/imprensa-oficial/';
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    logger.info(`Crawling Osasco gazettes from ${this.baseUrl}...`);

    try {
      const response = await fetch(this.baseUrl);
      
      if (!response.ok) {
        logger.error(`Failed to fetch ${this.baseUrl}: ${response.status}`);
        return gazettes;
      }

      const html = await response.text();
      
      // Extract JSON data embedded in the page
      // Look for the pattern: [{"url":"...","title":"IOMO...",...}]
      const jsonMatch = html.match(/\[\s*\{[^[]*"url"\s*:\s*"[^"]*"[^[]*"title"\s*:\s*"[^"]*"[^[]*"year"\s*:\s*"[^"]*"[^[]*"month"\s*:\s*"[^"]*"[^[]*"date"\s*:\s*"[^"]*"[^\]]*\}\s*\]/g);
      
      if (!jsonMatch) {
        // Try alternative pattern - look for IOMO entries in a script tag
        const scriptMatch = html.match(/\[\{[^\]]*"IOMO[^\]]*\}\]/g);
        if (!scriptMatch) {
          logger.warn('Could not find gazette data in page HTML');
          return gazettes;
        }
      }

      // Parse all found JSON arrays
      const allEntries: OsascoGazetteEntry[] = [];
      const jsonStrings = html.match(/\[\s*\{"url"\s*:\s*"[^}]+"[^}]*\}/g) || [];
      
      // More robust: find the entire JSON array in the page
      const fullJsonMatch = html.match(/\[\s*\{"url"[^\]]+\}\s*\]/);
      if (fullJsonMatch) {
        try {
          // Unescape the JSON (it's escaped for JavaScript)
          const unescapedJson = fullJsonMatch[0]
            .replace(/\\"/g, '"')
            .replace(/\\\//g, '/');
          const entries = JSON.parse(unescapedJson) as OsascoGazetteEntry[];
          allEntries.push(...entries);
        } catch (e) {
          logger.debug(`Failed to parse main JSON array: ${e}`);
        }
      }

      // Fallback: try to extract individual entries
      if (allEntries.length === 0) {
        const entryPattern = /\{"url"\s*:\s*"([^"]+)"\s*,\s*"title"\s*:\s*"([^"]*)"\s*,\s*"thumbnail"\s*:\s*(true|false)\s*,\s*"year"\s*:\s*"([^"]+)"\s*,\s*"month"\s*:\s*"([^"]+)"\s*,\s*"date"\s*:\s*"([^"]+)"\s*\}/g;
        let match;
        while ((match = entryPattern.exec(html)) !== null) {
          allEntries.push({
            url: match[1].replace(/\\\//g, '/'),
            title: match[2],
            thumbnail: match[3] === 'true',
            year: match[4],
            month: match[5],
            date: match[6],
          });
        }
      }

      logger.info(`Found ${allEntries.length} total gazette entries`);

      // Filter and convert to Gazette objects
      for (const entry of allEntries) {
        // Parse date from "DD / MM / YYYY" format
        const dateParts = entry.date.replace(/\s+/g, '').split('/');
        if (dateParts.length !== 3) {
          logger.debug(`Invalid date format: ${entry.date}`);
          continue;
        }

        const [day, month, year] = dateParts;
        const documentDate = new Date(`${year}-${month}-${day}`);

        // Filter by date range
        if (documentDate > this.endDate) continue;
        if (documentDate < this.startDate) continue;

        // Extract edition number from title (e.g., "IOMO 2943" -> "2943")
        const editionMatch = entry.title.match(/IOMO\s*(\d+[a-zA-Z]*)/i);
        const editionNumber = editionMatch ? editionMatch[1] : undefined;

        // Check for extra edition (title contains 'a', 'b', etc. after number)
        const isExtra = /\d+[a-zA-Z]/.test(entry.title);

        const gazette: Gazette = {
          date: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
          fileUrl: entry.url,
          territoryId: this.config.territoryId,
          scrapedAt: new Date().toISOString(),
          editionNumber,
          isExtraEdition: isExtra,
          power: 'executive',
        };

        gazettes.push(gazette);
      }

      // Remove duplicates by fileUrl
      const uniqueGazettes = Array.from(
        new Map(gazettes.map(g => [g.fileUrl, g])).values()
      );

      logger.info(`Successfully crawled ${uniqueGazettes.length} gazettes for ${this.config.name}`);
      return uniqueGazettes;
    } catch (error) {
      logger.error(`Error crawling Osasco gazettes: ${error}`);
      return gazettes;
    }
  }
}

