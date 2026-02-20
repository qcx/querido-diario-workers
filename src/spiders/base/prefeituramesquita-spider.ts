import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraMesquitaConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * PrefeituraMesquitaSpider for Mesquita, RJ
 * 
 * Site Structure:
 * - URL: https://transparencia.mesquita.rj.gov.br/
 * - Navigation flow:
 *   1. Navigate to base URL (transparency portal)
 *   2. Click on "Diário Oficial" link
 *   3. Click on "Diário Oficial do Município" link
 *   4. Interface with monthly tabs (Jan, Fev, Mar, etc.) and year dropdown
 * - Each month tab shows a list of gazettes with:
 *   - Date in format DD/MM/YYYY
 *   - Edition number (Nº XXXX)
 *   - PDF download links
 * - Requires browser rendering to navigate and interact with tabs
 */
export class PrefeituraMesquitaSpider extends BaseSpider {
  protected mesquitaConfig: PrefeituraMesquitaConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.mesquitaConfig = spiderConfig.config as PrefeituraMesquitaConfig;
    this.browser = browser || null;
    
    if (!this.mesquitaConfig.baseUrl) {
      throw new Error(`PrefeituraMesquitaSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraMesquitaSpider for ${spiderConfig.name}`);
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.mesquitaConfig.baseUrl} for ${this.spiderConfig.name}...`);
    
    if (!this.browser) {
      throw new Error(`PrefeituraMesquitaSpider requires browser binding for ${this.spiderConfig.name}`);
    }
    
    return this.crawlWithBrowser();
  }

  /**
   * Browser-based crawling with navigation to diário oficial page
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Capture console messages for debugging (only errors and warnings)
      page.on('console', (msg) => {
        const type = msg.type();
        if (type === 'error' || type === 'warning') {
          logger.debug(`Browser console ${type}: ${msg.text()}`);
        }
      });
      
      // Navigate to the base URL
      logger.debug(`Navigating to ${this.mesquitaConfig.baseUrl}`);
      await page.goto(this.mesquitaConfig.baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Wait for page to load
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Step 1: Get and navigate to "Diários Oficiais" URL
      logger.debug('Looking for "Diários Oficiais" link...');
      let diarioOficialUrl = await this.getDiarioOficialUrl(page);
      if (!diarioOficialUrl) {
        logger.error('Could not find "Diários Oficiais" link');
        return gazettes;
      }
      
      // Make absolute URL if relative
      if (!diarioOficialUrl.startsWith('http')) {
        const currentUrl = page.url();
        diarioOficialUrl = new URL(diarioOficialUrl, currentUrl).toString();
      }
      
      logger.debug(`Navigating to Diários Oficiais URL: ${diarioOficialUrl}`);
      await page.goto(diarioOficialUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Step 2: Get and navigate to "Diário Oficial do Município" URL
      logger.debug('Looking for "Diário Oficial do Município" link...');
      let diarioMunicipioUrl = await this.getDiarioMunicipioUrl(page);
      if (!diarioMunicipioUrl) {
        logger.error('Could not find "Diário Oficial do Município" link');
        return gazettes;
      }
      
      // Make absolute URL if relative
      if (!diarioMunicipioUrl.startsWith('http')) {
        const currentUrl = page.url();
        diarioMunicipioUrl = new URL(diarioMunicipioUrl, currentUrl).toString();
      }
      
      logger.debug(`Navigating to Diário Oficial do Município URL: ${diarioMunicipioUrl}`);
      await page.goto(diarioMunicipioUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Wait for page to fully load
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Log current URL for debugging
      const currentUrl = await page.url();
      logger.debug(`Current page URL: ${currentUrl}`);
      
      // Wait for the page to be fully loaded - look for key elements
      try {
        // Wait for either the select dropdown or tablist to appear
        await page.waitForSelector('[role="tablist"], select, [role="combobox"]', { timeout: 15000 });
        logger.debug('Page elements found, continuing...');
      } catch (error) {
        logger.warn('Key elements not found immediately, but continuing anyway');
        // Try to log what elements are actually available
        const availableElements = await page.evaluate(() => {
          return {
            hasTablist: !!document.querySelector('[role="tablist"]'),
            hasSelect: !!document.querySelector('select'),
            hasCombobox: !!document.querySelector('[role="combobox"]'),
            selectCount: document.querySelectorAll('select').length,
            tabCount: document.querySelectorAll('[role="tab"]').length,
          };
        });
        logger.debug('Available elements on page:', availableElements);
      }
      
      // Additional wait for dynamic content to load
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Now we should be on the page similar to Duque de Caxias
      // Get all years we need to process
      const years = this.getYearsInRange();
      
      for (const year of years) {
        logger.debug(`Processing year ${year}`);
        
        // Select the year in the dropdown using browser evaluation for reliability
        const yearSelected = await page.evaluate((targetYear) => {
          // Try multiple selectors to find the year dropdown
          let combobox: HTMLSelectElement | null = null;
          
          // First try: role="combobox" as select
          combobox = document.querySelector('[role="combobox"]') as HTMLSelectElement;
          
          // Second try: look for select element near the tabs
          if (!combobox || combobox.tagName !== 'SELECT') {
            const tablist = document.querySelector('[role="tablist"]');
            if (tablist) {
              // Look in the parent and siblings
              const parent = tablist.parentElement;
              if (parent) {
                combobox = parent.querySelector('select') as HTMLSelectElement;
              }
              // Also check siblings
              if (!combobox && tablist.parentElement) {
                const siblings = Array.from(tablist.parentElement.children);
                for (const sibling of siblings) {
                  const select = sibling.querySelector('select');
                  if (select) {
                    combobox = select as HTMLSelectElement;
                    break;
                  }
                }
              }
            }
          }
          
          // Third try: any select in the main area or body
          if (!combobox || combobox.tagName !== 'SELECT') {
            combobox = document.querySelector('main select, [role="main"] select, body select') as HTMLSelectElement;
          }
          
          // Fourth try: look for any select element on the page
          if (!combobox || combobox.tagName !== 'SELECT') {
            const allSelects = document.querySelectorAll('select');
            // Prefer selects that have year-like options
            for (const select of Array.from(allSelects)) {
              const options = Array.from(select.options);
              const hasYearOption = options.some(opt => {
                const text = opt.textContent?.trim() || '';
                return /^\d{4}$/.test(text) || text.includes('202');
              });
              if (hasYearOption) {
                combobox = select as HTMLSelectElement;
                break;
              }
            }
            // If still not found, use the first select
            if (!combobox && allSelects.length > 0) {
              combobox = allSelects[0] as HTMLSelectElement;
            }
          }
          
          if (!combobox || combobox.tagName !== 'SELECT') {
            console.error('Could not find select element for year dropdown');
            // Log what we found for debugging
            const allSelects = Array.from(document.querySelectorAll('select'));
            console.error('Available selects:', allSelects.map(s => ({
              id: s.id,
              className: s.className,
              options: Array.from(s.options).map(o => o.textContent?.trim()).slice(0, 5)
            })));
            return false;
          }
          
          // Find the option with matching year
          const options = Array.from(combobox.options);
          const targetOption = options.find(opt => {
            const text = opt.textContent?.trim() || opt.innerText?.trim() || '';
            return text === targetYear.toString();
          });
          
          if (targetOption) {
            combobox.value = targetOption.value;
            // Trigger multiple events to ensure the change is registered
            combobox.dispatchEvent(new Event('change', { bubbles: true }));
            combobox.dispatchEvent(new Event('input', { bubbles: true }));
            // Also try click if it's a custom dropdown
            if (combobox.onchange) {
              combobox.onchange(new Event('change') as any);
            }
            return true;
          }
          
          console.error(`Could not find option for year ${targetYear}. Available options:`, options.map(o => o.textContent?.trim()));
          return false;
        }, year);
        
        if (!yearSelected) {
          logger.warn(`Could not select year ${year} - trying alternative method`);
          
          // Fallback: try multiple selector strategies
          let fallbackSuccess = false;
          const selectors = [
            'select[role="combobox"]',
            'select',
            'select option',
            '[role="combobox"]',
          ];
          
          for (const selector of selectors) {
            try {
              // Try to find and select the year using different approaches
              const found = await page.evaluate((sel, targetYear) => {
                // Try to find select element
                const select = document.querySelector(sel) as HTMLSelectElement;
                if (select && select.tagName === 'SELECT') {
                  // Find the option
                  const options = Array.from(select.options);
                  const targetOption = options.find(opt => {
                    const text = opt.textContent?.trim() || opt.innerText?.trim() || opt.value;
                    return text === targetYear.toString() || text.includes(targetYear.toString());
                  });
                  
                  if (targetOption) {
                    select.value = targetOption.value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    select.dispatchEvent(new Event('input', { bubbles: true }));
                    return true;
                  }
                }
                return false;
              }, selector, year);
              
              if (found) {
                fallbackSuccess = true;
                logger.debug(`Successfully selected year ${year} using fallback selector: ${selector}`);
                break;
              }
            } catch (error) {
              logger.debug(`Fallback selector ${selector} failed: ${error}`);
            }
          }
          
          if (!fallbackSuccess) {
            logger.error(`Failed to select year ${year} with all methods`);
            continue;
          }
          
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        await new Promise(resolve => setTimeout(resolve, 1500)); // Wait for content to load after year change
        
        // Get all months (1-12) and process each
        const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        
        for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
          const month = monthIndex + 1; // 1-based
          const monthName = monthNames[monthIndex];
          
          // Check if we need this month (only process months in date range)
          if (!this.isMonthInRange(year, month)) {
            continue;
          }
          
          logger.debug(`Processing ${monthName}/${year}`);
          
          // Click on the month tab - use browser evaluation for more reliable clicking
          try {
            const tabInfo = await page.evaluate((monthName) => {
              // Find all tabs
              const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
              
              // Find the tab with matching text
              const targetTab = tabs.find(tab => {
                const text = tab.textContent?.trim() || '';
                return text === monthName;
              });
              
              if (targetTab) {
                (targetTab as HTMLElement).click();
                
                // After clicking, check tab states
                const clickedTabText = targetTab.textContent?.trim();
                const isSelected = targetTab.getAttribute('aria-selected') === 'true';
                
                // Count items in all panels before waiting
                const panelsBefore = Array.from(document.querySelectorAll('[role="tabpanel"]'));
                const itemCountsBefore = panelsBefore.map(panel => ({
                  display: window.getComputedStyle(panel).display,
                  items: panel.querySelectorAll('[role="listitem"]').length
                }));
                
                return {
                  clicked: true,
                  tabText: clickedTabText,
                  isSelected,
                  itemCountsBefore
                };
              }
              
              return { clicked: false, availableTabs: tabs.map(t => t.textContent?.trim()) };
            }, monthName);
            
            if (!tabInfo.clicked) {
              logger.warn(`Could not find or click tab for ${monthName}/${year}. Available tabs: ${tabInfo.availableTabs?.join(', ')}`);
              continue;
            }
            
            logger.debug(`Clicked tab ${monthName}, selected: ${tabInfo.isSelected}`);
            
            // Wait a bit for the click to register
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Wait for content to load - use polling approach since AJAX may be loading
            let itemsFound = false;
            const maxAttempts = 8; // Wait up to 8 seconds
            
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
              await new Promise(resolve => setTimeout(resolve, 1000));
              
              const checkResult = await page.evaluate(() => {
                const panels = document.querySelectorAll('[role="tabpanel"]');
                for (const panel of panels) {
                  const style = window.getComputedStyle(panel);
                  // Make sure it's not a nav-link (tab)
                  const isNavLink = panel.classList.contains('nav-link') || panel.tagName === 'A';
                  
                  if (style.display === 'block' && !isNavLink) {
                    const list = panel.querySelector('[role="list"]');
                    const items = panel.querySelectorAll('[role="listitem"]');
                    
                    // Also check for any elements with dates and links
                    let dateItemsCount = 0;
                    const allLinks = panel.querySelectorAll('a');
                    const datePattern = /\d{2}\/\d{2}\/\d{4}/;
                    
                    for (const link of allLinks) {
                      let element: Element | null = link.parentElement;
                      let depth = 0;
                      while (element && element !== panel && depth < 10) {
                        const text = element.textContent || '';
                        if (datePattern.test(text)) {
                          dateItemsCount++;
                          break;
                        }
                        element = element.parentElement;
                        depth++;
                      }
                    }
                    
                    return {
                      hasList: !!list,
                      listItemCount: items.length,
                      dateItemsCount: dateItemsCount,
                      panelHasContent: panel.textContent?.trim().length > 0
                    };
                  }
                }
                return null;
              });
              
              if (checkResult && (checkResult.listItemCount > 0 || checkResult.dateItemsCount > 0)) {
                itemsFound = true;
                break;
              }
            }
            
            if (!itemsFound) {
              logger.debug(`No items found after ${maxAttempts} seconds - content may not be loading or month is empty`);
            }
          } catch (error) {
            logger.warn(`Could not click tab for ${monthName}/${year}: ${error}`);
            continue;
          }
          
          // Extract gazettes from the current tab panel
          // Add a small delay before extraction to ensure DOM is stable
          await new Promise(resolve => setTimeout(resolve, 500));
          const monthGazettes = await this.extractGazettesFromPage(page, year, month);
          gazettes.push(...monthGazettes);
          
          if (monthGazettes.length === 0) {
            logger.debug(`No gazettes extracted for ${monthName}/${year} - this might be expected if month has no publications`);
          }
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (error) {
          logger.warn(`Error closing page: ${error}`);
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (error) {
          logger.warn(`Error closing browser: ${error}`);
        }
      }
    }
    
    return gazettes;
  }

  /**
   * Get the URL for "Diários Oficiais" or "Diário Oficial" link
   */
  private async getDiarioOficialUrl(page: any): Promise<string | null> {
    try {
      const url = await page.evaluate(() => {
        const allLinks = document.querySelectorAll('a');
        
        // Priority 1: Look for exact "Diários Oficiais" or "Diário Oficial" text (case insensitive)
        for (const link of Array.from(allLinks)) {
          const text = link.textContent?.trim() || '';
          const lowerText = text.toLowerCase();
          if (lowerText === 'diários oficiais' || 
              lowerText === 'diarios oficiais' ||
              lowerText === 'diário oficial' || 
              lowerText === 'diario oficial') {
            const href = (link as HTMLAnchorElement).href || link.getAttribute('href') || '';
            if (href) {
              return href;
            }
          }
        }
        
        // Priority 2: Look for links containing "Diários Oficiais" or "Diário Oficial"
        for (const link of Array.from(allLinks)) {
          const text = link.textContent?.trim() || '';
          const lowerText = text.toLowerCase();
          if (lowerText.includes('diários oficiais') || 
              lowerText.includes('diarios oficiais') ||
              lowerText.includes('diário oficial') || 
              lowerText.includes('diario oficial')) {
            const href = (link as HTMLAnchorElement).href || link.getAttribute('href') || '';
            if (href) {
              return href;
            }
          }
        }
        
        // Priority 3: Look for links in nav/menu that contain "Diário" or "Diários"
        const menuLinks = document.querySelectorAll('nav a, .menu a, ul.menu a, header a');
        for (const link of Array.from(menuLinks)) {
          const text = link.textContent?.trim() || '';
          const lowerText = text.toLowerCase();
          if (lowerText.includes('diário') || 
              lowerText.includes('diario') ||
              lowerText.includes('diários') ||
              lowerText.includes('diarios')) {
            const href = (link as HTMLAnchorElement).href || link.getAttribute('href') || '';
            if (href) {
              return href;
            }
          }
        }
        
        return null;
      });
      
      if (url) {
        logger.debug(`Found Diários Oficiais URL: ${url}`);
        return url;
      }
      
      return null;
    } catch (error) {
      logger.warn('Error getting Diário Oficial URL', { error: (error as Error).message });
      return null;
    }
  }

  /**
   * Get the URL for "Diário Oficial do Município" link
   */
  private async getDiarioMunicipioUrl(page: any): Promise<string | null> {
    try {
      const url = await page.evaluate(() => {
        const allLinks = document.querySelectorAll('a');
        
        // Priority 1: Look for exact "Diário Oficial do Município" text
        for (const link of Array.from(allLinks)) {
          const text = link.textContent?.trim() || '';
          if (text.toLowerCase() === 'diário oficial do município' || 
              text.toLowerCase() === 'diario oficial do municipio' ||
              text.toLowerCase() === 'diário oficial do municipio') {
            const href = (link as HTMLAnchorElement).href || link.getAttribute('href') || '';
            if (href) {
              return href;
            }
          }
        }
        
        // Priority 2: Look for links containing "Diário Oficial do Município"
        for (const link of Array.from(allLinks)) {
          const text = link.textContent?.trim() || '';
          if ((text.toLowerCase().includes('diário oficial do município') || 
               text.toLowerCase().includes('diario oficial do municipio') ||
               text.toLowerCase().includes('diário oficial do municipio')) &&
              !text.toLowerCase().includes('estado')) {
            const href = (link as HTMLAnchorElement).href || link.getAttribute('href') || '';
            if (href) {
              return href;
            }
          }
        }
        
        // Priority 3: Look for links containing "do Município" or "do Municipio"
        for (const link of Array.from(allLinks)) {
          const text = link.textContent?.trim() || '';
          if ((text.toLowerCase().includes('diário oficial') || text.toLowerCase().includes('diario oficial')) &&
              (text.toLowerCase().includes('do município') || text.toLowerCase().includes('do municipio')) &&
              !text.toLowerCase().includes('estado')) {
            const href = (link as HTMLAnchorElement).href || link.getAttribute('href') || '';
            if (href) {
              return href;
            }
          }
        }
        
        return null;
      });
      
      if (url) {
        logger.debug(`Found Diário Oficial do Município URL: ${url}`);
        return url;
      }
      
      return null;
    } catch (error) {
      logger.warn('Error getting Diário Oficial do Município URL', { error: (error as Error).message });
      return null;
    }
  }

  /**
   * Extract gazettes from the current page state using browser evaluation
   */
  private async extractGazettesFromPage(page: any, year: number, month: number): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Use browser evaluation to extract data from the active tab panel
      const extractedData = await page.evaluate(() => {
        const results: Array<{
          date: string;
          editionNumber?: string;
          pdfUrl: string;
          isExtra: boolean;
        }> = [];
        
        // Find the active tab panel - try multiple methods
        let activePanel: Element | null = null;
        
        // Method 1: Find panel by aria-selected tab (most reliable)
        const selectedTab = document.querySelector('[role="tab"][aria-selected="true"]');
        if (selectedTab) {
          const tabId = selectedTab.id || selectedTab.getAttribute('aria-controls');
          if (tabId) {
            activePanel = document.getElementById(tabId);
            
            if (!activePanel) {
              activePanel = document.querySelector(`[aria-labelledby="${tabId}"]`) || 
                           document.querySelector(`[aria-controls="${tabId}"]`);
            }
            
            if (!activePanel) {
              const panels = document.querySelectorAll('[role="tabpanel"]');
              for (const panel of panels) {
                const panelId = panel.id;
                if (panelId && (panelId === tabId || panelId.includes(tabId) || tabId.includes(panelId))) {
                  activePanel = panel;
                  break;
                }
              }
            }
          }
        }
        
        // Method 2: Find panel that is visible (display: block) and has content
        if (!activePanel) {
          const tabPanels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
          for (const panel of tabPanels) {
            const style = window.getComputedStyle(panel);
            const isNavLink = panel.classList.contains('nav-link') || panel.tagName === 'A';
            if (style.display === 'block' && !isNavLink) {
              const links = panel.querySelectorAll('a');
              const datePattern = /\d{2}\/\d{2}\/\d{4}/;
              for (const link of links) {
                let element: Element | null = link.parentElement;
                let depth = 0;
                while (element && depth < 5) {
                  if (datePattern.test(element.textContent || '')) {
                    activePanel = panel;
                    break;
                  }
                  element = element.parentElement;
                  depth++;
                }
                if (activePanel) break;
              }
              if (activePanel) break;
            }
          }
        }
        
        // Method 3: Fallback - find any panel with visible list items
        if (!activePanel) {
          const tabPanels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
          for (const panel of tabPanels) {
            const style = window.getComputedStyle(panel);
            const isNavLink = panel.classList.contains('nav-link') || panel.tagName === 'A';
            if (style.display !== 'none' && style.visibility !== 'hidden' && !isNavLink) {
              const hasVisibleItems = panel.querySelector('[role="listitem"]') !== null;
              if (hasVisibleItems) {
                activePanel = panel;
                break;
              }
            }
          }
        }
        
        if (!activePanel || activePanel.classList.contains('nav-link') || activePanel.tagName === 'A') {
          return results;
        }
        
        // Look for list items in the list within the panel
        const list = activePanel.querySelector('[role="list"]');
        let listItems: Element[] = [];
        
        if (list) {
          listItems = Array.from(list.querySelectorAll('[role="listitem"]'));
        } else {
          listItems = Array.from(activePanel.querySelectorAll('[role="listitem"]'));
        }
        
        // If still no items, try alternative search - find containers with dates and links
        if (listItems.length === 0) {
          const allLinks = Array.from(activePanel.querySelectorAll('a'));
          const datePattern = /\d{2}\/\d{2}\/\d{4}/;
          const itemContainers = new Set<Element>();
          
          for (const link of allLinks) {
            let element: Element | null = link;
            let depth = 0;
            
            while (element && element !== activePanel && depth < 15) {
              const text = element.textContent || '';
              
              if (datePattern.test(text)) {
                let container = element;
                
                while (container && container !== activePanel) {
                  const containerText = container.textContent || '';
                  const containerLinks = container.querySelectorAll('a');
                  
                  if (containerLinks.length > 0 && datePattern.test(containerText)) {
                    if (!itemContainers.has(container)) {
                      itemContainers.add(container);
                      break;
                    }
                  }
                  
                  container = container.parentElement;
                }
                break;
              }
              
              element = element.parentElement;
              depth++;
            }
          }
          
          listItems = Array.from(itemContainers);
          
          if (listItems.length === 0) {
            const allDivs = Array.from(activePanel.querySelectorAll('div, li, article, section'));
            for (const div of allDivs) {
              const text = div.textContent || '';
              const links = div.querySelectorAll('a');
              
              if (datePattern.test(text) && links.length > 0) {
                let isNested = false;
                for (const existingItem of itemContainers) {
                  if (existingItem.contains(div) || div.contains(existingItem)) {
                    if (existingItem.contains(div)) {
                      itemContainers.delete(existingItem);
                      itemContainers.add(div);
                    }
                    isNested = true;
                    break;
                  }
                }
                
                if (!isNested) {
                  itemContainers.add(div);
                }
              }
            }
            listItems = Array.from(itemContainers);
          }
        }
      
      for (const item of listItems) {
        try {
            const itemText = item.textContent?.trim() || '';
            
            // Extract date (format: "DD/MM/YYYY Ver OCR do PDF Nº XXXX")
          const dateMatch = itemText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) {
            continue;
          }
          
            // Extract edition number
            const editionMatch = itemText.match(/Nº\s*(\d+)/i);
            const editionNumber = editionMatch ? editionMatch[1] : undefined;
            
            // Check if it's an extra edition
            const isExtra = /\b(vol|suplemento|extra)\d*\b/i.test(itemText);
            
            // Find the PDF link - prioritize direct PDF links
            const links = Array.from(item.querySelectorAll('a'));
            let pdfUrl = '';
            
            // First, try to find a link with .pdf in the href (direct PDF link)
            const directPdfLink = links.find(link => {
              const href = link.getAttribute('href') || link.href || '';
              return href.toLowerCase().includes('.pdf');
            });
            
            if (directPdfLink) {
              pdfUrl = directPdfLink.href || directPdfLink.getAttribute('href') || '';
            } else {
              // Try to find link with "PDF" text
              const pdfTextLink = links.find(link => {
                const text = link.textContent?.trim() || '';
                const href = link.getAttribute('href') || link.href || '';
                return text.toLowerCase() === 'pdf' || 
                       (text.toLowerCase().includes('pdf') && href.length > 0);
              });
              
              if (pdfTextLink) {
                pdfUrl = pdfTextLink.href || pdfTextLink.getAttribute('href') || '';
              } else {
                // Fallback: use "Ver OCR do PDF" link
                const ocrLink = links.find(link => {
                  const text = link.textContent?.trim() || '';
                  return text.toLowerCase().includes('ver ocr') || text.toLowerCase().includes('ocr');
                });
                
                if (ocrLink) {
                  pdfUrl = ocrLink.href || ocrLink.getAttribute('href') || '';
                }
              }
            }
            
            if (!pdfUrl) {
              continue;
            }
            
            // Make URL absolute if needed
            if (!pdfUrl.startsWith('http')) {
              const baseUrl = window.location.origin;
              pdfUrl = pdfUrl.startsWith('/') 
                ? `${baseUrl}${pdfUrl}`
                : `${baseUrl}/${pdfUrl}`;
            }
            
            results.push({
              date: dateMatch[0],
              editionNumber,
              pdfUrl,
              isExtra,
            });
          } catch (error) {
            console.error('Error processing list item:', error);
          }
        }
        
        return results;
      });
      
      if (extractedData.length > 0) {
        logger.debug(`Found ${extractedData.length} items in month ${month}/${year}`);
      }
      
      // Process extracted data
      for (const data of extractedData) {
        try {
          // Parse date
          const [day, itemMonth, itemYear] = data.date.split('/');
          const gazetteDate = new Date(`${itemYear}-${itemMonth}-${day}`);
          
          if (isNaN(gazetteDate.getTime())) {
            logger.warn(`Invalid date: ${data.date}`);
            continue;
          }
          
          // Filter by date range
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }
          
          // Create gazette
          const gazette = await this.createGazette(gazetteDate, data.pdfUrl, {
            power: 'executive_legislative',
            editionNumber: data.editionNumber,
            isExtraEdition: data.isExtra,
          });
          
          if (gazette) {
            gazettes.push(gazette);
            logger.info(`Found gazette for ${toISODate(gazetteDate)} (edição ${data.editionNumber || 'N/A'}): ${data.pdfUrl}`);
          } else {
            logger.warn(`Failed to create gazette for ${toISODate(gazetteDate)} with URL: ${data.pdfUrl}`);
          }
        } catch (error) {
          logger.error(`Error processing extracted data:`, error as Error);
        }
      }
    } catch (error) {
      logger.error(`Error extracting gazettes from page:`, error as Error);
    }
    
    return gazettes;
  }

  /**
   * Get all years in the date range
   */
  private getYearsInRange(): number[] {
    const years: number[] = [];
    const startYear = new Date(this.startDate).getFullYear();
    const endYear = new Date(this.endDate).getFullYear();
    
    for (let year = startYear; year <= endYear; year++) {
      years.push(year);
    }
    
    return years;
  }

  /**
   * Check if a month is in the date range
   */
  private isMonthInRange(year: number, month: number): boolean {
    const startDate = new Date(this.startDate);
    const endDate = new Date(this.endDate);
    
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0); // Last day of month
    
    // Check if month overlaps with date range
    return monthStart <= endDate && monthEnd >= startDate;
  }
}
