import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraVitoriadaConquistaConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp, generateMonthlySequence } from '../../utils/date-utils';

/**
 * PrefeituraVitoriadaConquistaSpider implementation
 * 
 * Crawls the official gazette from Vitória da Conquista, BA
 * Site: https://dom.pmvc.ba.gov.br
 * 
 * The site has a monthly listing structure:
 * https://dom.pmvc.ba.gov.br/diarios/{year}/{month}
 * 
 * Each gazette has a preview link:
 * https://dom.pmvc.ba.gov.br/diarios/previsualizar/{hash}
 */
export class PrefeituraVitoriadaConquistaSpider extends BaseSpider {
  protected pmvcConfig: PrefeituraVitoriadaConquistaConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.pmvcConfig = spiderConfig.config as PrefeituraVitoriadaConquistaConfig;
    
    if (!this.pmvcConfig.baseUrl) {
      throw new Error(`PrefeituraVitoriadaConquistaSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraVitoriadaConquistaSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.pmvcConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Generate monthly URLs for the date range
      const monthYears = generateMonthlySequence(this.startDate, this.endDate, 'yyyy/M');

      for (const monthYear of monthYears) {
        try {
          const monthGazettes = await this.crawlMonth(monthYear);
          gazettes.push(...monthGazettes);
        } catch (error) {
          logger.error(`Failed to crawl month ${monthYear}`, error as Error);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  private async crawlMonth(monthYear: string): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const url = `${this.pmvcConfig.baseUrl}/diarios/${monthYear}`;
    
    logger.info(`Crawling month: ${url}`);

    try {
      const html = await this.fetch(url);
      const $ = this.loadHTML(html);

      // Find all gazette boxes
      const gazetteBoxes = $('.box-diario').toArray();
      
      // Find all download links (they appear after each box-diario in the DOM)
      // The download links have title="Baixar Publicação" and href containing "previsualizar" without page number
      const downloadLinks = $('a[title="Baixar Publicação"]').toArray();
      
      logger.debug(`Found ${gazetteBoxes.length} gazette boxes and ${downloadLinks.length} download links for ${monthYear}`);

      // Track dates to detect extra editions (multiple editions on the same date)
      const dateCount: Record<string, number> = {};

      // Process each box-diario with its corresponding download link
      for (let i = 0; i < gazetteBoxes.length; i++) {
        try {
          const $box = $(gazetteBoxes[i]);
          
          // Extract date from box ID (format: diario-YYYYMMDD)
          const boxId = $box.attr('id');
          if (!boxId) continue;
          
          const dateMatch = boxId.match(/diario-(\d{4})(\d{2})(\d{2})/);
          if (!dateMatch) continue;
          
          const [, year, month, day] = dateMatch;
          const date = `${year}-${month}-${day}`;
          const dateObj = new Date(date);
          
          // Check if date is in range
          if (!this.isInDateRange(dateObj)) {
            continue;
          }

          // Get the corresponding download link (same index as box)
          const downloadLink = downloadLinks[i];
          if (!downloadLink) {
            logger.debug(`No download link found for ${date} at index ${i}`);
            continue;
          }
          
          const pdfLink = $(downloadLink).attr('href');
          if (!pdfLink) {
            logger.debug(`No PDF link found for ${date}`);
            continue;
          }

          // Convert preview link to download link
          const fileUrl = pdfLink.replace('previsualizar', 'baixar');
          const fullUrl = fileUrl.startsWith('http') ? fileUrl : `${this.pmvcConfig.baseUrl}${fileUrl}`;

          // Extract edition number from the box title (h1 inside div#titulo)
          const titleText = $box.find('h1').first().text();
          const editionMatch = titleText.match(/Edição\s+([\d.]+)/i);
          const editionNumber = editionMatch ? editionMatch[1].replace('.', '') : undefined;

          // Track occurrences of this date to detect extra editions
          dateCount[date] = (dateCount[date] || 0) + 1;
          const isExtraEdition = dateCount[date] > 1;

          const gazette: Gazette = {
            date,
            fileUrl: fullUrl,
            territoryId: this.spiderConfig.territoryId,
            scrapedAt: getCurrentTimestamp(),
            isExtraEdition,
            power: 'executive_legislative',
            editionNumber,
            sourceText: titleText.trim() || `Diário Oficial ${date}`,
          };

          gazettes.push(gazette);
          logger.info(`Found gazette: ${date} - Edition ${editionNumber || 'N/A'}${isExtraEdition ? ' (extra)' : ''}`);
        } catch (error) {
          logger.warn(`Error processing gazette box:`, { error: (error as Error).message });
        }
      }
    } catch (error) {
      logger.error(`Error crawling month ${monthYear}:`, error as Error);
    }

    return gazettes;
  }
}
