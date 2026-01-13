import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import {
  SpiderConfig,
} from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";

/**
 * Configuration for Prefeitura de Betim spider
 */
export interface PrefeiturabetimConfig {
  type: 'prefeituraBetim';
  /** Base URL for the Prefeitura Betim diário oficial page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

interface CalendarApiResponse {
  status: string;
  mensagem: string;
  dados: {
    [day: string]: Array<{
      descricao: string;
      link: string;
    }>;
  };
}

/**
 * Spider for Prefeitura de Betim - MG
 *
 * Site Structure:
 * - URL: https://www.betim.mg.gov.br/portal/diario-oficial/
 * - API: /portal/calendario/diario_oficial/{month}/{year}/ - Returns JSON with editions by day
 * - Detail page: /portal/diario-oficial/ver/{id} - Contains PDF link
 * - PDFs: /uploads/diario_{hash}.pdf
 * 
 * API Response format:
 * {
 *   "status": "sucesso",
 *   "mensagem": "X registros foram encontrados.",
 *   "dados": {
 *     "6": [{"descricao": "Edição 3311", "link": "/portal/diario-oficial/ver/3939"}]
 *   }
 * }
 */
export class PrefeiturabetimSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeiturabetimConfig;
    this.baseUrl = platformConfig.baseUrl || "https://www.betim.mg.gov.br/portal/diario-oficial/";
    // Normalize baseUrl to get the domain
    const url = new URL(this.baseUrl);
    this.baseUrl = `${url.protocol}//${url.host}`;
    
    logger.debug(
      `PrefeiturabetimSpider initialized with baseUrl: ${this.baseUrl} for ${config.name}`
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
        `PrefeiturabetimSpider for ${this.config.name} requires browser binding`
      );
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura Betim for ${this.config.name}...`);

    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();

      // Get date range
      const startDate = new Date(this.startDate);
      const endDate = new Date(this.endDate);
      
      // Collect all months in the date range
      const months: { month: number; year: number }[] = [];
      const current = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      const end = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
      
      while (current <= end) {
        months.push({ month: current.getMonth() + 1, year: current.getFullYear() });
        current.setMonth(current.getMonth() + 1);
      }

      logger.debug(`Will fetch ${months.length} months of data`);

      // Fetch each month's data using the calendar API
      for (const { month, year } of months) {
        try {
          const calendarUrl = `${this.baseUrl}/portal/calendario/diario_oficial/${month}/${year}/`;
          logger.debug(`Fetching calendar: ${calendarUrl}`);
          
          // Navigate to calendar API (using browser to avoid potential issues)
          const response = await page.goto(calendarUrl, { 
            waitUntil: "networkidle0", 
            timeout: 30000 
          });
          this.requestCount++;

          if (!response) {
            logger.warn(`No response from calendar API for ${month}/${year}`);
            continue;
          }

          // Get JSON content
          const content = await page.evaluate(() => {
            // Try to get the pre/body text content
            const pre = document.querySelector('pre');
            if (pre) return pre.textContent;
            return document.body.textContent;
          });

          if (!content) {
            logger.warn(`Empty content from calendar API for ${month}/${year}`);
            continue;
          }

          let data: CalendarApiResponse;
          try {
            data = JSON.parse(content);
          } catch (e) {
            logger.warn(`Failed to parse calendar JSON for ${month}/${year}: ${content.substring(0, 100)}`);
            continue;
          }

          if (data.status !== 'sucesso' || !data.dados) {
            logger.debug(`No data for ${month}/${year}: ${data.mensagem}`);
            continue;
          }

          // Process each day's editions
          for (const [day, editions] of Object.entries(data.dados)) {
            for (const edition of editions) {
              const gazetteDate = new Date(year, month - 1, parseInt(day));
              
              // Check if date is in range
              if (!this.isInDateRange(gazetteDate)) {
                continue;
              }

              // Extract edition number from description (e.g., "Edição 3311")
              const editionMatch = edition.descricao.match(/Edição\s+(\d+)/i);
              const editionNumber = editionMatch ? editionMatch[1] : undefined;
              const isExtra = edition.descricao.toLowerCase().includes('extra');

              // Get PDF URL from detail page
              const detailUrl = `${this.baseUrl}${edition.link}`;
              logger.debug(`Fetching detail page: ${detailUrl}`);
              
              try {
                await page.goto(detailUrl, { waitUntil: "networkidle0", timeout: 30000 });
                this.requestCount++;

                // Extract PDF URL from the page
                const pdfUrl = await page.evaluate(() => {
                  // Look for PDF URL in the page
                  // Pattern: /uploads/diario_{hash}.pdf
                  const pageContent = document.documentElement.innerHTML;
                  const pdfMatch = pageContent.match(/uploads\/diario_[a-f0-9]+\.pdf/i);
                  if (pdfMatch) {
                    return pdfMatch[0];
                  }
                  
                  // Try looking for download link
                  const downloadLink = document.querySelector('a[href*="uploads/diario"]') as HTMLAnchorElement;
                  if (downloadLink) {
                    return downloadLink.href;
                  }
                  
                  return null;
                });

                if (!pdfUrl) {
                  logger.warn(`No PDF found on detail page: ${detailUrl}`);
                  continue;
                }

                // Build full PDF URL
                const fullPdfUrl = pdfUrl.startsWith('http') 
                  ? pdfUrl 
                  : `${this.baseUrl}/${pdfUrl}`;

                const gazette: Gazette = {
                  date: this.formatDate(gazetteDate),
                  fileUrl: fullPdfUrl,
                  territoryId: this.config.territoryId,
                  scrapedAt: new Date().toISOString(),
                  editionNumber: editionNumber,
                  isExtraEdition: isExtra,
                  power: "executive_legislative",
                };

                gazettes.push(gazette);
                logger.debug(`Found gazette: ${edition.descricao} - ${gazetteDate.toISOString().split('T')[0]}`);
                
              } catch (detailError) {
                logger.warn(`Error fetching detail page ${detailUrl}: ${detailError instanceof Error ? detailError.message : String(detailError)}`);
              }
            }
          }
        } catch (monthError) {
          logger.warn(`Error fetching month ${month}/${year}: ${monthError instanceof Error ? monthError.message : String(monthError)}`);
        }
      }

      logger.info(
        `Found ${gazettes.length} gazettes within date range for ${this.config.name}`
      );
    } catch (error) {
      logger.error(
        `Error crawling Prefeitura Betim for ${this.config.name}:`,
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
   * Format date as YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}
