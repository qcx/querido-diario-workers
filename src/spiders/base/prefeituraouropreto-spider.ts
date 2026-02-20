import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraOuroPretoConfig } from '../../types';
import { logger } from '../../utils/logger';
import { parse } from 'node-html-parser';

/**
 * Spider for Prefeitura de Ouro Preto diário oficial
 * 
 * Site Structure:
 * - URL: https://www.ouropreto.mg.gov.br/transparencia/diario
 * - List of publications with format "PUBLICAÇÃO Nº XXXX - DD/MM/YYYY"
 * - Each publication has:
 *   - Link to detail page: /transparencia/diario-publicacoes/{id}
 *   - Direct PDF link: https://sgm.ouropreto.mg.gov.br/ext_resources/do_pmop.php?id={id}
 * - Has search form with filters (type, term, year)
 * - Uses pagination or infinite scroll
 */
export class PrefeituraOuroPretoSpider extends BaseSpider {
  protected ouroPretoConfig: PrefeituraOuroPretoConfig;
  private baseUrl: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.ouroPretoConfig = spiderConfig.config as PrefeituraOuroPretoConfig;
    this.baseUrl = this.ouroPretoConfig.baseUrl || 'https://www.ouropreto.mg.gov.br/transparencia/diario';
    
    logger.info(`Initializing PrefeituraOuroPretoSpider for ${spiderConfig.name} with URL: ${this.baseUrl}`);
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling ${this.baseUrl} for ${this.spiderConfig.name}...`);

    try {
      const startDate = new Date(this.dateRange.start);
      const endDate = new Date(this.dateRange.end);

      // Fetch the main page
      const response = await fetch(this.baseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        }
      });

      if (!response.ok) {
        logger.error(`Failed to fetch ${this.baseUrl}: ${response.status}`);
        return gazettes;
      }

      const html = await response.text();
      const root = parse(html);
      this.requestCount++;

      // Find all publication items
      // Structure: <div class="row list-group-item center-block">
      //   <a class="col-md-8 list-group-item" href="/transparencia/diario-publicacoes/{id}">PUBLICAÇÃO Nº XXXX - DD/MM/YYYY</a>
      //   <a class="col-md-4 list-group-item" href="https://sgm.ouropreto.mg.gov.br/ext_resources/do_pmop.php?id={id}">PDF icon</a>
      // </div>
      const publicationRows = root.querySelectorAll('.row.list-group-item.center-block, .list-group-item');

      logger.debug(`Found ${publicationRows.length} publication rows`);

      for (const row of publicationRows) {
        try {
          // Extract publication text (e.g., "PUBLICAÇÃO Nº 3822 - 08/01/2026")
          const titleLink = row.querySelector('a.col-md-8, a.list-group-item');
          const titleText = titleLink?.textContent?.trim() || '';
          
          if (!titleText) continue;

          // Parse publication number and date
          // Format: "PUBLICAÇÃO Nº 3822 - 08/01/2026"
          const match = titleText.match(/PUBLICAÇÃO\s+N[°º]\s*(\d+)\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/i);
          
          if (!match) {
            logger.debug(`Could not parse publication format: ${titleText}`);
            continue;
          }

          const [, editionNumber, day, month, year] = match;
          const publicationDate = new Date(`${year}-${month}-${day}`);

          // Validate date
          if (isNaN(publicationDate.getTime())) {
            logger.warn(`Invalid date parsed: ${day}/${month}/${year}`);
            continue;
          }

          // Check if date is within range
          if (publicationDate < startDate || publicationDate > endDate) {
            continue;
          }

          // Find PDF link
          // Look for link to sgm.ouropreto.mg.gov.br/ext_resources/do_pmop.php
          const pdfLink = row.querySelector('a[href*="do_pmop.php"], a[href*=".pdf"]');
          let pdfUrl = pdfLink?.getAttribute('href') || '';

          // If no direct PDF link, try to extract ID from detail page link
          if (!pdfUrl && titleLink) {
            const detailHref = titleLink.getAttribute('href') || '';
            const idMatch = detailHref.match(/diario-publicacoes\/(\d+)/);
            if (idMatch) {
              pdfUrl = `https://sgm.ouropreto.mg.gov.br/ext_resources/do_pmop.php?id=${idMatch[1]}`;
            }
          }

          if (!pdfUrl) {
            logger.warn(`No PDF URL found for publication ${editionNumber}`);
            continue;
          }

          // Make URL absolute if relative
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }

          // Create gazette
          const gazette = await this.createGazette(publicationDate, pdfUrl, {
            editionNumber,
            isExtraEdition: false,
            power: 'executive_legislative',
            sourceText: `Publicação Nº ${editionNumber} - ${day}/${month}/${year}`,
          });

          if (gazette) {
            gazettes.push(gazette);
          }

        } catch (error) {
          logger.error(`Error processing publication row:`, error as Error);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);

    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }
}

