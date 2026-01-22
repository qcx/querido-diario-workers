import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';
import * as cheerio from 'cheerio';

/**
 * Configuration interface for Phoca Download spider
 */
interface PhocaDownloadConfig {
  type: string;
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/**
 * Month name mappings for Portuguese date parsing
 */
const MONTH_NAMES: Record<string, number> = {
  'janeiro': 1, 'jan': 1,
  'fevereiro': 2, 'fev': 2,
  'março': 3, 'mar': 3, 'marco': 3,
  'abril': 4, 'abr': 4,
  'maio': 5, 'mai': 5,
  'junho': 6, 'jun': 6,
  'julho': 7, 'jul': 7,
  'agosto': 8, 'ago': 8,
  'setembro': 9, 'set': 9,
  'outubro': 10, 'out': 10,
  'novembro': 11, 'nov': 11,
  'dezembro': 12, 'dez': 12,
};

/**
 * Spider for Phoca Download component (Joomla)
 * 
 * This spider handles the hierarchical structure:
 * - Main page lists year categories
 * - Each year contains month subcategories
 * - Each month contains gazette PDF files
 * 
 * Download URLs follow pattern: /category/ID-slug?download=FILE_ID:file-slug
 */
export class PhocaDownloadSpider extends BaseSpider {
  protected config: PhocaDownloadConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PhocaDownloadConfig;
    
    if (!this.config.baseUrl) {
      throw new Error(`PhocaDownloadSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PhocaDownloadSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.config.baseUrl} for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    
    try {
      // First, get the main page to find year categories
      const mainPageHtml = await this.fetchPage(this.config.baseUrl);
      const yearCategories = this.extractYearCategories(mainPageHtml);
      
      logger.info(`Found ${yearCategories.length} year categories`);
      
      // Filter years based on date range
      const startYear = new Date(this.dateRange.start).getFullYear();
      const endYear = new Date(this.dateRange.end).getFullYear();
      
      const relevantYears = yearCategories.filter(cat => {
        const year = this.extractYearFromCategory(cat.name);
        return year >= startYear && year <= endYear;
      });
      
      logger.info(`Processing ${relevantYears.length} relevant year categories`);
      
      // For each year, get month subcategories
      for (const yearCat of relevantYears) {
        try {
          const yearPageHtml = await this.fetchPage(yearCat.url);
          const monthCategories = this.extractMonthCategories(yearPageHtml);
          
          logger.info(`Found ${monthCategories.length} month categories for ${yearCat.name}`);
          
          // For each month, get gazette files
          for (const monthCat of monthCategories) {
            try {
              const monthPageHtml = await this.fetchPage(monthCat.url);
              const gazetteItems = this.extractGazetteItems(monthPageHtml, monthCat.url);
              
              logger.debug(`Found ${gazetteItems.length} gazette items for ${monthCat.name}`);
              
              // Process each gazette item
              for (const item of gazetteItems) {
                try {
                  const gazetteDate = this.parseDateFromTitle(item.title, item.date);
                  
                  if (!gazetteDate || isNaN(gazetteDate.getTime())) {
                    logger.warn(`Invalid date for gazette: ${item.title}`);
                    continue;
                  }
                  
                  // Filter by date range
                  if (!this.isInDateRange(gazetteDate)) {
                    continue;
                  }
                  
                  // Extract edition number from title
                  const editionMatch = item.title.match(/(?:D\.?O\.?|DIARIO|DIÁRIO)[\s\-]*(\d+)/i);
                  const editionNumber = editionMatch ? editionMatch[1] : undefined;
                  
                  // Check for extra edition
                  const isExtra = /\b(extra|suplemento|extraordin[aá]ri[oa])\b/i.test(item.title);
                  
                  // Create gazette
                  const gazette = await this.createGazette(gazetteDate, item.downloadUrl, {
                    power: 'executive_legislative',
                    editionNumber,
                    isExtraEdition: isExtra,
                  });
                  
                  if (gazette) {
                    gazettes.push(gazette);
                    logger.info(`Found gazette for ${toISODate(gazetteDate)} (edição ${editionNumber || 'N/A'}): ${item.downloadUrl}`);
                  }
                } catch (error) {
                  logger.error(`Error processing gazette item:`, error as Error);
                }
              }
            } catch (error) {
              logger.error(`Error processing month category ${monthCat.name}:`, error as Error);
            }
          }
        } catch (error) {
          logger.error(`Error processing year category ${yearCat.name}:`, error as Error);
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }
    
    return gazettes;
  }

  /**
   * Fetch a page and return HTML
   */
  private async fetchPage(url: string): Promise<string> {
    this.requestCount++;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return response.text();
  }

  /**
   * Extract year category links from main page
   */
  private extractYearCategories(html: string): Array<{ name: string; url: string }> {
    const $ = cheerio.load(html);
    const categories: Array<{ name: string; url: string }> = [];
    
    // Look for Phoca Download subcategory links
    // Pattern: .pd-subcategory a or links containing "diario-oficial-" and year
    $('.pd-subcategory a, a[href*="diario-oficial"]').each((_, element) => {
      const $el = $(element);
      const href = $el.attr('href');
      const name = $el.text().trim();
      
      if (href && name) {
        // Check if it's a year category (contains year number)
        const yearMatch = name.match(/20\d{2}/);
        if (yearMatch) {
          const url = this.makeAbsoluteUrl(href);
          categories.push({ name, url });
        }
      }
    });
    
    return categories;
  }

  /**
   * Extract month category links from year page
   */
  private extractMonthCategories(html: string): Array<{ name: string; url: string }> {
    const $ = cheerio.load(html);
    const categories: Array<{ name: string; url: string }> = [];
    
    // Look for month subcategories
    $('.pd-subcategory a').each((_, element) => {
      const $el = $(element);
      const href = $el.attr('href');
      const name = $el.text().trim();
      
      if (href && name) {
        // Check if it's a month category
        const isMonthCategory = /\d{1,2}\s*[-–]\s*\w+|janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro/i.test(name);
        if (isMonthCategory) {
          const url = this.makeAbsoluteUrl(href);
          categories.push({ name, url });
        }
      }
    });
    
    return categories;
  }

  /**
   * Extract gazette items from month page
   */
  private extractGazetteItems(html: string, pageUrl: string): Array<{ title: string; date: string; downloadUrl: string }> {
    const $ = cheerio.load(html);
    const items: Array<{ title: string; date: string; downloadUrl: string }> = [];
    
    // Look for Phoca Download file boxes
    $('.pd-filebox').each((_, element) => {
      const $el = $(element);
      
      // Get title from .pd-title
      const title = $el.find('.pd-title').first().text().trim();
      
      // Get download link
      const $downloadLink = $el.find('.pd-filename a').first();
      const href = $downloadLink.attr('href');
      
      // Extract date from overlib tooltip or title
      let date = '';
      
      // Try to get date from overlib mouseover
      const onMouseOver = $el.find('a[onmouseover]').attr('onmouseover') || '';
      const overlibDateMatch = onMouseOver.match(/Data:.*?(\d{1,2})\s+(\w+)\s+(\d{4})/i);
      if (overlibDateMatch) {
        date = `${overlibDateMatch[1]} ${overlibDateMatch[2]} ${overlibDateMatch[3]}`;
      }
      
      if (href && title) {
        const downloadUrl = this.makeAbsoluteUrl(href);
        items.push({ title, date, downloadUrl });
      }
    });
    
    // Also try alternative patterns - direct links to files
    $('a[href*="download="]').each((_, element) => {
      const $el = $(element);
      const href = $el.attr('href');
      
      if (!href) return;
      
      // Skip if already processed
      if (items.some(item => item.downloadUrl.includes(href))) return;
      
      // Get text as title
      const text = $el.text().trim();
      if (!text || text.length < 5) return;
      
      // Look for parent context for title/date
      let title = text;
      let date = '';
      
      const $parent = $el.closest('.pd-filebox, .pd-filenamebox, li, tr');
      if ($parent.length) {
        const parentTitle = $parent.find('.pd-title').first().text().trim();
        if (parentTitle) {
          title = parentTitle;
        }
        
        // Try to extract date from parent context
        const parentText = $parent.text();
        const dateMatch = parentText.match(/(\d{1,2})\s+(?:de\s+)?(\w+)\s+(?:de\s+)?(\d{4})/i);
        if (dateMatch) {
          date = `${dateMatch[1]} ${dateMatch[2]} ${dateMatch[3]}`;
        }
      }
      
      const downloadUrl = this.makeAbsoluteUrl(href);
      items.push({ title, date, downloadUrl });
    });
    
    return items;
  }

  /**
   * Parse date from gazette title or extracted date string
   */
  private parseDateFromTitle(title: string, dateStr?: string): Date | null {
    // First try the extracted date string
    if (dateStr) {
      const parsed = this.parsePortugueseDate(dateStr);
      if (parsed) return parsed;
    }
    
    // Try various patterns in the title
    
    // Pattern: "DD DE MÊS DE YYYY" (e.g., "31 DE JANEIRO DE 2025")
    const longDateMatch = title.match(/(\d{1,2})\s+(?:DE\s+)?([A-Za-zÇç]+)\s+(?:DE\s+)?(\d{4})/i);
    if (longDateMatch) {
      const [, day, monthName, year] = longDateMatch;
      const month = MONTH_NAMES[monthName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')];
      if (month) {
        return new Date(`${year}-${month.toString().padStart(2, '0')}-${day.padStart(2, '0')}`);
      }
    }
    
    // Pattern: "DD/MM/YYYY"
    const slashDateMatch = title.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (slashDateMatch) {
      const [, day, month, year] = slashDateMatch;
      return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    }
    
    // Pattern: "DD-MM-YYYY" or "DD_MM_YYYY"
    const dashDateMatch = title.match(/(\d{1,2})[-_](\d{1,2})[-_](\d{4})/);
    if (dashDateMatch) {
      const [, day, month, year] = dashDateMatch;
      return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    }
    
    return null;
  }

  /**
   * Parse Portuguese date string like "31 Janeiro 2025"
   */
  private parsePortugueseDate(dateStr: string): Date | null {
    const match = dateStr.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/i);
    if (!match) return null;
    
    const [, day, monthName, year] = match;
    const normalizedMonth = monthName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const month = MONTH_NAMES[normalizedMonth];
    
    if (!month) return null;
    
    return new Date(`${year}-${month.toString().padStart(2, '0')}-${day.padStart(2, '0')}`);
  }

  /**
   * Extract year from category name
   */
  private extractYearFromCategory(name: string): number {
    const match = name.match(/20\d{2}/);
    return match ? parseInt(match[0], 10) : 0;
  }

  /**
   * Make URL absolute
   */
  private makeAbsoluteUrl(href: string): string {
    if (!href) return '';
    if (href.startsWith('http')) return href;
    
    const baseUrl = new URL(this.config.baseUrl);
    if (href.startsWith('//')) return baseUrl.protocol + href;
    if (href.startsWith('/')) return baseUrl.origin + href;
    
    return new URL(href, this.config.baseUrl).href;
  }
}
