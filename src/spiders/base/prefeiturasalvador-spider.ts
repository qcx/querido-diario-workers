import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeiturasalvadorConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp, parseBrazilianDate, generateMonthlySequence } from '../../utils/date-utils';

/**
 * PrefeiturasalvadorSpider implementation
 * 
 * Crawls the official gazette from Salvador, BA
 * Site: http://dom.salvador.ba.gov.br
 * 
 * The site is a Joomla-based platform with a category listing of gazettes.
 * Each gazette has a PDF file stored at:
 * http://www.dom.salvador.ba.gov.br/images/stories/pdf/{year}/{month_name}/dom-{number}-{day}-{month}-{year}.pdf
 */
export class PrefeiturasalvadorSpider extends BaseSpider {
  protected salvadorConfig: PrefeiturasalvadorConfig;
  private readonly monthNames = [
    'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
  ];

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.salvadorConfig = spiderConfig.config as PrefeiturasalvadorConfig;
    
    if (!this.salvadorConfig.baseUrl) {
      throw new Error(`PrefeiturasalvadorSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeiturasalvadorSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.salvadorConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Fetch the category listing page
      const listUrl = `${this.salvadorConfig.baseUrl}/index.php?option=com_content&view=category&id=1&Itemid=2`;
      const html = await this.fetch(listUrl);
      const $ = this.loadHTML(html);

      // Find all gazette links in the table
      const gazetteLinks = $('a[href*="view=article"]').toArray();
      
      logger.info(`Found ${gazetteLinks.length} gazette links`);

      for (const link of gazetteLinks) {
        try {
          const $link = $(link);
          const href = $link.attr('href');
          const title = $link.text().trim();
          
          // Skip if not a DOM link
          if (!title.match(/DOM-\d+/i)) {
            continue;
          }

          // Extract the article ID and fetch the article page
          const articleUrl = href?.startsWith('http') ? href : `${this.salvadorConfig.baseUrl}${href}`;
          
          if (!articleUrl) continue;

          const gazette = await this.parseArticlePage(articleUrl, title);
          if (gazette && this.isInDateRange(new Date(gazette.date))) {
            gazettes.push(gazette);
            logger.info(`Found gazette: ${gazette.date} - ${title}`);
          }
        } catch (error) {
          logger.warn(`Error processing gazette link:`, { error: (error as Error).message });
        }
      }

      // Also try to fetch from the thumbsup module on the homepage
      const homeGazettes = await this.crawlHomepage();
      for (const gazette of homeGazettes) {
        if (!gazettes.some(g => g.fileUrl === gazette.fileUrl)) {
          gazettes.push(gazette);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  private async crawlHomepage(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      const html = await this.fetch(this.salvadorConfig.baseUrl);
      const $ = this.loadHTML(html);

      // Find thumbsup items
      const thumbsupItems = $('.thumbsup-thumb').toArray();
      
      for (const item of thumbsupItems) {
        try {
          const $item = $(item);
          const href = $item.attr('href');
          const title = $item.find('.thumbsup-title').text().trim() || $item.next('.thumbsup-title').text().trim();
          const dateText = $item.find('.thumbsup-date').text().trim() || $item.nextAll('.thumbsup-date').first().text().trim();
          
          if (!href || !title.match(/DOM-\d+/i)) continue;

          const articleUrl = href.startsWith('http') ? href : `${this.salvadorConfig.baseUrl}${href}`;
          const gazette = await this.parseArticlePage(articleUrl, title);
          
          if (gazette && this.isInDateRange(new Date(gazette.date))) {
            gazettes.push(gazette);
          }
        } catch (error) {
          logger.debug(`Error processing thumbsup item:`, { error: (error as Error).message });
        }
      }
    } catch (error) {
      logger.warn(`Error crawling homepage:`, { error: (error as Error).message });
    }

    return gazettes;
  }

  private async parseArticlePage(articleUrl: string, title: string): Promise<Gazette | null> {
    try {
      const html = await this.fetch(articleUrl);
      const $ = this.loadHTML(html);

      // Find the PDF link in the article
      const pdfLink = $('a[href*=".pdf"]').first().attr('href');
      
      if (!pdfLink) {
        // Try to find in object tag
        const objectData = $('object[data*=".pdf"]').attr('data');
        if (!objectData) {
          logger.debug(`No PDF found for ${title}`);
          return null;
        }
        return this.createGazetteFromPdfUrl(objectData, title);
      }

      return this.createGazetteFromPdfUrl(pdfLink, title);
    } catch (error) {
      logger.warn(`Error parsing article page ${articleUrl}:`, { error: (error as Error).message });
      return null;
    }
  }

  private createGazetteFromPdfUrl(pdfUrl: string, title: string): Gazette | null {
    // Extract date from PDF URL
    // Format: dom-{number}-{day}-{month}-{year}.pdf
    const match = pdfUrl.match(/dom-(\d+)-(\d{2})-(\d{2})-(\d{4})\.pdf/i);
    
    if (!match) {
      logger.debug(`Could not extract date from PDF URL: ${pdfUrl}`);
      return null;
    }

    const [, editionNumber, day, month, year] = match;
    const date = `${year}-${month}-${day}`;

    // Ensure URL is absolute
    const fileUrl = pdfUrl.startsWith('http') ? pdfUrl : `http://www.dom.salvador.ba.gov.br${pdfUrl}`;

    return {
      date,
      fileUrl,
      territoryId: this.spiderConfig.territoryId,
      scrapedAt: getCurrentTimestamp(),
      isExtraEdition: false,
      power: 'executive_legislative',
      editionNumber,
      sourceText: title,
    };
  }
}
