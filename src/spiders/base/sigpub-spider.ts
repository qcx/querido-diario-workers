import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange, SigpubConfig } from "../../types";
import { logger } from "../../utils/logger";
import { toISODate } from "../../utils/date-utils";

/**
 * SigpubSpider for SIGPub/Vox Tecnologia platforms (AMUPE, APRECE, AEMERJ, etc.)
 *
 * IMPORTANT LIMITATION:
 * The SIGPub platform publishes CONSOLIDATED gazettes - all municipalities
 * publish in the same PDF. The entityId is used for search filtering in the
 * web interface (which requires reCAPTCHA), not for separate PDF downloads.
 *
 * Current approach:
 * - Downloads the consolidated gazette PDF from the main page
 * - The PDF contains publications from ALL member municipalities
 * - Text extraction/OCR would be needed to filter content per municipality
 *
 * Future improvements:
 * - Use browser rendering to navigate the calendar and search interface
 * - Implement OCR-based filtering to extract municipality-specific content
 */
export class SigpubSpider extends BaseSpider {
  protected sigpubConfig: SigpubConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.sigpubConfig = spiderConfig.config as SigpubConfig;
    const cityName = this.sigpubConfig.cityName || this.spiderConfig.name;
    logger.info(
      `Initializing SigpubSpider for ${cityName} with URL: ${this.sigpubConfig.url}, entityId: ${this.sigpubConfig.entityId}`,
    );
  }

  async crawl(): Promise<Gazette[]> {
    const cityName = this.sigpubConfig.cityName || this.spiderConfig.name;
    logger.info(
      `Crawling ${this.sigpubConfig.url} for ${cityName} (entityId: ${this.sigpubConfig.entityId})...`,
    );
    logger.warn(
      `Note: SIGPub uses consolidated PDFs. The gazette will contain all municipalities, not just ${cityName}.`,
    );
    const gazettes: Gazette[] = [];

    try {
      // Always use direct URL construction for now
      // TODO: Implement browser rendering when needed
      return await this.crawlWithDirectUrls();
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Crawl using Cloudflare Browser Rendering (Puppeteer)
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    logger.info("Using browser rendering for SIGPub crawling");

    // This would use Puppeteer via Cloudflare Browser Rendering
    // Example implementation:
    /*
    const page = await this.browser.newPage();
    
    try {
      // Navigate to the main page
      await page.goto(this.sigpubConfig.url, { waitUntil: 'networkidle0' });
      
      // Wait for calendar to load
      await page.waitForSelector('a[href*="voxtecnologia.com.br"]', { timeout: 10000 });
      
      // Extract all PDF links from the page
      const pdfLinks = await page.evaluate(() => {
        const links: Array<{url: string, text: string}> = [];
        
        document.querySelectorAll('a[href*="voxtecnologia.com.br"]').forEach(link => {
          const href = link.getAttribute('href');
          const text = link.textContent?.trim() || '';
          
          if (href && href.includes('.pdf') && !href.includes('.xml')) {
            links.push({ url: href, text });
          }
        });
        
        return links;
      });
      
      // Process each PDF link
      for (const link of pdfLinks) {
        // Extract date from URL (format: YYYY-MM-DD)
        const dateMatch = link.url.match(/(\d{4}-\d{2}-\d{2})/);
        
        if (dateMatch) {
          const dateStr = dateMatch[1];
          const gazetteDate = new Date(dateStr);
          
          if (this.isInDateRange(gazetteDate)) {
            // Check if it's an extraordinary edition
            const isExtra = link.text.toLowerCase().includes('extraordin');
            
            gazettes.push(this.createGazette(gazetteDate, link.url, {
              editionNumber: this.extractEditionNumber(link.text),
              isExtraEdition: isExtra,
              power: 'executive',
            }));
          }
        }
      }
      
    } finally {
      await page.close();
    }
    */

    logger.warn(
      "Browser rendering not implemented yet - using fallback method",
    );
    return await this.crawlWithDirectUrls();
  }

  /**
   * Crawl by constructing direct URLs (fallback method)
   *
   * This method attempts to fetch the main page and extract PDF links
   * directly from the HTML. Less reliable than browser rendering but
   * works without Puppeteer.
   *
   * NOTE: The PDFs found are CONSOLIDATED - they contain all municipalities.
   * The entityId is not used for filtering here (would require reCAPTCHA).
   */
  private async crawlWithDirectUrls(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const cityName = this.sigpubConfig.cityName || this.spiderConfig.name;
    const entityId = this.sigpubConfig.entityId;

    try {
      const response = await this.fetch(this.sigpubConfig.url);

      logger.debug(
        `Fetched HTML (first 500 chars): ${response.substring(0, 500)}`,
      );

      // Normalize HTML entities - pages return &amp; instead of &
      const normalizedHtml = response.replace(/&amp;/g, "&");

      // Extract PDF URLs from the HTML
      // Pattern: https://www-storage.voxtecnologia.com.br/?m=sigpub.publicacao&f=XXX&i=publicado_XXX_YYYY-MM-DD_hash.pdf
      const pdfUrlRegex =
        /https:\/\/www-storage\.voxtecnologia\.com\.br\/\?m=sigpub\.publicacao&f=(\d+)&i=publicado_(\d+)_(\d{4}-\d{2}-\d{2})_[a-f0-9]+\.pdf/g;

      const matches = normalizedHtml.matchAll(pdfUrlRegex);
      let matchCount = 0;
      const seenDates = new Set<string>();

      for (const match of matches) {
        matchCount++;
        const url = match[0];
        const pdfAssociationId = match[1]; // The association ID in the PDF URL (e.g., "365" for AMUPE)
        const pdfEditionId = match[2];
        const dateStr = match[3];
        const gazetteDate = new Date(dateStr + "T00:00:00.000Z"); // Force UTC to match range dates

        // Avoid duplicate gazettes for the same date
        if (seenDates.has(dateStr)) {
          continue;
        }

        logger.debug(
          `Match ${matchCount}: Date ${dateStr}, Association ID in PDF: ${pdfAssociationId}, Edition: ${pdfEditionId}`,
        );

        // Format date range for logging (handle both Date objects and strings)
        const startStr =
          this.dateRange.start instanceof Date
            ? toISODate(this.dateRange.start)
            : String(this.dateRange.start);
        const endStr =
          this.dateRange.end instanceof Date
            ? toISODate(this.dateRange.end)
            : String(this.dateRange.end);
        logger.debug(
          `Date range check: ${dateStr} is in range ${startStr} to ${endStr}? ${this.isInDateRange(gazetteDate)}`,
        );

        if (this.isInDateRange(gazetteDate)) {
          seenDates.add(dateStr);

          const gazette = await this.createGazette(gazetteDate, url, {
            editionNumber: pdfEditionId,
            isExtraEdition: false,
            power: "executive",
          });

          if (gazette) {
            // Add metadata about the consolidated nature
            gazette.notes = `Consolidated gazette from ${this.sigpubConfig.url}. Contains publications from multiple municipalities. EntityId for ${cityName}: ${entityId}`;
            gazettes.push(gazette);
          }
        }
      }

      logger.info(
        `Found ${gazettes.length} gazettes from ${matchCount} matches for ${cityName} using direct URL extraction`,
      );

      if (gazettes.length === 0 && matchCount > 0) {
        logger.warn(
          `Found ${matchCount} PDF URLs but none in the requested date range. The main page only shows the latest edition.`,
        );
      }
    } catch (error) {
      logger.error("Error in direct URL extraction:", error as Error);
    }

    return gazettes;
  }

  /**
   * Extract edition number from text
   */
  private extractEditionNumber(text: string): string {
    const match = text.match(/(?:edição|edicao)\s*(?:n[°º]?)?\s*(\d+)/i);
    return match ? match[1] : "N/A";
  }
}
