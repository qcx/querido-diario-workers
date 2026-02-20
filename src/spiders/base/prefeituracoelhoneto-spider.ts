import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
  PrefeituraCoelhoNetoConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";

/**
 * Spider for Prefeitura de Coelho Neto - MA
 *
 * Site: dom.coelhoneto.ma.gov.br
 *
 * The site displays a paginated list of gazette editions.
 * PDFs follow the pattern: /DOM/DOM{YYYYMMDD}.pdf or /DOM/DOM{YYYYMMDD}-a.pdf
 * 
 * Total editions: 1627+ (as of Jan 2026)
 * Law: Lei N° 709/2018
 */
export class PrefeituraCoelhoNetoSpider extends BaseSpider {
  protected config: PrefeituraCoelhoNetoConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeituraCoelhoNetoConfig;

    if (!this.config.baseUrl) {
      throw new Error(
        `PrefeituraCoelhoNetoSpider requires baseUrl in config for ${spiderConfig.name}`,
      );
    }

    logger.info(
      `Initializing PrefeituraCoelhoNetoSpider for ${spiderConfig.name} with URL: ${this.config.baseUrl}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling ${this.config.baseUrl} for ${this.spiderConfig.name}...`,
    );

    const gazettes: Gazette[] = [];
    const baseUrl = new URL(this.config.baseUrl);
    const origin = baseUrl.origin;

    try {
      // Fetch the main page to get gazette list
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
      
      // Parse the table to extract gazette data
      // Pattern: Volume X - Nº. XXXX/YYYY|DD/MM/YYYY [link to PDF]
      // PDF links: /DOM/DOM{YYYYMMDD}.pdf or /DOM/DOM{YYYYMMDD}-a.pdf
      
      // Match PDF links with dates
      const pdfLinkRegex = /\[?\*?\*?\]\((https?:\/\/dom\.coelhoneto\.ma\.gov\.br\/DOM\/DOM(\d{8})(?:-[a-z])?\.pdf)\)/g;
      
      let match;
      while ((match = pdfLinkRegex.exec(html)) !== null) {
        const [, pdfUrl, dateCode] = match;
        
        // Parse date from YYYYMMDD format
        const year = dateCode.substring(0, 4);
        const month = dateCode.substring(4, 6);
        const day = dateCode.substring(6, 8);
        const date = `${year}-${month}-${day}`;
        
        // Check if date is in range
        if (!this.isInDateRange(new Date(date))) continue;
        
        // Try to extract edition number from context
        const editionMatch = html.match(new RegExp(`Nº\\.?\\s*(\\d+)\\/${year}[^]*?${dateCode}`, "i"));
        const editionNumber = editionMatch ? editionMatch[1] : undefined;
        
        // Avoid duplicates
        if (!gazettes.some(g => g.fileUrl === pdfUrl)) {
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
      }

      // Alternative pattern if markdown links not found
      if (gazettes.length === 0) {
        // Try to find direct PDF URLs
        const directPdfRegex = /(https?:\/\/dom\.coelhoneto\.ma\.gov\.br\/DOM\/DOM(\d{8})(?:-[a-z])?\.pdf)/g;
        
        while ((match = directPdfRegex.exec(html)) !== null) {
          const [, pdfUrl, dateCode] = match;
          
          const year = dateCode.substring(0, 4);
          const month = dateCode.substring(4, 6);
          const day = dateCode.substring(6, 8);
          const date = `${year}-${month}-${day}`;
          
          if (!this.isInDateRange(new Date(date))) continue;
          
          if (!gazettes.some(g => g.fileUrl === pdfUrl)) {
            gazettes.push({
              date,
              fileUrl: pdfUrl,
              territoryId: this.spiderConfig.territoryId,
              power: "executive",
              isExtraEdition: false,
              scrapedAt: new Date().toISOString(),
            });
          }
        }
      }

      // Try pagination if we have date range requirements
      // The site uses /diario/?page=X for pagination
      if (this.dateRange) {
        let page = 2;
        const maxPages = 100; // Safety limit
        
        while (page <= maxPages) {
          const pageUrl = `${origin}/diario/?page=${page}`;
          
          try {
            const pageResponse = await fetch(pageUrl, {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                Accept:
                  "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
              },
            });
            
            if (!pageResponse.ok) break;
            
            const pageHtml = await pageResponse.text();
            
            // Check if page has content
            if (!pageHtml.includes("/DOM/DOM")) break;
            
            const pagePdfRegex = /(https?:\/\/dom\.coelhoneto\.ma\.gov\.br\/DOM\/DOM(\d{8})(?:-[a-z])?\.pdf)/g;
            let foundInRange = false;
            let oldestDate: Date | null = null;
            
            while ((match = pagePdfRegex.exec(pageHtml)) !== null) {
              const [, pdfUrl, dateCode] = match;
              
              const year = dateCode.substring(0, 4);
              const month = dateCode.substring(4, 6);
              const day = dateCode.substring(6, 8);
              const date = `${year}-${month}-${day}`;
              const dateObj = new Date(date);
              
              if (!oldestDate || dateObj < oldestDate) {
                oldestDate = dateObj;
              }
              
              if (!this.isInDateRange(dateObj)) continue;
              
              foundInRange = true;
              
              if (!gazettes.some(g => g.fileUrl === pdfUrl)) {
                gazettes.push({
                  date,
                  fileUrl: pdfUrl,
                  territoryId: this.spiderConfig.territoryId,
                  power: "executive",
                  isExtraEdition: false,
                  scrapedAt: new Date().toISOString(),
                });
              }
            }
            
            // If oldest date on page is before our range start, stop pagination
            if (oldestDate && this.dateRange.start && oldestDate < this.dateRange.start) {
              break;
            }
            
            page++;
          } catch {
            break;
          }
        }
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
