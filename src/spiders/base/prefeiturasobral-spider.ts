import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraSobralConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp } from '../../utils/date-utils';

interface GazetteEntry {
  edition: string;
  date: Date;
  pdfUrl: string;
}

/**
 * PrefeituraSobralSpider implementation
 * 
 * Crawls Sobral's official gazette website (DOM Sobral).
 * 
 * Site structure:
 * - Main page: https://www.sobral.ce.gov.br/diario/pesquisa
 * - PDF URL pattern: https://www.sobral.ce.gov.br/diario/public/files/diario/DOM{EDITION}_{DD-MM-YYYY}.pdf
 * 
 * Strategy:
 * 1. Fetch the main page to get the most recent gazettes and discover the latest edition number
 * 2. For date ranges that go beyond the first page, probe earlier editions by decrementing
 *    the edition number and checking each date in the range
 * 
 * Note: The site's pagination only works via JavaScript form submission, so we use
 * direct URL generation based on the predictable PDF URL pattern.
 */
export class PrefeituraSobralSpider extends BaseSpider {
  protected sobralConfig: PrefeituraSobralConfig;
  private readonly BASE_PDF_URL = 'https://www.sobral.ce.gov.br/diario/public/files/diario';

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.sobralConfig = spiderConfig.config as PrefeituraSobralConfig;
    
    if (!this.sobralConfig.baseUrl) {
      throw new Error(`PrefeituraSobralSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraSobralSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.sobralConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Step 1: Fetch the main page to get recent gazettes and the latest edition
      const recentEntries = await this.fetchRecentGazetteEntries();
      
      if (recentEntries.length === 0) {
        logger.warn(`No gazette entries found on main page for ${this.spiderConfig.name}`);
        return gazettes;
      }
      
      // Find the latest and oldest editions from the main page
      const sortedEntries = [...recentEntries].sort((a, b) => parseInt(b.edition) - parseInt(a.edition));
      const latestEdition = parseInt(sortedEntries[0].edition);
      const oldestEditionOnPage = parseInt(sortedEntries[sortedEntries.length - 1].edition);
      const oldestDateOnPage = sortedEntries[sortedEntries.length - 1].date;
      
      logger.info(`Found ${recentEntries.length} recent gazettes. Latest edition: ${latestEdition}, oldest on page: ${oldestEditionOnPage}`);
      
      // Collect all entries
      const allEntries: GazetteEntry[] = [...recentEntries];
      const seenUrls = new Set(recentEntries.map(e => e.pdfUrl));
      
      // Step 2: If the date range extends before the oldest date on the main page,
      // probe earlier editions
      const startDateStr = toISODate(this.startDate);
      const oldestDateOnPageStr = toISODate(oldestDateOnPage);
      
      if (startDateStr < oldestDateOnPageStr) {
        logger.info(`Date range starts before oldest gazette on page. Probing earlier editions...`);
        
        // Probe editions going backwards from the oldest on the page
        const olderEntries = await this.probeOlderEditions(
          oldestEditionOnPage - 1,
          this.startDate,
          oldestDateOnPage,
          seenUrls
        );
        
        allEntries.push(...olderEntries);
      }
      
      logger.info(`Found ${allEntries.length} total gazette entries, filtering by date range...`);
      
      // Filter by date range
      const endDateStr = toISODate(this.endDate);
      
      const filteredEntries = allEntries.filter(entry => {
        const entryDateStr = toISODate(entry.date);
        return entryDateStr >= startDateStr && entryDateStr <= endDateStr;
      });
      
      logger.info(`${filteredEntries.length} gazettes match the date range`, {
        startDate: startDateStr,
        endDate: endDateStr,
      });
      
      // Create gazette objects
      for (const entry of filteredEntries) {
        try {
          const gazette: Gazette = {
            date: toISODate(entry.date),
            fileUrl: entry.pdfUrl,
            territoryId: this.spiderConfig.territoryId,
            scrapedAt: getCurrentTimestamp(),
            editionNumber: entry.edition,
            isExtraEdition: false,
            power: 'executive_legislative',
            sourceText: `DOM Sobral - Edição ${entry.edition}`,
          };

          gazettes.push(gazette);
          logger.debug(`Found gazette for ${toISODate(entry.date)}: ${entry.pdfUrl}`);
        } catch (error) {
          logger.error(`Error creating gazette for ${toISODate(entry.date)}:`, error as Error);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Fetch gazette entries from the main page
   */
  private async fetchRecentGazetteEntries(): Promise<GazetteEntry[]> {
    const entries: GazetteEntry[] = [];
    
    try {
      const response = await fetch(this.sobralConfig.baseUrl, {
        method: 'GET',
        headers: this.getHeaders(),
      });
      
      if (!response.ok) {
        logger.error(`Failed to fetch page: ${response.status} ${response.statusText}`);
        return entries;
      }
      
      const html = await response.text();
      
      // Parse PDF links
      // Pattern: DOM{EDITION}_{DD-MM-YYYY}.pdf
      const pdfPattern = /href=["']([^"']*\/diario\/public\/files\/diario\/DOM(\d+)_(\d{2})-(\d{2})-(\d{4})\.pdf)["']/gi;
      
      let match;
      while ((match = pdfPattern.exec(html)) !== null) {
        const [, pdfPath, edition, day, month, year] = match;
        
        const date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));
        
        // Build absolute URL if needed
        let pdfUrl = pdfPath;
        if (pdfUrl.startsWith('/')) {
          pdfUrl = `https://www.sobral.ce.gov.br${pdfUrl}`;
        }
        
        // Avoid duplicates
        if (!entries.some(e => e.pdfUrl === pdfUrl)) {
          entries.push({
            edition,
            date,
            pdfUrl,
          });
        }
      }
      
      logger.debug(`Parsed ${entries.length} gazette entries from main page`);
      
    } catch (error) {
      logger.error(`Error fetching gazette entries: ${(error as Error).message}`);
    }
    
    return entries;
  }

  /**
   * Probe older editions by generating URLs and checking if they exist
   * This is needed because the site's pagination doesn't work via GET requests
   */
  private async probeOlderEditions(
    startEdition: number,
    targetStartDate: Date,
    stopBeforeDate: Date,
    seenUrls: Set<string>
  ): Promise<GazetteEntry[]> {
    const entries: GazetteEntry[] = [];
    let currentEdition = startEdition;
    let consecutiveNotFound = 0;
    const maxConsecutiveNotFound = 5; // Stop after 5 consecutive not found (reduced for speed)
    const maxEditionsToProbe = 100; // Safety limit (reduced for speed)
    let editionsProbed = 0;
    
    // Generate dates to check (all dates from targetStartDate to stopBeforeDate)
    const datesToCheck: Date[] = [];
    const currentDate = new Date(targetStartDate);
    while (currentDate < stopBeforeDate) {
      datesToCheck.push(new Date(currentDate));
      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }
    
    logger.debug(`Probing editions starting from ${startEdition}, checking ${datesToCheck.length} dates`);
    
    const targetStartDateStr = toISODate(targetStartDate);
    
    while (currentEdition > 0 && editionsProbed < maxEditionsToProbe && consecutiveNotFound < maxConsecutiveNotFound) {
      let foundAny = false;
      let foundDateBeforeRange = false;
      
      // Try each date for this edition
      for (const date of datesToCheck) {
        const day = String(date.getUTCDate()).padStart(2, '0');
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const year = date.getUTCFullYear();
        
        const pdfUrl = `${this.BASE_PDF_URL}/DOM${currentEdition}_${day}-${month}-${year}.pdf`;
        
        if (seenUrls.has(pdfUrl)) {
          continue;
        }
        
        // Check if the URL exists
        const exists = await this.checkUrlExists(pdfUrl);
        
        if (exists) {
          const foundDate = new Date(Date.UTC(year, date.getUTCMonth(), date.getUTCDate()));
          const foundDateStr = toISODate(foundDate);
          
          seenUrls.add(pdfUrl);
          entries.push({
            edition: String(currentEdition),
            date: foundDate,
            pdfUrl,
          });
          foundAny = true;
          consecutiveNotFound = 0;
          logger.debug(`Found gazette: DOM${currentEdition}_${day}-${month}-${year}.pdf`);
          
          // If we found a gazette at or before our target start date, we can stop
          if (foundDateStr <= targetStartDateStr) {
            foundDateBeforeRange = true;
          }
          
          break; // Each edition only has one date, so move to next edition
        }
      }
      
      // Stop if we've found gazettes before our target date range
      if (foundDateBeforeRange) {
        logger.debug(`Found gazette before target start date, stopping probe`);
        break;
      }
      
      if (!foundAny) {
        consecutiveNotFound++;
      }
      
      currentEdition--;
      editionsProbed++;
      
      // Small delay to be respectful to the server
      if (editionsProbed % 10 === 0) {
        await this.delay(50);
      }
    }
    
    logger.info(`Probed ${editionsProbed} editions, found ${entries.length} additional gazettes`);
    
    return entries;
  }

  /**
   * Check if a URL exists and is a PDF
   * The server returns 302 redirect for non-existent files, so we need to
   * check that we're not being redirected and that the content type is PDF
   */
  private async checkUrlExists(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        headers: this.getHeaders(),
        redirect: 'manual', // Don't follow redirects
      });
      
      // Only return true if we get a 200 OK (not a redirect)
      if (response.status !== 200) {
        return false;
      }
      
      // Verify it's actually a PDF
      const contentType = response.headers.get('content-type');
      return contentType?.includes('application/pdf') ?? false;
    } catch {
      return false;
    }
  }

  /**
   * Get HTTP headers for requests
   */
  private getHeaders(): Record<string, string> {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    };
  }

  /**
   * Simple delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
