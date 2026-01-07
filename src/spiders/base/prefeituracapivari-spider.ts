import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraCapivariConfig } from '../../types';
import { logger } from '../../utils/logger';

interface ElFinderFile {
  hash: string;
  name: string;
  mime: string;
  url?: string;
  phash?: string;
  ts?: number;
}

interface CapturedPdf {
  name: string;
  hash: string;
  url: string;
  year: number;
  month: number;
  editionNumber?: string;
}

/**
 * PrefeituraCapivariSpider for Capivari, SP elFinder-based gazette site
 * 
 * Site Structure:
 * - WordPress with File Manager Advanced plugin (elFinder)
 * - Page URL: https://capivari.sp.gov.br/portal/servicos/diario-oficial/
 * - elFinder interface with folder structure: /Diario Oficial/YYYY/MM - Month/
 * - Each month folder contains PDF files named like "Diário Oficial Ed 1410 - assinado.pdf"
 * 
 * Technical Details:
 * - elFinder loads via AJAX through admin-ajax.php?action=fma_load_shortcode_fma_secure
 * - API responses contain file hashes that can be used to construct download URLs
 * - Download URL format: baseApiUrl + &cmd=file&target=HASH&download=1
 * 
 * Requires browser rendering for JavaScript-rendered elFinder interface
 */
export class PrefeituraCapivariSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    const config = spiderConfig.config as PrefeituraCapivariConfig;
    this.baseUrl = config.url || config.baseUrl || 'https://capivari.sp.gov.br/portal/servicos/diario-oficial/';
    this.browser = browser || null;
    
    if (!this.baseUrl.endsWith('/')) {
      this.baseUrl += '/';
    }
    
    logger.info(`Initializing PrefeituraCapivariSpider for ${spiderConfig.name} with URL: ${this.baseUrl}`);
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.baseUrl} for ${this.config.name}...`);
    
    if (!this.browser) {
      logger.error(`PrefeituraCapivariSpider requires browser binding`);
      return [];
    }
    
    return this.crawlWithBrowser();
  }

  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page: any = null;

    // Store captured files from API responses with their hashes
    const fileHashMap: Map<string, ElFinderFile> = new Map();
    
    // Store the API base URL for constructing download URLs
    let apiBaseUrl = '';

    try {
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Set up request interception to capture elFinder API responses
      await page.setRequestInterception(true);
      
      page.on('request', (request: any) => {
        request.continue();
      });
      
      page.on('response', async (response: any) => {
        try {
          const url = response.url();
          if (url.includes('admin-ajax.php') && url.includes('fma_load_shortcode')) {
            // Capture the API base URL (remove cmd and target params for reuse)
            if (!apiBaseUrl) {
              // Keep everything up to and including the action parameter
              apiBaseUrl = url.split('&cmd=')[0];
              logger.debug(`Captured API base URL: ${apiBaseUrl.substring(0, 100)}...`);
            }
            
            const contentType = response.headers()['content-type'] || '';
            if (contentType.includes('application/json')) {
              const json = await response.json();
              
              // Extract files from the response
              const files = json.files || [];
              for (const file of files) {
                if (file.name && file.hash) {
                  // Store file by name for later lookup
                  const cleanName = file.name.trim();
                  fileHashMap.set(cleanName, file);
                  
                  if (file.mime === 'application/pdf' || cleanName.toLowerCase().endsWith('.pdf')) {
                    logger.debug(`Captured PDF hash: ${cleanName} -> ${file.hash}`);
                  }
                }
              }
            }
          }
        } catch (e) {
          // Ignore response parsing errors
        }
      });
      
      // Navigate to the page
      logger.debug(`Navigating to: ${this.baseUrl}`);
      await page.goto(this.baseUrl, { waitUntil: 'networkidle0', timeout: 60000 });
      this.requestCount++;
      
      // Wait for elFinder to load
      await page.waitForSelector('.elfinder', { timeout: 15000 }).catch(() => {
        logger.warn('elFinder container not found, waiting more...');
      });
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Get years to process
      const startYear = new Date(this.dateRange.start).getFullYear();
      const endYear = new Date(this.dateRange.end).getFullYear();
      const yearsToProcess: number[] = [];
      for (let year = endYear; year >= startYear; year--) {
        yearsToProcess.push(year);
      }
      
      logger.debug(`Years to process: ${yearsToProcess.join(', ')}`);
      
      // First, expand the "Diario Oficial" folder if needed
      await this.expandDiarioOficialFolder(page);
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Log available folders in the CWD panel
      const availableFolders = await this.getVisibleFolders(page);
      logger.debug(`Available folders in CWD: ${availableFolders.join(', ')}`);
      
      // Store captured PDFs with their context
      const capturedPdfs: CapturedPdf[] = [];
      
      // Navigate to each year folder
      for (const year of yearsToProcess) {
        try {
          logger.debug(`Navigating to year ${year}`);
          
          // Double-click on year folder
          const yearClicked = await this.doubleClickFolder(page, String(year));
          
          if (!yearClicked) {
            logger.debug(`Year ${year} folder not found in CWD`);
            continue;
          }
          
          logger.debug(`Entered year folder: ${year}`);
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          // Get items in year folder (should be month folders)
          const itemsInYear = await this.getVisibleItems(page);
          const monthFolders = itemsInYear.filter(item => !item.isPdf);
          const directPdfs = itemsInYear.filter(item => item.isPdf);
          
          logger.debug(`Year ${year}: ${directPdfs.length} PDFs, ${monthFolders.length} month folders`);
          
          // Get month range to process for this year
          const startMonth = year === startYear ? new Date(this.dateRange.start).getMonth() + 1 : 1;
          const endMonth = year === endYear ? new Date(this.dateRange.end).getMonth() + 1 : 12;
          
          // Process each month folder
          for (const monthFolder of monthFolders) {
            // Extract month number from folder name (e.g., "01- Janeiro" -> 1)
            const monthMatch = monthFolder.name.match(/^(\d{1,2})/);
            if (!monthMatch) continue;
            
            const monthNum = parseInt(monthMatch[1], 10);
            if (monthNum < startMonth || monthNum > endMonth) {
              logger.debug(`Skipping month ${monthFolder.name} - outside date range (${startMonth}-${endMonth})`);
              continue;
            }
            
            logger.debug(`Entering month folder: ${monthFolder.name}`);
            
            // Double-click on month folder
            const monthClicked = await this.doubleClickFolder(page, monthFolder.name);
            if (!monthClicked) {
              logger.warn(`Could not enter month folder: ${monthFolder.name}`);
              continue;
            }
            
            // Wait for content to load and API response to be captured
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Get PDFs in this month folder
            const pdfsInMonth = await this.getVisibleItems(page);
            const pdfFiles = pdfsInMonth.filter(item => item.isPdf);
            
            logger.debug(`Found ${pdfFiles.length} PDFs in month ${monthFolder.name}`);
            
            // Process each PDF - look up its hash from the captured API responses
            for (const pdfFile of pdfFiles) {
              try {
                // Look up the file hash from captured API responses
                const fileInfo = fileHashMap.get(pdfFile.name);
                
                if (fileInfo && fileInfo.hash) {
                  // Construct download URL using the hash
                  const downloadUrl = this.constructDownloadUrl(apiBaseUrl, fileInfo.hash);
                  
                  if (downloadUrl) {
                    const editionMatch = pdfFile.name.match(/[Ee]d(?:i[çc][ãa]o)?\s*(\d+)/i);
                    const editionNumber = editionMatch ? editionMatch[1] : undefined;
                    
                    capturedPdfs.push({
                      name: pdfFile.name,
                      hash: fileInfo.hash,
                      url: downloadUrl,
                      year,
                      month: monthNum,
                      editionNumber,
                    });
                    logger.debug(`Captured PDF: ${pdfFile.name} (hash: ${fileInfo.hash})`);
                  }
                } else {
                  logger.warn(`No hash found for PDF: ${pdfFile.name}`);
                }
              } catch (pdfError) {
                logger.warn(`Error processing PDF ${pdfFile.name}: ${pdfError instanceof Error ? pdfError.message : String(pdfError)}`);
              }
            }
            
            // Go back to year folder
            await this.goUp(page);
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
          
          // Process direct PDFs in year folder (if any)
          if (directPdfs.length > 0) {
            for (const pdfFile of directPdfs) {
              try {
                const fileInfo = fileHashMap.get(pdfFile.name);
                
                if (fileInfo && fileInfo.hash) {
                  const downloadUrl = this.constructDownloadUrl(apiBaseUrl, fileInfo.hash);
                  
                  if (downloadUrl) {
                    const editionMatch = pdfFile.name.match(/[Ee]d(?:i[çc][ãa]o)?\s*(\d+)/i);
                    const editionNumber = editionMatch ? editionMatch[1] : undefined;
                    
                    capturedPdfs.push({
                      name: pdfFile.name,
                      hash: fileInfo.hash,
                      url: downloadUrl,
                      year,
                      month: 1,
                      editionNumber,
                    });
                    logger.debug(`Captured direct PDF: ${pdfFile.name}`);
                  }
                }
              } catch (pdfError) {
                logger.warn(`Error processing direct PDF ${pdfFile.name}`);
              }
            }
          }
          
          // Go back to root
          await this.goUp(page);
          await new Promise(resolve => setTimeout(resolve, 1500));
          
        } catch (yearError) {
          logger.warn(`Error processing year ${year}: ${yearError instanceof Error ? yearError.message : String(yearError)}`);
        }
      }
      
      logger.debug(`Total captured PDFs: ${capturedPdfs.length}`);
      logger.debug(`Total hashes in map: ${fileHashMap.size}`);
      
      // Create gazettes from captured PDFs
      for (const pdf of capturedPdfs) {
        try {
          // Try to extract date from filename first
          let gazetteDate = this.extractDateFromFilename(pdf.name);
          
          // If no date in filename, use the first day of the month
          if (!gazetteDate) {
            gazetteDate = new Date(pdf.year, pdf.month - 1, 1);
            logger.debug(`Using inferred date for ${pdf.name}: ${gazetteDate.toISOString().split('T')[0]}`);
          }
          
          if (!this.isInDateRange(gazetteDate)) {
            logger.debug(`PDF ${pdf.name} outside date range`);
            continue;
          }
          
          const isExtraEdition = pdf.name.toLowerCase().includes('extra');
          
          const gazette = await this.createGazette(gazetteDate, pdf.url, {
            editionNumber: pdf.editionNumber,
            isExtraEdition,
            power: 'executive_legislative',
            sourceText: pdf.name,
          });
          
          if (gazette) {
            gazettes.push(gazette);
            logger.debug(`Created gazette: ${pdf.name}`);
          }
          
        } catch (error) {
          logger.error(`Error creating gazette for: ${pdf.name}`, error as Error);
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`);
      
    } catch (error) {
      logger.error(`Error during browser crawl:`, error as Error);
    } finally {
      if (page) {
        try { await page.close(); } catch (e) { /* ignore */ }
      }
      if (browserInstance) {
        try { await browserInstance.close(); } catch (e) { /* ignore */ }
      }
    }
    
    return gazettes;
  }

  /**
   * Construct a download URL for a file using its hash
   */
  private constructDownloadUrl(apiBaseUrl: string, hash: string): string {
    if (!apiBaseUrl || !hash) {
      return '';
    }
    
    // The download URL is the API base URL with cmd=file and target=hash
    // Format: baseApiUrl&cmd=file&target=HASH&download=1
    return `${apiBaseUrl}&cmd=file&target=${hash}&download=1`;
  }

  /**
   * Double-click on a folder to open it
   */
  private async doubleClickFolder(page: any, folderName: string): Promise<boolean> {
    const selector = `.elfinder-cwd-file .elfinder-cwd-filename`;
    const allFilenames = await page.$$(selector);
    
    for (const el of allFilenames) {
      const text = await el.evaluate((e: Element) => e.textContent?.trim() || '');
      if (text === folderName) {
        // Double-click on the element
        await el.click({ clickCount: 2 });
        return true;
      }
    }
    
    return false;
  }

  /**
   * Navigate up one level in elFinder
   */
  private async goUp(page: any): Promise<void> {
    await page.evaluate(() => {
      const upButton = 
        document.querySelector('.elfinder-button-icon-up') ||
        document.querySelector('.elfinder-buttonicon-up') ||
        document.querySelector('[class*="up"]');
      
      if (upButton) {
        const parent = upButton.closest('.elfinder-button') || upButton.closest('div');
        if (parent) {
          (parent as HTMLElement).click();
        } else {
          (upButton as HTMLElement).click();
        }
      }
    });
  }

  /**
   * Get visible folder names in CWD
   */
  private async getVisibleFolders(page: any): Promise<string[]> {
    return page.evaluate(() => {
      const folders: string[] = [];
      const cwdFiles = document.querySelectorAll('.elfinder-cwd-file');
      
      for (const file of Array.from(cwdFiles)) {
        const nameEl = file.querySelector('.elfinder-cwd-filename');
        const name = nameEl?.textContent?.trim();
        const isPdf = name?.toLowerCase().endsWith('.pdf') || file.querySelector('[class*="pdf"]') !== null;
        if (name && !isPdf) {
          folders.push(name);
        }
      }
      
      return folders;
    });
  }

  /**
   * Get all visible items (folders and files) in CWD
   */
  private async getVisibleItems(page: any): Promise<{ name: string; isPdf: boolean }[]> {
    return page.evaluate(() => {
      const items: { name: string; isPdf: boolean }[] = [];
      const cwdFiles = document.querySelectorAll('.elfinder-cwd-file');
      
      for (const file of Array.from(cwdFiles)) {
        const nameEl = file.querySelector('.elfinder-cwd-filename');
        const name = nameEl?.textContent?.trim() || '';
        const isPdf = name.toLowerCase().endsWith('.pdf') || file.querySelector('[class*="pdf"]') !== null;
        items.push({ name, isPdf });
      }
      
      return items;
    });
  }

  /**
   * Expand the "Diario Oficial" folder in the tree
   */
  private async expandDiarioOficialFolder(page: any): Promise<void> {
    try {
      await page.evaluate(() => {
        const treeItems = document.querySelectorAll('.elfinder-navbar-dir, .elfinder-nav-dir');
        for (const item of Array.from(treeItems)) {
          const text = item.textContent?.trim().toLowerCase();
          if (text?.includes('diario') && text?.includes('oficial')) {
            (item as HTMLElement).click();
            return true;
          }
        }
        return false;
      });
    } catch (e) {
      logger.debug('Error expanding Diario Oficial folder');
    }
  }

  /**
   * Extract date from filename
   */
  private extractDateFromFilename(filename: string): Date | null {
    // Pattern: DD-MM-YYYY or DD/MM/YYYY or DD.MM.YYYY
    let match = filename.match(/(\d{2})[-\/.](\d{2})[-\/.](\d{4})/);
    if (match) {
      const [, day, month, year] = match;
      const date = new Date(`${year}-${month}-${day}`);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
    
    // Pattern: YYYY-MM-DD
    match = filename.match(/(\d{4})[-\/.](\d{2})[-\/.](\d{2})/);
    if (match) {
      const [, year, month, day] = match;
      const date = new Date(`${year}-${month}-${day}`);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
    
    // Pattern: DDMMYYYY (no separator)
    match = filename.match(/(\d{2})(\d{2})(\d{4})/);
    if (match) {
      const [, day, month, year] = match;
      const date = new Date(`${year}-${month}-${day}`);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
    
    return null;
  }
}
