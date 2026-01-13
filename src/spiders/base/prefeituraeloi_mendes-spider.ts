import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraEloiMendesConfig } from '../../types';
import { logger } from '../../utils/logger';
import { parse } from 'node-html-parser';

/**
 * PrefeituraEloiMendesSpider for Elói Mendes, MG WordPress category-based gazette site
 * 
 * Site Structure:
 * - WordPress category page with posts for each gazette edition
 * - Listing page: https://eloimendes.mg.gov.br/category/editais/concurso-publico/
 * - Pagination: /category/editais/concurso-publico/page/{N}/
 * - Each post contains a PDF link to the gazette
 * - Posts have dates in the post metadata
 * - Note: Only concurso-publico category found, no general atos/editions page available
 */
export class PrefeituraEloiMendesSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;
  private config: PrefeituraEloiMendesConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeituraEloiMendesConfig;
    this.baseUrl = this.config.url || 'https://eloimendes.mg.gov.br/category/editais/concurso-publico/';
    this.browser = browser || null;
    
    // Ensure base URL ends with /
    if (!this.baseUrl.endsWith('/')) {
      this.baseUrl += '/';
    }
    
    logger.info(`Initializing PrefeituraEloiMendesSpider for ${spiderConfig.name} with URL: ${this.baseUrl}`);
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.baseUrl} for ${this.spiderConfig.name}...`);
    
    // Check if browser rendering is required
    if (this.browser && this.config.requiresClientRendering === true) {
      return this.crawlWithBrowser();
    }
    
    // Try fetch first, but wp-file-download may require browser
    return this.crawlWithFetch();
  }

  /**
   * Crawl using fetch (no browser needed for this site)
   */
  private async crawlWithFetch(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let pageNum = 1;
    const maxPages = 100;
    let foundOlderThanRange = false;

    while (pageNum <= maxPages && !foundOlderThanRange) {
      const pageUrl = pageNum === 1 
        ? this.baseUrl 
        : `${this.baseUrl}page/${pageNum}/`;
      
      logger.debug(`Fetching page ${pageNum}: ${pageUrl}`);
      
      try {
        const html = await this.fetch(pageUrl);
        const root = parse(html);
        
        // Find all post elements
        // This site uses td_module_6 td_module_wrap structure (TagDiv theme)
        const articles = root.querySelectorAll('.td_module_wrap, .td_module_6, article, .post, .entry');
        
        if (articles.length === 0) {
          logger.info(`No articles found on page ${pageNum}, stopping`);
          break;
        }
        
        logger.debug(`Found ${articles.length} articles on page ${pageNum}`);
        
        for (const article of articles) {
          try {
            // Extract title and link - TagDiv uses h3.entry-title.td-module-title
            const titleLink = article.querySelector('h3.entry-title a, h3.td-module-title a, h2 a, h3 a, .entry-title a, .post-title a, a[rel="bookmark"]');
            if (!titleLink) {
              logger.debug(`No title link found in article`);
              continue;
            }
            
            const titleText = titleLink.text?.trim() || '';
            const detailUrl = titleLink.getAttribute('href');
            
            if (!detailUrl) {
              logger.debug(`No detail URL found for article: ${titleText}`);
              continue;
            }
            
            // Extract date from post metadata
            // TagDiv uses time.entry-date.updated.td-module-date with datetime attribute
            const dateElement = article.querySelector('time[datetime], time.entry-date, time.td-module-date, .entry-date, .post-date, .published, .td-post-date');
            let gazetteDate: Date | null = null;
            
            if (dateElement) {
              // Try to get date from datetime attribute
              const datetime = dateElement.getAttribute('datetime');
              if (datetime) {
                gazetteDate = new Date(datetime);
              } else {
                // Try to parse from text content
                const dateText = dateElement.textContent?.trim() || '';
                const dateMatch = dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/) || 
                                 dateText.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
                if (dateMatch) {
                  if (dateMatch[2]) {
                    // Portuguese format: "DD de mês de YYYY"
                    const monthMap: Record<string, string> = {
                      'janeiro': '01', 'fevereiro': '02', 'março': '03', 'marco': '03',
                      'abril': '04', 'maio': '05', 'junho': '06',
                      'julho': '07', 'agosto': '08', 'setembro': '09',
                      'outubro': '10', 'novembro': '11', 'dezembro': '12'
                    };
                    const month = monthMap[dateMatch[2].toLowerCase()];
                    if (month) {
                      const day = dateMatch[1].padStart(2, '0');
                      gazetteDate = new Date(`${dateMatch[3]}-${month}-${day}`);
                    }
                  } else {
                    // DD/MM/YYYY format
                    const [, day, month, year] = dateMatch;
                    gazetteDate = new Date(`${year}-${month}-${day}`);
                  }
                }
              }
            }
            
            // If no date found in metadata, try to extract from title
            if (!gazetteDate || isNaN(gazetteDate.getTime())) {
              const dateMatch = titleText.match(/(\d{2})\/(\d{2})\/(\d{4})/) ||
                               titleText.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
              if (dateMatch) {
                if (dateMatch[2]) {
                  // Portuguese format
                  const monthMap: Record<string, string> = {
                    'janeiro': '01', 'fevereiro': '02', 'março': '03', 'marco': '03',
                    'abril': '04', 'maio': '05', 'junho': '06',
                    'julho': '07', 'agosto': '08', 'setembro': '09',
                    'outubro': '10', 'novembro': '11', 'dezembro': '12'
                  };
                  const month = monthMap[dateMatch[2].toLowerCase()];
                  if (month) {
                    const day = dateMatch[1].padStart(2, '0');
                    gazetteDate = new Date(`${dateMatch[3]}-${month}-${day}`);
                  }
                } else {
                  // DD/MM/YYYY format
                  const [, day, month, year] = dateMatch;
                  gazetteDate = new Date(`${year}-${month}-${day}`);
                }
              }
            }
            
            if (!gazetteDate || isNaN(gazetteDate.getTime())) {
              logger.debug(`Could not parse date from article: ${titleText}`);
              continue;
            }
            
            // Check if older than range - stop pagination early
            if (gazetteDate < new Date(this.dateRange.start)) {
              foundOlderThanRange = true;
              continue;
            }
            
            // Skip if not in range
            if (!this.isInDateRange(gazetteDate)) {
              continue;
            }
            
            // Try to get PDF URL from article directly first
            let pdfUrl = this.extractPdfFromArticle(article);
            
            // If not found, navigate to detail page
            if (!pdfUrl) {
              pdfUrl = await this.getPdfUrlFromDetailPage(detailUrl);
            }
            
            if (!pdfUrl) {
              logger.warn(`No PDF URL found for: ${titleText}`);
              continue;
            }
            
            // Extract edition number from title
            const editionMatch = titleText.match(/[Ee]di[çc][ãa]o\s*[nN]?[°º]?\s*(\d+)/i) ||
                                titleText.match(/[Nn]°\s*(\d+)/i) ||
                                titleText.match(/(\d+)/);
            const editionNumber = editionMatch ? editionMatch[1] : undefined;
            
            // Check if it's an extra edition
            const isExtraEdition = titleText.toLowerCase().includes('extra') || 
                                   titleText.toLowerCase().includes('extraordinária');
            
            // Create gazette
            const gazette = await this.createGazette(gazetteDate, pdfUrl, {
              editionNumber,
              isExtraEdition,
              power: 'executive_legislative',
              sourceText: titleText,
            });
            
            if (gazette) {
              gazettes.push(gazette);
            }
            
          } catch (error) {
            logger.error(`Error processing article:`, error as Error);
          }
        }
        
        logger.debug(`Found ${gazettes.length} gazettes so far after page ${pageNum}`);
        
        // Check for next page link
        const nextPageLink = root.querySelector('a.next, a[rel="next"], .pagination-next a, .nav-next a');
        if (!nextPageLink && !foundOlderThanRange) {
          // Try checking if there's a page/N+1/ link
          const nextNum = pageNum + 1;
          const possibleNextLink = root.querySelector(`a[href*="/page/${nextNum}/"]`);
          if (!possibleNextLink) {
            logger.debug(`No next page link found, stopping pagination`);
            break;
          }
        }
        
        pageNum++;
        
      } catch (error) {
        if ((error as any).message?.includes('404') || (error as any).message?.includes('Not Found')) {
          logger.debug(`Page ${pageNum} returned 404, stopping pagination`);
          break;
        }
        logger.error(`Error fetching page ${pageNum}:`, error as Error);
        break;
      }
    }
    
    logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    return gazettes;
  }

  /**
   * Extract PDF URL directly from article element (if available)
   */
  private extractPdfFromArticle(article: any): string | null {
    // Look for PDF links in the article
    const pdfLink = article.querySelector('a[href$=".pdf"], a[href*=".pdf"]');
    if (pdfLink) {
      let pdfUrl = pdfLink.getAttribute('href');
      if (pdfUrl) {
        // Make absolute URL if relative
        if (!pdfUrl.startsWith('http')) {
          const baseUrlObj = new URL(this.baseUrl);
          pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
        }
        return pdfUrl;
      }
    }
    return null;
  }

  /**
   * Navigate to detail page and extract PDF URL
   */
  private async getPdfUrlFromDetailPage(detailUrl: string): Promise<string | null> {
    try {
      // Make absolute URL if relative
      let fullUrl = detailUrl;
      if (!detailUrl.startsWith('http')) {
        const baseUrlObj = new URL(this.baseUrl);
        fullUrl = `${baseUrlObj.origin}${detailUrl.startsWith('/') ? '' : '/'}${detailUrl}`;
      }
      
      logger.debug(`Fetching detail page: ${fullUrl}`);
      const html = await this.fetch(fullUrl);
      const root = parse(html);
      
      // Look for PDF download link
      // This site uses WP File Download plugin which stores links in:
      // 1. input.wpfd_file_preview_link_download[value] - hidden input with direct PDF URL
      // 2. a.wpfd_downloadlink[href] - download link
      // 3. tr.file.pdf - table rows with PDF files
      
      // First, try to find WP File Download hidden inputs (most reliable)
      const wpfdInputs = root.querySelectorAll('input.wpfd_file_preview_link_download');
      if (wpfdInputs.length > 0) {
        // Look for the main edital document (prefer "edital" in title, avoid "retificacao" and "despacho")
        let mainPdfUrl: string | null = null;
        let firstPdfUrl: string | null = null;
        
        for (const input of wpfdInputs) {
          const pdfUrl = input.getAttribute('value');
          const fileTitle = input.getAttribute('data-filetitle') || '';
          
          if (pdfUrl && pdfUrl.includes('.pdf')) {
            // Make absolute URL if relative
            let absoluteUrl = pdfUrl;
            if (!absoluteUrl.startsWith('http')) {
              const baseUrlObj = new URL(fullUrl);
              absoluteUrl = `${baseUrlObj.origin}${absoluteUrl.startsWith('/') ? '' : '/'}${absoluteUrl}`;
            }
            
            // Prefer edital/main document
            const titleLower = fileTitle.toLowerCase();
            if ((titleLower.includes('edital') || titleLower.includes('concurso')) && 
                !titleLower.includes('retificacao') && 
                !titleLower.includes('despacho') &&
                !titleLower.includes('anexo')) {
              mainPdfUrl = absoluteUrl;
              logger.debug(`Found main edital PDF: ${absoluteUrl}`);
              break;
            }
            
            // Store first PDF as fallback
            if (!firstPdfUrl) {
              firstPdfUrl = absoluteUrl;
            }
          }
        }
        
        if (mainPdfUrl) {
          return mainPdfUrl;
        }
        if (firstPdfUrl) {
          logger.debug(`Using first PDF found: ${firstPdfUrl}`);
          return firstPdfUrl;
        }
      }
      
      // Second, try WP File Download table rows
      const wpfdRows = root.querySelectorAll('tr.file.pdf');
      if (wpfdRows.length > 0) {
        for (const row of wpfdRows) {
          // Check for hidden input first
          const hiddenInput = row.querySelector('input.wpfd_file_preview_link_download');
          if (hiddenInput) {
            const pdfUrl = hiddenInput.getAttribute('value');
            const fileTitle = hiddenInput.getAttribute('data-filetitle') || '';
            
            if (pdfUrl && pdfUrl.includes('.pdf')) {
              let absoluteUrl = pdfUrl;
              if (!absoluteUrl.startsWith('http')) {
                const baseUrlObj = new URL(fullUrl);
                absoluteUrl = `${baseUrlObj.origin}${absoluteUrl.startsWith('/') ? '' : '/'}${absoluteUrl}`;
              }
              
              const titleLower = fileTitle.toLowerCase();
              if ((titleLower.includes('edital') || titleLower.includes('concurso')) && 
                  !titleLower.includes('retificacao') && 
                  !titleLower.includes('despacho')) {
                return absoluteUrl;
              }
            }
          }
          
          // Check for download link
          const downloadLink = row.querySelector('a.wpfd_downloadlink');
          if (downloadLink) {
            const pdfUrl = downloadLink.getAttribute('href');
            if (pdfUrl && pdfUrl.includes('.pdf')) {
              let absoluteUrl = pdfUrl;
              if (!absoluteUrl.startsWith('http')) {
                const baseUrlObj = new URL(fullUrl);
                absoluteUrl = `${baseUrlObj.origin}${absoluteUrl.startsWith('/') ? '' : '/'}${absoluteUrl}`;
              }
              return absoluteUrl;
            }
          }
        }
      }
      
      // Third, try standard PDF selectors
      const pdfSelectors = [
        'a.wpfd_downloadlink[href$=".pdf"]',
        'a.wpfd_downloadlink[href*=".pdf"]',
        'a[href$=".pdf"]',
        'a[href*=".pdf"]',
        '.wp-block-file a[href*=".pdf"]',
        '.td-post-content a[href*=".pdf"]',
        '.entry-content a[href*="uploads"]',
        'article a[href*=".pdf"]'
      ];
      
      for (const selector of pdfSelectors) {
        const pdfLink = root.querySelector(selector);
        if (pdfLink) {
          let pdfUrl = pdfLink.getAttribute('href');
          if (pdfUrl && pdfUrl.includes('.pdf')) {
            // Make absolute URL if relative
            if (!pdfUrl.startsWith('http')) {
              const baseUrlObj = new URL(fullUrl);
              pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
            }
            return pdfUrl;
          }
        }
      }
      
      // Check if there's a link to external portal (ibgpconcursos.com.br)
      // Some posts may link to external portal instead of direct PDFs
      const externalPortalLink = root.querySelector('a[href*="ibgpconcursos"], a[href*="portal"]');
      if (externalPortalLink) {
        const portalUrl = externalPortalLink.getAttribute('href');
        logger.debug(`Found external portal link: ${portalUrl} - PDFs may be hosted externally`);
        // For now, we'll skip these as they require additional navigation
        // In the future, we could add support for crawling the external portal
      }
      
      logger.debug(`No PDF link found on detail page: ${fullUrl}`);
      return null;
      
    } catch (error) {
      logger.warn(`Error getting PDF URL from ${detailUrl}`, error as Error);
      return null;
    }
  }
}
