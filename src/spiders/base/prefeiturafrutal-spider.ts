import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraFrutalConfig } from '../../types';
import { logger } from '../../utils/logger';
import { parse } from 'node-html-parser';

/**
 * Spider for Prefeitura de Frutal diário oficial
 * 
 * Site Structure:
 * - URL: https://frutal.publicabrasil.net/
 * - Uses PublicaBrasil platform (WordPress-based)
 * - List of editions with format: "DIÁRIO OFICIAL ELETRÔNICO – EDIÇÃO XXX"
 * - Each edition has a link to: /documentos/diario-oficial-eletronico-edicao-XXX/
 * - PDFs are in: /wp-content/uploads/YYYY/MM/DIARIO-OFICIAL-PREFEITURA-DE-FRUTAL-Edicao-XXX-{date}.pdf
 * - Dates in format: "X de janeiro de 2026"
 */
export class PrefeituraFrutalSpider extends BaseSpider {
  protected frutalConfig: PrefeituraFrutalConfig;
  private baseUrl: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.frutalConfig = spiderConfig.config as PrefeituraFrutalConfig;
    this.baseUrl = this.frutalConfig.baseUrl || 'https://frutal.publicabrasil.net';
    
    logger.info(`Initializing PrefeituraFrutalSpider for ${spiderConfig.name} with URL: ${this.baseUrl}`);
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling ${this.baseUrl} for ${this.spiderConfig.name}...`);

    try {
      const startDate = new Date(this.dateRange.start);
      const endDate = new Date(this.dateRange.end);

      // Fetch the main page
      const html = await this.fetch(this.baseUrl);
      const root = parse(html);

      // Find all edition links
      // Pattern: href="/documentos/diario-oficial-eletronico-edicao-XXX/"
      const editionLinks = root.querySelectorAll('a[href*="diario-oficial-eletronico-edicao"]');
      
      logger.debug(`Found ${editionLinks.length} edition links`);

      // Portuguese month names
      const monthMap: Record<string, string> = {
        'janeiro': '01', 'fevereiro': '02', 'março': '03', 'marco': '03',
        'abril': '04', 'maio': '05', 'junho': '06',
        'julho': '07', 'agosto': '08', 'setembro': '09',
        'outubro': '10', 'novembro': '11', 'dezembro': '12'
      };

      const processedUrls = new Set<string>();

      for (const link of editionLinks) {
        try {
          const href = link.getAttribute('href') || '';
          if (!href || processedUrls.has(href)) {
            continue;
          }

          // Extract edition number from URL
          // Pattern: /documentos/diario-oficial-eletronico-edicao-XXX/
          const editionMatch = href.match(/edicao-(\d+)/i);
          if (!editionMatch) {
            continue;
          }

          const editionNumber = editionMatch[1];

          // Get the link text and nearby text which contains the date
          // Format: "DIÁRIO OFICIAL ELETRÔNICO – EDIÇÃO 367" followed by date "7 de janeiro de 2026"
          const linkText = link.textContent || '';
          const parentText = link.parent?.textContent || '';
          const grandParentText = link.parent?.parent?.textContent || '';
          const combinedText = `${linkText} ${parentText} ${grandParentText}`;

          // Extract date from text (try from link text first)
          // Pattern: "X de janeiro de 2026"
          let dateMatch = combinedText.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);

          // Make URL absolute to fetch edition page
          let editionUrl = href;
          if (!editionUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.baseUrl);
            editionUrl = `${baseUrlObj.origin}${editionUrl.startsWith('/') ? '' : '/'}${editionUrl}`;
          }

          // Fetch the edition page to get the PDF URL and date (more reliable)
          logger.debug(`Fetching edition page: ${editionUrl}`);
          const editionHtml = await this.fetch(editionUrl);
          const editionRoot = parse(editionHtml);
          
          // Try to get date from edition page (more reliable than link text)
          const pageText = editionRoot.textContent || '';
          const pageDateMatch = pageText.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
          
          // Use date from page if found, otherwise use date from link text
          const finalDateMatch = pageDateMatch || dateMatch;
          
          if (!finalDateMatch) {
            logger.warn(`Could not extract date for edition ${editionNumber}`);
            continue;
          }
          
          const [, day, monthName, year] = finalDateMatch;
          const month = monthMap[monthName.toLowerCase()];
          
          if (!month) {
            logger.warn(`Unknown month: ${monthName}`);
            continue;
          }

          const gazetteDate = new Date(`${year}-${month}-${day.padStart(2, '0')}`);

          // Validate date
          if (isNaN(gazetteDate.getTime())) {
            logger.warn(`Invalid date: ${day}/${month}/${year}`);
            continue;
          }

          // Check if date is within range
          if (gazetteDate < startDate || gazetteDate > endDate) {
            continue;
          }
          
          processedUrls.add(href);

          // Find PDF links
          // Pattern: /wp-content/uploads/YYYY/MM/DIARIO-OFICIAL-PREFEITURA-DE-FRUTAL-Edicao-XXX-{date}.pdf
          // Also check object[data] and wp-block-file elements
          const pdfLinks = editionRoot.querySelectorAll('a[href*=".pdf"], embed[src*=".pdf"], iframe[src*=".pdf"], object[data*=".pdf"], .wp-block-file a[href*=".pdf"]');
          
          let pdfUrl = '';
          for (const pdfLink of pdfLinks) {
            const pdfHref = pdfLink.getAttribute('href') || 
                           pdfLink.getAttribute('src') || 
                           pdfLink.getAttribute('data') || '';
            if (pdfHref && pdfHref.includes('.pdf') && pdfHref.includes('DIARIO-OFICIAL')) {
              pdfUrl = pdfHref;
              break;
            }
          }

          // If no direct PDF link found, try to find any PDF link
          if (!pdfUrl) {
            const anyPdfLink = editionRoot.querySelector('a[href*=".pdf"], object[data*=".pdf"]');
            if (anyPdfLink) {
              pdfUrl = anyPdfLink.getAttribute('href') || anyPdfLink.getAttribute('data') || '';
            }
          }

          if (!pdfUrl) {
            logger.warn(`No PDF URL found for edition ${editionNumber}`);
            continue;
          }

          // Make PDF URL absolute
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(editionUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }

          // Check if it's an extra edition
          const isExtraEdition = combinedText.toLowerCase().includes('extra') || 
                                 pdfUrl.toLowerCase().includes('extra');

          // Create gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber,
            isExtraEdition,
            power: 'executive_legislative',
            sourceText: `Diário Oficial Eletrônico - Edição ${editionNumber} - ${day}/${month}/${year}`,
          });

          if (gazette) {
            gazettes.push(gazette);
          }

        } catch (error) {
          logger.error(`Error processing edition link:`, error as Error);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);

    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }
}

