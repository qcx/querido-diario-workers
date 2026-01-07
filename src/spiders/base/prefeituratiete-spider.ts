import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituratieteeConfig } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for Prefeitura de Tietê official gazette portal
 * 
 * Site Structure:
 * - Page URL: https://www.tiete.sp.gov.br/diariooficial.php
 * - List organized by months (e.g., "Dezembro / 2025")
 * - Each month contains multiple edition links (e.g., "Edição 342-A", "Edição 342-B")
 * - PDFs at: https://www.tiete.sp.gov.br/imprensa_oficial/{YYYY}_{MM}_{EDITION}.pdf
 * 
 * The site doesn't provide exact publication dates for each edition,
 * so we use the month/year from the heading and the day of month defaults to 1.
 * 
 * Requires browser rendering for proper link extraction
 */
export class PrefeituratieteeSpider extends BaseSpider {
  private platformConfig: PrefeituratieteeConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.platformConfig = spiderConfig.config as PrefeituratieteeConfig;
    this.browser = browser || null;

    const baseUrl = this.platformConfig.url || this.platformConfig.baseUrl;
    if (!baseUrl) {
      throw new Error(`PrefeituratieteeSpider requires url or baseUrl in config for ${spiderConfig.name}`);
    }

    logger.info(`PrefeituratieteeSpider initialized for ${spiderConfig.name} with URL: ${baseUrl}`);
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(`PrefeituratieteeSpider for ${this.spiderConfig.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    const baseUrl = this.platformConfig.url || this.platformConfig.baseUrl!;
    
    logger.info(`Crawling Prefeitura Tietê for ${this.spiderConfig.name}...`);

    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      
      // Navigate to the page
      logger.info(`Navigating to: ${baseUrl}`);
      await page.goto(baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Wait for page to stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extract all edition links with their month/year context
      const editionData = await page.evaluate(() => {
        const results: Array<{
          monthYear: string;
          editionName: string;
          pdfUrl: string;
        }> = [];
        
        // Find all list items containing "/ 20" which indicates month/year format
        const listItems = document.querySelectorAll('li');
        
        for (const li of Array.from(listItems)) {
          const liText = li.textContent || '';
          
          // Match month/year format like "Dezembro / 2025"
          const monthYearMatch = liText.match(/(Janeiro|Fevereiro|Março|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro)\s*\/\s*(\d{4})/i);
          
          if (monthYearMatch) {
            const monthYear = `${monthYearMatch[1]} / ${monthYearMatch[2]}`;
            
            // Find all edition links within this list item
            const links = li.querySelectorAll('a[href*=".pdf"], a[href*="imprensa_oficial"]');
            
            for (const link of Array.from(links)) {
              const href = link.getAttribute('href');
              const text = link.textContent?.trim() || '';
              
              if (href && text.includes('Edição')) {
                results.push({
                  monthYear,
                  editionName: text,
                  pdfUrl: href
                });
              }
            }
          }
        }
        
        return results;
      });
      
      logger.info(`Found ${editionData.length} edition links on page`);
      
      // Portuguese month names to numbers
      const monthMap: Record<string, number> = {
        'janeiro': 1,
        'fevereiro': 2,
        'março': 3,
        'marco': 3,
        'abril': 4,
        'maio': 5,
        'junho': 6,
        'julho': 7,
        'agosto': 8,
        'setembro': 9,
        'outubro': 10,
        'novembro': 11,
        'dezembro': 12
      };
      
      // Process each edition
      for (const edition of editionData) {
        try {
          // Parse month/year
          const monthYearMatch = edition.monthYear.match(/(Janeiro|Fevereiro|Março|Marco|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro)\s*\/\s*(\d{4})/i);
          
          if (!monthYearMatch) {
            logger.warn(`Could not parse month/year from: ${edition.monthYear}`);
            continue;
          }
          
          const monthName = monthYearMatch[1].toLowerCase();
          const year = parseInt(monthYearMatch[2], 10);
          const month = monthMap[monthName];
          
          if (!month) {
            logger.warn(`Unknown month: ${monthName}`);
            continue;
          }
          
          // Create a date for the first day of the month
          // Since the site doesn't provide exact dates, we use the 1st of the month
          const gazetteDate = new Date(year, month - 1, 1);
          
          // Check if in date range (we use the whole month for range check)
          const monthStart = new Date(year, month - 1, 1);
          const monthEnd = new Date(year, month, 0); // Last day of the month
          
          const rangeStart = new Date(this.dateRange.start);
          const rangeEnd = new Date(this.dateRange.end);
          
          // Skip if the entire month is outside the date range
          if (monthEnd < rangeStart || monthStart > rangeEnd) {
            continue;
          }
          
          // Construct full PDF URL if needed
          let pdfUrl = edition.pdfUrl;
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }
          
          // Extract edition number from name (e.g., "Edição 342-A" -> "342-A")
          const editionMatch = edition.editionName.match(/Edição\s*(\d+[-\w]*)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;
          
          // Check if it's an extra edition (editions with letters like A, B, C)
          const isExtraEdition = !!editionNumber && /[-][A-Z]$/i.test(editionNumber);
          
          logger.debug(`Processing: ${edition.editionName} - ${edition.monthYear} -> ${pdfUrl}`);
          
          // Create gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber,
            isExtraEdition,
            power: 'executive_legislative',
            sourceText: `${edition.editionName} - ${edition.monthYear}`,
          });
          
          if (gazette) {
            gazettes.push(gazette);
          }
          
        } catch (error) {
          logger.error(`Error processing edition ${edition.editionName}:`, error as Error);
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from Prefeitura Tietê`);
      
    } catch (error) {
      logger.error(`Error crawling Prefeitura Tietê:`, error as Error);
      throw error;
    } finally {
      // Clean up
      if (page) {
        try {
          await page.close();
        } catch (e) {
          logger.warn('Error closing page', e as Error);
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (e) {
          logger.warn('Error closing browser', e as Error);
        }
      }
    }

    return gazettes;
  }
}

