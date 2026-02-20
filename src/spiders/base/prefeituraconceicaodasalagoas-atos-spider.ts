import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraConceicaoDasAlagoasAtosConfig } from '../../types';
import { logger } from '../../utils/logger';
// @ts-ignore
import { parse } from 'node-html-parser';

/**
 * Spider for Prefeitura de Conceição das Alagoas - Atos Oficiais
 * 
 * Site Structure:
 * - URL: https://www.conceicaodasalagoas.mg.gov.br/atos-oficiais/
 * - WordPress page with posts for each official act
 * - Pagination: /atos-oficiais/{N}/
 * - Each post has a title (e.g., "Decreto Municipal nº262/2025 – Decreta Luto Oficial...")
 * - Date format: "abril 9, 2025" (month day, year)
 * - PDF links: "Baixar arquivo" and "Visualizar arquivo" buttons
 */
export class PrefeituraConceicaoDasAlagoasAtosSpider extends BaseSpider {
  protected atosConfig: PrefeituraConceicaoDasAlagoasAtosConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.atosConfig = spiderConfig.config as PrefeituraConceicaoDasAlagoasAtosConfig;
    this.browser = browser || null;
    
    if (!this.atosConfig.baseUrl) {
      throw new Error(`PrefeituraConceicaoDasAlagoasAtosSpider requires a baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraConceicaoDasAlagoasAtosSpider for ${spiderConfig.name} with URL: ${this.atosConfig.baseUrl}`, {
      hasBrowser: !!this.browser,
    });
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.atosConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    // Use browser-based crawling if browser is available and requiresClientRendering is true
    if (this.browser && this.atosConfig.requiresClientRendering === true) {
      return this.crawlWithBrowser();
    }
    
    // Otherwise use standard fetch-based crawling
    return this.crawlWithFetch();
  }

  /**
   * Standard fetch-based crawling
   */
  private async crawlWithFetch(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Using fetch-based crawling for ${this.spiderConfig.name}...`);

    try {
      const startDate = new Date(this.dateRange.start);
      const endDate = new Date(this.dateRange.end);
      let currentPage = 1;
      let hasMorePages = true;

      // Portuguese month names
      const monthMap: Record<string, string> = {
        'janeiro': '01', 'fevereiro': '02', 'março': '03', 'marco': '03',
        'abril': '04', 'maio': '05', 'junho': '06',
        'julho': '07', 'agosto': '08', 'setembro': '09',
        'outubro': '10', 'novembro': '11', 'dezembro': '12'
      };

      while (hasMorePages) {
        // Atos oficiais uses pattern /atos-oficiais/{N}/ not /atos-oficiais/page/{N}/
        const pageUrl = currentPage === 1 
          ? this.atosConfig.baseUrl 
          : `${this.atosConfig.baseUrl}${currentPage}/`;
        
        logger.debug(`Fetching page ${currentPage}: ${pageUrl}`);
        const html = await this.fetch(pageUrl);
        const root = parse(html);

        // Find all post entries
        // Structure: Elementor posts with class "elementor-post" or "ecs-post-loop"
        const posts = root.querySelectorAll('article.elementor-post, article.ecs-post-loop, .elementor-post, .ecs-post-loop');
        
        if (posts.length === 0) {
          logger.debug(`No posts found on page ${currentPage}, stopping pagination`);
          hasMorePages = false;
          break;
        }

        logger.debug(`Found ${posts.length} posts on page ${currentPage}`);

        let foundInRange = false;

        for (const post of posts) {
          try {
            // Extract title - Elementor uses h1.elementor-heading-title
            const titleElement = post.querySelector('h1.elementor-heading-title, h1, .entry-title, .post-title');
            const title = titleElement?.textContent?.trim() || '';

            if (!title) {
              continue;
            }

            // Extract date - Elementor uses h2.elementor-heading-title right after h1
            // Format: "abril 9, 2025"
            const dateElement = post.querySelector('h2.elementor-heading-title, .date, .post-date, time, [class*="date"]');
            let dateText = dateElement?.textContent?.trim() || '';
            
            // Also check the post content for date patterns
            const postText = post.textContent || '';
            
            // Try to find date in various formats
            let gazetteDate: Date | null = null;
            
            // Pattern 1: "abril 9, 2025" or "abril 9 2025"
            const dateMatch1 = (dateText || postText).match(/(\w+)\s+(\d{1,2})[,\s]+(\d{4})/i);
            if (dateMatch1) {
              const [, monthName, day, year] = dateMatch1;
              const month = monthMap[monthName.toLowerCase()];
              if (month) {
                gazetteDate = new Date(`${year}-${month}-${day.padStart(2, '0')}`);
              }
            }
            
            // Pattern 2: "9 de abril de 2025"
            if (!gazetteDate) {
              const dateMatch2 = (dateText || postText).match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
              if (dateMatch2) {
                const [, day, monthName, year] = dateMatch2;
                const month = monthMap[monthName.toLowerCase()];
                if (month) {
                  gazetteDate = new Date(`${year}-${month}-${day.padStart(2, '0')}`);
                }
              }
            }
            
            // Pattern 3: "DD/MM/YYYY"
            if (!gazetteDate) {
              const dateMatch3 = (dateText || postText).match(/(\d{2})\/(\d{2})\/(\d{4})/);
              if (dateMatch3) {
                const [, day, month, year] = dateMatch3;
                gazetteDate = new Date(`${year}-${month}-${day}`);
              }
            }

            if (!gazetteDate || isNaN(gazetteDate.getTime())) {
              logger.warn(`Could not parse date from post: ${title}`);
              continue;
            }

            // Check if date is within range
            if (gazetteDate < startDate || gazetteDate > endDate) {
              if (gazetteDate < startDate) {
                // If we're going backwards and found a date before range, stop
                hasMorePages = false;
              }
              continue;
            }

            foundInRange = true;

            // Find PDF link
            // Elementor uses .elementor-button-link with href containing .pdf
            // Look for "Baixar arquivo" button first
            let pdfUrl = '';
            const baixarButton = Array.from(post.querySelectorAll('a.elementor-button-link, a')).find(link => {
              const linkText = link.textContent?.trim() || '';
              const href = link.getAttribute('href') || '';
              return (linkText.includes('Baixar') || linkText.includes('Download')) && href.includes('.pdf');
            });
            
            if (baixarButton) {
              pdfUrl = baixarButton.getAttribute('href') || '';
            } else {
              // Fallback: find any PDF link
              const pdfLinks = post.querySelectorAll('a[href*=".pdf"]');
              if (pdfLinks.length > 0) {
                pdfUrl = pdfLinks[0].getAttribute('href') || '';
              }
            }

            if (!pdfUrl) {
              logger.warn(`No PDF URL found for post: ${title}`);
              continue;
            }

            // Make PDF URL absolute
            if (!pdfUrl.startsWith('http')) {
              const baseUrlObj = new URL(this.atosConfig.baseUrl);
              pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
            }

            // Extract edition number from title if possible (e.g., "Decreto Municipal nº262/2025")
            const editionMatch = title.match(/n[°º]?(\d+)\/(\d{4})/i) || title.match(/(\d+)\/(\d{4})/);
            const editionNumber = editionMatch ? editionMatch[1] : undefined;

            // Create gazette
            const gazette = await this.createGazette(gazetteDate, pdfUrl, {
              editionNumber,
              isExtraEdition: false,
              power: 'executive',
              sourceText: title,
            });

            if (gazette) {
              gazettes.push(gazette);
            }

          } catch (error) {
            logger.error(`Error processing post:`, error as Error);
          }
        }

        // Check if we should continue to next page
        if (!foundInRange && currentPage > 1) {
          hasMorePages = false;
        } else {
          // Check if there's a next page link
          const nextPageLink = root.querySelector('a[href*="page"], .next, [class*="next"]');
          if (!nextPageLink || currentPage >= 10) { // Limit to 10 pages to avoid infinite loops
            hasMorePages = false;
          } else {
            currentPage++;
          }
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);

    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Browser-based crawling for pages that require JavaScript rendering
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      logger.debug(`Navigating to: ${this.atosConfig.baseUrl}`);
      await page.goto(this.atosConfig.baseUrl, { waitUntil: 'networkidle0', timeout: 45000 });
      this.requestCount++;
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Extract gazettes from all pages
      let currentPage = 1;
      let hasMorePages = true;

      while (hasMorePages && currentPage <= 10) {
        const pageUrl = currentPage === 1 
          ? this.atosConfig.baseUrl 
          : `${this.atosConfig.baseUrl}${currentPage}/`;
        
        if (currentPage > 1) {
          await page.goto(pageUrl, { waitUntil: 'networkidle0', timeout: 45000 });
          this.requestCount++;
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        const pageGazettes = await this.extractGazettesFromPage(page);
        
        let foundInRange = false;
        for (const gazette of pageGazettes) {
          if (gazette) {
            const gazetteDate = new Date(gazette.date);
            if (this.isInDateRange(gazetteDate)) {
              gazettes.push(gazette);
              foundInRange = true;
            } else if (gazetteDate < new Date(this.dateRange.start)) {
              hasMorePages = false;
            }
          }
        }

        if (!foundInRange && currentPage > 1) {
          hasMorePages = false;
        } else {
          // Check for next page
          const hasNext = await page.evaluate(() => {
            return !!document.querySelector('a[href*="page"], .next, [class*="next"]');
          });
          hasMorePages = hasNext && currentPage < 10;
          currentPage++;
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from browser`);

    } catch (error) {
      logger.error(`Error crawling with browser:`, error as Error);
      throw error;
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (e) {
          logger.warn('Error closing page', { error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (e) {
          logger.warn('Error closing browser', { error: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    return gazettes;
  }

  /**
   * Extract gazettes from the current browser page
   */
  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
        const gazetteData = await page.evaluate(() => {
        const data: any[] = [];
        const monthMap: Record<string, string> = {
          'janeiro': '01', 'fevereiro': '02', 'março': '03', 'marco': '03',
          'abril': '04', 'maio': '05', 'junho': '06',
          'julho': '07', 'agosto': '08', 'setembro': '09',
          'outubro': '10', 'novembro': '11', 'dezembro': '12'
        };

        const posts = document.querySelectorAll('article.elementor-post, article.ecs-post-loop, .elementor-post, .ecs-post-loop');
        
        for (const post of Array.from(posts)) {
          const titleElement = post.querySelector('h1.elementor-heading-title, h1, .entry-title, .post-title');
          const title = titleElement?.textContent?.trim() || '';
          
          if (!title) continue;

          const dateElement = post.querySelector('h2.elementor-heading-title, .date, .post-date, time, [class*="date"]');
          const dateText = dateElement?.textContent?.trim() || '';
          const postText = post.textContent || '';
          
          let dateStr = '';
          
          // Pattern 1: "abril 9, 2025"
          const dateMatch1 = (dateText || postText).match(/(\w+)\s+(\d{1,2})[,\s]+(\d{4})/i);
          if (dateMatch1) {
            const [, monthName, day, year] = dateMatch1;
            const month = monthMap[monthName.toLowerCase()];
            if (month) {
              dateStr = `${year}-${month}-${day.padStart(2, '0')}`;
            }
          }
          
          // Pattern 2: "9 de abril de 2025"
          if (!dateStr) {
            const dateMatch2 = (dateText || postText).match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
            if (dateMatch2) {
              const [, day, monthName, year] = dateMatch2;
              const month = monthMap[monthName.toLowerCase()];
              if (month) {
                dateStr = `${year}-${month}-${day.padStart(2, '0')}`;
              }
            }
          }
          
          // Pattern 3: "DD/MM/YYYY"
          if (!dateStr) {
            const dateMatch3 = (dateText || postText).match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (dateMatch3) {
              const [, day, month, year] = dateMatch3;
              dateStr = `${year}-${month}-${day}`;
            }
          }

          if (!dateStr) continue;

          // Find PDF link - Elementor button with "Baixar arquivo"
          let pdfUrl = '';
          const baixarButton = Array.from(post.querySelectorAll('a.elementor-button-link, a')).find((link: any) => {
            const linkText = link.textContent?.trim() || '';
            const href = link.getAttribute('href') || '';
            return (linkText.includes('Baixar') || linkText.includes('Download')) && href.includes('.pdf');
          });
          
          if (baixarButton) {
            pdfUrl = baixarButton.getAttribute('href') || '';
          } else {
            // Fallback: find any PDF link
            const pdfLinks = post.querySelectorAll('a[href*=".pdf"]');
            if (pdfLinks.length > 0) {
              pdfUrl = pdfLinks[0].getAttribute('href') || '';
            }
          }

          if (pdfUrl) {
            data.push({
              title,
              dateStr,
              pdfUrl,
            });
          }
        }
        
        return data;
      });
      
      for (const item of gazetteData) {
        try {
          const gazetteDate = new Date(item.dateStr);
          if (isNaN(gazetteDate.getTime())) {
            continue;
          }

          let pdfUrl = item.pdfUrl;
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.atosConfig.baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }

          const editionMatch = item.title.match(/n[°º]?(\d+)\/(\d{4})/i) || item.title.match(/(\d+)\/(\d{4})/);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;

          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber,
            isExtraEdition: false,
            power: 'executive',
            sourceText: item.title,
          });

          if (gazette) {
            gazettes.push(gazette);
          }
        } catch (error) {
          logger.error(`Error processing gazette item:`, error as Error);
        }
      }
    } catch (error) {
      logger.error(`Error extracting gazettes from page:`, error as Error);
    }
    
    return gazettes;
  }
}
