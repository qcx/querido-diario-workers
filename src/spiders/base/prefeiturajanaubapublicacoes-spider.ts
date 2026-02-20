import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraJanaubaPublicacoesConfig } from '../../types';
import { logger } from '../../utils/logger';
import { parse } from 'node-html-parser';
import { toISODate } from '../../utils/date-utils';

/**
 * Spider for Prefeitura de Janaúba publicações page
 * 
 * Site Structure:
 * - URL: https://janauba.mg.gov.br/transparencia/publicacoes
 * - List of publications with DATA DA PUBLICAÇÃO and ARQUIVO links
 * - Pagination support (1, 2, 3, Próxima, Última)
 * - Filters by TIPO DE PUBLICAÇÃO and ANO
 */
export class PrefeituraJanaubaPublicacoesSpider extends BaseSpider {
  protected publicacoesConfig: PrefeituraJanaubaPublicacoesConfig;
  private baseUrl: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.publicacoesConfig = spiderConfig.config as PrefeituraJanaubaPublicacoesConfig;
    this.baseUrl = this.publicacoesConfig.baseUrl || 'https://janauba.mg.gov.br/transparencia/publicacoes';
    
    logger.info(`Initializing PrefeituraJanaubaPublicacoesSpider for ${spiderConfig.name} with URL: ${this.baseUrl}`);
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling ${this.baseUrl} for ${this.spiderConfig.name}...`);

    try {
      let currentPage = 1;
      let hasMorePages = true;
      let foundOlderThanRange = false;
      const maxPages = 100; // Safety limit

      while (hasMorePages && currentPage <= maxPages && !foundOlderThanRange) {
        // Build URL with pagination
        const url = currentPage === 1 
          ? this.baseUrl 
          : `${this.baseUrl}?page=${currentPage}`;
        
        logger.debug(`Fetching page ${currentPage}: ${url}`);

        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
          }
        });

        if (!response.ok) {
          logger.error(`Failed to fetch page ${currentPage}: ${response.status}`);
          break;
        }

        const html = await response.text();
        const root = parse(html);
        this.requestCount++;

        // Extract gazettes from current page
        const pageGazettes = this.extractGazettesFromHtml(root);

        if (pageGazettes.length === 0) {
          logger.debug(`No gazettes found on page ${currentPage}, stopping pagination`);
          hasMorePages = false;
          continue;
        }

        logger.debug(`Found ${pageGazettes.length} publications on page ${currentPage}`);

        // Filter by date range and check if we should continue
        for (const gazette of pageGazettes) {
          const gazetteDate = new Date(gazette.date);
          
          // Check if older than date range
          if (gazetteDate < new Date(this.dateRange.start)) {
            foundOlderThanRange = true;
            continue;
          }
          
          // Check if in date range
          if (this.isInDateRange(gazetteDate)) {
            gazettes.push(gazette);
          }
        }

        // Check for next page - look for pagination links
        const paginationLinks = root.querySelectorAll('a[href*="page"], .pagination a, .pager a');
        let hasNextPage = false;
        
        for (const link of paginationLinks) {
          const text = link.textContent?.trim().toLowerCase() || '';
          const href = link.getAttribute('href') || '';
          
          // Check if it's a next page link
          if (text.includes('próxima') || text.includes('proxima') || text.includes('next') || 
              (text === String(currentPage + 1)) || href.includes(`page=${currentPage + 1}`)) {
            hasNextPage = true;
            break;
          }
        }

        // Also check for numbered pagination
        if (!hasNextPage) {
          const currentPageLinks = root.querySelectorAll('a, button');
          for (const link of currentPageLinks) {
            const text = link.textContent?.trim();
            if (text === String(currentPage + 1)) {
              hasNextPage = true;
              break;
            }
          }
        }

        if (!hasNextPage) {
          logger.debug(`No next page found, stopping pagination at page ${currentPage}`);
          hasMorePages = false;
        } else {
          currentPage++;
        }

        // Safety check to avoid infinite loops
        if (foundOlderThanRange) {
          logger.debug('Found publications older than date range, stopping pagination');
          hasMorePages = false;
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Extract gazettes from HTML
   * 
   * Page structure (from web search):
   * - Publications are listed with:
   *   - DATA DA PUBLICAÇÃO (date)
   *   - EMENTA (title/description)
   *   - ARQUIVO (download link)
   */
  private extractGazettesFromHtml(root: any): Gazette[] {
    const gazettes: Gazette[] = [];

    try {
      // Based on the page structure, publications are in a list with:
      // - DATA DA PUBLICAÇÃO
      // - EMENTA (title/description)
      // - ARQUIVO (download link)
      
      // Strategy 1: Look for publication items in common container patterns
      // The page shows "Últimas Publicações" with each publication having a horizontal rule separator
      let publicationItems: any[] = [];
      
      // Look for sections that contain "DATA:" followed by a date
      // Common patterns: article, div with hr separator, list items
      const candidates = Array.from(root.querySelectorAll('article, div, section, li'));
      
      for (const candidate of candidates) {
        const text = candidate.textContent || '';
        // Check if this element contains a publication pattern
        // Pattern: "DATA: DD/MM/YYYY" or "DATA DA PUBLICAÇÃO: DD/MM/YYYY"
        if (/\bDATA(?:\s+DA\s+PUBLICAÇÃO)?\s*:?\s*\d{2}\/\d{2}\/\d{4}/i.test(text)) {
          // Also check if it has a link (ARQUIVO)
          const hasLink = candidate.querySelector('a[href]');
          if (hasLink) {
            publicationItems.push(candidate);
          }
        }
      }
      
      // Strategy 2: If no matches, try looking for elements with date patterns and links
      if (publicationItems.length === 0) {
        const allElements = Array.from(root.querySelectorAll('div, article, section, li, tr'));
        publicationItems = allElements.filter(el => {
          const text = el.textContent || '';
          const hasDate = /\d{2}\/\d{2}\/\d{4}/.test(text);
          const hasLink = el.querySelector('a[href]');
          const hasPublicationKeywords = /\b(EMENTA|ARQUIVO|PUBLICAÇÃO|DATA)\b/i.test(text);
          return hasDate && hasLink && (hasPublicationKeywords || el.querySelector('a[href*=".pdf"], a[href*="download"], a[href*="arquivo"]'));
        });
      }

      logger.debug(`Found ${publicationItems.length} potential publication items`);

      for (const item of publicationItems) {
        try {
          const itemText = item.textContent || '';
          
          // Extract date - look for "DATA:" or "DATA DA PUBLICAÇÃO:" followed by date
          let dateMatch = itemText.match(/(?:DATA(?:\s+DA\s+PUBLICAÇÃO)?\s*:?\s*)(\d{2}\/\d{2}\/\d{4})/i);
          
          if (!dateMatch) {
            // Try alternative patterns
            const datePatterns = [
              /(\d{2}\/\d{2}\/\d{4})/, // Simple DD/MM/YYYY
              /(\d{2})-(\d{2})-(\d{4})/, // DD-MM-YYYY
            ];
            
            for (const pattern of datePatterns) {
              const match = itemText.match(pattern);
              if (match) {
                dateMatch = match;
                break;
              }
            }
          }

          if (!dateMatch) {
            continue; // Skip items without dates
          }

          let dateStr = dateMatch[1];
          if (!dateStr && dateMatch[2] && dateMatch[3] && dateMatch[4]) {
            // Format DD-MM-YYYY to DD/MM/YYYY
            dateStr = `${dateMatch[2]}/${dateMatch[3]}/${dateMatch[4]}`;
          }
          
          if (!dateStr) {
            continue;
          }
          const parsedDate = this.parseBrazilianDate(dateStr);
          
          if (!parsedDate) {
            logger.debug(`Could not parse date: ${dateStr}`);
            continue;
          }

          // Find download link - look for "ARQUIVO" or PDF links
          let pdfUrl = '';
          
          // Look for link with "ARQUIVO" text - need to check text content manually
          const allLinks = item.querySelectorAll('a[href]');
          for (const link of allLinks) {
            const linkText = (link.textContent || '').toLowerCase().trim();
            const href = link.getAttribute('href') || '';
            
            if (linkText.includes('arquivo') || linkText.includes('download') || 
                href.includes('.pdf') || href.includes('download') || href.includes('arquivo')) {
              pdfUrl = href;
              break;
            }
          }

          // If still no link, try to find any PDF link in the item
          if (!pdfUrl) {
            const pdfLink = item.querySelector('a[href*=".pdf"], a[href*="download"]');
            if (pdfLink) {
              pdfUrl = pdfLink.getAttribute('href') || '';
            }
          }

          // If still no link, try to find any link that might be a file
          if (!pdfUrl) {
            const anyLink = item.querySelector('a[href]');
            if (anyLink) {
              const href = anyLink.getAttribute('href') || '';
              // Only use if it looks like a file link
              if (href.includes('.pdf') || href.includes('download') || href.includes('arquivo') || 
                  href.includes('.doc') || href.includes('.docx')) {
                pdfUrl = href;
              }
            }
          }

          if (!pdfUrl) {
            logger.debug(`No PDF link found for publication dated ${dateStr}`);
            continue;
          }

          // Resolve relative URLs
          if (pdfUrl.startsWith('/')) {
            const baseUrlObj = new URL(this.baseUrl);
            pdfUrl = `${baseUrlObj.protocol}//${baseUrlObj.host}${pdfUrl}`;
          } else if (!pdfUrl.startsWith('http')) {
            pdfUrl = new URL(pdfUrl, this.baseUrl).href;
          }

          // Extract title/description (EMENTA)
          let title = '';
          const titleEl = item.querySelector('h3, h4, h5, .title, .titulo, .ementa, [class*="title"], [class*="titulo"]');
          if (titleEl) {
            title = titleEl.textContent?.trim() || '';
          } else {
            // Try to extract from item text - look for text after "EMENTA:"
            const ementaMatch = itemText.match(/EMENTA\s*:?\s*(.+?)(?:\n|DATA|$)/i);
            if (ementaMatch) {
              title = ementaMatch[1].trim().substring(0, 200);
            }
          }

          // Extract edition number if present
          let editionNumber: string | undefined;
          const editionMatch = itemText.match(/(?:edi[çc][ãa]o|ed\.?|n[úu]mero|n[°º]?\.?)\s*[°º]?\s*(\d+)/i);
          if (editionMatch) {
            editionNumber = editionMatch[1];
          }

          const gazette: Gazette = {
            date: toISODate(parsedDate),
            fileUrl: pdfUrl,
            territoryId: this.spiderConfig.territoryId,
            scrapedAt: new Date().toISOString(),
            power: 'executive',
            isExtraEdition: false,
          };

          if (editionNumber) {
            gazette.editionNumber = editionNumber;
          }

          if (title) {
            gazette.sourceText = title;
          }

          gazettes.push(gazette);
        } catch (error) {
          logger.debug(`Error parsing publication item:`, error as Error);
          continue;
        }
      }

    } catch (error) {
      logger.error(`Error extracting gazettes from HTML:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Parse Brazilian date format (DD/MM/YYYY) to Date object
   */
  private parseBrazilianDate(dateStr: string): Date | null {
    if (!dateStr) return null;

    // Common Brazilian date formats: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
    const patterns = [
      /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/,
      /(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/, // ISO format
    ];

    for (const pattern of patterns) {
      const match = dateStr.match(pattern);
      if (match) {
        if (pattern === patterns[1]) {
          // ISO format YYYY-MM-DD
          return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
        }
        // Brazilian format DD/MM/YYYY
        return new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
      }
    }

    return null;
  }
}

