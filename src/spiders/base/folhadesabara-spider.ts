import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Configuration for Folha de Sabará spider
 * 
 * Site Structure:
 * - URL: https://folhadesabara.com.br/publicacao-leg
 * - Local newspaper that publishes legal notices for Sabará
 * - Lists: EDITAL, LICENÇA AMBIENTAL, CONCURSO, etc.
 * - Link text format: "TIPO DD/MM/YYYY - HHhMM Título..."
 * - Pagination available: /page/2, /page/3, etc.
 * 
 * Note: This is a news website, not a traditional diário oficial.
 * Publications are individual articles, not consolidated PDFs.
 */
export interface FolhadesabaraConfig {
  type: 'folhadesabara';
  /** Base URL for the Folha de Sabará publications page */
  baseUrl: string;
}

export class FolhadesabaraSpider extends BaseSpider {
  protected folhaConfig: FolhadesabaraConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.folhaConfig = spiderConfig.config as FolhadesabaraConfig;
    logger.info(`Initializing FolhadesabaraSpider for ${spiderConfig.name} with URL: ${this.folhaConfig.baseUrl}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.folhaConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];
    const processedUrls = new Set<string>();

    try {
      let page = 1;
      let hasMorePages = true;
      const maxPages = 5; // Safety limit

      while (hasMorePages && page <= maxPages) {
        const url = page === 1 
          ? this.folhaConfig.baseUrl 
          : `${this.folhaConfig.baseUrl}/page/${page}`;
        
        logger.info(`Fetching page ${page}: ${url}`);
        
        const html = await this.fetch(url);
        const $ = this.loadHTML(html);

        // Find all links that contain dates in DD/MM/YYYY format in their text
        // These are the publication cards with format: "TIPO DD/MM/YYYY - HHhMM Título..."
        let foundArticles = 0;
        let articlesInRange = 0;

        $('a').each((_, el) => {
          const linkText = $(el).text().trim();
          const href = $(el).attr('href');
          
          if (!href || !linkText) return;
          
          // Skip if already processed
          if (processedUrls.has(href)) return;

          // Check if link text matches publication pattern with date
          // Examples: "EDITAL 29/12/2025 - 18h08 Licenciamento..."
          //           "LICENÇA AMBIENTAL 22/07/2024 - 19h28 ENARFA..."
          const dateMatch = linkText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) return;

          // Check if it's a legal publication
          const isLegalPublication = 
            linkText.includes('EDITAL') ||
            linkText.includes('LICENÇA') ||
            linkText.includes('LICENCIAMENTO') ||
            linkText.includes('CONCURSO') ||
            linkText.includes('CONVOCAÇÃO') ||
            linkText.includes('LAS ') ||
            linkText.includes('SINDIMESA') ||
            linkText.includes('PUBLICAÇÕES LEGAIS') ||
            linkText.includes('AMAIBEN');

          if (!isLegalPublication) return;

          foundArticles++;
          processedUrls.add(href);

          const [, day, month, year] = dateMatch;
          const articleDate = new Date(`${year}-${month}-${day}T00:00:00.000Z`);

          // Check if date is in range
          if (!this.isInDateRange(articleDate)) {
            logger.debug(`Article date ${day}/${month}/${year} out of range: ${linkText.substring(0, 50)}...`);
            return;
          }

          articlesInRange++;

          // Resolve relative URLs
          let fullUrl = href;
          if (href.startsWith('/')) {
            fullUrl = `https://folhadesabara.com.br${href}`;
          } else if (!href.startsWith('http')) {
            fullUrl = `https://folhadesabara.com.br/${href}`;
          }

          // Extract type for edition number
          const typeMatch = linkText.match(/^([A-Z\s]+)\s+\d{2}\/\d{2}\/\d{4}/);
          const editionType = typeMatch ? typeMatch[1].trim() : 'PUBLICAÇÃO';

          // Create gazette with the article URL
          // We'll process PDF extraction async
          this.fetchArticleAndCreateGazette(fullUrl, articleDate, linkText, editionType, gazettes);
        });

        logger.info(`Page ${page}: Found ${foundArticles} articles, ${articlesInRange} in date range`);

        // Check for pagination
        const nextPageLink = $('a:contains("Próxima")').attr('href');
        hasMorePages = !!nextPageLink && foundArticles > 0;
        page++;

        // Small delay between pages
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Wait for all gazette fetches to complete
      await new Promise(resolve => setTimeout(resolve, 2000));

      logger.info(`Found ${gazettes.length} publications from Folha de Sabará`);

    } catch (error) {
      logger.error(`Error crawling Folha de Sabará:`, error as Error);
    }

    return gazettes;
  }

  private async fetchArticleAndCreateGazette(
    articleUrl: string,
    articleDate: Date,
    linkText: string,
    editionType: string,
    gazettes: Gazette[]
  ): Promise<void> {
    try {
      const articleHtml = await this.fetch(articleUrl);
      const $ = this.loadHTML(articleHtml);

      // Look for PDF links in the article
      const pdfLinks = $('a[href$=".pdf"]');
      
      let gazette: Gazette | null = null;

      if (pdfLinks.length > 0) {
        let pdfUrl = pdfLinks.first().attr('href');
        if (pdfUrl) {
          // Resolve relative PDF URLs
          if (pdfUrl.startsWith('/')) {
            pdfUrl = `https://folhadesabara.com.br${pdfUrl}`;
          } else if (!pdfUrl.startsWith('http')) {
            pdfUrl = `https://folhadesabara.com.br/${pdfUrl}`;
          }

          gazette = await this.createGazette(articleDate, pdfUrl, {
            editionNumber: editionType,
            isExtraEdition: false,
            power: 'executive',
            sourceText: linkText.substring(0, 200),
          });
          
          if (gazette) {
            logger.debug(`Found gazette with PDF: ${linkText.substring(0, 50)}...`);
          }
        }
      } else {
        // If no PDF, store the article link as the gazette URL
        gazette = await this.createGazette(articleDate, articleUrl, {
          editionNumber: editionType,
          isExtraEdition: false,
          power: 'executive',
          sourceText: linkText.substring(0, 200),
        });
        
        if (gazette) {
          logger.debug(`Found publication (no PDF): ${linkText.substring(0, 50)}...`);
        }
      }

      if (gazette) {
        gazettes.push(gazette);
      }
    } catch (error) {
      logger.warn(`Failed to fetch article: ${articleUrl}`, error as Error);
    }
  }
}
