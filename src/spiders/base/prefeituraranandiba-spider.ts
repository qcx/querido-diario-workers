import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraNarandibaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { parse } from 'node-html-parser';
import { toISODate } from '../../utils/date-utils';

/**
 * Spider for Prefeitura de Narandiba official gazette
 * 
 * Simple HTML page with all gazettes listed on a single page
 * No pagination or filtering needed - all items are displayed
 * 
 * The site structure:
 * 1. Navigate to baseUrl: https://www.donarandiba.com.br/paginas/diario.php
 * 2. Each gazette is in a <div class="row"> element
 * 3. Structure:
 *    - Title: <p> with "Diário Eletrônico do Município de Narandiba - Edição {NUMBER}"
 *    - Date: <p> with "Publicado em DD/MM/YYYY às HH:MM:SS"
 *    - PDF link: <a href="..."> appears twice (image and text "CLIQUE AQUI PARA VISUALIZAR")
 *    - Separated by <hr />
 */
export class PrefeituraNarandibaSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraNarandibaConfig;
    this.baseUrl = platformConfig.baseUrl;
  }

  /**
   * Parse date from "Publicado em DD/MM/YYYY às HH:MM:SS" format
   */
  private parseDate(dateStr: string): Date | null {
    // Match pattern: "Publicado em DD/MM/YYYY às HH:MM:SS"
    const match = dateStr.match(/Publicado em\s+(\d{2})\/(\d{2})\/(\d{4})/i);
    if (!match) {
      return null;
    }

    const [, day, month, year] = match;
    return new Date(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10)
    );
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura Narandiba for ${this.config.name}...`);

    try {
      // Fetch the page
      logger.debug(`Fetching: ${this.baseUrl}`);
      const response = await fetch(this.baseUrl);
      this.requestCount++;

      if (!response.ok) {
        throw new Error(`Failed to fetch ${this.baseUrl}: ${response.status} ${response.statusText}`);
      }

      const html = await response.text();
      const root = parse(html);

      // Find all row divs that contain gazette information
      // Each gazette is in a <div class="row"> followed by an <hr />
      const rows = root.querySelectorAll('.row');

      logger.debug(`Found ${rows.length} row elements`);

      for (const row of rows) {
        try {
          // Check if this row contains a gazette (has the title pattern)
          const titleElement = row.querySelector('p[style*="font-size: 30px"][style*="font-weight: bold"]');
          if (!titleElement) {
            continue;
          }

          const titleText = titleElement.text.trim();
          
          // Check if it's a gazette title
          if (!titleText.includes('Diário Eletrônico') || !titleText.includes('Edição')) {
            continue;
          }

          // Extract edition number from title (e.g., "Edição 879")
          const editionMatch = titleText.match(/[Ee]di[çc][ãa]o\s+(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;

          // Extract date from paragraph containing "Publicado em"
          // Find all paragraphs and look for one with "Publicado em" text
          const allParagraphs = row.querySelectorAll('p');
          let dateParagraph = null;
          let dateText = '';
          
          for (const p of Array.from(allParagraphs)) {
            const text = p.text.trim();
            if (text.includes('Publicado em')) {
              dateParagraph = p;
              dateText = text;
              break;
            }
          }
          
          if (!dateParagraph || !dateText) {
            logger.warn(`No date paragraph found for gazette: ${titleText}`);
            continue;
          }

          const gazetteDate = this.parseDate(dateText);

          if (!gazetteDate) {
            logger.warn(`Could not parse date from: ${dateText}`);
            continue;
          }

          // Check if date is in range
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }

          // Find PDF link - look for link with "CLIQUE AQUI PARA VISUALIZAR" text
          // or any link in the col-sm-2 div that contains a PDF URL
          const pdfLink = row.querySelector('a[href*=".pdf"]');
          
          if (!pdfLink) {
            logger.warn(`No PDF link found for gazette: ${titleText}`);
            continue;
          }

          let pdfUrl = pdfLink.getAttribute('href');
          if (!pdfUrl) {
            continue;
          }

          // Construct full URL if relative
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }

          // Skip if PDF URL is just a directory (some entries have incomplete links)
          if (pdfUrl.endsWith('/') || !pdfUrl.includes('.pdf')) {
            logger.warn(`Invalid PDF URL for gazette: ${titleText} - ${pdfUrl}`);
            continue;
          }

          // Create gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber,
            power: 'executive_legislative',
            sourceText: titleText || `Edição ${editionNumber || 'N/A'} - ${dateText}`,
          });

          if (gazette) {
            gazettes.push(gazette);
            logger.debug(`Created gazette: Edição ${editionNumber} - ${toISODate(gazetteDate)}`);
          }

        } catch (error) {
          logger.error(`Error processing gazette row:`, error as Error);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from Prefeitura Narandiba`);

    } catch (error) {
      logger.error(`Error crawling Prefeitura Narandiba:`, error as Error);
      throw error;
    }

    return gazettes;
  }
}

