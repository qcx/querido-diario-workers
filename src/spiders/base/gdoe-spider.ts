import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Configuration for GDOE platform spider
 */
export interface GdoeConfig {
  type: 'gdoe';
  /** Base URL for the GDOE platform (e.g., "https://www.gdoe.com.br/assis") */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Spider for GDOE platform (Ordem Pública Tecnologia)
 * Used by municipalities like Assis and Artur Nogueira
 * 
 * Uses Cloudflare Browser Rendering (Puppeteer) to handle:
 * - JavaScript-driven content loading
 * - Dynamic list of gazettes
 * - PDF links on detail pages
 * 
 * Site structure:
 * - List of gazettes with links containing date and edition info
 * - Pattern: "DD/MM/YYYY - Ano XX Edição nº XXXX (X páginas)"
 * - Links format: ./publicacao/?arq={hash}.pdf
 * - Real PDF URL: https://gdoe.nyc3.digitaloceanspaces.com/diarios/{citySlug}/{hash}.pdf
 */
export class GdoeSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;
  private citySlug: string;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as GdoeConfig;
    this.baseUrl = platformConfig.baseUrl;
    this.browser = browser || null;
    
    // Extract city slug from base URL (e.g., "arturnogueira" from "https://www.gdoe.com.br/arturnogueira")
    const urlParts = this.baseUrl.replace(/\/$/, '').split('/');
    this.citySlug = urlParts[urlParts.length - 1];
    
    if (!this.baseUrl) {
      throw new Error(`GdoeSpider requires baseUrl in config for ${config.name}`);
    }
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(`GdoeSpider for ${this.config.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling GDOE for ${this.config.name}...`);

    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      
      // Navigate to base URL and extract all gazette info
      await page.goto(this.baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      await new Promise(resolve => setTimeout(resolve, 2000));
      this.requestCount++;
      
      // Close modal if present by clicking outside or pressing Escape
      try {
        await page.keyboard.press('Escape');
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (e) {
        // Ignore if no modal
      }
      
      // Extract gazette data from all visible links using the HTML structure
      const allGazetteData = await page.evaluate(() => {
        const results: Array<{
          dateStr: string;
          editionNumber: string;
          isExtra: boolean;
          pdfHash: string;
          linkText: string;
        }> = [];
        
        // Find all gazette download links (class btn-download)
        const downloadLinks = document.querySelectorAll('a.btn-download[href*="publicacao"]');
        
        for (const link of Array.from(downloadLinks)) {
          const href = (link as HTMLAnchorElement).getAttribute('href') || '';
          const text = (link as HTMLElement).textContent || '';
          
          // Extract hash from href (e.g., "./publicacao/?arq=6945d7365f6a7.pdf" -> "6945d7365f6a7")
          const hashMatch = href.match(/arq=([a-f0-9]+)\.pdf/i);
          if (!hashMatch) continue;
          
          const pdfHash = hashMatch[1];
          
          // Extract date from text (e.g., "19/12/2025")
          const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) continue;
          
          const dateStr = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;
          
          // Extract edition number (e.g., "966" or "965-A")
          const editionMatch = text.match(/Edi[çc][ãa]o\s+n[°º]?\s*(\d+[A-Za-z-]*)/i);
          const editionNumber = editionMatch ? editionMatch[1] : '';
          
          // Check if extra edition
          const isExtra = editionNumber.includes('-') || /[A-Za-z]$/.test(editionNumber);
          
          results.push({
            dateStr,
            editionNumber,
            isExtra,
            pdfHash,
            linkText: text.trim().replace(/\s+/g, ' ')
          });
        }
        
        return results;
      });
      
      logger.info(`Found ${allGazetteData.length} gazette entries on page`);
      
      // Filter by date range and create gazette objects
      for (const gazetteData of allGazetteData) {
        try {
          // Parse date from DD/MM/YYYY format
          const [day, month, year] = gazetteData.dateStr.split('/').map(Number);
          const gazetteDate = new Date(year, month - 1, day);
          
          // Check if within date range
          const startDate = new Date(this.startDate);
          const endDate = new Date(this.endDate);
          
          // Normalize dates to midnight for comparison
          gazetteDate.setHours(0, 0, 0, 0);
          startDate.setHours(0, 0, 0, 0);
          endDate.setHours(0, 0, 0, 0);
          
          if (gazetteDate < startDate || gazetteDate > endDate) {
            logger.debug(`Skipping gazette from ${gazetteData.dateStr} - outside date range`);
            continue;
          }
          
          // Build the real PDF URL from DigitalOcean Spaces
          const pdfUrl = `https://gdoe.nyc3.digitaloceanspaces.com/diarios/${this.citySlug}/${gazetteData.pdfHash}.pdf`;
          
          const cleanEditionNumber = gazetteData.editionNumber.replace(/[^0-9]/g, '');
          
          const platformConfig = this.config.config as GdoeConfig;
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber: cleanEditionNumber || undefined,
            isExtraEdition: gazetteData.isExtra,
            power: 'executive_legislative',
            requiresClientRendering: platformConfig.requiresClientRendering || true,
          });
          
          if (gazette) {
            gazettes.push(gazette);
            logger.info(`Found gazette: ${pdfUrl} (Date: ${gazetteData.dateStr}, Edition: ${gazetteData.editionNumber || 'N/A'})`);
          }
        } catch (error) {
          logger.warn(`Failed to process gazette data:`, error as Error);
        }
      }
      
      // If no gazettes found on first page, try pagination
      if (gazettes.length === 0) {
        logger.debug('No gazettes found on first page, checking if pagination needed');
        
        // Check for pagination and iterate through pages if needed
        const hasMorePages = await page.evaluate(() => {
          const pagination = document.querySelector('.pagination');
          return pagination !== null;
        });
        
        if (hasMorePages) {
          logger.debug('Pagination found, but limiting to first page for efficiency');
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from GDOE`);
      
    } catch (error) {
      logger.error(`Error crawling GDOE:`, error as Error);
      throw error;
    } finally {
      // Clean up
      if (page) {
        try {
          await page.close();
        } catch (e) {
          logger.warn('Error closing page', e as Error);
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (e) {
          logger.warn('Error closing browser', e as Error);
        }
      }
    }

    return gazettes;
  }

  /**
   * Format date for API search (DD/MM/YYYY)
   */
  private formatDateForApi(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }

  /**
   * Format date for display matching (DD/MM/YYYY)
   */
  private formatDateDisplay(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }
}
