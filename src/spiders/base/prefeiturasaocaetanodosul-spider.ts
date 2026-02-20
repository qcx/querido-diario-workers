import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeiturasaocaetanodosulConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { getCurrentTimestamp } from '../../utils/date-utils';

interface PublicationData {
  date: string;
  editionNumber: string;
  title: string;
  organs: string;
  isExtra: boolean;
  buttonName: string;
}

/**
 * Spider for Prefeitura de São Caetano do Sul official gazette
 * 
 * Site structure (ASP.NET WebForms):
 * - Page URL: https://diariooficial.saocaetanodosul.sp.gov.br/publico/Default.aspx
 * - Main list of publications with download buttons (input type="image")
 * - Pagination via "Mais Antigos" button to load older publications
 * - Each publication has: edition number, date, title, organs
 * - Download buttons trigger popup with PDF
 * 
 * Strategy:
 * - Parse the publication list directly from the page
 * - Use pagination to load more publications until we find dates outside our range
 * - For each publication in range, click the download button and capture the PDF URL
 */
export class PrefeiturasaocaetanodosulSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeiturasaocaetanodosulConfig;
    this.baseUrl = platformConfig.baseUrl || 'https://diariooficial.saocaetanodosul.sp.gov.br/publico/Default.aspx';
    this.browser = browser || null;
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(`PrefeiturasaocaetanodosulSpider for ${this.config.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura São Caetano do Sul for ${this.config.name}...`);

    let browserInstance = null;
    let page = null;

    try {
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      
      // Set up popup handler to capture PDF URLs
      const pdfUrls: Map<string, string> = new Map();
      
      browserInstance.on('targetcreated', async (target: any) => {
        const url = target.url();
        if (url && (url.endsWith('.pdf') || url.includes('.pdf') || url.includes('Visualizador'))) {
          logger.debug(`Captured PDF URL from popup: ${url}`);
          // Store with timestamp as key
          pdfUrls.set(Date.now().toString(), url);
        }
      });

      logger.info(`Navigating to: ${this.baseUrl}`);
      await page.goto(this.baseUrl, { waitUntil: 'networkidle0', timeout: 60000 });
      this.requestCount++;
      
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Parse publications from the list
      let continueLoading = true;
      let maxPages = 50; // Safety limit
      let currentPage = 0;
      const seenEditions = new Set<string>();

      while (continueLoading && currentPage < maxPages) {
        currentPage++;
        
        // Extract publications from current page
        const publications = await this.extractPublications(page);
        logger.info(`Page ${currentPage}: Found ${publications.length} publications`);

        if (publications.length === 0) {
          continueLoading = false;
          break;
        }

        let foundOlder = false;
        let foundNewer = false;

        for (const pub of publications) {
          // Skip if already processed
          const pubKey = `${pub.date}_${pub.editionNumber}`;
          if (seenEditions.has(pubKey)) {
            continue;
          }
          seenEditions.add(pubKey);

          // Check if date is in range
          if (pub.date < this.dateRange.start) {
            foundOlder = true;
            continue;
          }
          if (pub.date > this.dateRange.end) {
            foundNewer = true;
            continue;
          }

          // Date is in range - get the PDF
          try {
            const pdfUrl = await this.getPdfUrl(page, pub.buttonName);
            
            if (pdfUrl) {
              const gazette: Gazette = {
                date: pub.date,
                fileUrl: pdfUrl,
                territoryId: this.config.territoryId,
                scrapedAt: getCurrentTimestamp(),
                editionNumber: pub.editionNumber,
                isExtraEdition: pub.isExtra,
                power: 'executive_legislative',
                sourceText: `${pub.title} - Edição ${pub.editionNumber}`,
              };
              
              gazettes.push(gazette);
              logger.debug(`Found gazette: ${pub.date} - Edition ${pub.editionNumber}`);
            }
          } catch (error) {
            logger.warn(`Error getting PDF for edition ${pub.editionNumber}:`, { error: String(error) });
          }
        }

        // If all publications are older than our start date, stop
        if (foundOlder && !foundNewer && publications.every(p => p.date < this.dateRange.start)) {
          logger.info(`All publications on page ${currentPage} are before ${this.dateRange.start}, stopping`);
          continueLoading = false;
          break;
        }

        // Try to load more (older) publications
        const hasMorePages = await this.loadMorePublications(page);
        if (!hasMorePages) {
          continueLoading = false;
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from Prefeitura São Caetano do Sul`);
      
    } catch (error) {
      logger.error(`Error crawling Prefeitura São Caetano do Sul:`, error as Error);
      throw error;
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (e) {
          logger.warn('Error closing page', { error: String(e) });
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (e) {
          logger.warn('Error closing browser', { error: String(e) });
        }
      }
    }

    return gazettes;
  }

  /**
   * Extract publication data from the current page
   */
  private async extractPublications(page: any): Promise<PublicationData[]> {
    return await page.evaluate(() => {
      const publications: PublicationData[] = [];
      
      // Find all publication containers (divs with download buttons)
      const containers = document.querySelectorAll('#dvRegsH > div');
      
      containers.forEach((container) => {
        try {
          // Get the download button name for later clicking
          const downloadBtn = container.querySelector('input[type="image"][name*="btnDnPublicacaoHome"]');
          if (!downloadBtn) return;
          
          const buttonName = downloadBtn.getAttribute('name') || '';
          
          // Get edition number
          const editionSpan = container.querySelector('span[id*="lbEdicaoH"]');
          const editionNumber = editionSpan?.textContent?.trim() || '';
          
          // Get title
          const titleSpan = container.querySelector('span[id*="lbTituloH"]');
          const title = titleSpan?.textContent?.trim() || '';
          
          // Get date (format: DD/MM/YYYY)
          const dateSpan = container.querySelector('span[id*="lbDataH"]');
          const dateText = dateSpan?.textContent?.trim() || '';
          
          // Get organs
          const organsSpan = container.querySelector('span[id*="lbUGH"]');
          const organs = organsSpan?.textContent?.trim() || '';
          
          // Parse date to YYYY-MM-DD
          let isoDate = '';
          const dateMatch = dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (dateMatch) {
            isoDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
          }
          
          // Check if extra edition
          const isExtra = /extra/i.test(title);
          
          if (isoDate && editionNumber) {
            publications.push({
              date: isoDate,
              editionNumber,
              title,
              organs,
              isExtra,
              buttonName,
            });
          }
        } catch (e) {
          // Skip malformed entries
        }
      });
      
      return publications;
    });
  }

  /**
   * Get PDF URL by clicking on the download button
   */
  private async getPdfUrl(page: any, buttonName: string): Promise<string | null> {
    try {
      // Set up a promise to capture the popup URL
      const popupPromise = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Popup timeout')), 10000);
        
        page.once('popup', async (popup: any) => {
          clearTimeout(timeout);
          try {
            const url = popup.url();
            // Close the popup
            try {
              await popup.close();
            } catch (e) {
              // Ignore close errors
            }
            resolve(url);
          } catch (e) {
            reject(e);
          }
        });
      });

      // Click the download button
      await page.evaluate((name: string) => {
        const btn = document.querySelector(`input[name="${name}"]`) as HTMLElement;
        if (btn) {
          btn.click();
        }
      }, buttonName);

      const pdfUrl = await popupPromise;
      
      // Small delay before next action
      await new Promise(resolve => setTimeout(resolve, 500));
      
      return pdfUrl || null;
    } catch (error) {
      logger.debug(`Error getting PDF URL for button ${buttonName}:`, { error: String(error) });
      return null;
    }
  }

  /**
   * Load more (older) publications by clicking the "Mais Antigos" button
   */
  private async loadMorePublications(page: any): Promise<boolean> {
    try {
      const clicked = await page.evaluate(() => {
        // Look for "Mais Antigos" link
        const maisAntigosLink = document.querySelector('a[id*="btnAntigasTH"]') ||
                               document.querySelector('a[id*="btnAntigas"]');
        if (maisAntigosLink) {
          (maisAntigosLink as HTMLElement).click();
          return true;
        }
        return false;
      });
      
      if (clicked) {
        // Wait for page to update
        await new Promise(resolve => setTimeout(resolve, 2000));
        return true;
      }
      
      return false;
    } catch (error) {
      logger.debug('Error loading more publications:', { error: String(error) });
      return false;
    }
  }
}
