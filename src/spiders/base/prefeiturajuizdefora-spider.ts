import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraJuizDeForaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for Prefeitura de Juiz de Fora - MG
 * 
 * The official gazette of Juiz de Fora is published at:
 * https://www.pjf.mg.gov.br/e_atos/e_atos.php
 * 
 * Site Structure:
 * - Main page shows current day's acts with attached PDFs
 * - Historical search available at anos_anteriores.php with date filters
 * - Individual acts have optional PDF attachments in ./anexos/
 * - Each day's publication is considered a gazette edition
 * 
 * The spider fetches the HTML page and extracts PDF links from the
 * 'download_anexo' sections.
 */
export class PrefeituraJuizDeForaSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraJuizDeForaConfig;
    this.baseUrl = platformConfig.baseUrl || 'https://www.pjf.mg.gov.br/e_atos/e_atos.php';
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura Juiz de Fora for ${this.config.name}...`);

    try {
      // Generate dates to crawl within the date range
      const startDate = new Date(this.dateRange.start);
      const endDate = new Date(this.dateRange.end);
      
      // Iterate through each day in the range
      for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
        const currentDate = new Date(date);
        const dayGazettes = await this.crawlDate(currentDate);
        gazettes.push(...dayGazettes);
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from Juiz de Fora`);
      
    } catch (error) {
      logger.error(`Error crawling Juiz de Fora:`, error as Error);
      throw error;
    }

    return gazettes;
  }

  /**
   * Crawl a specific date and extract PDF attachments
   */
  private async crawlDate(date: Date): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    // Format date as DD/MM/YYYY for the search
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const dateStr = `${day}/${month}/${year}`;
    
    logger.debug(`Crawling Juiz de Fora for date: ${dateStr}`);
    
    try {
      // The site uses a form to filter by date
      // We'll use the anos_anteriores.php endpoint with date parameters
      const searchUrl = `https://www.pjf.mg.gov.br/e_atos/anos_anteriores.php?dia=${day}&mes=${month}&ano=${year}`;
      
      const response = await fetch(searchUrl, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
          'User-Agent': 'Mozilla/5.0 (compatible; GoodFellowBot/1.0)',
        },
        signal: AbortSignal.timeout(30000),
      });
      this.requestCount++;
      
      if (!response.ok) {
        logger.warn(`Failed to fetch date ${dateStr}: ${response.status}`);
        return gazettes;
      }
      
      const html = await response.text();
      
      // Extract PDF links from the page
      // Pattern: href='./anexos/{filename}.pdf'
      const pdfPattern = /href=['"]\.\/anexos\/([^'"]+\.pdf)['"][^>]*>/gi;
      const pdfMatches = [...html.matchAll(pdfPattern)];
      
      // Also look for absolute PDF links
      const absolutePdfPattern = /href=['"]([^'"]*\/e_atos\/anexos\/[^'"]+\.pdf)['"][^>]*>/gi;
      const absoluteMatches = [...html.matchAll(absolutePdfPattern)];
      
      // Collect unique PDF URLs
      const pdfUrls = new Set<string>();
      
      for (const match of pdfMatches) {
        const pdfUrl = `https://www.pjf.mg.gov.br/e_atos/anexos/${match[1]}`;
        pdfUrls.add(pdfUrl);
      }
      
      for (const match of absoluteMatches) {
        let pdfUrl = match[1];
        if (!pdfUrl.startsWith('http')) {
          pdfUrl = `https://www.pjf.mg.gov.br${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
        }
        pdfUrls.add(pdfUrl);
      }
      
      logger.debug(`Found ${pdfUrls.size} PDFs for date ${dateStr}`);
      
      // If we found PDFs, create gazettes for them
      // If we have multiple PDFs for the same date, consider them as parts of the same edition
      let editionCounter = 1;
      for (const pdfUrl of pdfUrls) {
        const gazette = await this.createGazette(date, pdfUrl, {
          editionNumber: pdfUrls.size > 1 ? `${year}${month}${day}-${editionCounter}` : `${year}${month}${day}`,
          isExtraEdition: false,
          power: 'executive_legislative',
          sourceText: `Atos do Governo - ${dateStr}`,
        });
        
        if (gazette) {
          gazettes.push(gazette);
          editionCounter++;
        }
      }
      
      // If no PDFs found but the page has content (atos), we could also try
      // the main page for the current date
      if (pdfUrls.size === 0) {
        // Try the e_atos_vis.php page for individual acts
        const mainPageGazettes = await this.tryMainPageForDate(date, html);
        gazettes.push(...mainPageGazettes);
      }
      
    } catch (error) {
      logger.error(`Error crawling date ${dateStr}:`, error as Error);
    }
    
    return gazettes;
  }

  /**
   * Try to extract PDFs from the main e_atos page for a specific date
   */
  private async tryMainPageForDate(date: Date, existingHtml: string): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const dateStr = `${day}/${month}/${year}`;
    
    // Check if we already have the right page or need to fetch the main page
    // Look for date in the existing HTML - Publicado em: <strong>DD/MM/YYYY</strong>
    const datePattern = new RegExp(`Publicado em:[\\s\\S]*?<strong>${dateStr}</strong>`, 'i');
    
    let html = existingHtml;
    
    // If the existing HTML doesn't have this date, try fetching the main page with date filter
    if (!datePattern.test(html)) {
      try {
        // Try the main page with form submission (simulated via URL params)
        const mainUrl = `https://www.pjf.mg.gov.br/e_atos/e_atos.php`;
        const formData = new URLSearchParams({
          'data_ato': `${day}/${month}/${year}`,
        });
        
        const response = await fetch(mainUrl, {
          method: 'POST',
          headers: {
            'Accept': 'text/html,application/xhtml+xml',
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (compatible; GoodFellowBot/1.0)',
          },
          body: formData.toString(),
          signal: AbortSignal.timeout(30000),
        });
        this.requestCount++;
        
        if (response.ok) {
          html = await response.text();
        }
      } catch (error) {
        logger.debug(`Could not fetch main page for date ${dateStr}`);
        return gazettes;
      }
    }
    
    // Look for PDFs in the download_anexo sections for this date
    // Pattern: <div class='download_anexo'>...<a href='./anexos/filename.pdf'
    const anexoBlockPattern = /<div class=['"]download_anexo['"]>[\s\S]*?<a href=['"]\.\/anexos\/([^'"]+\.pdf)['"][^>]*>/gi;
    const matches = [...html.matchAll(anexoBlockPattern)];
    
    for (const match of matches) {
      const pdfUrl = `https://www.pjf.mg.gov.br/e_atos/anexos/${match[1]}`;
      
      const gazette = await this.createGazette(date, pdfUrl, {
        editionNumber: `${year}${month}${day}-${matches.indexOf(match) + 1}`,
        isExtraEdition: false,
        power: 'executive_legislative',
        sourceText: `Atos do Governo - ${dateStr} - ${match[1]}`,
      });
      
      if (gazette) {
        gazettes.push(gazette);
      }
    }
    
    return gazettes;
  }
}

