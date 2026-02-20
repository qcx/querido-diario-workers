import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraCaratingaConfig } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for Prefeitura de Caratinga diário oficial
 * 
 * Site Structure:
 * - URL: https://caratinga.mg.gov.br/diario-executivo/
 * - Uses a calendar/list view with links in format "DD/MM/YYYY HH:MM Edição Nº XXXX"
 * - Each gazette has a "Visualizar Publicação" link to the PDF
 * - Requires browser rendering due to JavaScript-heavy page
 */
export class PrefeituraCaratingaSpider extends BaseSpider {
  protected caratingaConfig: PrefeituraCaratingaConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.caratingaConfig = spiderConfig.config as PrefeituraCaratingaConfig;
    this.browser = browser || null;
    
    if (!this.caratingaConfig.baseUrl) {
      throw new Error(`PrefeituraCaratingaSpider requires a baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraCaratingaSpider for ${spiderConfig.name} with URL: ${this.caratingaConfig.baseUrl}`, {
      hasBrowser: !!this.browser,
    });
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.caratingaConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error('PrefeituraCaratingaSpider requires browser rendering');
    }
    
    return this.crawlWithBrowser();
  }

  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      logger.debug(`Navigating to: ${this.caratingaConfig.baseUrl}`);
      
      // Use 'load' instead of 'networkidle0' for faster loading
      // networkidle0 can timeout on sites with continuous network activity
      try {
        await page.goto(this.caratingaConfig.baseUrl, { waitUntil: 'load', timeout: 30000 });
      } catch (error) {
        logger.warn('Page load timeout, trying with domcontentloaded');
        try {
          await page.goto(this.caratingaConfig.baseUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        } catch (retryError) {
          logger.error('Failed to load page even with domcontentloaded');
          throw retryError;
        }
      }
      
      this.requestCount++;
      
      // Wait for page to stabilize and JavaScript to execute
      await new Promise(resolve => setTimeout(resolve, 4000));
      
      try {
        // Wait for gazette links or calendar structure - more lenient timeout
        await page.waitForSelector('a[href*="edicao"], .dof_publicacao_diario, [role="link"], a', { timeout: 10000 });
      } catch (error) {
        logger.warn('Gazette list selector not found, but continuing anyway - page may still have content');
      }
      
      // Additional wait to ensure dynamic content is loaded
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const pageGazettes = await this.extractGazettesFromPage(page);
      
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

  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      const gazetteData = await page.evaluate(() => {
        const data: any[] = [];
        const debugInfo: any = {
          totalLinks: 0,
          linksWithDates: [] as string[],
          gazetteLinksFound: 0,
        };
        
        // Find all links that match the pattern "DD/MM/YYYY HH:MM Edição Nº XXXX"
        const allLinks = document.querySelectorAll('a');
        debugInfo.totalLinks = allLinks.length;
        const gazetteLinks: Array<{ link: Element; parent: Element | null; text: string }> = [];
        
        for (const link of Array.from(allLinks)) {
          // Get text from link itself or from heading/span inside it
          // Normalize whitespace (replace newlines/tabs with single space)
          let linkText = (link.textContent || '').replace(/\s+/g, ' ').trim();
          const heading = link.querySelector('h1, h2, h3, h4, h5, h6, span, div');
          if (heading) {
            const headingText = (heading.textContent || '').replace(/\s+/g, ' ').trim();
            if (headingText.length > linkText.length) {
              linkText = headingText;
            }
          }
          
          // Check for date pattern first
          const hasDate = /\d{2}\/\d{2}\/\d{4}/.test(linkText);
          if (hasDate) {
            debugInfo.linksWithDates.push(linkText.substring(0, 100));
          }
          
          // Pattern: DD/MM/YYYY HH:MM Edição Nº XXXX or variations
          // Try multiple patterns to catch different formats (note: \s now matches normalized single spaces)
          const patterns = [
            /(\d{2}\/\d{2}\/\d{4})\s+(?:\d{2}:\d{2}\s+)?[Ee]di[çc][ãa]o\s+[Nn][°º]?\s*(\d+)/, // Standard format: "07/01/2026 17:25 Edição Nº 6172"
            /(\d{2}\/\d{2}\/\d{4})\s+[Ee]di[çc][ãa]o\s+[Nn][°º]?\s*(\d+)/, // Without time: "07/01/2026 Edição Nº 6172"
            /[Ee]di[çc][ãa]o\s+[Nn][°º]?\s*(\d+).*?(\d{2}\/\d{2}\/\d{4})/, // Edition first
            /(\d{2}\/\d{2}\/\d{4}).*?[Ee]di[çc][ãa]o.*?[Nn][°º]?\s*(\d+)/, // Date and edition separated
          ];
          
          let matched = false;
          for (const pattern of patterns) {
            if (pattern.test(linkText)) {
              // Find the parent container that likely contains the "Visualizar" link
              let parent = link.closest('div, article, section, li');
              if (!parent) {
                parent = link.parentElement;
              }
              gazetteLinks.push({ link, parent, text: linkText });
              matched = true;
              break;
            }
          }
        }
        
        debugInfo.gazetteLinksFound = gazetteLinks.length;
        
        // Alternative approach: Find "Visualizar Publicação" links and work backwards
        if (gazetteLinks.length === 0) {
          const visualizarLinks = Array.from(document.querySelectorAll('a')).filter(link => {
            const text = (link.textContent || '').toLowerCase();
            return text.includes('visualizar') && (text.includes('publicação') || text.includes('publicacao'));
          });
          
          debugInfo.visualizarLinksFound = visualizarLinks.length;
          
          // For each "Visualizar" link, find the associated gazette info
          for (const visualizarLink of visualizarLinks) {
            // Find parent container
            let parent = visualizarLink.closest('div, article, section, li');
            if (!parent) {
              parent = visualizarLink.parentElement;
            }
            
            if (parent) {
              // Find date and edition in the same container
              const containerText = parent.textContent || '';
              const dateMatch = containerText.match(/(\d{2}\/\d{2}\/\d{4})/);
              const editionMatch = containerText.match(/[Ee]di[çc][ãa]o\s+[Nn][°º]?\s*(\d+)/);
              
              if (dateMatch && editionMatch) {
                const linkWithDate = parent.querySelector('a');
                if (linkWithDate) {
                  gazetteLinks.push({ 
                    link: linkWithDate, 
                    parent: parent, 
                    text: linkWithDate.textContent || containerText.substring(0, 100) 
                  });
                }
              }
            }
          }
          
          debugInfo.gazetteLinksFound = gazetteLinks.length;
        }
        
        // Process each gazette link
        const processedItems: any[] = [];
        for (const { link, parent, text } of gazetteLinks) {
          // Use the text we already extracted (which may include heading text)
          // Normalize whitespace (replace newlines/tabs with spaces)
          let linkText = (text || link.textContent || '').replace(/\s+/g, ' ').trim();
          
          // Extract date and edition number from link text or parent container
          let dateMatch = linkText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          let editionMatch = linkText.match(/[Ee]di[çc][ãa]o\s+[Nn][°º]?\s*(\d+)/);
          
          // If not found in link, try parent container
          if (!dateMatch && parent) {
            const parentText = (parent.textContent || '').replace(/\s+/g, ' ').trim();
            dateMatch = parentText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (!editionMatch) {
              editionMatch = parentText.match(/[Ee]di[çc][ãa]o\s+[Nn][°º]?\s*(\d+)/);
            }
          }
          
          if (!dateMatch) {
            processedItems.push({ status: 'no_date', text: linkText.substring(0, 50) });
            continue;
          }
          
          const dateText = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;
          const editionNumber = editionMatch ? editionMatch[1] : null;
          
          // Find "Visualizar Publicação" link in the same container or nearby
          let pdfUrl = '';
          
          // Strategy 1: Search in parent container for "Visualizar" link by text
          if (parent) {
            const allLinksInParent = Array.from(parent.querySelectorAll('a'));
            for (const parentLink of allLinksInParent) {
              const text = (parentLink.textContent || '').toLowerCase().trim();
              const href = parentLink.getAttribute('href') || '';
              // Check for "Visualizar" in text (case insensitive, with or without "Publicação")
              if (text.includes('visualizar') || text.includes('visualisar')) {
                pdfUrl = href;
                break;
              }
            }
          }
          
          // Strategy 2: Search in a wider area (grandparent, siblings)
          if (!pdfUrl && parent && parent.parentElement) {
            const grandparent = parent.parentElement;
            const allLinksNearby = Array.from(grandparent.querySelectorAll('a'));
            for (const nearbyLink of allLinksNearby) {
              const text = (nearbyLink.textContent || '').toLowerCase().trim();
              const href = nearbyLink.getAttribute('href') || '';
              if ((text.includes('visualizar') || text.includes('visualisar')) && nearbyLink !== link) {
                pdfUrl = href;
                break;
              }
            }
          }
          
          // Strategy 3: Try by href attribute containing "visualizar"
          if (!pdfUrl && parent) {
            const visualizarLinkByHref = parent.querySelector('a[href*="visualizar" i], a[href*="Visualizar"]');
            if (visualizarLinkByHref) {
              pdfUrl = visualizarLinkByHref.getAttribute('href') || '';
            }
          }
          
          // Strategy 4: Search siblings of the parent
          if (!pdfUrl && parent && parent.parentElement) {
            const siblings = Array.from(parent.parentElement.children);
            for (const sibling of siblings) {
              if (sibling === parent) continue;
              const siblingLinks = Array.from(sibling.querySelectorAll('a'));
              for (const siblingLink of siblingLinks) {
                const text = (siblingLink.textContent || '').toLowerCase().trim();
                if (text.includes('visualizar') || text.includes('visualisar')) {
                  pdfUrl = siblingLink.getAttribute('href') || '';
                  break;
                }
              }
              if (pdfUrl) break;
            }
          }
          
          // Strategy 5: Try to find any PDF or download link in parent
          if (!pdfUrl && parent) {
            const pdfLink = parent.querySelector('a[href*=".pdf"], a[href*="download" i], a[href*="Download"]');
            if (pdfLink) {
              pdfUrl = pdfLink.getAttribute('href') || '';
            }
          }
          
          // Strategy 6: Use the link itself if it looks like a PDF or points to a viewer
          if (!pdfUrl) {
            const linkHref = link.getAttribute('href') || '';
            if (linkHref.includes('.pdf') || linkHref.includes('visualizar') || linkHref.includes('download') || 
                linkHref.includes('viewer') || linkHref.includes('visualisar')) {
              pdfUrl = linkHref;
            }
          }
          
          // Strategy 7: If still no PDF URL but we have the edition link, use it
          // The link itself might lead to a page with the PDF or might be the PDF
          if (!pdfUrl) {
            const linkHref = link.getAttribute('href') || '';
            // If the link has an href, use it - it might be the gazette page or PDF
            if (linkHref && linkHref !== '#' && !linkHref.startsWith('javascript:')) {
              pdfUrl = linkHref;
            }
          }
          
          if (dateText && pdfUrl) {
            data.push({
              editionNumber,
              dateText,
              pdfUrl,
            });
            processedItems.push({ status: 'success', dateText, editionNumber, pdfUrl: pdfUrl.substring(0, 100) });
          } else {
            // Enhanced debug info
            const debugData: any = { 
              status: 'no_pdf_url', 
              dateText, 
              editionNumber,
              hasParent: !!parent,
              linkHref: link.getAttribute('href') || '',
            };
            
            if (parent) {
              const allLinks = Array.from(parent.querySelectorAll('a'));
              debugData.parentLinksCount = allLinks.length;
              debugData.parentLinks = allLinks.map((l: Element) => ({
                href: l.getAttribute('href') || '',
                text: (l.textContent || '').trim().substring(0, 50)
              }));
              
              // Check if parent has siblings with links
              if (parent.parentElement) {
                const siblings = Array.from(parent.parentElement.children);
                const siblingLinks: any[] = [];
                siblings.forEach(sibling => {
                  if (sibling !== parent) {
                    const sLinks = Array.from(sibling.querySelectorAll('a'));
                    sLinks.forEach(sLink => {
                      siblingLinks.push({
                        href: sLink.getAttribute('href') || '',
                        text: (sLink.textContent || '').trim().substring(0, 50)
                      });
                    });
                  }
                });
                if (siblingLinks.length > 0) {
                  debugData.siblingLinks = siblingLinks;
                }
              }
            }
            
            processedItems.push(debugData);
          }
        }
        
        // Fallback: Try Portal Fácil format
        if (data.length === 0) {
          const listItems = document.querySelectorAll('.list-group-item, li.list-group-item, #arquivos li');
          
          for (const item of Array.from(listItems)) {
            const allLinks = item.querySelectorAll('a');
            let hasVisualizarLink = false;
            let pdfUrl = '';
            
            for (const link of allLinks) {
              if (link.textContent?.includes('Visualizar') || link.textContent?.includes('Download') || link.textContent?.includes('Baixar')) {
                pdfUrl = link.getAttribute('href') || '';
                hasVisualizarLink = true;
                break;
              }
            }
            
            if (!hasVisualizarLink) continue;
            
            let editionText = '';
            const editionElement = item.querySelector('span, h4, h5');
            editionText = editionElement?.textContent?.trim() || '';
            const editionMatch = editionText.match(/N[°º]\s*(\d+)/);
            const editionNumber = editionMatch ? editionMatch[1] : null;
            
            let dateText = '';
            const allDivs = item.querySelectorAll('div, span, h4, h5');
            for (const div of allDivs) {
              const text = div.textContent || '';
              const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
              if (dateMatch) {
                dateText = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;
                break;
              }
            }
            
            if (dateText && pdfUrl) {
              data.push({
                editionNumber,
                dateText,
                pdfUrl,
              });
            }
          }
        }
        
        // Fallback: Try Instar format
        if (data.length === 0) {
          const instarItems = document.querySelectorAll('.dof_publicacao_diario');
          for (const item of Array.from(instarItems)) {
            const titleElement = item.querySelector('.dof_titulo_publicacao span');
            const downloadElement = item.querySelector('.dof_download[data-href]');
            
            if (titleElement && downloadElement) {
              const titleText = titleElement.textContent || '';
              const editionMatch = titleText.match(/Edi[çc][ãa]o\s+n[°º]?\s*(\d+)/i);
              const editionNumber = editionMatch ? editionMatch[1] : null;
              
              const dateMatch = titleText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
              const dateText = dateMatch ? `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}` : '';
              
              const pdfUrl = downloadElement.getAttribute('data-href') || downloadElement.getAttribute('href') || '';
              
              if (dateText && pdfUrl) {
                data.push({
                  editionNumber,
                  dateText,
                  pdfUrl,
                });
              }
            }
          }
        }
        
        debugInfo.processedItems = processedItems;
        debugInfo.successCount = data.length;
        
        return { data, debugInfo };
      });
      
      const debugInfo = (gazetteData as any).debugInfo;
      const actualData = (gazetteData as any).data || gazetteData;
      
      if (debugInfo) {
        logger.debug(`Debug info - Total links: ${debugInfo.totalLinks}, Links with dates: ${debugInfo.linksWithDates?.length || 0}, Gazette links found: ${debugInfo.gazetteLinksFound}, Success: ${debugInfo.successCount || 0}`);
        if (debugInfo.linksWithDates && debugInfo.linksWithDates.length > 0) {
          logger.debug(`Sample links with dates: ${debugInfo.linksWithDates.slice(0, 3).join(' | ')}`);
        }
        if (debugInfo.processedItems && debugInfo.processedItems.length > 0) {
          const byStatus = debugInfo.processedItems.reduce((acc: any, item: any) => {
            acc[item.status] = (acc[item.status] || 0) + 1;
            return acc;
          }, {});
          logger.debug(`Processing results: ${JSON.stringify(byStatus)}`);
          // Log first few failed items for debugging
          const failed = debugInfo.processedItems.filter((item: any) => item.status !== 'success').slice(0, 3);
          if (failed.length > 0) {
            logger.debug(`Sample failed items: ${JSON.stringify(failed)}`);
          }
        }
      }
      
      logger.debug(`Found ${actualData.length} gazette items on page`);
      
      for (const item of actualData) {
        try {
          const dateMatch = item.dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) {
            logger.warn(`Could not parse date: ${item.dateText}`);
            continue;
          }
          
          const [, day, month, year] = dateMatch;
          const gazetteDate = new Date(`${year}-${month}-${day}`);
          
          if (isNaN(gazetteDate.getTime())) {
            logger.warn(`Invalid date: ${item.dateText}`);
            continue;
          }
          
          let pdfUrl = item.pdfUrl;
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.caratingaConfig.baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }
          
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber: item.editionNumber || undefined,
            isExtraEdition: false,
            power: 'executive_legislative',
            sourceText: `Diário Oficial ${item.editionNumber ? `N° ${item.editionNumber}` : ''} - ${item.dateText}`,
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

