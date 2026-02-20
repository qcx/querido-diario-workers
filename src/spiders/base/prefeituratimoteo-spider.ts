import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraTimoteoConfig } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for Prefeitura de Timóteo diário oficial
 * 
 * Site Structure:
 * - URL: https://www.timoteo.mg.gov.br/diariooficial
 * - Uses Portal Fácil platform similar to Ipatinga
 * - Requires browser rendering due to JavaScript-heavy page
 */
export class PrefeituraTimoteoSpider extends BaseSpider {
  protected timoteoConfig: PrefeituraTimoteoConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.timoteoConfig = spiderConfig.config as PrefeituraTimoteoConfig;
    this.browser = browser || null;
    
    if (!this.timoteoConfig.baseUrl) {
      throw new Error(`PrefeituraTimoteoSpider requires a baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraTimoteoSpider for ${spiderConfig.name} with URL: ${this.timoteoConfig.baseUrl}`, {
      hasBrowser: !!this.browser,
    });
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.timoteoConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error('PrefeituraTimoteoSpider requires browser rendering');
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
      
      logger.debug(`Navigating to: ${this.timoteoConfig.baseUrl}`);
      // Use 'load' instead of 'networkidle0' for faster loading, then wait manually
      try {
        await page.goto(this.timoteoConfig.baseUrl, { waitUntil: 'load', timeout: 60000 });
      } catch (error) {
        // If load fails, try domcontentloaded as fallback
        logger.warn('Load timeout, trying domcontentloaded...');
        await page.goto(this.timoteoConfig.baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      }
      this.requestCount++;
      
      // Wait for page to stabilize and JavaScript to load the gazettes
      await new Promise(resolve => setTimeout(resolve, 8000));
      
      // Always debug page structure to understand what's available
      const pageStructure = await page.evaluate(() => {
        const allSelectors = [
          '#arquivos',
          '.list-group',
          '.list-group-item',
          'ul.list-group',
          '.dof_publicacao_diario',
          'table',
          'table tbody tr',
          '.edocman-document-title-td',
          '[class*="diario"]',
          '[id*="diario"]',
          '[class*="gazette"]',
          '[id*="gazette"]'
        ];
        
        const selectorResults: Record<string, number> = {};
        allSelectors.forEach(sel => {
          try {
            selectorResults[sel] = document.querySelectorAll(sel).length;
          } catch (e) {
            selectorResults[sel] = -1;
          }
        });
        
        return {
          title: document.title,
          url: window.location.href,
          bodyText: document.body?.textContent?.substring(0, 1000) || '',
          selectorCounts: selectorResults,
          allLinks: Array.from(document.querySelectorAll('a')).slice(0, 20).map(a => ({
            text: a.textContent?.trim().substring(0, 100),
            href: a.getAttribute('href')?.substring(0, 200),
            className: a.className
          })),
          allDivsWithText: Array.from(document.querySelectorAll('div')).filter(d => {
            const text = d.textContent?.trim() || '';
            return text.length > 10 && text.length < 200 && (text.includes('diário') || text.includes('Diário') || text.includes('edição') || text.includes('Edição'));
          }).slice(0, 10).map(d => ({
            text: d.textContent?.trim().substring(0, 200),
            className: d.className,
            id: d.id
          }))
        };
      });
      logger.debug('Page structure debug:', JSON.stringify(pageStructure, null, 2));
      
      // Wait for gazettes to load - look for the list container with multiple selector options
      try {
        await page.waitForSelector('#arquivos li, .list-group-item, ul.list-group, .dof_publicacao_diario, table tbody tr, .edocman-document-title-td', { timeout: 20000 });
        logger.debug('Found expected selectors on page');
      } catch (error) {
        logger.warn('Gazette list not found with standard selectors, will try alternative extraction');
      }
      
      // Additional wait for JavaScript to finish loading content
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Extract gazettes from the page
      let hasMorePages = true;
      let currentPage = 1;
      const maxPages = 50;
      
      while (hasMorePages && currentPage <= maxPages) {
        logger.debug(`Extracting gazettes from page ${currentPage}`);
        
        // Extract gazette data from the current page
        const pageGazettes = await this.extractGazettesFromPage(page);
        
        if (pageGazettes.length === 0) {
          logger.info(`No gazettes found on page ${currentPage}, stopping pagination`);
          hasMorePages = false;
          continue;
        }
        
        // Filter by date range and add to collection
        let foundOlderThanRange = false;
        for (const gazette of pageGazettes) {
          if (gazette) {
            const gazetteDate = new Date(gazette.date);
            
            if (this.isInDateRange(gazetteDate)) {
              gazettes.push(gazette);
            }
            
            // Check if we've found gazettes older than our date range
            if (gazetteDate < new Date(this.dateRange.start)) {
              foundOlderThanRange = true;
            }
          }
        }
        
        logger.debug(`Found ${pageGazettes.length} gazettes on page ${currentPage}, ${gazettes.length} in date range`);
        
        // If we found gazettes older than the range, stop pagination
        if (foundOlderThanRange) {
          logger.debug('Found gazettes older than date range, stopping pagination');
          hasMorePages = false;
          continue;
        }
        
        // Check for pagination - look for "Anteriores" button or next page link
        const hasNextPageButton = await page.evaluate(() => {
          // Look for "Anteriores" button
          const buttons = document.querySelectorAll('button');
          for (const button of buttons) {
            if (button.textContent?.includes('Anteriores') && !button.disabled) {
              return true;
            }
          }
          // Look for pagination links
          const paginationLinks = document.querySelectorAll('a.page-link, .pagination a[href*="page"]');
          for (const link of paginationLinks) {
            if (link.textContent?.includes('›') || link.textContent?.includes('»')) {
              return true;
            }
          }
          return false;
        });
        
        if (hasNextPageButton) {
          // Click the button using evaluate
          const clicked = await page.evaluate(() => {
            const buttons = document.querySelectorAll('button');
            for (const button of buttons) {
              if (button.textContent?.includes('Anteriores') && !button.disabled) {
                button.click();
                return true;
              }
            }
            // Try pagination links
            const paginationLinks = document.querySelectorAll('a.page-link, .pagination a[href*="page"]');
            for (const link of paginationLinks) {
              const el = link as HTMLAnchorElement;
              if (link.textContent?.includes('›') || link.textContent?.includes('»')) {
                el.click();
                return true;
              }
            }
            return false;
          });
          
          if (clicked) {
            logger.debug('Clicked next page button');
            await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for content to load
            currentPage++;
          } else {
            hasMorePages = false;
          }
        } else {
          hasMorePages = false;
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
      // Extract gazette elements from the page
      // The structure has ul.list-group with li.list-group-item elements (Portal Fácil format)
      const gazetteData = await page.evaluate(() => {
        const data: any[] = [];
        
        // Find all list items that contain gazette info
        // Structure: <li class="list-group-item">
        //   <h4>DD/Mês/YYYY</h4>
        //   <span>N° XXXX / YYYY</span>
        //   <h5>Diário Oficial</h5>
        //   <div>Data: DD/MM/YYYY</div>
        //   <div>Descrição Diário:</div>
        //   <span>Tamanho: X.XXX MB</span>
        //   <a href="...">Visualizar arquivo</a>
        // </li>
        
        // Debug: capture all links on the page for analysis
        const allPageLinks: any[] = [];
        const allLinks = document.querySelectorAll('a');
        for (const link of Array.from(allLinks)) {
          const href = link.getAttribute('href') || '';
          const onclick = link.getAttribute('onclick') || '';
          const text = link.textContent?.trim() || '';
          if (href || onclick) {
            allPageLinks.push({
              href,
              onclick: onclick.substring(0, 200), // Limit onclick length
              text: text.substring(0, 100), // Limit text length
              contains50758: (href + onclick + text).includes('50758')
            });
          }
        }
        
        // Try ASP.NET Repeater structure first (Timóteo uses this)
        // Look for divs with IDs containing rptDiario or dvEdicao
        const aspNetItems = document.querySelectorAll('[id*="rptDiario"], [id*="dvEdicao"], [id*="ContentPlaceHolder"]');
        // Also try to find divs that contain "Edição" text
        const allDivsWithEdicao = Array.from(document.querySelectorAll('div')).filter(div => {
          const text = div.textContent || '';
          return text.includes('Edição') || text.includes('Ediç');
        });
        
        const itemsToCheck = aspNetItems.length > 0 ? Array.from(aspNetItems) : allDivsWithEdicao;
        
        if (itemsToCheck.length > 0) {
          for (const item of itemsToCheck) {
            const itemText = item.textContent || '';
            // Check if this item contains edition info
            if (!itemText.includes('Edição') && !itemText.includes('Ediç')) continue;
            
            // Extract edition number
            const editionMatch = itemText.match(/Edi[çc][ãa]o\s+N[°º]?[:\s]*(\d+)/i);
            const editionNumber = editionMatch ? editionMatch[1] : null;
            
            // Extract date
            const dateMatch = itemText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            const dateText = dateMatch ? `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}` : '';
            
            // Find PDF link in this item or nearby - must be related to diário oficial
            let pdfUrl = '';
            // First try to find link in the item itself - check all links
            const allLinksInItem = item.querySelectorAll('a');
            for (const link of Array.from(allLinksInItem)) {
              const href = link.getAttribute('href') || '';
              const onclick = link.getAttribute('onclick') || '';
              const linkText = link.textContent?.toLowerCase() || '';
              const hrefLower = href.toLowerCase();
              
              // Check if it's a PDF link or download link
              if (href.includes('.pdf') || 
                  href.includes('download') || 
                  href.includes('abrir') || 
                  href.includes('visualizar') ||
                  onclick.includes('pdf') ||
                  onclick.includes('download') ||
                  linkText.includes('visualizar') ||
                  linkText.includes('download') ||
                  linkText.includes('baixar') ||
                  (editionNumber && (href.includes(editionNumber) || onclick.includes(editionNumber)))) {
                // Prefer direct PDF links or links with edition number
                if (href.includes('.pdf') || (editionNumber && href.includes(editionNumber))) {
                  pdfUrl = href;
                  break;
                }
                // Otherwise use onclick if it contains a URL
                if (!pdfUrl && onclick) {
                  const urlMatch = onclick.match(/(https?:\/\/[^\s'"]+\.pdf|[^\s'"]+\.pdf|['"]([^'"]+)['"])/i);
                  if (urlMatch) {
                    pdfUrl = urlMatch[2] || urlMatch[1];
                    break;
                  }
                }
                // Last resort: use href if it exists
                if (!pdfUrl && href) {
                  pdfUrl = href;
                }
              }
            }
            
            // If still no link, try to find link in the item itself with broader search
            if (!pdfUrl) {
              const pdfLink = item.querySelector('a[href*=".pdf"], a[href*="download"], a[href*="abrir"], a[href*="visualizar"], a[href*="Diario"], a[href*="diario"]');
              if (pdfLink) {
                const href = pdfLink.getAttribute('href') || '';
                const hrefLower = href.toLowerCase();
                // Only accept if it seems related to diário oficial
                if (hrefLower.includes('diario') || hrefLower.includes('diário') || hrefLower.includes('oficial') || 
                    (editionNumber && hrefLower.includes(editionNumber))) {
                  pdfUrl = href;
                }
              }
            }
            
            if (!pdfUrl) {
              // Look in parent or sibling elements (but limit search to avoid generic links)
              let parent = item.parentElement;
              for (let i = 0; i < 3 && parent; i++) {
                const links = parent.querySelectorAll('a[href*=".pdf"], a[href*="download"], a[href*="abrir"]');
                for (const link of Array.from(links)) {
                  const href = link.getAttribute('href') || '';
                  const hrefLower = href.toLowerCase();
                  const linkText = link.textContent?.toLowerCase() || '';
                  
                  // Prefer links that contain diário-related terms or edition number
                  if (hrefLower.includes('diario') || hrefLower.includes('diário') || hrefLower.includes('oficial') ||
                      linkText.includes('diário') || linkText.includes('diario') ||
                      (editionNumber && (hrefLower.includes(editionNumber) || linkText.includes(editionNumber)))) {
                    pdfUrl = href;
                    break;
                  }
                }
                if (pdfUrl) break;
                
                // Also check siblings
                if (parent.previousElementSibling) {
                  const siblingLinks = parent.previousElementSibling.querySelectorAll('a[href*=".pdf"], a[href*="download"], a[href*="abrir"]');
                  for (const link of Array.from(siblingLinks)) {
                    const href = link.getAttribute('href') || '';
                    const hrefLower = href.toLowerCase();
                    if (hrefLower.includes('diario') || hrefLower.includes('diário') || 
                        (editionNumber && hrefLower.includes(editionNumber))) {
                      pdfUrl = href;
                      break;
                    }
                  }
                }
                if (pdfUrl) break;
                
                parent = parent.parentElement;
              }
            }
            
            // Last resort: try to find any link on the page that matches the edition number
            if (!pdfUrl && editionNumber) {
              // Try all links, not just PDF links
              const allLinks = document.querySelectorAll('a');
              for (const link of Array.from(allLinks)) {
                const linkHref = link.getAttribute('href') || '';
                const onclick = link.getAttribute('onclick') || '';
                const linkText = link.textContent || '';
                const linkHrefLower = linkHref.toLowerCase();
                
                // Check if link contains edition number
                if (linkHref.includes(editionNumber) || 
                    onclick.includes(editionNumber) || 
                    linkText.includes(editionNumber)) {
                  // Prefer PDF links or links with diário-related terms
                  if (linkHref.includes('.pdf') || 
                      linkHrefLower.includes('diario') || 
                      linkHrefLower.includes('diário') || 
                      linkHrefLower.includes('oficial') ||
                      onclick.includes('pdf') ||
                      onclick.includes('diario')) {
                    // Extract URL from onclick if needed - try multiple patterns
                    if (onclick) {
                      // Try multiple patterns to extract URL from onclick
                      const patterns = [
                        /(?:window\.open|location\.href|location\.replace)\s*\(\s*['"]([^'"]+)['"]/i,
                        /['"](https?:\/\/[^'"]+)['"]/i,
                        /['"](\/[^'"]+\.pdf)['"]/i,
                        /['"](\/[^'"]+diario[^'"]*)['"]/i,
                        /['"](\/[^'"]+abrir[^'"]*)['"]/i,
                        /id[=:]\s*['"]?(\d+)['"]?/i,
                        /['"]([^'"]+)['"]/i
                      ];
                      
                      for (const pattern of patterns) {
                        const match = onclick.match(pattern);
                        if (match && match[1]) {
                          pdfUrl = match[1];
                          // If it's just an ID, construct the URL
                          if (/^\d+$/.test(pdfUrl) && editionNumber) {
                            pdfUrl = `/diariooficial/abrir_arquivo.aspx?id=${pdfUrl}`;
                          }
                          break;
                        }
                      }
                    }
                    // If still no URL, use href
                    if (!pdfUrl && linkHref) {
                      pdfUrl = linkHref;
                    }
                    if (pdfUrl) break;
                  }
                }
              }
            }
            
            // Validate PDF URL - must be related to diário oficial
            if (pdfUrl) {
              const pdfUrlLower = pdfUrl.toLowerCase();
              // Reject generic PDFs that are not diário oficial
              const invalidPatterns = [
                'cadastro',
                'formulario',
                'formulário',
                'edital',
                'licitacao',
                'licitação',
                'concurso',
                'processo_seletivo',
                'processo-seletivo'
              ];
              
              const isValidDiario = pdfUrlLower.includes('diario') || 
                                   pdfUrlLower.includes('diário') ||
                                   pdfUrlLower.includes('oficial') ||
                                   (editionNumber && pdfUrlLower.includes(editionNumber)) ||
                                   pdfUrlLower.includes('do_') ||
                                   pdfUrlLower.includes('do-');
              
              const isInvalid = invalidPatterns.some(pattern => pdfUrlLower.includes(pattern));
              
              // Only accept if it's a valid diário URL or if we can't determine, but reject invalid ones
              if (isInvalid && !isValidDiario) {
                pdfUrl = ''; // Reject this URL
              }
            }
            
            // Only add if we have both date and a valid PDF URL
            if (dateText && pdfUrl) {
              data.push({
                editionNumber,
                dateText,
                pdfUrl,
              });
            }
          }
        }
        
        // If no ASP.NET items found, try standard selectors
        if (data.length === 0) {
          const listItems = document.querySelectorAll('.list-group-item, li.list-group-item, #arquivos li, table tbody tr, .edocman-document-title-td');
          
          for (const item of Array.from(listItems)) {
          // Skip items that are not gazette items (like headers)
          // Check for link with "abrir_arquivo" or containing "Visualizar" text
          let hasVisualizarLink = item.querySelector('a[href*="abrir_arquivo"]');
          if (!hasVisualizarLink) {
            // Check all links for "Visualizar", "Download", "Baixar", or PDF links
            const allLinks = item.querySelectorAll('a');
            for (const link of allLinks) {
              const linkText = link.textContent?.toLowerCase() || '';
              const linkHref = link.getAttribute('href')?.toLowerCase() || '';
              if (linkText.includes('visualizar') || 
                  linkText.includes('download') || 
                  linkText.includes('baixar') ||
                  linkHref.includes('.pdf') ||
                  linkHref.includes('abrir_arquivo')) {
                hasVisualizarLink = link;
                break;
              }
            }
          }
          if (!hasVisualizarLink) continue;
          
          // Extract edition number
          // Look for pattern "N° XXXX / YYYY" or "N° XXXX"
          const editionElement = item.querySelector('span:not([class]), span, h4, h5');
          let editionText = editionElement?.textContent?.trim() || '';
          // Try full pattern first: "N° XXXX / YYYY"
          let editionMatch = editionText.match(/N[°º]\s*(\d+)\s*\/\s*(\d{4})/);
          // If not found, try simple pattern: "N° XXXX"
          if (!editionMatch) {
            editionMatch = editionText.match(/N[°º]\s*(\d+)/);
          }
          const editionNumber = editionMatch ? editionMatch[1] : null;
          const editionYear = editionMatch && editionMatch[2] ? editionMatch[2] : null;
          
          // Extract date
          // Look for pattern "Data: DD/MM/YYYY" or from h4 heading
          let dateText = '';
          // Find div containing "Data:" text
          const allDivs = item.querySelectorAll('div');
          for (const div of allDivs) {
            if (div.textContent?.includes('Data:')) {
              const match = div.textContent.match(/(\d{2})\/(\d{2})\/(\d{4})/);
              if (match) {
                dateText = `${match[1]}/${match[2]}/${match[3]}`;
                break;
              }
            }
          }
          
          // If no date found, try the h4 heading (Portuguese month format)
          if (!dateText) {
            const headingElement = item.querySelector('h4.list-group-item-heading, h4, h5');
            const headingText = headingElement?.textContent?.trim() || '';
            // Pattern: DD/Mês/YYYY (e.g., "06/Janeiro/2026")
            const months: Record<string, string> = {
              'janeiro': '01', 'fevereiro': '02', 'março': '03', 'marco': '03',
              'abril': '04', 'maio': '05', 'junho': '06', 
              'julho': '07', 'agosto': '08', 'setembro': '09',
              'outubro': '10', 'novembro': '11', 'dezembro': '12'
            };
            const dateMatchPt = headingText.match(/(\d{2})\/(\w+)\/(\d{4})/i);
            if (dateMatchPt) {
              const monthNum = months[dateMatchPt[2].toLowerCase()];
              if (monthNum) {
                dateText = `${dateMatchPt[1]}/${monthNum}/${dateMatchPt[3]}`;
              }
            }
          }
          
          // Try to find date in any text content if still not found
          if (!dateText) {
            const allTextElements = item.querySelectorAll('div, span, h4, h5, p, td');
            for (const el of allTextElements) {
              const text = el.textContent || '';
              const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
              if (dateMatch) {
                dateText = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;
                break;
              }
            }
          }
          
          // Extract PDF URL
          const pdfLink = item.querySelector('a[href*="abrir_arquivo"]');
          let pdfUrl = pdfLink?.getAttribute('href') || '';
          
          // If not found, look for any "Visualizar", "Download", or PDF link
          if (!pdfUrl) {
            const allLinks = item.querySelectorAll('a');
            for (const link of allLinks) {
              const linkText = link.textContent?.toLowerCase() || '';
              const linkHref = link.getAttribute('href') || '';
              if (linkText.includes('visualizar') || 
                  linkText.includes('download') || 
                  linkText.includes('baixar') ||
                  linkHref.includes('.pdf') ||
                  linkHref.includes('abrir_arquivo')) {
                pdfUrl = linkHref;
                break;
              }
            }
          }
          
          if (dateText && pdfUrl) {
            data.push({
              editionNumber,
              editionYear,
              dateText,
              pdfUrl,
            });
          }
        }
        }
        
        // Try Instar format if no items found
        if (data.length === 0) {
          const instarItems = document.querySelectorAll('.dof_publicacao_diario');
          for (const item of Array.from(instarItems)) {
            const titleElement = item.querySelector('.dof_titulo_publicacao span, .dof_titulo_publicacao');
            const downloadElement = item.querySelector('.dof_download[data-href], .dof_download');
            
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
        
        // Last resort: try to find any PDF links on the page with dates nearby
        if (data.length === 0) {
          const allLinks = document.querySelectorAll('a[href*=".pdf"], a[href*="abrir"], a[href*="download"], a[href*="visualizar"]');
          for (const link of Array.from(allLinks)) {
            const href = link.getAttribute('href') || '';
            if (!href) continue;
            
            // Look for date in parent elements or nearby text
            let parent = link.parentElement;
            let dateText = '';
            let editionNumber = null;
            
            // Check up to 3 levels up
            for (let i = 0; i < 3 && parent; i++) {
              const text = parent.textContent || '';
              
              // Try to find date
              const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
              if (dateMatch && !dateText) {
                dateText = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;
              }
              
              // Try to find edition number
              const editionMatch = text.match(/N[°º]\s*(\d+)/i) || text.match(/Edi[çc][ãa]o\s+n[°º]?\s*(\d+)/i);
              if (editionMatch && !editionNumber) {
                editionNumber = editionMatch[1];
              }
              
              parent = parent.parentElement;
            }
            
            // If we found a date and a PDF link, add it
            if (dateText && href) {
              data.push({
                editionNumber,
                dateText,
                pdfUrl: href,
              });
            }
          }
        }
        
        // If still no data, try finding any divs with "Edição" text
        if (data.length === 0) {
          const allDivs = document.querySelectorAll('div');
          for (const div of Array.from(allDivs)) {
            const text = div.textContent || '';
            if (!text.includes('Edição') && !text.includes('Ediç')) continue;
            
            const editionMatch = text.match(/Edi[çc][ãa]o\s+N[°º]?[:\s]*(\d+)/i);
            const editionNumber = editionMatch ? editionMatch[1] : null;
            
            const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            const dateText = dateMatch ? `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}` : '';
            
            // Look for PDF link nearby
            let pdfUrl = '';
            const link = div.querySelector('a[href*=".pdf"], a[href*="download"], a[href*="abrir"]');
            if (link) {
              pdfUrl = link.getAttribute('href') || '';
            } else {
              // Check parent elements
              let parent = div.parentElement;
              for (let i = 0; i < 5 && parent; i++) {
                const parentLink = parent.querySelector('a[href*=".pdf"], a[href*="download"], a[href*="abrir"]');
                if (parentLink) {
                  pdfUrl = parentLink.getAttribute('href') || '';
                  break;
                }
                parent = parent.parentElement;
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
        
        return {
          gazettes: data,
          debugLinks: allPageLinks.filter(l => l.contains50758 || l.href.includes('diario') || l.href.includes('pdf') || l.onclick.includes('diario') || l.onclick.includes('pdf'))
        };
      });
      
      const debugLinks = (gazetteData as any).debugLinks || [];
      const actualGazetteData = (gazetteData as any).gazettes || gazetteData;
      
      logger.debug(`Found ${actualGazetteData.length} gazette items on page`);
      if (debugLinks.length > 0) {
        logger.debug(`Debug: Found ${debugLinks.length} relevant links on page:`, JSON.stringify(debugLinks.slice(0, 10), null, 2));
      }
      
      const gazetteDataToProcess = actualGazetteData;
      
      // Debug: log extracted URLs
      for (const item of gazetteDataToProcess) {
        logger.debug(`Extracted gazette: edition=${item.editionNumber}, date=${item.dateText}, pdfUrl=${item.pdfUrl}`);
      }
      
      if (gazetteDataToProcess.length === 0) {
        // Additional debug: try to understand what's on the page
        const debugInfo = await page.evaluate(() => {
          const allText = document.body?.textContent || '';
          const hasDiarioText = allText.toLowerCase().includes('diário') || allText.toLowerCase().includes('diario');
          const hasEdicaoText = allText.toLowerCase().includes('edição') || allText.toLowerCase().includes('edicao');
          const pdfLinks = Array.from(document.querySelectorAll('a[href*=".pdf"]')).length;
          const allLinks = Array.from(document.querySelectorAll('a')).length;
          
          return {
            hasDiarioText,
            hasEdicaoText,
            pdfLinksCount: pdfLinks,
            totalLinks: allLinks,
            pageTextSample: allText.substring(0, 500)
          };
        });
        logger.debug('No gazettes found - page debug info:', debugInfo);
      }
      
      // Process each gazette item
      for (const item of gazetteDataToProcess) {
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
          
          // If no PDF URL was found, try to construct it from edition number
          if (!pdfUrl && item.editionNumber) {
            // Try common patterns for Timóteo - prioritize ASP.NET format
            const baseUrlObj = new URL(this.timoteoConfig.baseUrl);
            const possibleUrls = [
              `${baseUrlObj.origin}/diariooficial/abrir_arquivo.aspx?id=${item.editionNumber}`,
              `${baseUrlObj.origin}/diariooficial/VisualizarArquivo.aspx?id=${item.editionNumber}`,
              `${baseUrlObj.origin}/diariooficial/DownloadArquivo.aspx?id=${item.editionNumber}`,
              `${baseUrlObj.origin}/diariooficial/${item.editionNumber}/pdf`,
              `${baseUrlObj.origin}/diariooficial/${item.editionNumber}.pdf`,
              `${baseUrlObj.origin}/diariooficial/pdf/${item.editionNumber}`,
            ];
            // Use the first pattern as default (ASP.NET format is most common)
            pdfUrl = possibleUrls[0];
            logger.debug(`No PDF URL found, constructing from edition number: ${pdfUrl}`);
          } else if (pdfUrl && !pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.timoteoConfig.baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }
          
          logger.debug(`Final PDF URL: ${pdfUrl}`);
          
          // Create gazette
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

