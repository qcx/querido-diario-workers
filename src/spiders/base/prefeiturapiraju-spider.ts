import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraPirajuConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for Prefeitura de Piraju official gazette
 * 
 * Uses Cloudflare Browser Rendering (Puppeteer) to handle:
 * - JSF/PrimeFaces application requiring JavaScript
 * - Date filter form (dataPublicacaoInicial, dataPublicacaoFinal)
 * - PrimeFaces datagrid with pagination
 * - AJAX-based PDF links
 * 
 * The site structure:
 * 1. Navigate to baseUrl with idCidade parameter
 * 2. Fill date filters in formPesquisa form
 * 3. Click search button (formPesquisa:btnPesquisa)
 * 4. Results appear in formConteudo:tb datagrid
 * 5. Each gazette panel has:
 *    - Title: "ED 651 DIÁRIO OFICIAL DO MUNICÍPIO 08-11-2025"
 *    - Date: "Publicado em 08/11/2025"
 *    - Buttons: "Baixar" (download) and "Visualizar" (view PDF)
 * 6. Pagination in formConteudo:tb_paginator_top
 */
export class PrefeituraPirajuSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraPirajuConfig;
    this.baseUrl = platformConfig.baseUrl;
    this.browser = browser || null;
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  /**
   * Format date for PrimeFaces calendar (DD/MM/YYYY)
   */
  private formatDateForCalendar(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }


  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(`PrefeituraPirajuSpider for ${this.config.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura Piraju for ${this.config.name}...`);

    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      
      // Navigate to the page
      logger.debug(`Navigating to: ${this.baseUrl}`);
      await page.goto(this.baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Wait for page to stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Fill date filters
      const startDateStr = this.formatDateForCalendar(new Date(this.startDate));
      const endDateStr = this.formatDateForCalendar(new Date(this.endDate));
      
      logger.debug(`Setting date filters: ${startDateStr} to ${endDateStr}`);
      
      // Fill start date
      await page.evaluate((dateStr: string) => {
        const input = document.getElementById('formPesquisa:dataPublicacaoInicial_input') as HTMLInputElement;
        if (input) {
          input.value = dateStr;
          // Trigger change event for PrimeFaces
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, startDateStr);
      
      // Fill end date
      await page.evaluate((dateStr: string) => {
        const input = document.getElementById('formPesquisa:dataPublicacaoFinal_input') as HTMLInputElement;
        if (input) {
          input.value = dateStr;
          // Trigger change event for PrimeFaces
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, endDateStr);
      
      // Wait a bit for PrimeFaces to process
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Click search button - wait for it to be visible first
      logger.debug('Looking for search button...');
      
      // Try multiple selector strategies
      let searchButton = null;
      const selectors = [
        '#formPesquisa\\:btnPesquisa',
        'button[name="formPesquisa:btnPesquisa"]',
        'button[id*="btnPesquisa"]',
        'form#formPesquisa button[type="submit"]',
        'button:has-text("Pesquisar")',
      ];
      
      for (const selector of selectors) {
        try {
          await page.waitForSelector(selector, { visible: true, timeout: 5000 });
          searchButton = await page.$(selector);
          if (searchButton) {
            logger.debug(`Found search button with selector: ${selector}`);
            break;
          }
        } catch (e) {
          // Try next selector
          continue;
        }
      }
      
      if (!searchButton) {
        // Fallback: try to submit form directly or click via JavaScript
        logger.debug('Search button not found, trying to submit form via JavaScript...');
        const formSubmitted = await page.evaluate(() => {
          const form = document.getElementById('formPesquisa') as HTMLFormElement;
          if (form) {
            // Try to find and click the button via JS
            const button = document.getElementById('formPesquisa:btnPesquisa') as HTMLElement;
            if (button) {
              button.click();
              return true;
            }
            // Fallback: trigger PrimeFaces AJAX directly
            if ((window as any).PrimeFaces) {
              const buttonElement = document.getElementById('formPesquisa:btnPesquisa');
              if (buttonElement) {
                (buttonElement as any).click();
                return true;
              }
            }
          }
          return false;
        });
        
        if (!formSubmitted) {
          const pageContent = await page.content();
          logger.error('Could not find or click search button. Page content:', { content: pageContent.substring(0, 1000) });
          return gazettes;
        }
      } else {
        await searchButton.click();
      }
      
      // Wait for AJAX to complete and results to load
      try {
        await page.waitForSelector('#formConteudo\\:tb', { timeout: 15000 });
        await new Promise(resolve => setTimeout(resolve, 3000));
        this.requestCount++;
      } catch (e) {
        logger.warn('Results container not found after search, but continuing...');
        // Give it more time
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      // Extract gazettes from all pages
      let currentPage = 1;
      let hasMorePages = true;
      
      while (hasMorePages) {
        logger.debug(`Extracting gazettes from page ${currentPage}...`);
        
        const pageGazettes = await this.extractGazettesFromPage(page);
        
        // Filter by date range
        for (const gazette of pageGazettes) {
          if (gazette && this.isInDateRange(new Date(gazette.date))) {
            gazettes.push(gazette);
          }
        }
        
        logger.debug(`Found ${pageGazettes.length} gazettes on page ${currentPage}, ${gazettes.length} total in date range`);
        
        // Check for next page
        const nextPageButton = await page.$('.ui-paginator-next:not(.ui-state-disabled)');
        if (nextPageButton) {
          await nextPageButton.click();
          await new Promise(resolve => setTimeout(resolve, 2000));
          currentPage++;
          this.requestCount++;
        } else {
          hasMorePages = false;
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from Prefeitura Piraju`);
      
    } catch (error) {
      logger.error(`Error crawling Prefeitura Piraju:`, error as Error);
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
   * Extract gazettes from the current page
   * Processes each gazette individually by clicking the "Baixar" button to get PDF URL
   */
  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Extract all gazette panels from formConteudo:tb_content
      const gazetteItems = await page.$$eval(
        '#formConteudo\\:tb_content .ui-panel',
        (panels: any[]) => {
          return panels.map((panel: any) => {
            // Extract title
            const titleElement = panel.querySelector('.ui-panel-title');
            const titleText = titleElement ? titleElement.textContent?.trim() : '';
            
            // Extract edition number from title (e.g., "ED 651")
            const editionMatch = titleText.match(/ED\s+(\d+)/i);
            const editionNumber = editionMatch ? editionMatch[1] : undefined;
            
            // Extract date from title (e.g., "08-11-2025")
            const dateMatch = titleText.match(/(\d{2})-(\d{2})-(\d{4})/);
            let gazetteDateStr: string | null = null;
            if (dateMatch) {
              const [, day, month, year] = dateMatch;
              // Return as ISO string for serialization
              const date = new Date(
                parseInt(year, 10),
                parseInt(month, 10) - 1,
                parseInt(day, 10)
              );
              gazetteDateStr = date.toISOString();
            }
            
            // Try to get date from "Publicado em" text as fallback
            if (!gazetteDateStr) {
              const dateTextElement = panel.querySelector('.ui-panelgrid-cell span.fonte-negrita');
              if (dateTextElement) {
                const dateText = dateTextElement.textContent?.trim() || '';
                const publishedMatch = dateText.match(/Publicado em\s+(\d{2})\/(\d{2})\/(\d{4})/i);
                if (publishedMatch) {
                  const [, day, month, year] = publishedMatch;
                  const date = new Date(
                    parseInt(year, 10),
                    parseInt(month, 10) - 1,
                    parseInt(day, 10)
                  );
                  gazetteDateStr = date.toISOString();
                }
              }
            }
            
            // Find "Visualizar" button by looking for span with class "ui-button-text ui-c" containing "Visualizar"
            // The button structure: <button><span class="ui-button-text ui-c">Visualizar</span></button>
            let visualizarButtonId: string | null = null;
            
            // Find the span with "Visualizar" text, then get its parent button
            const visualizarSpan = Array.from(panel.querySelectorAll('span.ui-button-text.ui-c')).find(
              (span: any) => span.textContent?.trim() === 'Visualizar'
            ) as HTMLElement | undefined;
            
            if (visualizarSpan) {
              const button = visualizarSpan.closest('button') as HTMLElement;
              if (button) {
                visualizarButtonId = button.id || null;
              }
            }
            
            // Fallback: if span method didn't work, try finding by button text
            if (!visualizarButtonId) {
              const buttons = panel.querySelectorAll('button');
              for (const button of Array.from(buttons) as HTMLElement[]) {
                const buttonText = button.textContent?.trim() || '';
                const buttonId = button.id || '';
                
                // Look for "Visualizar" button (contains "Visualizar" or has j_idt56 pattern)
                if (buttonText.includes('Visualizar') || buttonId.includes('j_idt56')) {
                  visualizarButtonId = buttonId;
                  break;
                }
              }
            }
            
            return {
              titleText,
              editionNumber,
              gazetteDateStr,
              visualizarButtonId,
              panelIndex: panels.indexOf(panel),
            };
          }).filter((item: any) => item.titleText && item.gazetteDateStr);
        }
      );
      
      logger.debug(`Found ${gazetteItems.length} gazette panels on page`);
      
      // Process each gazette item individually
      for (let i = 0; i < gazetteItems.length; i++) {
        const item = gazetteItems[i];
        
        try {
          // Convert date string back to Date object
          if (!item.gazetteDateStr) {
            logger.debug(`Skipping item ${i + 1}: no date found`);
            continue;
          }
          
          const gazetteDate = new Date(item.gazetteDateStr);
          
          // Validate date
          if (isNaN(gazetteDate.getTime())) {
            logger.warn(`Skipping item ${i + 1}: invalid date ${item.gazetteDateStr}`);
            continue;
          }
          
          // Check if date is in range
          if (!this.isInDateRange(gazetteDate)) {
            logger.debug(`Skipping item ${i + 1}: date ${gazetteDate.toISOString()} not in range`);
            continue;
          }
          
          logger.debug(`Processing gazette ${i + 1}/${gazetteItems.length}: ${item.titleText}`);
          
          // Get PDF URL by clicking the "Visualizar" button
          let pdfUrl: string | null = null;
          
          if (!item.visualizarButtonId) {
            logger.warn(`No "Visualizar" button found for gazette: ${item.titleText}`);
            continue;
          }
          
          try {
            const buttonSelector = `#${item.visualizarButtonId.replace(/:/g, '\\:')}`;
            
            // Wait for button to be available and visible
            await page.waitForSelector(buttonSelector, { visible: true, timeout: 5000 }).catch(() => null);
            
            // Set up navigation promise BEFORE clicking
            // The "Visualizar" button navigates to a PDF viewer page
            const navigationPromise = page.waitForNavigation({ 
              waitUntil: 'networkidle0', 
              timeout: 15000 
            }).catch(() => null);
            
            // Click the "Visualizar" button
            logger.debug(`Clicking "Visualizar" button for gazette ${i + 1}: ${item.visualizarButtonId}`);
            await page.evaluate((selector: string) => {
              const button = document.querySelector(selector) as HTMLElement;
              if (button) {
                button.click();
              }
            }, buttonSelector);
            
            // Wait for navigation to PDF viewer page
            await navigationPromise;
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Extract PDF URL from the pdf_viewer object element
            logger.debug(`Extracting PDF URL from viewer page...`);
            const extractedPdfUrl = await page.evaluate(() => {
              const pdfViewer = document.getElementById('pdf_viewer') as HTMLObjectElement;
              if (pdfViewer && pdfViewer.data) {
                // Remove query parameters if needed (pfdrid_c=true)
                return pdfViewer.data.split('?')[0];
              }
              return null;
            });
            
            if (extractedPdfUrl) {
              pdfUrl = extractedPdfUrl;
              logger.debug(`Got PDF URL from viewer page: ${pdfUrl}`);
            } else {
              logger.warn(`Could not find PDF URL in viewer page for gazette ${i + 1}`);
            }
            
            // Navigate back to results page
            await page.goBack();
            await page.waitForSelector('#formConteudo\\:tb_content', { timeout: 10000 }).catch(() => null);
            await new Promise(resolve => setTimeout(resolve, 2000));
            
          } catch (error) {
            logger.warn(`Error clicking "Visualizar" button for gazette ${i + 1}:`, { 
              error: error instanceof Error ? error.message : String(error),
              buttonId: item.visualizarButtonId 
            });
            
            // Try to go back if we're on a different page
            try {
              const currentUrl = page.url();
              if (!currentUrl.includes('diario_externo.xhtml')) {
                await page.goBack();
                await page.waitForSelector('#formConteudo\\:tb_content', { timeout: 10000 }).catch(() => null);
                await new Promise(resolve => setTimeout(resolve, 2000));
              }
            } catch (backError) {
              // Ignore back navigation errors
            }
          }
          
          if (!pdfUrl) {
            logger.warn(`Could not determine PDF URL for gazette: ${item.titleText}`);
            continue;
          }
          
          // Construct full URL if relative
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }
          
          // Create gazette
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber: item.editionNumber,
            power: 'executive_legislative',
            sourceText: item.titleText || `Edição ${item.editionNumber || 'N/A'}`,
          });
          
          if (gazette) {
            gazettes.push(gazette);
            logger.debug(`Successfully created gazette ${i + 1}/${gazetteItems.length}: ${item.titleText}`);
          }
          
          // Small delay between items to avoid overwhelming the server
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (error) {
          logger.error(`Error processing gazette item ${i + 1}:`, { error: error instanceof Error ? error.message : String(error) });
        }
      }
      
    } catch (error) {
      logger.error(`Error extracting gazettes from page:`, { error: error instanceof Error ? error.message : String(error) });
    }
    
    return gazettes;
  }
}

