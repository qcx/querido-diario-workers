import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Configuration interface for Prefeitura Alfenas Atos Oficiais spider
 */
export interface PrefeituraAlfenasAtosOficiaisConfig {
  type: 'prefeituraalfenasatosoficiais';
  /** Base URL for the Atos Oficiais page */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Spider for Prefeitura de Alfenas Atos Oficiais
 * 
 * Site Structure:
 * - URL: https://www.alfenas.mg.gov.br/publicacoes/atos-oficiais
 * - List of official acts (decrees, ordinances, administrative processes)
 * - Each item has a title and a PDF download link
 * - Uses "Visualizar Download" links
 * 
 * Data Structure per gazette:
 * - Title/Description (may contain dates)
 * - PDF download link
 * 
 * Requires browser rendering due to JavaScript-heavy page
 */
export class PrefeituraAlfenasAtosOficiaisSpider extends BaseSpider {
  protected atosConfig: PrefeituraAlfenasAtosOficiaisConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.atosConfig = spiderConfig.config as PrefeituraAlfenasAtosOficiaisConfig;
    this.browser = browser || null;
    
    if (!this.atosConfig.baseUrl) {
      throw new Error(`PrefeituraAlfenasAtosOficiaisSpider requires a baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraAlfenasAtosOficiaisSpider for ${spiderConfig.name} with URL: ${this.atosConfig.baseUrl}`, {
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
    
    if (!this.browser) {
      throw new Error('PrefeituraAlfenasAtosOficiaisSpider requires browser rendering');
    }
    
    return this.crawlWithBrowser();
  }

  /**
   * Browser-based crawling for Atos Oficiais page
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Navigate to the atos oficiais page
      logger.debug(`Navigating to: ${this.atosConfig.baseUrl}`);
      await page.goto(this.atosConfig.baseUrl, { waitUntil: 'networkidle0', timeout: 45000 });
      this.requestCount++;
      
      // Wait for page to stabilize and JavaScript to load the content
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Wait for content to load
      try {
        await page.waitForSelector('a[href*=".pdf"], .view-pdf, a:contains("Visualizar")', { timeout: 15000 });
      } catch (error) {
        logger.warn('Content not found immediately, continuing anyway');
      }
      
      // Additional wait for JavaScript to finish loading content
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extract gazettes from the page
      const pageGazettes = await this.extractGazettesFromPage(page);
      
      // Filter by date range and add to collection
      for (const gazette of pageGazettes) {
        if (gazette) {
          const gazetteDate = new Date(gazette.date);
          
          if (this.isInDateRange(gazetteDate)) {
            gazettes.push(gazette);
          }
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from browser`);
      
    } catch (error) {
      logger.error(`Error crawling with browser:`, error as Error);
      throw error;
    } finally {
      // Clean up
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
      // Extract gazette elements from the page
      const gazetteData = await page.evaluate(() => {
        const data: any[] = [];
        
        // Look for items with PDF links
        // Structure: Each item has a title and "Visualizar Download" link
        // Example: "Portaria Nº 138, de 01 de Julho de 2022 (Arquivo PDF) Visualizar Download"
        
        // Strategy 1: Look for all links that contain "Visualizar" or "Download"
        const allLinks = document.querySelectorAll('a');
        const processedUrls = new Set<string>();
        
        for (const link of Array.from(allLinks)) {
          const linkText = link.textContent?.trim() || '';
          const href = link.getAttribute('href') || '';
          
          // Check if this is a PDF link or download link
          if ((linkText.includes('Visualizar') || 
               linkText.includes('Download') ||
               href.includes('.pdf') ||
               href.includes('download')) && 
              !processedUrls.has(href)) {
            
            processedUrls.add(href);
            
            // Find the parent container that contains both title and link
            let container = link.parentElement;
            let title = '';
            let dateText = '';
            
            // Go up the DOM tree to find the container with the full text
            while (container && container !== document.body) {
              const containerText = container.textContent || '';
              
              // Skip if this container is too large (likely the whole page)
              if (containerText.length > 2000) {
                container = container.parentElement;
                continue;
              }
              
              // Check if this container has both the title and the link
              if (container.contains(link) && containerText.length > linkText.length) {
                // Extract title (everything before "Visualizar" or "Download")
                title = containerText
                  .replace(/Visualizar.*?Download.*?/gi, '')
                  .replace(/\(Arquivo PDF\).*?/gi, '')
                  .trim();
                
                // Extract date from the container text
                // Pattern 1: "de DD de Mês de YYYY" (e.g., "de 01 de Julho de 2022")
                const dateMatch1 = containerText.match(/(\d{2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
                if (dateMatch1) {
                  const months: Record<string, string> = {
                    'janeiro': '01', 'fevereiro': '02', 'março': '03', 'marco': '03',
                    'abril': '04', 'maio': '05', 'junho': '06', 
                    'julho': '07', 'agosto': '08', 'setembro': '09',
                    'outubro': '10', 'novembro': '11', 'dezembro': '12'
                  };
                  const monthNum = months[dateMatch1[2].toLowerCase()];
                  if (monthNum) {
                    dateText = `${dateMatch1[1]}/${monthNum}/${dateMatch1[3]}`;
                  }
                }
                
                // Pattern 2: "DD/MM/YYYY"
                if (!dateText) {
                  const dateMatch2 = containerText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                  if (dateMatch2) {
                    dateText = `${dateMatch2[1]}/${dateMatch2[2]}/${dateMatch2[3]}`;
                  }
                }
                
                // Pattern 3: Year in process number (e.g., "PROC Nº001/2023")
                if (!dateText) {
                  const procMatch = containerText.match(/PROC\s*N[°º]?\s*\d+\/(\d{4})/i);
                  if (procMatch) {
                    dateText = `01/01/${procMatch[1]}`;
                  }
                }
                
                // Pattern 4: Any year in the text (use as fallback)
                if (!dateText) {
                  const yearMatch = containerText.match(/\/(\d{4})/);
                  if (yearMatch && parseInt(yearMatch[1]) >= 2000 && parseInt(yearMatch[1]) <= 2100) {
                    dateText = `01/01/${yearMatch[1]}`;
                  }
                }
                
                if (title && dateText && href) {
                  data.push({
                    title,
                    dateText,
                    pdfUrl: href,
                  });
                }
                
                break; // Found the container, move to next link
              }
              
              container = container.parentElement;
            }
          }
        }
        
        // Strategy 2: Look for items in list or container structure (fallback)
        // Try to find parent containers that have both title and PDF link
        if (data.length === 0) {
          const containers = document.querySelectorAll('div, li, article, .item, [class*="documento"], [class*="ato"]');
        
        for (const container of Array.from(containers)) {
          const containerText = container.textContent || '';
          
          // Skip empty containers or headers
          if (containerText.trim() === '' || containerText.includes('BAIXAR ARQUIVOS')) {
            continue;
          }
          
          // Look for PDF link in this container
          const pdfLink = container.querySelector('a[href*=".pdf"]');
          if (!pdfLink) {
            // Check for links with "Visualizar" or "Download" text
            const allContainerLinks = container.querySelectorAll('a');
            for (const link of allContainerLinks) {
              const linkText = link.textContent || '';
              const href = link.getAttribute('href') || '';
              
              if (linkText.includes('Visualizar') || 
                  linkText.includes('Download') ||
                  href.includes('.pdf') ||
                  href.includes('download')) {
                const pdfUrl = href;
                const title = containerText.split('Visualizar')[0].split('Download')[0].trim();
                
                // Try to extract date from title or container text
                let dateText = '';
                
                // Look for date patterns in the text
                // Pattern 1: "de DD de Mês de YYYY" (e.g., "de 01 de Julho de 2022")
                const dateMatch1 = containerText.match(/(\d{2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
                if (dateMatch1) {
                  const months: Record<string, string> = {
                    'janeiro': '01', 'fevereiro': '02', 'março': '03', 'marco': '03',
                    'abril': '04', 'maio': '05', 'junho': '06', 
                    'julho': '07', 'agosto': '08', 'setembro': '09',
                    'outubro': '10', 'novembro': '11', 'dezembro': '12'
                  };
                  const monthNum = months[dateMatch1[2].toLowerCase()];
                  if (monthNum) {
                    dateText = `${dateMatch1[1]}/${monthNum}/${dateMatch1[3]}`;
                  }
                }
                
                // Pattern 2: "DD/MM/YYYY"
                if (!dateText) {
                  const dateMatch2 = containerText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                  if (dateMatch2) {
                    dateText = `${dateMatch2[1]}/${dateMatch2[2]}/${dateMatch2[3]}`;
                  }
                }
                
                // Pattern 3: Year in title (use as fallback - set to Jan 1 of that year)
                if (!dateText) {
                  const yearMatch = containerText.match(/\/(\d{4})/);
                  if (yearMatch) {
                    dateText = `01/01/${yearMatch[1]}`;
                  }
                }
                
                if (pdfUrl && dateText) {
                  data.push({
                    title,
                    dateText,
                    pdfUrl,
                  });
                }
                
                break; // Found a PDF link, move to next container
              }
            }
          } else {
            // Found PDF link directly
            const pdfUrl = pdfLink.getAttribute('href') || '';
            const containerTextWithoutLink = containerText.replace(/\s*Visualizar.*?Download.*?/gi, '').trim();
            const title = containerTextWithoutLink;
            
            // Try to extract date
            let dateText = '';
            
            // Pattern 1: "de DD de Mês de YYYY"
            const dateMatch1 = containerText.match(/(\d{2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
            if (dateMatch1) {
              const months: Record<string, string> = {
                'janeiro': '01', 'fevereiro': '02', 'março': '03', 'marco': '03',
                'abril': '04', 'maio': '05', 'junho': '06', 
                'julho': '07', 'agosto': '08', 'setembro': '09',
                'outubro': '10', 'novembro': '11', 'dezembro': '12'
              };
              const monthNum = months[dateMatch1[2].toLowerCase()];
              if (monthNum) {
                dateText = `${dateMatch1[1]}/${monthNum}/${dateMatch1[3]}`;
              }
            }
            
            // Pattern 2: "DD/MM/YYYY"
            if (!dateText) {
              const dateMatch2 = containerText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
              if (dateMatch2) {
                dateText = `${dateMatch2[1]}/${dateMatch2[2]}/${dateMatch2[3]}`;
              }
            }
            
            // Pattern 3: Year in text
            if (!dateText) {
              const yearMatch = containerText.match(/\/(\d{4})/);
              if (yearMatch) {
                dateText = `01/01/${yearMatch[1]}`;
              }
            }
            
            if (pdfUrl && dateText) {
              data.push({
                title,
                dateText,
                pdfUrl,
              });
            }
          }
        }
        }
        
        // Strategy 3: Direct link extraction (fallback)
        if (data.length === 0) {
          const directPdfLinks = document.querySelectorAll('a[href*=".pdf"]');
          for (const link of Array.from(directPdfLinks)) {
            const pdfUrl = link.getAttribute('href') || '';
            const linkText = link.textContent || '';
            const parent = link.parentElement;
            const parentText = parent?.textContent || '';
            const fullText = `${parentText} ${linkText}`;
            
            // Extract date
            let dateText = '';
            
            // Try date patterns
            const dateMatch1 = fullText.match(/(\d{2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
            if (dateMatch1) {
              const months: Record<string, string> = {
                'janeiro': '01', 'fevereiro': '02', 'março': '03', 'marco': '03',
                'abril': '04', 'maio': '05', 'junho': '06', 
                'julho': '07', 'agosto': '08', 'setembro': '09',
                'outubro': '10', 'novembro': '11', 'dezembro': '12'
              };
              const monthNum = months[dateMatch1[2].toLowerCase()];
              if (monthNum) {
                dateText = `${dateMatch1[1]}/${monthNum}/${dateMatch1[3]}`;
              }
            }
            
            if (!dateText) {
              const dateMatch2 = fullText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
              if (dateMatch2) {
                dateText = `${dateMatch2[1]}/${dateMatch2[2]}/${dateMatch2[3]}`;
              }
            }
            
            if (!dateText) {
              const yearMatch = fullText.match(/\/(\d{4})/);
              if (yearMatch) {
                dateText = `01/01/${yearMatch[1]}`;
              }
            }
            
            if (pdfUrl && dateText) {
              data.push({
                title: fullText.substring(0, 200),
                dateText,
                pdfUrl,
              });
            }
          }
        }
        
        return data;
      });
      
      logger.debug(`Found ${gazetteData.length} gazette items on page`);
      
      // Process each gazette item
      for (const item of gazetteData) {
        try {
          // Parse date (DD/MM/YYYY format)
          const dateMatch = item.dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) {
            logger.warn(`Could not parse date: ${item.dateText}`);
            continue;
          }
          
          const [, day, month, year] = dateMatch;
          const gazetteDate = new Date(`${year}-${month}-${day}`);
          
          // Validate date
          if (isNaN(gazetteDate.getTime())) {
            logger.warn(`Invalid date: ${item.dateText}`);
            continue;
          }
          
          // Construct full PDF URL if relative
          let pdfUrl = item.pdfUrl;
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.atosConfig.baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }
          
          // Create gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            isExtraEdition: false,
            power: 'executive',
            sourceText: item.title || `Atos Oficiais - ${item.dateText}`,
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

