import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * Configuration interface for Barra do Piraí spider
 */
interface PrefeituraRjBarraDoPiraiConfig {
  type: 'prefeiturarjbarradopirai';
  baseUrl: string;
  requiresClientRendering?: boolean;
}

/**
 * Spider for Barra do Piraí - RJ
 * 
 * Website: https://transparencia.portalbarradopirai.com.br/index.php/pt/links/15-boletim
 * 
 * Structure:
 * - Main page lists all years with gazette tables
 * - Each year section contains a table with PDF links
 * - PDF naming pattern: "DOE XXX - Data DD-MM.pdf"
 * - PDF URLs: https://transparencia.portalbarradopirai.com.br/images/boletim/{year}/DOE XXX - Data DD-MM.pdf
 */
export class PrefeituraRjBarraDoPiraiSpider extends BaseSpider {
  protected config: PrefeituraRjBarraDoPiraiConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.config = spiderConfig.config as PrefeituraRjBarraDoPiraiConfig;
    
    if (!this.config.baseUrl) {
      throw new Error(`PrefeituraRjBarraDoPiraiSpider requires baseUrl in config`);
    }
    
    logger.info(`Initializing PrefeituraRjBarraDoPiraiSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.config.baseUrl} for ${this.spiderConfig.name}...`);
    
    const gazettes: Gazette[] = [];
    
    try {
      // Fetch the main page
      const response = await fetch(this.config.baseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        },
      });
      this.requestCount++;
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const html = await response.text();
      
      // Extract gazettes from HTML
      const extractedGazettes = this.extractGazettesFromHtml(html);
      
      for (const extracted of extractedGazettes) {
        try {
          const gazetteDate = extracted.date;
          
          // Filter by date range
          if (!this.isInDateRange(gazetteDate)) {
            continue;
          }
          
          const gazette = await this.createGazette(gazetteDate, extracted.pdfUrl, {
            power: 'executive_legislative',
            editionNumber: extracted.editionNumber,
            isExtraEdition: extracted.isExtra,
          });
          
          if (gazette) {
            gazettes.push(gazette);
            logger.info(`Found gazette for ${toISODate(gazetteDate)} (edição ${extracted.editionNumber || 'N/A'}): ${extracted.pdfUrl}`);
          }
        } catch (error) {
          logger.error(`Error processing gazette:`, error as Error);
        }
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }
    
    return gazettes;
  }

  /**
   * Extract gazette information from HTML
   */
  private extractGazettesFromHtml(html: string): Array<{
    date: Date;
    editionNumber?: string;
    pdfUrl: string;
    isExtra: boolean;
  }> {
    const results: Array<{
      date: Date;
      editionNumber?: string;
      pdfUrl: string;
      isExtra: boolean;
    }> = [];
    
    const processedUrls = new Set<string>();
    
    // Find all year sections by looking for headings like "Diário Oficial Eletrônico 2026"
    const yearSectionRegex = /Diário Oficial Eletrônico (\d{4})/gi;
    let yearMatch;
    const years: number[] = [];
    
    while ((yearMatch = yearSectionRegex.exec(html)) !== null) {
      const year = parseInt(yearMatch[1], 10);
      if (!years.includes(year)) {
        years.push(year);
      }
    }
    
    // Pattern to match PDF links
    // Example: href="https://transparencia.portalbarradopirai.com.br/images/boletim/2026/DOE 013 - Data 20-01.pdf"
    // Or: href="/images/boletim/2026/DOE 013 - Data 20-01.pdf"
    const pdfLinkRegex = /href=["']([^"']*?\/images\/boletim\/(\d{4})\/([^"']+\.pdf))["']/gi;
    
    let pdfMatch;
    while ((pdfMatch = pdfLinkRegex.exec(html)) !== null) {
      const fullUrl = pdfMatch[1];
      const year = parseInt(pdfMatch[2], 10);
      const filename = decodeURIComponent(pdfMatch[3]);
      
      // Make URL absolute and normalize (encode spaces and special chars)
      let pdfUrl = fullUrl;
      if (fullUrl.startsWith('/')) {
        pdfUrl = `https://transparencia.portalbarradopirai.com.br${fullUrl}`;
      } else if (!fullUrl.startsWith('http')) {
        pdfUrl = `https://transparencia.portalbarradopirai.com.br/${fullUrl}`;
      }
      
      // Normalize URL - encode spaces and special characters in the path
      pdfUrl = this.normalizeUrl(pdfUrl);
      
      if (processedUrls.has(pdfUrl)) {
        continue;
      }
      processedUrls.add(pdfUrl);
      
      // Parse filename to extract date and edition
      // Pattern: "DOE XXX - Data DD-MM.pdf" or "DOE XXX - Data DD-MM - Extra.pdf"
      const filenameMatch = filename.match(/DOE\s*(\d+)\s*-\s*Data\s*(\d{2})-(\d{2})(?:\s*-\s*(Extra))?\.pdf/i);
      
      if (filenameMatch) {
        const editionNumber = filenameMatch[1];
        const day = parseInt(filenameMatch[2], 10);
        const month = parseInt(filenameMatch[3], 10);
        const isExtra = !!filenameMatch[4];
        
        // Create date using the year from the URL path
        const gazetteDate = new Date(year, month - 1, day);
        
        if (!isNaN(gazetteDate.getTime())) {
          results.push({
            date: gazetteDate,
            editionNumber,
            pdfUrl,
            isExtra,
          });
        }
      } else {
        // Try alternative patterns
        // Pattern: just numbers in filename like "DOE_2026_01_20.pdf"
        const altMatch = filename.match(/(\d{4})[\-_](\d{2})[\-_](\d{2})/);
        if (altMatch) {
          const altYear = parseInt(altMatch[1], 10);
          const altMonth = parseInt(altMatch[2], 10);
          const altDay = parseInt(altMatch[3], 10);
          
          const gazetteDate = new Date(altYear, altMonth - 1, altDay);
          
          if (!isNaN(gazetteDate.getTime())) {
            results.push({
              date: gazetteDate,
              pdfUrl,
              isExtra: /extra/i.test(filename),
            });
          }
        }
      }
    }
    
    // Also look for links with text content containing the PDF name
    // Pattern: <a href="...">DOE 013 - Data 20-01.pdf</a>
    const linkTextRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*DOE\s*\d+\s*-\s*Data\s*\d{2}-\d{2}[^<]*)<\/a>/gi;
    
    let linkMatch;
    while ((linkMatch = linkTextRegex.exec(html)) !== null) {
      const href = linkMatch[1];
      const linkText = linkMatch[2].trim();
      
      // Make URL absolute and normalize
      let pdfUrl = href;
      if (href.startsWith('/')) {
        pdfUrl = `https://transparencia.portalbarradopirai.com.br${href}`;
      } else if (!href.startsWith('http')) {
        pdfUrl = `https://transparencia.portalbarradopirai.com.br/${href}`;
      }
      
      // Normalize URL - encode spaces and special characters in the path
      pdfUrl = this.normalizeUrl(pdfUrl);
      
      if (processedUrls.has(pdfUrl)) {
        continue;
      }
      
      // Extract year from URL
      const yearFromUrl = href.match(/\/(\d{4})\//);
      if (!yearFromUrl) continue;
      
      const year = parseInt(yearFromUrl[1], 10);
      
      // Parse the link text
      const textMatch = linkText.match(/DOE\s*(\d+)\s*-\s*Data\s*(\d{2})-(\d{2})(?:\s*-\s*(Extra))?/i);
      
      if (textMatch) {
        const editionNumber = textMatch[1];
        const day = parseInt(textMatch[2], 10);
        const month = parseInt(textMatch[3], 10);
        const isExtra = !!textMatch[4];
        
        const gazetteDate = new Date(year, month - 1, day);
        
        if (!isNaN(gazetteDate.getTime())) {
          processedUrls.add(pdfUrl);
          results.push({
            date: gazetteDate,
            editionNumber,
            pdfUrl,
            isExtra,
          });
        }
      }
    }
    
    logger.debug(`Extracted ${results.length} gazettes from HTML`);
    return results;
  }

  /**
   * Normalize URL by encoding spaces and special characters in the path
   */
  private normalizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      // Encode each path segment properly
      const pathSegments = urlObj.pathname.split('/');
      const encodedSegments = pathSegments.map(segment => 
        encodeURIComponent(decodeURIComponent(segment))
      );
      urlObj.pathname = encodedSegments.join('/');
      return urlObj.toString();
    } catch {
      // If URL parsing fails, just encode spaces
      return url.replace(/ /g, '%20');
    }
  }
}
