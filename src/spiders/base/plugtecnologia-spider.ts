import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PlugTecnologiaConfig } from '../../types';
import { logger } from '../../utils/logger';
// @ts-ignore
import { parse } from 'node-html-parser';

/**
 * Spider for Plug Tecnologia transparency portal
 * 
 * Site Structure:
 * - Main page: /transparencia/exibir/{CATEGORY_ID}/0/1/{SLUG} - shows year folders
 * - Year folder: /transparencia/exibir/{CATEGORY_ID}/{FOLDER_ID}/1/{SLUG} - shows gazette list
 * - Each gazette has: title, date, download link (/transparencia/download/{FILE_ID})
 * - Download URL redirects to actual PDF
 * 
 * Example URL: https://miracema.plugtecnologia.com.br/transparencia/exibir/20/0/1/boletim-oficial
 */
export class PlugTecnologiaSpider extends BaseSpider {
  protected platformConfig: PlugTecnologiaConfig;
  private baseUrl: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.platformConfig = spiderConfig.config as PlugTecnologiaConfig;

    if (!this.platformConfig.baseUrl) {
      throw new Error(`PlugTecnologiaSpider requires baseUrl in config for ${spiderConfig.name}`);
    }

    this.baseUrl = this.platformConfig.baseUrl;
    logger.info(`Initializing PlugTecnologiaSpider for ${spiderConfig.name} with baseUrl: ${this.baseUrl}`);
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      logger.info(`Crawling Plug Tecnologia gazettes from ${this.baseUrl}`);
      
      // Step 1: Get the main page to find year folders
      const mainPageHtml = await this.fetch(this.baseUrl);
      const yearFolders = this.extractYearFolders(mainPageHtml);
      
      logger.info(`Found ${yearFolders.length} year folders: ${yearFolders.map(y => y.year).join(', ')}`);
      
      // Step 2: Determine which years we need based on date range
      const startYear = this.startDate.getFullYear();
      const endYear = this.endDate.getFullYear();
      
      const relevantYears = yearFolders.filter(y => y.year >= startYear && y.year <= endYear);
      logger.info(`Processing ${relevantYears.length} relevant years for date range: ${relevantYears.map(y => y.year).join(', ')}`);
      
      // Step 3: For each relevant year, fetch the page and extract gazettes
      for (const yearInfo of relevantYears) {
        try {
          const yearGazettes = await this.crawlYearPage(yearInfo.url, yearInfo.year);
          gazettes.push(...yearGazettes);
        } catch (error) {
          logger.error(`Error crawling year ${yearInfo.year}: ${error}`);
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from Plug Tecnologia`);
      return gazettes;
    } catch (error) {
      logger.error(`Error crawling Plug Tecnologia: ${error}`);
      throw error;
    }
  }

  /**
   * Extract year folders from the main page
   * Each folder has a year name and a URL
   */
  private extractYearFolders(html: string): Array<{ year: number; url: string }> {
    const root = parse(html);
    const folders: Array<{ year: number; url: string }> = [];
    
    // Find all rows with year numbers and their corresponding folder links
    const rows = root.querySelectorAll('tr');
    
    for (const row of rows) {
      // Look for cells with year numbers (e.g., "2025", "2024")
      const titleCell = row.querySelector('td.pl-3[scope="row"]');
      const linkCell = row.querySelector('a[title="Abrir pasta"]');
      
      if (titleCell && linkCell) {
        const yearText = titleCell.textContent?.trim() || '';
        const yearMatch = yearText.match(/^(20\d{2})$/);
        
        if (yearMatch) {
          const year = parseInt(yearMatch[1], 10);
          const href = linkCell.getAttribute('href');
          
          if (href) {
            folders.push({ year, url: href });
          }
        }
      }
    }
    
    // Sort by year descending
    return folders.sort((a, b) => b.year - a.year);
  }

  /**
   * Crawl a year page to extract all gazettes
   */
  private async crawlYearPage(url: string, year: number): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let currentUrl = url;
    let pageNum = 1;
    
    while (currentUrl) {
      logger.debug(`Crawling year ${year}, page ${pageNum}: ${currentUrl}`);
      
      const html = await this.fetch(currentUrl);
      const pageGazettes = await this.extractGazettesFromPage(html, year);
      
      gazettes.push(...pageGazettes);
      
      // Check for pagination (next page link)
      const nextUrl = this.extractNextPageUrl(html, currentUrl);
      
      if (nextUrl && nextUrl !== currentUrl) {
        currentUrl = nextUrl;
        pageNum++;
      } else {
        break;
      }
    }
    
    logger.info(`Found ${gazettes.length} gazettes for year ${year}`);
    return gazettes;
  }

  /**
   * Extract gazettes from a page
   */
  private async extractGazettesFromPage(html: string, year: number): Promise<Gazette[]> {
    const root = parse(html);
    const gazettes: Gazette[] = [];
    
    // Find all table rows with gazette data
    const rows = root.querySelectorAll('tr');
    
    for (const row of rows) {
      // Find rows with gazette entries (have title, date, and download link)
      const cells = row.querySelectorAll('td');
      const downloadLink = row.querySelector('a[title="Download do arquivo"]');
      
      if (cells.length >= 2 && downloadLink) {
        try {
          // Extract title from first cell
          const titleCell = cells[0];
          const title = titleCell.textContent?.trim() || '';
          
          // Extract date from second cell (format: DD/MM/YYYY)
          const dateCell = cells[1];
          const dateText = dateCell.textContent?.trim() || '';
          
          // Extract download URL
          const downloadUrl = downloadLink.getAttribute('href');
          
          if (!downloadUrl || !dateText) {
            continue;
          }
          
          // Parse date (format: DD/MM/YYYY)
          const date = this.parseDate(dateText);
          
          if (!date) {
            logger.debug(`Could not parse date: ${dateText}`);
            continue;
          }
          
          // Check if date is within range
          if (!this.isInDateRange(date)) {
            continue;
          }
          
          // Extract edition number from title if present (e.g., "B.O 650 29.12.2025")
          const editionMatch = title.match(/B\.O\s*(\d+)/i) || title.match(/(\d+)[ªº]?\s*Edi[çc][ãa]o/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;
          
          // Create gazette
          const gazette = await this.createGazette(date, downloadUrl, {
            editionNumber,
            sourceText: title,
          });
          
          if (gazette) {
            gazettes.push(gazette);
            logger.debug(`Found gazette: ${title} - ${dateText}`);
          }
        } catch (error) {
          logger.debug(`Error processing row: ${error}`);
        }
      }
    }
    
    return gazettes;
  }

  /**
   * Extract next page URL from pagination
   */
  private extractNextPageUrl(html: string, currentUrl: string): string | null {
    const root = parse(html);
    
    // Look for pagination links - Plug Tecnologia uses page numbers in URL
    // URL pattern: /transparencia/exibir/{CAT_ID}/{FOLDER_ID}/{PAGE_NUM}/{SLUG}
    const paginationLinks = root.querySelectorAll('a[href*="/transparencia/exibir/"]');
    
    // Parse current page number from URL
    const pageMatch = currentUrl.match(/\/exibir\/\d+\/\d+\/(\d+)\//);
    const currentPage = pageMatch ? parseInt(pageMatch[1], 10) : 1;
    
    // Find link to next page
    for (const link of paginationLinks) {
      const href = link.getAttribute('href');
      if (!href) continue;
      
      const linkPageMatch = href.match(/\/exibir\/\d+\/\d+\/(\d+)\//);
      if (linkPageMatch) {
        const linkPage = parseInt(linkPageMatch[1], 10);
        if (linkPage === currentPage + 1) {
          return href;
        }
      }
    }
    
    return null;
  }

  /**
   * Parse date from Brazilian format (DD/MM/YYYY)
   */
  private parseDate(dateText: string): Date | null {
    const match = dateText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!match) return null;
    
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1; // JS months are 0-indexed
    const year = parseInt(match[3], 10);
    
    const date = new Date(year, month, day);
    
    // Validate the date
    if (isNaN(date.getTime())) return null;
    
    return date;
  }
}
