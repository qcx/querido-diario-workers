import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituramontesclarosConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';
import * as cheerio from 'cheerio';

/**
 * Spider for Montes Claros (MG) official gazette
 * 
 * Site Structure:
 * - Base URL: https://diariooficial.montesclaros.mg.gov.br/
 * - Uses BEE platform (custom municipal portal system)
 * - Listing pages: /exercicio-{YYYY} for each year
 * - Gazette pages: /{YYYY}/{mes}/{slug} with JS redirect to PDF
 * - PDFs hosted on: https://admin.montesclaros.mg.gov.br/upload/diario-oficial/files/edicoes/
 * 
 * The site displays gazette links that redirect via JavaScript to PDF files.
 * Each gazette page contains a script tag with window.location redirect to the PDF.
 */
export class PrefeituramontesclarosSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const mcConfig = config.config as PrefeituramontesclarosConfig;
    this.baseUrl = mcConfig.baseUrl || 'https://diariooficial.montesclaros.mg.gov.br';
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    logger.info(`Crawling ${this.baseUrl} for ${this.config.name} with date range ${this.startDate.toISOString()} to ${this.endDate.toISOString()}`);

    try {
      // Determine which years we need to crawl based on date range
      // Use UTC methods since dates are created at UTC midnight
      const startYear = this.startDate.getUTCFullYear();
      const endYear = this.endDate.getUTCFullYear();

      for (let year = startYear; year <= endYear; year++) {
        const yearGazettes = await this.crawlYear(year);
        gazettes.push(...yearGazettes);
      }

    } catch (error) {
      logger.error(`Error crawling Montes Claros: ${error}`);
    }

    logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`);
    return gazettes;
  }

  /**
   * Crawl all gazettes for a specific year
   */
  private async crawlYear(year: number): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    try {
      // Fetch the exercise page for this year
      const exerciseUrl = `${this.baseUrl}/exercicio-${year}`;
      logger.debug(`Fetching exercise page: ${exerciseUrl}`);

      const response = await fetch(exerciseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (!response.ok) {
        logger.warn(`Failed to fetch exercise page for ${year}: ${response.status}`);
        return gazettes;
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Find all gazette links - they contain patterns like "diario-oficial-eletronico-DDMMYYYY"
      const gazetteLinks: { url: string; title: string }[] = [];

      $('a[href*="diario-oficial-eletronico"]').each((_, element) => {
        const href = $(element).attr('href');
        const title = $(element).text().trim();
        if (href && title) {
          gazetteLinks.push({ url: href, title });
        }
      });

      logger.debug(`Found ${gazetteLinks.length} gazette links for year ${year}`);

      // Process each gazette link
      for (const link of gazetteLinks) {
        const gazette = await this.processGazetteLink(link.url, link.title);
        if (gazette) {
          // Check if the gazette date is within our date range
          const gazetteDate = new Date(gazette.date);
          if (gazetteDate >= this.startDate && gazetteDate <= this.endDate) {
            gazettes.push(gazette);
            logger.debug(`Found gazette: ${gazette.date} - ${link.title}`);
          }
        }
      }

    } catch (error) {
      logger.error(`Error crawling year ${year}: ${error}`);
    }

    return gazettes;
  }

  /**
   * Process a single gazette link to extract the PDF URL
   */
  private async processGazetteLink(url: string, title: string): Promise<Gazette | null> {
    try {
      // Ensure the URL is absolute
      const fullUrl = url.startsWith('http') ? url : `${this.baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;

      // Fetch the gazette page
      const response = await fetch(fullUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (!response.ok) {
        logger.debug(`Failed to fetch gazette page: ${fullUrl} - ${response.status}`);
        return null;
      }

      const html = await response.text();

      // Extract PDF URL from the JavaScript redirect
      // Pattern: window.location = 'https://admin.montesclaros.mg.gov.br/upload/.../...pdf'
      const pdfMatch = html.match(/window\.location\s*=\s*['"]([^'"]+\.pdf)['"]/i);
      
      if (!pdfMatch || !pdfMatch[1]) {
        // Try alternative pattern - sometimes it's a direct link
        const altMatch = html.match(/href\s*=\s*['"]([^'"]+\.pdf)['"]/i);
        if (!altMatch || !altMatch[1]) {
          logger.debug(`No PDF URL found in gazette page: ${fullUrl}`);
          return null;
        }
        return this.buildGazetteFromTitle(altMatch[1], title);
      }

      return this.buildGazetteFromTitle(pdfMatch[1], title);

    } catch (error) {
      logger.debug(`Error processing gazette link ${url}: ${error}`);
      return null;
    }
  }

  /**
   * Build a Gazette object from the extracted PDF URL and title
   */
  private buildGazetteFromTitle(pdfUrl: string, title: string): Gazette | null {
    try {
      // Parse the date from the title
      // Examples: "Diário Oficial Eletrônico 07/01/2026", "Diário Oficial Eletrônico 07/01/2026 - Edição Extra"
      const dateMatch = title.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (!dateMatch) {
        logger.debug(`Could not parse date from title: ${title}`);
        return null;
      }

      const day = dateMatch[1];
      const month = dateMatch[2];
      const year = dateMatch[3];
      const dateStr = `${year}-${month}-${day}`;

      // Check if it's an extra edition
      const isExtraEdition = title.toLowerCase().includes('extra');

      const gazette: Gazette = {
        date: dateStr,
        fileUrl: pdfUrl,
        territoryId: this.config.territoryId,
        scrapedAt: new Date().toISOString(),
        isExtraEdition: isExtraEdition,
        power: 'executive',
      };

      return gazette;

    } catch (error) {
      logger.debug(`Error creating gazette from PDF URL ${pdfUrl}: ${error}`);
      return null;
    }
  }
}

