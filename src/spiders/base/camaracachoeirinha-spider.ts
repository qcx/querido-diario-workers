import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, CamaraCachoerinhaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for Câmara Municipal de Cachoeirinha (RS)
 * Platform: sistemalegislativo.com.br (Legisoft/Virtualize)
 *
 * The municipality publishes its Diário Oficial through the Câmara website,
 * not through the Atende.net portal (which has the module but no content).
 *
 * Listing: /documentos/tipo:legislativo-2/subtipo[0]:diario-oficial-3000010/subtipo[1]:diario-oficial-extraordinario-3000011
 * Pagination: /page:{n}
 * Individual: /documento/diario-oficial-{num}-{year}-{id}
 * PDF: hosted on rs-cachoeirinha-camara.ad.sistemalegislativo.com.br with JWT tokens
 */
export class CamaraCachoerinhaSpider extends BaseSpider {
  private baseUrl: string;
  private listingPath: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as CamaraCachoerinhaConfig;
    this.baseUrl = platformConfig.baseUrl;
    this.listingPath = platformConfig.listingPath ??
      '/documentos/tipo:legislativo-2/subtipo%5B0%5D:diario-oficial-3000010/subtipo%5B1%5D:diario-oficial-extraordinario-3000011';
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling CamaraCachoeirinha for ${this.config.name}...`);

    try {
      let currentPage = 1;
      let shouldContinue = true;

      while (shouldContinue) {
        const pageUrl = currentPage === 1
          ? `${this.baseUrl}${this.listingPath}`
          : `${this.baseUrl}${this.listingPath}/page:${currentPage}`;

        logger.debug(`Fetching listing page ${currentPage}: ${pageUrl}`);

        const html = await this.fetch(pageUrl);
        const $ = this.loadHTML(html);

        const items = $('li.list-item');
        logger.debug(`Found ${items.length} items on page ${currentPage}`);

        if (items.length === 0) {
          break;
        }

        let foundInRange = false;
        let foundBeforeRange = false;

        for (let i = 0; i < items.length; i++) {
          const $item = $(items[i]);

          const date = this.extractDate($item);
          if (!date) {
            logger.debug('Could not extract date from item');
            continue;
          }

          if (date > this.endDate) {
            continue;
          }

          if (date < this.startDate) {
            foundBeforeRange = true;
            continue;
          }

          foundInRange = true;

          const link = $item.find('a[href*="/documento/diario-oficial"]').first().attr('href');
          if (!link) {
            continue;
          }

          const titleText = $item.find('.title-link strong').text().trim();
          const isExtra = /extraordin/i.test(titleText) || /extraordin/i.test(link);
          const editionMatch = titleText.match(/(\d+)\/\d{4}/);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;

          const fullUrl = link.startsWith('http') ? link : `${this.baseUrl}${link}`;
          const pdfUrl = await this.extractPdfUrl(fullUrl);

          if (!pdfUrl) {
            logger.debug(`No PDF URL found for ${titleText}`);
            continue;
          }

          const gazette = await this.createGazette(date, pdfUrl, {
            editionNumber,
            isExtraEdition: isExtra,
            power: 'executive_legislative',
            skipUrlResolution: true,
          });

          if (gazette) {
            gazettes.push(gazette);
          }
        }

        if (foundBeforeRange && !foundInRange) {
          shouldContinue = false;
        }

        const hasNextPage = $(`a[href*="/page:${currentPage + 1}"]`).length > 0;
        if (!hasNextPage) {
          shouldContinue = false;
        }

        currentPage++;
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from CamaraCachoeirinha`);
    } catch (error) {
      logger.error(`Error crawling CamaraCachoeirinha: ${error}`);
      throw error;
    }

    return gazettes;
  }

  private extractDate($item: any): Date | null {
    const subTitle = $item.find('.sub-title').text();
    const dateMatch = subTitle.match(/Data Protocolo:\s*(\d{2})\/(\d{2})\/(\d{4})/);
    if (dateMatch) {
      return new Date(parseInt(dateMatch[3]), parseInt(dateMatch[2]) - 1, parseInt(dateMatch[1]));
    }

    const descText = $item.find('.document-desc').text();
    const descDateMatch = descText.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (descDateMatch) {
      return new Date(parseInt(descDateMatch[3]), parseInt(descDateMatch[2]) - 1, parseInt(descDateMatch[1]));
    }

    return null;
  }

  private async extractPdfUrl(gazetteUrl: string): Promise<string | null> {
    try {
      const html = await this.fetch(gazetteUrl);
      const $ = this.loadHTML(html);

      // Primary: captcha wrapper links contain the actual PDF URL as a query param
      const captchaLink = $('a[href*="validar_captcha"]').filter((_: number, el: any) => {
        const href = $(el).attr('href') || '';
        return href.includes('sistemalegislativo') || href.includes('.pdf');
      }).first().attr('href');

      if (captchaLink) {
        try {
          const urlParam = new URL(captchaLink).searchParams.get('url');
          if (urlParam && (urlParam.includes('.pdf') || urlParam.includes('sistemalegislativo'))) {
            return urlParam;
          }
        } catch {
          // URL parsing failed, continue to fallback strategies
        }
      }

      // Fallback: direct sistemalegislativo PDF link (without captcha wrapper)
      const directLink = $('a').filter((_: number, el: any) => {
        const href = $(el).attr('href') || '';
        return href.startsWith('https://') &&
          href.includes('sistemalegislativo.com.br') &&
          href.includes('.pdf');
      }).first().attr('href');

      if (directLink) {
        return directLink;
      }

      return null;
    } catch (error) {
      logger.debug(`Failed to extract PDF URL from ${gazetteUrl}: ${error}`);
      return null;
    }
  }
}
