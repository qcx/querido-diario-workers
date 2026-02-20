import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraVoltaRedondaConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Spider for Prefeitura de Volta Redonda - RJ official gazette
 * 
 * Uses Cloudflare Browser Rendering (Puppeteer) to handle:
 * - VR Destaque platform with calendar interface
 * - Month/year navigation using calendar controls
 * - JavaScript-driven calendar interaction
 * - Clicking dates to reveal PDF links
 * 
 * The site structure:
 * 1. Navigate to the main page with calendar
 * 2. Navigate through months using navigation buttons
 * 3. Calendar shows dates with gazettes marked (e.g., "VR DESTAQUE" labels)
 * 4. Clicking a date or "VR DESTAQUE" link reveals PDF link
 */
export class PrefeituraVoltaRedondaSpider extends BaseSpider {
  protected config: PrefeituraVoltaRedondaConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeituraVoltaRedondaConfig;
    this.browser = browser || null;
    
    if (!this.config.url) {
      throw new Error(`PrefeituraVoltaRedondaSpider requires a url in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraVoltaRedondaSpider for ${spiderConfig.name} with URL: ${this.config.url}`);
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(`PrefeituraVoltaRedondaSpider for ${this.config.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura Volta Redonda for ${this.spiderConfig.name}...`);

    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      
      // Navigate to the main page
      logger.debug(`Navigating to: ${this.config.url}`);
      await page.goto(this.config.url, { waitUntil: 'networkidle0', timeout: 30000 });
      this.requestCount++;
      
      // Wait for page to stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Generate list of months to navigate through
      const months = this.generateMonthsToCrawl();
      logger.info(`Will crawl ${months.length} months`);

      // Process each month
      for (const { year, month } of months) {
        try {
          logger.info(`Processing month: ${month}/${year}`);
          const monthGazettes = await this.crawlMonth(page, year, month);
          gazettes.push(...monthGazettes);
          logger.info(`Found ${monthGazettes.length} gazette(s) for ${month}/${year}`);
        } catch (error) {
          logger.error(`Error crawling month ${month}/${year}:`, error as Error);
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from Prefeitura Volta Redonda`);
      
    } catch (error) {
      logger.error(`Error crawling Prefeitura Volta Redonda:`, error as Error);
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

  /**
   * Generate list of months to crawl from start date to end date
   */
  private generateMonthsToCrawl(): Array<{ year: number; month: number }> {
    const months: Array<{ year: number; month: number }> = [];
    const current = new Date(this.startDate.getFullYear(), this.startDate.getMonth(), 1);
    const end = new Date(this.endDate.getFullYear(), this.endDate.getMonth(), 1);

    while (current <= end) {
      const year = current.getFullYear();
      const month = current.getMonth() + 1; // JavaScript months are 0-indexed
      months.push({ year, month });
      
      // Move to next month
      current.setMonth(current.getMonth() + 1);
    }

    return months;
  }

  /**
   * Navigate to a specific month/year in the calendar
   */
  private async navigateToMonth(page: any, targetYear: number, targetMonth: number): Promise<boolean> {
    try {
      // Wait for calendar to be visible
      await page.waitForSelector('table, .calendar, [class*="calendar"]', { timeout: 10000 });
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Get current month/year from the page
      const currentMonthInfo = await page.evaluate(() => {
        // Look for month/year display text (e.g., "janeiro 2026")
        const monthYearElement = document.querySelector('h1, h2, .month, [class*="month"], .calendar-header');
        if (!monthYearElement) {
          return null;
        }
        
        const text = monthYearElement.textContent || '';
        // Match month name (Portuguese) and year
        const match = text.match(/(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+(\d{4})/i);
        if (!match) {
          return null;
        }
        
        const monthNames: { [key: string]: number } = {
          'janeiro': 1, 'fevereiro': 2, 'março': 3, 'abril': 4,
          'maio': 5, 'junho': 6, 'julho': 7, 'agosto': 8,
          'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12
        };
        
        const monthName = match[1].toLowerCase();
        const month = monthNames[monthName] || 0;
        const year = parseInt(match[2], 10);
        
        return { month, year };
      });

      if (!currentMonthInfo) {
        logger.warn('Could not determine current month from page');
        // Try to navigate anyway by clicking navigation buttons
      } else {
        logger.debug(`Current month: ${currentMonthInfo.month}/${currentMonthInfo.year}, Target: ${targetMonth}/${targetYear}`);
        
        // Calculate how many months we need to navigate
        const currentDate = new Date(currentMonthInfo.year, currentMonthInfo.month - 1, 1);
        const targetDate = new Date(targetYear, targetMonth - 1, 1);
        
        const monthsDiff = (targetDate.getFullYear() - currentDate.getFullYear()) * 12 + 
                          (targetDate.getMonth() - currentDate.getMonth());
        
        if (monthsDiff === 0) {
          logger.debug('Already on target month');
          return true;
        }
        
        // Navigate forward or backward
        const direction = monthsDiff > 0 ? 'next' : 'prev';
        const clicksNeeded = Math.abs(monthsDiff);
        
        logger.debug(`Need to navigate ${clicksNeeded} months ${direction}`);
        
        for (let i = 0; i < clicksNeeded; i++) {
          // Find navigation button (previous/next month buttons)
          const buttonClicked = await page.evaluate((dir: string) => {
            // Look for navigation buttons
            // Common selectors: arrow buttons, ">" for next, "<" for previous
            const buttons = Array.from(document.querySelectorAll('button, a, [onclick*="mes"], [onclick*="ano"]'));
            
            for (const button of buttons) {
              const text = (button.textContent || '').trim();
              const onclick = button.getAttribute('onclick') || '';
              
              // Look for next/previous indicators
              if (dir === 'next') {
                if (text === '>' || text.includes('próximo') || text.includes('próximo mês') || 
                    onclick.includes('next') || onclick.includes('proximo')) {
                  (button as HTMLElement).click();
                  return true;
                }
              } else {
                if (text === '<' || text.includes('anterior') || text.includes('mês anterior') ||
                    onclick.includes('prev') || onclick.includes('anterior')) {
                  (button as HTMLElement).click();
                  return true;
                }
              }
            }
            
            // Fallback: look for buttons with arrow symbols or navigation classes
            const arrowButtons = Array.from(document.querySelectorAll('[class*="next"], [class*="prev"], [class*="arrow"]'));
            for (const button of arrowButtons) {
              const classes = button.className || '';
              if (dir === 'next' && (classes.includes('next') || classes.includes('arrow-right'))) {
                (button as HTMLElement).click();
                return true;
              } else if (dir === 'prev' && (classes.includes('prev') || classes.includes('arrow-left'))) {
                (button as HTMLElement).click();
                return true;
              }
            }
            
            return false;
          }, direction);
          
          if (!buttonClicked) {
            logger.warn(`Could not find ${direction} navigation button`);
            return false;
          }
          
          // Wait for calendar to update
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }

      // Verify we're on the correct month
      await new Promise(resolve => setTimeout(resolve, 500));
      const verifyMonth = await page.evaluate(() => {
        const monthYearElement = document.querySelector('h1, h2, .month, [class*="month"], .calendar-header');
        if (!monthYearElement) {
          return null;
        }
        const text = monthYearElement.textContent || '';
        const match = text.match(/(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+(\d{4})/i);
        if (!match) {
          return null;
        }
        const monthNames: { [key: string]: number } = {
          'janeiro': 1, 'fevereiro': 2, 'março': 3, 'abril': 4,
          'maio': 5, 'junho': 6, 'julho': 7, 'agosto': 8,
          'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12
        };
        const month = monthNames[match[1].toLowerCase()] || 0;
        const year = parseInt(match[2], 10);
        return { month, year };
      });

      if (verifyMonth && verifyMonth.month === targetMonth && verifyMonth.year === targetYear) {
        logger.debug(`Successfully navigated to ${targetMonth}/${targetYear}`);
        return true;
      } else {
        logger.warn(`Navigation may have failed. Current: ${verifyMonth?.month}/${verifyMonth?.year}, Target: ${targetMonth}/${targetYear}`);
        // Continue anyway - we'll try to extract what we can
        return true;
      }
    } catch (error) {
      logger.error(`Error navigating to month ${targetMonth}/${targetYear}:`, error as Error);
      return false;
    }
  }

  /**
   * Crawl all gazettes for a specific month
   */
  private async crawlMonth(page: any, year: number, month: number): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Navigate to the target month
      const navigated = await this.navigateToMonth(page, year, month);
      if (!navigated) {
        logger.warn(`Could not navigate to ${month}/${year}, skipping`);
        return gazettes;
      }
      
      // Wait for calendar to be fully loaded
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Find all "VR DESTAQUE" links in the calendar
      const dateData = await page.evaluate(() => {
        const results: Array<{
          day: number;
          editionNumber?: string;
          isExtra: boolean;
          href: string;
          rowIndex: number;
          cellIndex: number;
        }> = [];
        
        // Find all links with "VR DESTAQUE" text
        const allLinks = Array.from(document.querySelectorAll('a'));
        const vrDestaqueLinks = allLinks.filter(link => {
          const text = link.textContent?.trim() || '';
          return text.includes('VR DESTAQUE') || text.includes('DESTAQUE');
        });
        
        // Find the calendar table
        const calendarTable = document.querySelector('table.fc-day-grid, table[class*="calendar"], .fc-view-container table, table');
        if (!calendarTable) {
          return results;
        }
        
        // Find the date row (usually the first row with day numbers)
        const rows = Array.from(calendarTable.querySelectorAll('tr'));
        let dateRowIndex = -1;
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const cells = Array.from(row.querySelectorAll('td, th'));
          const firstCellText = cells[0]?.textContent?.trim() || '';
          // Check if this row contains day numbers (1-31)
          if (firstCellText.match(/^\d{1,2}$/)) {
            dateRowIndex = i;
            break;
          }
        }
        
        if (dateRowIndex === -1) {
          return results;
        }
        
        const dateRow = rows[dateRowIndex];
        const dateCells = Array.from(dateRow.querySelectorAll('td, th'));
        
        // Process each VR DESTAQUE link
        for (const link of vrDestaqueLinks) {
          const text = link.textContent?.trim() || '';
          const href = link.getAttribute('href') || (link as HTMLAnchorElement).href || '';
          
          // Extract edition number (e.g., "VR DESTAQUE 2273" or "VR DESTAQUE 2273-extra")
          const editionMatch = text.match(/VR\s*DESTAQUE\s*(\d+)/i);
          const editionNumber = editionMatch ? editionMatch[1] : undefined;
          
          // Check if it's an extra edition
          const isExtra = text.toLowerCase().includes('-extra') || 
                         text.toLowerCase().includes('extra') ||
                         text.toLowerCase().includes('-extraparte');
          
          // Find which date cell this link belongs to
          // The link might be in the same cell as the day, or in a row below/above
          let day = -1;
          let linkRow = link.closest('tr');
          let linkCell = link.closest('td, th');
          
          if (linkRow && linkCell) {
            // Find the column index of the link cell
            const linkRowCells = Array.from(linkRow.querySelectorAll('td, th'));
            const cellIndex = linkRowCells.indexOf(linkCell as HTMLTableCellElement);
            
            // First, check if the link cell itself contains a day number
            const linkCellText = linkCell.textContent?.trim() || '';
            const linkCellDayMatch = linkCellText.match(/^(\d{1,2})(?!\d)/);
            if (linkCellDayMatch) {
              day = parseInt(linkCellDayMatch[1], 10);
            }
            
            // If we couldn't find the day from the link cell, check the same column in the date row
            if (day === -1 && cellIndex >= 0 && cellIndex < dateCells.length) {
              const dateCell = dateCells[cellIndex];
              const dayText = dateCell.textContent?.trim() || '';
              const dayMatch = dayText.match(/^(\d{1,2})(?!\d)/);
              if (dayMatch) {
                day = parseInt(dayMatch[1], 10);
              }
            }
            
            // If we still couldn't find the day, check previous rows (links are usually below dates)
            if (day === -1 && cellIndex >= 0) {
              let currentRow = linkRow.previousElementSibling as HTMLTableRowElement | null;
              let rowCount = 0;
              while (currentRow && rowCount < 3 && day === -1) {
                const cells = Array.from(currentRow.querySelectorAll('td, th'));
                if (cellIndex < cells.length) {
                  const cellText = cells[cellIndex].textContent?.trim() || '';
                  const dayMatch = cellText.match(/^(\d{1,2})(?!\d)/);
                  if (dayMatch) {
                    day = parseInt(dayMatch[1], 10);
                    break;
                  }
                }
                currentRow = currentRow.previousElementSibling as HTMLTableRowElement | null;
                rowCount++;
              }
            }
            
            // If still not found, check next rows
            if (day === -1 && cellIndex >= 0) {
              let currentRow = linkRow.nextElementSibling as HTMLTableRowElement | null;
              let nextRowCount = 0;
              while (currentRow && nextRowCount < 3 && day === -1) {
                const cells = Array.from(currentRow.querySelectorAll('td, th'));
                if (cellIndex < cells.length) {
                  const cellText = cells[cellIndex].textContent?.trim() || '';
                  const dayMatch = cellText.match(/^(\d{1,2})(?!\d)/);
                  if (dayMatch) {
                    day = parseInt(dayMatch[1], 10);
                    break;
                  }
                }
                currentRow = currentRow.nextElementSibling as HTMLTableRowElement | null;
                nextRowCount++;
              }
            }
          }
          
          // If we still don't have a day, try to find it from surrounding context
          // Look for the closest date number near the link
          if (day === -1) {
            let parent: Element | null = link.parentElement;
            let depth = 0;
            while (parent && day === -1 && depth < 5) {
              const parentText = parent.textContent || '';
              // Look for day numbers (1-31) that are at the start of cells or standalone
              const dayMatches = parentText.match(/\b([1-9]|[12]\d|3[01])\b/g);
              if (dayMatches) {
                // Prefer numbers that appear before or near "VR DESTAQUE"
                const textBeforeLink = parentText.substring(0, parentText.indexOf(text));
                const dayMatchesBefore = textBeforeLink.match(/\b([1-9]|[12]\d|3[01])\b/g);
                if (dayMatchesBefore && dayMatchesBefore.length > 0) {
                  day = parseInt(dayMatchesBefore[dayMatchesBefore.length - 1], 10);
                } else if (dayMatches.length > 0) {
                  day = parseInt(dayMatches[0], 10);
                }
              }
              parent = parent.parentElement;
              depth++;
            }
          }
          
          if (day > 0 && href) {
            results.push({
              day,
              editionNumber,
              isExtra,
              href,
              rowIndex: linkRow ? rows.indexOf(linkRow) : -1,
              cellIndex: linkRow && linkCell ? 
                Array.from(linkRow.querySelectorAll('td, th')).indexOf(linkCell as HTMLTableCellElement) : -1,
            });
          }
        }
        
        return results;
      });
      
      logger.debug(`Found ${dateData.length} dates with VR DESTAQUE in ${month}/${year}`);
      
      if (dateData.length === 0) {
        return gazettes;
      }
      
      // Process each VR DESTAQUE link
      for (const dateInfo of dateData) {
        try {
          const day = dateInfo.day;
          const gazetteDate = new Date(year, month - 1, day);
          
          // Check if date is in our crawl range
          if (!this.isInDateRange(gazetteDate)) {
            logger.debug(`Gazette date ${toISODate(gazetteDate)} is outside crawl range`);
            continue;
          }
          
          logger.debug(`Processing: ${day}/${month}/${year} - ${dateInfo.href} (VR DESTAQUE ${dateInfo.editionNumber || 'N/A'})`);
          
          // Make URL absolute if relative
          let absoluteHref: string;
          if (dateInfo.href.startsWith('http')) {
            absoluteHref = dateInfo.href;
          } else {
            const baseUrlObj = new URL(this.config.url);
            const baseDomain = `${baseUrlObj.protocol}//${baseUrlObj.host}`;
            const normalizedPath = dateInfo.href.startsWith('/') ? dateInfo.href : `/${dateInfo.href}`;
            absoluteHref = `${baseDomain}${normalizedPath}`;
          }
          
          // Check if href is already a PDF
          let pdfUrl: string | null = null;
          if (absoluteHref.includes('.pdf') || absoluteHref.includes('.PDF')) {
            pdfUrl = absoluteHref;
          } else {
            // Navigate to the link to find the PDF
            logger.debug(`Navigating to: ${absoluteHref}`);
            try {
              await page.goto(absoluteHref, { waitUntil: 'networkidle0', timeout: 30000 });
              this.requestCount++;
              await new Promise(resolve => setTimeout(resolve, 2000));
              
              // Try to extract PDF URL from the page
              pdfUrl = await page.evaluate(() => {
                // Look for PDF link
                const pdfLinks = Array.from(document.querySelectorAll('a[href*=".pdf"], a[href*="PDF"], a[href*="pdf"]'));
                if (pdfLinks.length > 0) {
                  const href = (pdfLinks[0] as HTMLAnchorElement).href || pdfLinks[0].getAttribute('href') || '';
                  if (href) {
                    // Make absolute if relative
                    if (href.startsWith('http')) {
                      return href;
                    }
                    const baseUrl = window.location.origin;
                    const path = href.startsWith('/') ? href : `/${href}`;
                    return `${baseUrl}${path}`;
                  }
                }
                
                // Look for embed or iframe with PDF
                const embed = document.querySelector('embed[src*=".pdf"], iframe[src*=".pdf"], embed[src*="PDF"], iframe[src*="PDF"]') as HTMLEmbedElement | HTMLIFrameElement;
                if (embed) {
                  const src = embed.src || embed.getAttribute('src') || '';
                  if (src) {
                    if (src.startsWith('http')) {
                      return src;
                    }
                    const baseUrl = window.location.origin;
                    const path = src.startsWith('/') ? src : `/${src}`;
                    return `${baseUrl}${path}`;
                  }
                }
                
                // Look for direct PDF in the URL or redirect
                const currentUrl = window.location.href;
                if (currentUrl.includes('.pdf') || currentUrl.includes('.PDF')) {
                  return currentUrl;
                }
                
                // Check if page content contains PDF URL
                const bodyText = document.body.textContent || '';
                const pdfUrlMatch = bodyText.match(/https?:\/\/[^\s"']+\.pdf/i);
                if (pdfUrlMatch) {
                  return pdfUrlMatch[0];
                }
                
                return null;
              });
              
              // Navigate back to calendar
              await page.goto(this.config.url, { waitUntil: 'networkidle0', timeout: 30000 });
              this.requestCount++;
              await new Promise(resolve => setTimeout(resolve, 1000));
              
              // Navigate back to the correct month
              await this.navigateToMonth(page, year, month);
              
            } catch (error) {
              logger.warn(`Error navigating to ${absoluteHref}:`, error as Error);
              // Navigate back to calendar on error
              try {
                await page.goto(this.config.url, { waitUntil: 'networkidle0', timeout: 30000 });
                this.requestCount++;
                await new Promise(resolve => setTimeout(resolve, 1000));
                await this.navigateToMonth(page, year, month);
              } catch (e) {
                // Ignore navigation errors
              }
              continue;
            }
          }
          
          if (!pdfUrl) {
            logger.warn(`Could not extract PDF URL for day ${day}, href: ${absoluteHref}`);
            continue;
          }
          
          // Create the gazette object
          const gazette = await this.createGazette(gazetteDate, pdfUrl, {
            editionNumber: dateInfo.editionNumber,
            isExtraEdition: dateInfo.isExtra,
            power: 'executive_legislative',
            sourceText: `VR DESTAQUE ${dateInfo.editionNumber || ''} - ${day}/${month}/${year}`,
          });
          
          if (gazette) {
            gazettes.push(gazette);
            logger.debug(`Found gazette for ${toISODate(gazetteDate)}: ${pdfUrl}`);
          }
          
          // Add small delay between gazettes
          await new Promise(resolve => setTimeout(resolve, 300));
          
        } catch (error) {
          logger.error(`Error processing VR DESTAQUE link for day ${dateInfo.day}:`, error as Error);
        }
      }
      
    } catch (error) {
      logger.error(`Error crawling month ${month}/${year}:`, error as Error);
    }
    
    return gazettes;
  }
}
