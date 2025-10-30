import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, RondoniaConfig } from '../../types';
import { logger } from '../../../../utils/logger'

/**
 * RondoniaSpider implementation for Cloudflare Workers
 * 
 * Handles the state official gazette of Rondônia (https://diof.ro.gov.br/)
 * 
 * This spider collects gazettes from the centralized state system where
 * all municipal publications are included in the state gazette.
 * 
 * The site structure:
 * 1. Main page shows recent gazettes in a table
 * 2. Date search: /diarios/?cf_time=DD-MM-YYYY returns filtered HTML
 * 3. PDF URLs follow pattern: /data/uploads/YYYY/MM/DOE-DD-MM-YYYY.pdf
 * 4. Two types: Regular and Supplementary (DOE-SUPLEMENTAR-DD-MM-YYYY.pdf)
 * 
 * Each spider instance is configured for a specific city and filters
 * the gazette content to find publications for that city only.
 */
export class RondoniaSpider extends BaseSpider {
  private readonly BASE_URL = 'https://diof.ro.gov.br';
  private readonly SEARCH_ENDPOINT = '/diarios/';
  private rondoniaConfig: RondoniaConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.rondoniaConfig = spiderConfig.config as RondoniaConfig;
    
    if (!this.rondoniaConfig.cityName) {
      throw new Error(`RondoniaSpider requires a cityName in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing RondoniaSpider for ${spiderConfig.name} - City: ${this.rondoniaConfig.cityName}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling Rondônia gazette for ${this.rondoniaConfig.cityName} - date range: ${this.dateRange.start} to ${this.dateRange.end}`);
    const gazettes: Gazette[] = [];

    try {
      // Generate date intervals (daily)
      const dates = this.generateDateRange();
      logger.info(`Generated ${dates.length} dates to check for ${this.rondoniaConfig.cityName}`);
      
      // Check each date for gazettes
      for (const date of dates) {
        const dateGazettes = await this.fetchGazettesForDate(date);
        gazettes.push(...dateGazettes);
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.rondoniaConfig.cityName}`);
      
    } catch (error) {
      logger.error(`Error crawling Rondônia gazette for ${this.rondoniaConfig.cityName}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Generate array of dates to check (daily intervals)
   */
  private generateDateRange(): Date[] {
    const dates: Date[] = [];
    
    // Parse ISO dates correctly avoiding timezone issues
    const [startYear, startMonth, startDay] = this.dateRange.start.split('-').map(Number);
    const [endYear, endMonth, endDay] = this.dateRange.end.split('-').map(Number);
    
    const startDate = new Date(startYear, startMonth - 1, startDay); // month is 0-indexed
    const endDate = new Date(endYear, endMonth - 1, endDay);
    
    let currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
      dates.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return dates;
  }

  /**
   * Fetch gazettes for a specific date
   */
  private async fetchGazettesForDate(date: Date): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      const dateStr = this.formatDateForSearch(date);
      const searchUrl = `${this.BASE_URL}${this.SEARCH_ENDPOINT}?cf_time=${dateStr}`;
      
      logger.info(`Checking date ${dateStr}: ${searchUrl}`);
      
      const html = await this.fetch(searchUrl);
      
      // Parse HTML to extract gazette information
      const extractedGazettes = await this.parseGazettesFromHtml(html, date);
      gazettes.push(...extractedGazettes);
      
    } catch (error) {
      logger.error(`Error fetching gazettes for date ${date.toISOString().split('T')[0]}:`, error as Error);
    }
    
    return gazettes;
  }

  /**
   * Parse gazettes from HTML response and filter by city name
   */
  private async parseGazettesFromHtml(html: string, date: Date): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    try {
      // Look for PDF download links in the HTML
      // Pattern: https://diof.ro.gov.br/data/uploads/2025/09/DOE-25-09-2025.pdf
      // or: https://diof.ro.gov.br/data/uploads/2025/09/DOE-SUPLEMENTAR-25-09-2025.pdf
      
      const pdfLinkRegex = /href="([^"]*data\/uploads\/\d{4}\/\d{2}\/DOE[^"]*\.pdf)"/g;
      let match;
      
      while ((match = pdfLinkRegex.exec(html)) !== null) {
        const pdfUrl = match[1];
        
        // Ensure it's a full URL
        const fullUrl = pdfUrl.startsWith('http') ? pdfUrl : `${this.BASE_URL}${pdfUrl}`;
        
        // Check if this gazette contains content for our target city
        // Note: For now we're accepting all gazettes since the filtering by city content
        // would require downloading and parsing each PDF, which is expensive.
        // In a real implementation, you might want to:
        // 1. Download the PDF
        // 2. Extract text content 
        // 3. Search for the city name in the content
        // 4. Only include gazettes that mention the target city
        
        // For this implementation, we'll include all gazettes and let the OCR/analysis
        // stage handle the city-specific filtering
        if (await this.gazetteContainsCity(fullUrl)) {
          // Determine if it's a supplementary edition
          const isSupplementary = pdfUrl.includes('SUPLEMENTAR') || pdfUrl.includes('Suplemento');
          
          const gazette = await this.createGazette(date, fullUrl, {
            isExtraEdition: isSupplementary,
            power: this.rondoniaConfig.power,
          });
          
          if (gazette) {
            gazettes.push(gazette);
          }
          
          logger.info(`Found gazette for ${this.rondoniaConfig.cityName}: ${fullUrl} (${isSupplementary ? 'Supplementary' : 'Regular'})`);
        }
      }
      
    } catch (error) {
      logger.error(`Error parsing gazettes from HTML:`, error as Error);
    }
    
    return gazettes;
  }

  /**
   * Check if a gazette contains content for the target city
   * For now, returns true for all gazettes (optimistic approach)
   * In a production environment, you might want to implement proper PDF content filtering
   */
  private async gazetteContainsCity(pdfUrl: string): Promise<boolean> {
    // Optimistic approach - assume all state gazettes might contain city content
    // This ensures we don't miss any publications, and the OCR/analysis stage
    // will handle the actual filtering by city content
    return true;
    
    // TODO: Implement proper PDF content filtering if needed
    // This would involve:
    // 1. Downloading the PDF
    // 2. Extracting text content (using OCR or PDF text extraction)
    // 3. Searching for the city name in the content
    // 4. Returning true only if the city is mentioned
    
    // Example implementation:
    // try {
    //   const response = await fetch(pdfUrl, { method: 'HEAD' });
    //   if (!response.ok) return false;
    //   
    //   // For now, just check if the PDF exists
    //   // Real implementation would need PDF content analysis
    //   return true;
    // } catch (error) {
    //   return false;
    // }
  }

  /**
   * Format date for search (DD-MM-YYYY)
   */
  private formatDateForSearch(date: Date): string {
    // Use simple date formatting to avoid timezone issues
    // Input is expected to be ISO date string (YYYY-MM-DD)
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  }

  /**
   * Alternative method: Generate PDF URLs directly based on date pattern
   * This can be used as a fallback or primary method if the search endpoint is unreliable
   */
  private async _tryDirectPdfUrls(date: Date): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateStr = `${day}-${month}-${year}`;
    
    // Try regular edition
    const regularUrl = `${this.BASE_URL}/data/uploads/${year}/${month}/DOE-${dateStr}.pdf`;
    if (await this.testPdfUrl(regularUrl)) {
      const gazette = await this.createGazette(date, regularUrl, {
        isExtraEdition: false,
        power: this.rondoniaConfig.power,
      });
      if (gazette) {
        gazettes.push(gazette);
      }
    }
    
    // Try supplementary edition
    const supplementaryUrl = `${this.BASE_URL}/data/uploads/${year}/${month}/DOE-SUPLEMENTAR-${dateStr}.pdf`;
    if (await this.testPdfUrl(supplementaryUrl)) {
      const gazette = await this.createGazette(date, supplementaryUrl, {
        isExtraEdition: true,
        power: this.rondoniaConfig.power,
      });
      if (gazette) {
        gazettes.push(gazette);
      }
    }
    
    return gazettes;
  }

  /**
   * Test if a PDF URL exists
   */
  private async testPdfUrl(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      return response.ok;
    } catch (error) {
      return false;
    }
  }
}
