import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  PrefeituraPresidenteDutraConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";

/**
 * Spider for Prefeitura de Presidente Dutra - MA
 *
 * Site: presidentedutra.ma.gov.br/transparencia/diario-oficial
 *
 * The site displays a table with all gazette editions.
 * PDFs follow the pattern: /anexos/diarios/Diário_{DD-MM-YYYY}_PMPD_{HASH}.pdf
 * 
 * Total editions: 1253+ (as of Jan 2026)
 * ISSN: 2965-4483
 */
export class PrefeituraPresidenteDutraSpider extends BaseSpider {
  protected config: PrefeituraPresidenteDutraConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeituraPresidenteDutraConfig;

    if (!this.config.baseUrl) {
      throw new Error(
        `PrefeituraPresidenteDutraSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeituraPresidenteDutraSpider for ${spiderConfig.name} with URL: ${this.config.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.config.baseUrl} for ${this.spiderConfig.name}...`,
    );

    const gazettes: Gazette[] = [];

    try {
      const response = await fetch(this.config.baseUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const html = await response.text();
      
      // The site uses relative links in href attributes:
      // href="/anexos/diarios/Diário_28-01-2026_PMPD_697a91bdce07c.pdf"
      const baseUrl = new URL(this.config.baseUrl);
      const origin = baseUrl.origin; // https://presidentedutra.ma.gov.br
      
      // Extract all PDF URLs from href attributes (relative or absolute)
      // Pattern: href="/anexos/diarios/..." or href="https://..."
      const urlRegex = /href=["']([^"']*\/anexos\/diarios\/[^"']+\.pdf)["']/gi;
      
      let match;
      const seenUrls = new Set<string>();
      
      while ((match = urlRegex.exec(html)) !== null) {
        let pdfPath = match[1];
        
        // Convert relative URL to absolute
        let pdfUrl: string;
        if (pdfPath.startsWith("http")) {
          pdfUrl = pdfPath;
        } else {
          pdfUrl = `${origin}${pdfPath}`;
        }
        
        // Decode URL-encoded characters for processing
        const decodedUrl = decodeURIComponent(pdfUrl);
        
        // Skip if already processed
        if (seenUrls.has(decodedUrl)) continue;
        seenUrls.add(decodedUrl);
        
        // Try to extract date from URL
        // Pattern 1: Diário_DD-MM-YYYY_PMPD (with accent or URL encoded)
        // Pattern 2: diario_XXXX_PMPD (old pattern - edition number only)
        let date: string | null = null;
        let editionNumber: string | undefined;
        
        // Try pattern with date in filename: Diário_DD-MM-YYYY_PMPD
        const dateMatch = decodedUrl.match(/Di[aá]rio[_-](\d{2})-(\d{2})-(\d{4})[_-]PMPD/i);
        if (dateMatch) {
          const [, day, month, year] = dateMatch;
          date = `${year}-${month}-${day}`;
        }
        
        // Try old pattern: diario_XXXX_PMPD (no date in filename)
        if (!date) {
          const oldPatternMatch = decodedUrl.match(/diario[_-](\d{4})[_-]PMPD/i);
          if (oldPatternMatch) {
            editionNumber = oldPatternMatch[1];
            // Can't determine date from this pattern, skip
            continue;
          }
        }
        
        if (!date) continue;
        
        // Check if date is in range
        if (!this.isInDateRange(new Date(date))) continue;
        
        gazettes.push({
          date,
          fileUrl: pdfUrl,
          territoryId: this.spiderConfig.territoryId,
          editionNumber,
          power: "executive",
          isExtraEdition: false,
          scrapedAt: new Date().toISOString(),
        });
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`,
      );
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
      throw error;
    }

    return gazettes;
  }
}
