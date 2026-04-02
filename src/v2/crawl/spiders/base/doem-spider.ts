import { Gazette, SpiderConfig, DateRange, DoemConfig } from '../../types';
import { BaseSpider } from './base-spider';
import { generateMonthlySequence, parseBrazilianDate } from '../../../../utils/date-utils';
import { logger } from '../../../../utils/logger'
import { Cheerio, CheerioAPI } from '../../utils/html-parser';

/**
 * Spider for DOEM (Diário Oficial Eletrônico dos Municípios) platform
 * Used by 114+ municipalities
 */
export class DoemSpider extends BaseSpider {
  private stateCityUrlPart: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);

    const doemConfig = config.config as DoemConfig;
    this.stateCityUrlPart = doemConfig.stateCityUrlPart;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    logger.info('Starting DOEM crawl', {
      stateCityUrlPart: this.stateCityUrlPart,
      dateRange: {
        start: this.startDate.toISOString(),
        end: this.endDate.toISOString(),
      },
    });

    // Generate monthly URLs
    const monthYears = generateMonthlySequence(this.startDate, this.endDate, 'yyyy/MM');

    for (const monthYear of monthYears) {
      try {
        const monthGazettes = await this.crawlMonth(monthYear);
        gazettes.push(...monthGazettes);
      } catch (error) {
        logger.error(`Failed to crawl month ${monthYear}`, error as Error);
        // Continue with next month
      }
    }

    logger.info('DOEM crawl completed', {
      totalGazettes: gazettes.length,
      requestCount: this.requestCount,
    });

    return gazettes;
  }

  private async crawlMonth(monthYear: string): Promise<Gazette[]> {
    const url = `https://doem.org.br/${this.stateCityUrlPart}/diarios/${monthYear}`;
    const html = await this.fetch(url);
    const $ = this.loadHTML(html);

    const gazettes: Gazette[] = [];
    const gazetteBoxes = $('div.box-diario');

    logger.debug(`Found ${gazetteBoxes.length} gazette boxes for ${monthYear}`);

    for (let i = 0; i < gazetteBoxes.length; i++) {
      try {
        const element = gazetteBoxes[i];
        const gazette = await this.parseGazetteBox($, $(element));
        if (gazette) {
          gazettes.push(gazette);
        }
      } catch (error) {
        logger.warn('Failed to parse gazette box', {
          error: (error as Error).message,
        });
      }
    }

    return gazettes;
  }

  private async parseGazetteBox(_$: CheerioAPI, $box: Cheerio): Promise<Gazette | null> {
    try {
      // Extract date
      const dateText = $box.find('span.data-diario').text().trim();
      if (!dateText) {
        return null;
      }
      const date = parseBrazilianDate(dateText);

      // Check if date is in range
      if (!this.isInDateRange(date)) {
        return null;
      }

      // Extract PDF URL - the link is inside the box
      const previewLink = $box.find('a[title="Baixar Publicação"]').attr('href');
      if (!previewLink) {
        return null;
      }
      
      // Convert preview link to download link
      const fileUrl = previewLink.replace('previsualizar', 'baixar');

      // Extract edition number from h2 text
      const editionText = $box.find('h2').first().text();
      const editionMatch = editionText.match(/Edição\s+([.\d]+)/);
      const editionNumber = editionMatch ? editionMatch[1] : undefined;

      return await this.createGazette(date, fileUrl, {
        editionNumber,
        isExtraEdition: false,
        power: 'executive_legislative',
      });
    } catch (error) {
      logger.warn('Error parsing gazette box', {
        error: (error as Error).message,
      });
      return null;
    }
  }
}
