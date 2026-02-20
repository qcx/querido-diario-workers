import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraMarianaConfig } from '../../types';
import { logger } from '../../utils/logger';
import { parse } from 'node-html-parser';

/**
 * Spider for Prefeitura de Mariana diário oficial
 * 
 * Site Structure:
 * - URL: https://www.mariana.mg.gov.br/diario-oficial-pmm
 * - List of publications with format "DD/MM/YYYY - Diário Oficial do Munícipio de Mariana - Nº: XXXX"
 * - Some entries have "Edição Extra" in the text
 * - Each publication is a link that leads to the PDF
 * - Uses simple HTML list structure with pagination
 */
export class PrefeituraMarianaSpider extends BaseSpider {
  protected marianaConfig: PrefeituraMarianaConfig;
  private baseUrl: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.marianaConfig = spiderConfig.config as PrefeituraMarianaConfig;
    this.baseUrl = this.marianaConfig.baseUrl || 'https://www.mariana.mg.gov.br/diario-oficial-pmm';
    
    logger.info(`Initializing PrefeituraMarianaSpider for ${spiderConfig.name} with URL: ${this.baseUrl}`);
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling ${this.baseUrl} for ${this.spiderConfig.name}...`);

    try {
      const startDate = new Date(this.dateRange.start);
      const endDate = new Date(this.dateRange.end);

      // Fetch the main page
      const html = await this.fetch(this.baseUrl);
      const root = parse(html);

      // Log a sample of the HTML for debugging
      const htmlSample = html.substring(0, 2000);
      logger.debug(`HTML sample (first 2000 chars): ${htmlSample}`);

      // Find all links on the page
      // The format is: "DD/MM/YYYY - Diário Oficial do Munícipio de Mariana - Nº: XXXX"
      // Some entries have "Edição Extra" in them
      const allLinks = root.querySelectorAll('a');

      logger.debug(`Found ${allLinks.length} potential links on page`);

      // Also try to find links by looking for text patterns in the page
      const pageText = root.textContent || '';
      const textMatches = pageText.match(/\d{2}\/\d{2}\/\d{4}\s*-\s*Diário\s+Oficial[^N]*N[°ºº]:\s*\d+/gi);
      if (textMatches && textMatches.length > 0) {
        logger.debug(`Found ${textMatches.length} text matches in page content`);
        logger.debug(`Sample matches: ${textMatches.slice(0, 3).join(' | ')}`);
      }

      // Multiple patterns to match different formats
      // Examples:
      // "09/01/2026 - Diário Oficial do Munícipio de Mariana - Nº: 3695"
      // "08/01/2026 - Diário Oficial do Munícipio de Mariana - Edição Extra - Nº: 3694"
      const gazettePatterns = [
        // Pattern 1: DD/MM/YYYY - Diário Oficial... - Nº: XXXX
        /(\d{2})\/(\d{2})\/(\d{4})\s*-\s*Diário\s+Oficial[^N]*N[°ºº]:\s*(\d+)/i,
        // Pattern 2: More flexible - any text between date and Nº
        /(\d{2})\/(\d{2})\/(\d{4})\s*-\s*[^-]*-\s*N[°ºº]:\s*(\d+)/i,
        // Pattern 3: Even more flexible - just date and Nº somewhere in text
        /(\d{2})\/(\d{2})\/(\d{4})[^N]*N[°ºº]:\s*(\d+)/i,
      ];
      const extraEditionPattern = /Edição\s+Extra/i;

      let matchedLinks = 0;
      let processedLinks = 0;

      // Also try to find elements containing the pattern text (not just links)
      // Sometimes the link might be nested or the structure is different
      const allElements = root.querySelectorAll('*');
      const elementsWithDate = Array.from(allElements).filter(el => {
        const text = (el.textContent || '').trim();
        return /\d{2}\/\d{2}\/\d{4}/.test(text) && text.includes('Diário');
      });
      
      logger.debug(`Found ${elementsWithDate.length} elements containing date and 'Diário' text`);

      // Process both links and elements that might contain gazette info
      const itemsToProcess: Array<{ element: any; isLink: boolean }> = [
        ...Array.from(allLinks).map(link => ({ element: link, isLink: true })),
        ...elementsWithDate.slice(0, 50).map(el => ({ element: el, isLink: false }))
      ];

      for (const { element, isLink } of itemsToProcess) {
        try {
          // Get text from element and all its children
          let linkText = (element.textContent || '').trim();
          
          // Also check innerHTML for cases where text might be in nested elements
          if (!linkText || linkText.length < 20) {
            const innerText = element.innerHTML || '';
            // Try to extract text from HTML
            const textMatch = innerText.match(/>([^<]*Diário[^<]*N[°ºº]:\s*\d+[^<]*)</i);
            if (textMatch) {
              linkText = textMatch[1].trim();
            }
          }
          
          // Skip empty or very short text
          if (!linkText || linkText.length < 20) {
            continue;
          }

          // Normalize whitespace
          linkText = linkText.replace(/\s+/g, ' ').trim();

          // Try each pattern until one matches
          let match = null;
          for (const pattern of gazettePatterns) {
            match = linkText.match(pattern);
            if (match) {
              break;
            }
          }

          if (!match) {
            // Log first few non-matching links for debugging
            if (matchedLinks < 3 && (linkText.includes('Diário') || linkText.includes('Nº') || /\d{2}\/\d{2}\/\d{4}/.test(linkText))) {
              logger.debug(`Link text that didn't match any pattern: ${linkText.substring(0, 150)}`);
            }
            continue;
          }

          matchedLinks++;
          const [, day, month, year, editionNumber] = match;
          const publicationDate = new Date(`${year}-${month}-${day}`);

          // Validate date
          if (isNaN(publicationDate.getTime())) {
            logger.warn(`Invalid date parsed: ${day}/${month}/${year}`);
            continue;
          }

          // Check if date is within range
          if (publicationDate < startDate || publicationDate > endDate) {
            continue;
          }

          processedLinks++;

          // Check if it's an extra edition
          const isExtraEdition = extraEditionPattern.test(linkText);

          // Get the PDF URL from the link href
          let pdfUrl = '';
          
          if (isLink) {
            pdfUrl = element.getAttribute('href') || '';
          } else {
            // For non-link elements, try to find a link inside or nearby
            const linkInside = element.querySelector('a[href]');
            if (linkInside) {
              pdfUrl = linkInside.getAttribute('href') || '';
            } else {
              // Try to find a sibling link
              const parent = element.parent;
              if (parent) {
                const siblingLink = parent.querySelector('a[href]');
                if (siblingLink) {
                  pdfUrl = siblingLink.getAttribute('href') || '';
                }
              }
            }
          }
          
          if (!pdfUrl) {
            logger.warn(`No href found for gazette ${editionNumber} on ${day}/${month}/${year} (isLink: ${isLink})`);
            continue;
          }

          // Make URL absolute if relative
          if (!pdfUrl.startsWith('http')) {
            const baseUrlObj = new URL(this.baseUrl);
            pdfUrl = `${baseUrlObj.origin}${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
          }

          // Check if the URL is a PDF or if we need to navigate to get it
          // If it's not a PDF, we might need to fetch the page and extract the PDF link
          if (!pdfUrl.toLowerCase().endsWith('.pdf') && !pdfUrl.includes('.pdf')) {
            // Try to fetch the page and find the PDF link
            try {
              const detailHtml = await this.fetch(pdfUrl);
              const detailRoot = parse(detailHtml);
              
              // Look for PDF links in the detail page
              const pdfLinks = detailRoot.querySelectorAll('a[href*=".pdf"], iframe[src*=".pdf"], embed[src*=".pdf"]');
              
              if (pdfLinks.length > 0) {
                const pdfLink = pdfLinks[0];
                const pdfHref = pdfLink.getAttribute('href') || pdfLink.getAttribute('src') || '';
                if (pdfHref) {
                  if (!pdfHref.startsWith('http')) {
                    const baseUrlObj = new URL(pdfUrl);
                    pdfUrl = `${baseUrlObj.origin}${pdfHref.startsWith('/') ? '' : '/'}${pdfHref}`;
                  } else {
                    pdfUrl = pdfHref;
                  }
                }
              }
            } catch (error) {
              logger.warn(`Could not fetch detail page for ${pdfUrl}:`, error as Error);
            }
          }

          // Create gazette
          const gazette = await this.createGazette(publicationDate, pdfUrl, {
            editionNumber,
            isExtraEdition,
            power: 'executive_legislative',
            sourceText: linkText,
          });

          if (gazette) {
            gazettes.push(gazette);
          }

        } catch (error) {
          logger.error(`Error processing link:`, error as Error);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name} (matched ${matchedLinks} links, processed ${processedLinks} in date range)`);

    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }
}

