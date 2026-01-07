import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituraPeruibeConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for Prefeitura de Peruíbe official gazette (DOM-E)
 * 
 * Site uses WordPress with "The Post Grid Pro" plugin
 * - List page: https://www.peruibe.sp.gov.br/diario-oficial-do-municipio-dom-e/
 * - Posts are at: https://www.peruibe.sp.gov.br/YYYY/MM/diario-oficial-do-municipio-dom-e-edicao-XXX/
 * - PDFs at: https://www.peruibe.sp.gov.br/portal/wp-content/uploads/YYYY/MM/DOM-E_-_XXX_assinado.pdf
 * 
 * Structure:
 * - Each gazette is listed with title "Diário Oficial do Município – DOM-E – Edição XXX"
 * - The date is extracted from the post metadata (e.g., "jan 6, 2026")
 * - PDFs are linked within the post content
 */
export class PrefeituraPeruibeSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituraPeruibeConfig;
    this.baseUrl = platformConfig.baseUrl || 'https://www.peruibe.sp.gov.br';
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Prefeitura Peruíbe for ${this.config.name}...`);

    try {
      // Fetch the gazette list page
      const listUrl = `${this.baseUrl}/diario-oficial-do-municipio-dom-e/`;
      logger.debug(`Fetching list page: ${listUrl}`);
      
      const response = await fetch(listUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch list page: ${response.status}`);
      }

      const html = await response.text();
      
      // Extract all gazette post links from the page
      // Pattern: href="https://www.peruibe.sp.gov.br/YYYY/MM/diario-oficial-do-municipio-dom-e-edicao-XXX/"
      const linkPattern = /href="(https?:\/\/www\.peruibe\.sp\.gov\.br\/(\d{4})\/(\d{2})\/diario-oficial-do-municipio-dom-e-edicao-(\d+)(?:-extra)?\/?)"/gi;
      const matches = [...html.matchAll(linkPattern)];
      
      logger.debug(`Found ${matches.length} gazette links`);
      
      // Process unique links (there are duplicates in the HTML)
      const seenUrls = new Set<string>();
      
      for (const match of matches) {
        const postUrl = match[1];
        const year = match[2];
        const month = match[3];
        const editionNumber = match[4];
        const isExtra = postUrl.toLowerCase().includes('-extra');
        
        // Skip duplicates
        if (seenUrls.has(postUrl)) {
          continue;
        }
        seenUrls.add(postUrl);
        
        logger.debug(`Processing gazette Ed. ${editionNumber} - ${year}/${month}${isExtra ? ' (EXTRA)' : ''}`);
        
        try {
          // Fetch the post page to get the exact date and PDF URL
          const postResponse = await fetch(postUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
              'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
            }
          });
          
          if (!postResponse.ok) {
            logger.warn(`Failed to fetch post page: ${postUrl}`);
            continue;
          }
          
          const postHtml = await postResponse.text();
          
          // Extract the PDF URL
          // Pattern: href="https://www.peruibe.sp.gov.br/portal/wp-content/uploads/YYYY/MM/DOM-E_-_XXX_assinado.pdf"
          const pdfPattern = /href="(https?:\/\/www\.peruibe\.sp\.gov\.br\/portal\/wp-content\/uploads\/\d{4}\/\d{2}\/[^"]+\.pdf)"/gi;
          const pdfMatches = [...postHtml.matchAll(pdfPattern)];
          
          if (pdfMatches.length === 0) {
            // Try alternative pattern - just looking for PDF links
            const altPdfPattern = /href="([^"]+DOM-E[^"]*\.pdf)"/gi;
            const altMatches = [...postHtml.matchAll(altPdfPattern)];
            
            if (altMatches.length === 0) {
              logger.warn(`Could not find PDF link on page: ${postUrl}`);
              continue;
            }
            
            // Use the first alternative match
            const fileUrl = altMatches[0][1];
            const gazette = await this.processGazette(fileUrl, editionNumber, year, month, postHtml, isExtra);
            if (gazette) {
              gazettes.push(gazette);
            }
            continue;
          }
          
          // Use the first PDF URL found
          const fileUrl = pdfMatches[0][1];
          const gazette = await this.processGazette(fileUrl, editionNumber, year, month, postHtml, isExtra);
          if (gazette) {
            gazettes.push(gazette);
          }
          
        } catch (error) {
          logger.warn(`Failed to process gazette ${editionNumber}: ${error}`);
        }
        
        // Add delay between requests to avoid overloading the server
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from Prefeitura Peruíbe`);
    } catch (error) {
      logger.error(`Error crawling Prefeitura Peruíbe: ${error}`);
      throw error;
    }

    return gazettes;
  }

  private async processGazette(
    fileUrl: string,
    editionNumber: string,
    year: string,
    month: string,
    postHtml: string,
    isExtra: boolean
  ): Promise<Gazette | null> {
    // Extract the exact date from the post metadata
    // Look for patterns like "jan 6, 2026" or "6 de janeiro de 2026"
    let gazetteDate: Date | null = null;
    
    // Try pattern: "Month DD, YYYY" (English format from WordPress)
    const englishDatePattern = /(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez|janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+(\d{1,2}),?\s+(\d{4})/i;
    const englishMatch = postHtml.match(englishDatePattern);
    
    if (englishMatch) {
      const monthName = englishMatch[1].toLowerCase();
      const day = parseInt(englishMatch[2]);
      const yearNum = parseInt(englishMatch[3]);
      
      const monthMap: Record<string, number> = {
        'jan': 0, 'janeiro': 0,
        'fev': 1, 'fevereiro': 1,
        'mar': 2, 'março': 2,
        'abr': 3, 'abril': 3,
        'mai': 4, 'maio': 4,
        'jun': 5, 'junho': 5,
        'jul': 6, 'julho': 6,
        'ago': 7, 'agosto': 7,
        'set': 8, 'setembro': 8,
        'out': 9, 'outubro': 9,
        'nov': 10, 'novembro': 10,
        'dez': 11, 'dezembro': 11,
      };
      
      const monthNum = monthMap[monthName];
      if (monthNum !== undefined) {
        gazetteDate = new Date(yearNum, monthNum, day);
      }
    }
    
    // Try pattern: DD/MM/YYYY
    if (!gazetteDate) {
      const brDatePattern = /(\d{2})\/(\d{2})\/(\d{4})/;
      const brMatch = postHtml.match(brDatePattern);
      if (brMatch) {
        gazetteDate = new Date(parseInt(brMatch[3]), parseInt(brMatch[2]) - 1, parseInt(brMatch[1]));
      }
    }
    
    // Fallback: use year/month from URL and assume day 1
    if (!gazetteDate) {
      gazetteDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      logger.warn(`Could not extract exact date, using ${year}-${month}-01`);
    }
    
    // Check if within date range
    const startDate = new Date(this.dateRange.start);
    const endDate = new Date(this.dateRange.end);
    
    if (gazetteDate < startDate || gazetteDate > endDate) {
      const dateStr = gazetteDate.toISOString().split('T')[0];
      logger.debug(`Skipping gazette ${editionNumber} - ${dateStr}: out of date range`);
      return null;
    }
    
    const dateStr = gazetteDate.toISOString().split('T')[0];
    
    logger.debug(`Found gazette: Ed. ${editionNumber} - ${dateStr} - ${fileUrl}`);
    
    return {
      date: dateStr,
      editionNumber,
      fileUrl,
      territoryId: this.config.territoryId,
      isExtraEdition: isExtra,
      power: 'executive',
      scrapedAt: new Date().toISOString(),
    };
  }
}

