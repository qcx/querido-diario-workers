import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraBarueriConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { loadHTML } from '../../utils/html-parser';
import { logger } from '../../utils/logger';

/**
 * Spider for Prefeitura de Barueri official gazette (Jornal Oficial de Barueri - JOB)
 * 
 * The site uses a custom HTML structure with two sections:
 * 
 * 1. Carousel with 4 most recent editions (.container-diario):
 *    - Date in <div class="diarioTopoText"><b>DD/MM/YYYY</b></div>
 *    - Edition in <div class="diarioTopoText"><b>Edição:</b>XXXX</div>
 *    - PDF in <a class="acessarJornal" href="...pdf">
 *    - Type in <div class="diarioTopoText"><b>Distribuição:</b>Gratuita - Extraordinária</div>
 * 
 * 2. Table with older editions (.OutrosDiarios):
 *    - Date in <td><div><b>DD/MM/YYYY</b></div>...</td>
 *    - Edition + Type in same td: "Edição XXXX - Ano XX - Gratuita - Extraordinária"
 *    - PDF in <a href="...pdf" target="_blank">Download</a> in next td
 */
export class PrefeituraBarueriSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const barueriConfig = config.config as PrefeituraBarueriConfig;
    this.baseUrl = barueriConfig.baseUrl;
  }

  /**
   * Encode URL to handle spaces and special characters in PDF filenames
   * Barueri PDFs have spaces in filenames like "JOB -1938 EXTRA - 05Jan2026.pdf"
   */
  private encodeUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      // Encode the pathname to handle spaces
      urlObj.pathname = urlObj.pathname
        .split('/')
        .map(segment => encodeURIComponent(decodeURIComponent(segment)))
        .join('/');
      return urlObj.toString();
    } catch {
      // Fallback: replace spaces with %20
      return url.replace(/ /g, '%20');
    }
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    logger.info(`Crawling ${this.baseUrl} for ${this.config.name}...`);

    try {
      const response = await fetch(this.baseUrl);
      
      if (!response.ok) {
        logger.error(`Failed to fetch ${this.baseUrl}: ${response.status}`);
        return [];
      }

      const html = await response.text();
      const $ = loadHTML(html);

      // Section 1: Recent editions in carousel (.container-diario)
      $('.container-diario').each((_, element) => {
        try {
          const container = $(element);
          
          // Find PDF link
          const pdfLink = container.find('a.acessarJornal').attr('href');
          if (!pdfLink || !pdfLink.endsWith('.pdf')) {
            return;
          }

          // Find date (first bold text in diarioTopoText, format DD/MM/YYYY)
          let dateStr: string | null = null;
          container.find('.diarioTopoText b').each((_, b) => {
            const text = $(b).text().trim();
            if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) {
              dateStr = text;
              return false; // break
            }
          });

          if (!dateStr) {
            logger.warn('Could not find date in container-diario');
            return;
          }

          // Parse date
          const dateMatch = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) {
            return;
          }
          const [, day, month, year] = dateMatch;
          const documentDate = new Date(`${year}-${month}-${day}`);

          // Filter by date range
          if (documentDate > this.endDate || documentDate < this.startDate) {
            return;
          }

          // Find edition number
          let editionNumber: string | undefined;
          container.find('.diarioTopoText').each((_, div) => {
            const text = $(div).text();
            const editionMatch = text.match(/Edição:\s*(\d+)/);
            if (editionMatch) {
              editionNumber = editionMatch[1];
              return false; // break
            }
          });

          // Check if extra edition
          let isExtraEdition = false;
          container.find('.diarioTopoText').each((_, div) => {
            const text = $(div).text();
            if (/Extraordin[aá]ria/i.test(text)) {
              isExtraEdition = true;
              return false; // break
            }
          });

          const gazette: Gazette = {
            date: `${year}-${month}-${day}`,
            fileUrl: this.encodeUrl(pdfLink),
            territoryId: this.config.territoryId,
            scrapedAt: new Date().toISOString(),
            editionNumber,
            isExtraEdition,
            power: 'executive_legislative',
          };

          gazettes.push(gazette);
        } catch (error) {
          logger.warn(`Error parsing carousel item: ${error}`);
        }
      });

      // Section 2: Older editions in table (.OutrosDiarios)
      $('table.OutrosDiarios tr').each((_, row) => {
        try {
          const tr = $(row);
          const tds = tr.find('td');
          
          if (tds.length < 2) {
            return;
          }

          const infoTd = tds.eq(0);
          const downloadTd = tds.eq(1);

          // Find PDF link
          const pdfLink = downloadTd.find('a[href$=".pdf"]').attr('href');
          if (!pdfLink) {
            return;
          }

          // Find date (format: DD/MM/YYYY in bold)
          const dateMatch = infoTd.html()?.match(/<b>(\d{2}\/\d{2}\/\d{4})<\/b>/);
          if (!dateMatch) {
            return;
          }

          const dateStr = dateMatch[1];
          const dateParts = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateParts) {
            return;
          }
          const [, day, month, year] = dateParts;
          const documentDate = new Date(`${year}-${month}-${day}`);

          // Filter by date range
          if (documentDate > this.endDate || documentDate < this.startDate) {
            return;
          }

          // Find edition number (format: "Edição XXXX -" or "Edição XXXX")
          const infoText = infoTd.text();
          const editionMatch = infoText.match(/Edição\s+(\d+)/);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;

          // Check if extra edition
          const isExtraEdition = /Extraordin[aá]ria/i.test(infoText);

          const gazette: Gazette = {
            date: `${year}-${month}-${day}`,
            fileUrl: this.encodeUrl(pdfLink),
            territoryId: this.config.territoryId,
            scrapedAt: new Date().toISOString(),
            editionNumber,
            isExtraEdition,
            power: 'executive_legislative',
          };

          gazettes.push(gazette);
        } catch (error) {
          logger.warn(`Error parsing table row: ${error}`);
        }
      });

    } catch (error) {
      logger.error(`Error crawling ${this.baseUrl}: ${error}`);
    }

    // Remove duplicates (same date + same PDF URL)
    const uniqueGazettes = this.deduplicateGazettes(gazettes);

    logger.info(`Successfully crawled ${uniqueGazettes.length} gazettes for ${this.config.name}`);
    return uniqueGazettes;
  }

  private deduplicateGazettes(gazettes: Gazette[]): Gazette[] {
    const seen = new Set<string>();
    return gazettes.filter(gazette => {
      const key = `${gazette.date}-${gazette.fileUrl}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
}



