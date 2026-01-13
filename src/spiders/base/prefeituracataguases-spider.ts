import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraCataguasesConfig } from '../../types';
import { logger } from '../../utils/logger';
import { parse } from 'node-html-parser';

/**
 * Spider for Prefeitura de Cataguases diário oficial (Jornal Cataguases)
 * 
 * Site Structure:
 * - URL: https://cataguases.mg.gov.br/jornal-de-cataguases/
 * - WordPress blog with posts in format: /jornal-cataguases-{date}/
 * - Each post contains a PDF link to the gazette
 * - Posts have dates in format: "DD de mês de YYYY"
 * - Example: "28 dezembro 2025" -> /jornal-cataguases-28-de-dezembro-de-2025/
 */
export class PrefeituraCataguasesSpider extends BaseSpider {
  protected cataguasesConfig: PrefeituraCataguasesConfig;
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.cataguasesConfig = spiderConfig.config as PrefeituraCataguasesConfig;
    this.baseUrl = this.cataguasesConfig.baseUrl || 'https://cataguases.mg.gov.br/jornal-de-cataguases';
    this.browser = browser || null;
    
    logger.info(`Initializing PrefeituraCataguasesSpider for ${spiderConfig.name} with URL: ${this.baseUrl}`, {
      hasBrowser: !!this.browser,
      requiresClientRendering: this.cataguasesConfig.requiresClientRendering,
    });
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.baseUrl} for ${this.spiderConfig.name}...`);
    
    // Use browser-based crawling if browser is available and requiresClientRendering is true
    if (this.browser && this.cataguasesConfig.requiresClientRendering === true) {
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

      // Fetch the main page
      const html = await this.fetch(this.baseUrl);
      const root = parse(html);

      // Find all post links
      // Pattern: href="/jornal-cataguases-{date}/"
      // Example: /jornal-cataguases-28-de-dezembro-de-2025/
      const allLinks = root.querySelectorAll('a[href*="jornal-cataguases"]');
      
      logger.debug(`Found ${allLinks.length} potential gazette links`);

      // Portuguese month names
      const monthMap: Record<string, string> = {
        'janeiro': '01', 'fevereiro': '02', 'março': '03', 'marco': '03',
        'abril': '04', 'maio': '05', 'junho': '06',
        'julho': '07', 'agosto': '08', 'setembro': '09',
        'outubro': '10', 'novembro': '11', 'dezembro': '12'
      };

      const processedUrls = new Set<string>();

      for (const link of allLinks) {
        try {
          const href = link.getAttribute('href') || '';
          if (!href || processedUrls.has(href)) {
            continue;
          }

          // Extract date from URL
          // Pattern: /jornal-cataguases-{day}-de-{month}-de-{year}/
          const urlMatch = href.match(/jornal-cataguases-(\d+)-de-(\w+)-de-(\d{4})/i);
          
          if (!urlMatch) {
            continue;
          }

          const [, day, monthName, year] = urlMatch;
          const month = monthMap[monthName.toLowerCase()];
          
          if (!month) {
            logger.warn(`Unknown month: ${monthName} in URL: ${href}`);
            continue;
          }

          const gazetteDate = new Date(`${year}-${month}-${day}`);

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

          // Make URL absolute
          let postUrl = href;
          if (!postUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.baseUrl);
            postUrl = `${baseUrlObj.origin}${postUrl.startsWith('/') ? '' : '/'}${postUrl}`;
          }

          // Fetch the post page to get the PDF URL
          logger.debug(`Fetching post page: ${postUrl}`);
          const postHtml = await this.fetch(postUrl);
          const postRoot = parse(postHtml);

          // Find PDF links in the post
          // Pattern: /wp-content/uploads/YYYY/MM/JC-{date}.pdf
          const pdfLinks = postRoot.querySelectorAll('a[href*=".pdf"], embed[src*=".pdf"], iframe[src*=".pdf"], object[data*=".pdf"]');
          
          let pdfUrl = '';
          for (const pdfLink of pdfLinks) {
            const pdfHref = pdfLink.getAttribute('href') || 
                           pdfLink.getAttribute('src') || 
                           pdfLink.getAttribute('data') || '';
            if (pdfHref && pdfHref.includes('.pdf') && (pdfHref.includes('JC-') || pdfHref.includes('jornal'))) {
              pdfUrl = pdfHref;
              break;
            }
          }

          // If no direct PDF link, look for download links or wp-content/uploads
          if (!pdfUrl) {
            const downloadLinks = postRoot.querySelectorAll('a[href*="download"], a[href*="wp-content/uploads"]');
            for (const dlLink of downloadLinks) {
              const dlHref = dlLink.getAttribute('href') || '';
              if (dlHref.includes('.pdf')) {
                pdfUrl = dlHref;
                break;
              }
            }
          }

          if (!pdfUrl) {
            logger.warn(`No PDF URL found for post: ${postUrl}`);
            continue;
          }

          // Make PDF URL absolute
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(postUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }

          // Extract edition number from PDF filename or post title if possible
          const postTitle = postRoot.querySelector('h1, .entry-title, .post-title')?.textContent || '';
          const editionMatch = postTitle.match(/[Ee]di[çc][ãa]o\s+[nN]?[°º]?\s*(\d+)/i) || 
                               pdfUrl.match(/[Ee]di[çc][ãa]o[_-]?(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;

          // Create gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber,
            isExtraEdition: postTitle.toLowerCase().includes('extra') || href.toLowerCase().includes('extra'),
            power: 'executive_legislative',
            sourceText: postTitle || `Jornal Cataguases - ${day}/${month}/${year}`,
          });

          if (gazette) {
            gazettes.push(gazette);
          }

        } catch (error) {
          logger.error(`Error processing link:`, error as Error);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);

    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Browser-based crawling for sites that require JavaScript rendering
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(`PrefeituraCataguasesSpider for ${this.config.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      logger.info(`Using browser-based crawling for ${this.spiderConfig.name}...`);
      
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      
      // Navigate to the base URL
      logger.debug(`Navigating to: ${this.baseUrl}`);
      await page.goto(this.baseUrl, { 
        waitUntil: 'networkidle0', 
        timeout: 30000 
      });
      this.requestCount++;
      
      // Wait for page to stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Wait for links to load
      try {
        await page.waitForSelector('a[href*="jornal-cataguases"]', { timeout: 10000 });
        logger.debug('Gazette links found');
      } catch (error) {
        logger.warn('Gazette links not found, continuing anyway');
      }
      
      // Extract HTML from rendered page
      const html = await page.content();
      const root = parse(html);
      
      // Extract gazettes using the same logic as fetch-based crawling
      const extractedGazettes = await this.extractGazettesFromHTML(root, this.baseUrl);
      gazettes.push(...extractedGazettes);
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes with browser for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling with browser ${this.spiderConfig.name}:`, error as Error);
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (error) {
          logger.warn('Error closing page:', error as Error);
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (error) {
          logger.warn('Error closing browser:', error as Error);
        }
      }
    }

    return gazettes;
  }

  /**
   * Extract gazettes from HTML (shared logic for both fetch and browser methods)
   */
  private async extractGazettesFromHTML(root: any, baseUrl: string): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const startDate = new Date(this.dateRange.start);
    const endDate = new Date(this.dateRange.end);

    // Find all post links
    // Pattern: href="/jornal-cataguases-{date}/"
    // Example: /jornal-cataguases-28-de-dezembro-de-2025/
    const allLinks = root.querySelectorAll('a[href*="jornal-cataguases"]');
    
    logger.debug(`Found ${allLinks.length} potential gazette links`);

    // Portuguese month names
    const monthMap: Record<string, string> = {
      'janeiro': '01', 'fevereiro': '02', 'março': '03', 'marco': '03',
      'abril': '04', 'maio': '05', 'junho': '06',
      'julho': '07', 'agosto': '08', 'setembro': '09',
      'outubro': '10', 'novembro': '11', 'dezembro': '12'
    };

    const processedUrls = new Set<string>();

    for (const link of allLinks) {
      try {
        const href = link.getAttribute('href') || '';
        if (!href || processedUrls.has(href)) {
          continue;
        }

        // Extract date from URL
        // Pattern: /jornal-cataguases-{day}-de-{month}-de-{year}/
        const urlMatch = href.match(/jornal-cataguases-(\d+)-de-(\w+)-de-(\d{4})/i);
        
        if (!urlMatch) {
          continue;
        }

        const [, day, monthName, year] = urlMatch;
        const month = monthMap[monthName.toLowerCase()];
        
        if (!month) {
          logger.warn(`Unknown month: ${monthName} in URL: ${href}`);
          continue;
        }

        const gazetteDate = new Date(`${year}-${month}-${day}`);

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

        // Make URL absolute
        let postUrl = href;
        if (!postUrl.startsWith('http')) {
          const baseUrlObj = new URL(baseUrl);
          postUrl = `${baseUrlObj.origin}${postUrl.startsWith('/') ? '' : '/'}${postUrl}`;
        }

        // Fetch the post page to get the PDF URL
        logger.debug(`Fetching post page: ${postUrl}`);
        const postHtml = await this.fetch(postUrl);
        const postRoot = parse(postHtml);

        // Find PDF links in the post
        // Try multiple strategies to find the PDF
        let pdfUrl = '';
        
        // Strategy 1: Look for PDF links with specific patterns (JC-, jornal, Jornal, wp-content/uploads)
        const pdfLinks = postRoot.querySelectorAll('a[href*=".pdf"], embed[src*=".pdf"], iframe[src*=".pdf"], object[data*=".pdf"], source[src*=".pdf"]');
        
        for (const pdfLink of pdfLinks) {
          const pdfHref = pdfLink.getAttribute('href') || 
                         pdfLink.getAttribute('src') || 
                         pdfLink.getAttribute('data') || '';
          if (pdfHref && pdfHref.includes('.pdf')) {
            // Prefer links with specific keywords
            if (pdfHref.includes('JC-') || pdfHref.includes('jornal') || pdfHref.includes('Jornal') || pdfHref.includes('wp-content/uploads')) {
              pdfUrl = pdfHref;
              logger.debug(`Found PDF with keyword match: ${pdfUrl}`);
              break;
            }
            // If no keyword match yet, save the first PDF found as fallback
            if (!pdfUrl) {
              pdfUrl = pdfHref;
            }
          }
        }

        // Strategy 2: Look for download links or wp-content/uploads
        if (!pdfUrl) {
          const downloadLinks = postRoot.querySelectorAll('a[href*="download"], a[href*="wp-content/uploads"], a[href*="wp-content"]');
          for (const dlLink of downloadLinks) {
            const dlHref = dlLink.getAttribute('href') || '';
            if (dlHref.includes('.pdf')) {
              pdfUrl = dlHref;
              logger.debug(`Found PDF in download/uploads link: ${pdfUrl}`);
              break;
            }
          }
        }

        // Strategy 3: Look for any PDF link in the post content area
        if (!pdfUrl) {
          const contentArea = postRoot.querySelector('.entry-content, .post-content, article, .content, main');
          if (contentArea) {
            const contentPdfLinks = contentArea.querySelectorAll('a[href*=".pdf"]');
            if (contentPdfLinks.length > 0) {
              const firstPdf = contentPdfLinks[0].getAttribute('href') || '';
              if (firstPdf) {
                pdfUrl = firstPdf;
                logger.debug(`Found PDF in content area: ${pdfUrl}`);
              }
            }
          }
        }

        // Strategy 4: Fallback - any PDF link in the entire post
        if (!pdfUrl) {
          const allPdfLinks = postRoot.querySelectorAll('a[href*=".pdf"]');
          if (allPdfLinks.length > 0) {
            const firstPdf = allPdfLinks[0].getAttribute('href') || '';
            if (firstPdf) {
              pdfUrl = firstPdf;
              logger.debug(`Using first PDF link found as fallback: ${pdfUrl}`);
            }
          }
        }

        if (!pdfUrl) {
          logger.warn(`No PDF URL found for post: ${postUrl}`);
          continue;
        }

        // Make PDF URL absolute
        if (!pdfUrl.startsWith('http')) {
          const baseUrlObj = new URL(postUrl);
          pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
        }

        // Extract edition number from PDF filename or post title if possible
        const postTitle = postRoot.querySelector('h1, .entry-title, .post-title')?.textContent || '';
        const editionMatch = postTitle.match(/[Ee]di[çc][ãa]o\s+[nN]?[°º]?\s*(\d+)/i) || 
                             pdfUrl.match(/[Ee]di[çc][ãa]o[_-]?(\d+)/i);
        const editionNumber = editionMatch ? editionMatch[1] : undefined;

        // Create gazette
        const gazette = await this.createGazette(gazetteDate, pdfUrl, {
          editionNumber,
          isExtraEdition: postTitle.toLowerCase().includes('extra') || href.toLowerCase().includes('extra'),
          power: 'executive_legislative',
          sourceText: postTitle || `Jornal Cataguases - ${day}/${month}/${year}`,
        });

        if (gazette) {
          gazettes.push(gazette);
        }

      } catch (error) {
        logger.error(`Error processing link:`, error as Error);
      }
    }

    return gazettes;
  }
}

