import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Configuration for 1DOM platform spider
 */
export interface OnedomConfig {
  type: 'onedom';
  /** Base URL for the 1DOM platform (e.g., "https://araraquara.1dom.com.br") */
  baseUrl: string;
  /** Whether this spider requires client-side rendering */
  requiresClientRendering?: boolean;
}

/**
 * Spider for 1DOM platform
 * Used by municipalities like Araraquara and Pindamonhangaba
 * 
 * Uses Cloudflare Browser Rendering (Puppeteer) to handle:
 * - JavaScript-driven calendar and content loading
 * - Dynamic list of gazettes organized by date
 * - PDF links for each edition
 * 
 * Site structure:
 * - Calendar view showing which dates have editions
 * - Table listing editions with: date, number, type (Ordinária/Extraordinária), and link
 * - Pattern: "Edição • DD/MM/YYYY Nº XXX [Type] X Ato(s) vinculados Acessar Edição"
 * - Edition detail page: /edicao/{ID}
 * - PDF download: /edicao/{ID}/complete?
 */
export class OnedomSpider extends BaseSpider {
  private baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(config: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(config, dateRange);
    const platformConfig = config.config as OnedomConfig;
    this.baseUrl = platformConfig.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.browser = browser || null;
    
    if (!this.baseUrl) {
      throw new Error(`OnedomSpider requires baseUrl in config for ${config.name}`);
    }
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(`OnedomSpider for ${this.config.name} requires browser binding`);
      return [];
    }

    const gazettes: Gazette[] = [];
    logger.info(`Crawling 1DOM for ${this.config.name}...`);

    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      
      // Calculate date range to crawl
      const startDate = new Date(this.startDate);
      const endDate = new Date(this.endDate);
      
      // Normalize dates to midnight
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(0, 0, 0, 0);
      
      logger.info(`Crawling date range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
      
      // Iterate through each day in the date range
      const currentDate = new Date(startDate);
      
      while (currentDate <= endDate) {
        const dateStr = currentDate.toISOString().split('T')[0]; // YYYY-MM-DD format
        const url = `${this.baseUrl}/?date=${dateStr}`;
        
        logger.debug(`Fetching editions for date: ${dateStr}`);
        
        try {
          await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
          await new Promise(resolve => setTimeout(resolve, 2000));
          this.requestCount++;
          
          // Extract all gazette editions from the table
          const editionsData = await page.evaluate(() => {
            const results: Array<{
              dateStr: string;
              editionNumber: string;
              isExtra: boolean;
              editionId: string;
              editionType: string;
            }> = [];
            
            // Find all table rows with edition data
            const rows = document.querySelectorAll('table tbody tr');
            
            for (const row of Array.from(rows)) {
              try {
                // Extract date (format: "Edição • DD/MM/YYYY")
                const dateCell = row.querySelector('td:first-child');
                if (!dateCell) continue;
                
                const dateCellText = dateCell.textContent || '';
                const dateMatch = dateCellText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                if (!dateMatch) continue;
                
                const dateStr = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;
                
                // Extract edition number (format: "Nº XXX")
                const editionCell = row.querySelector('td:nth-child(2)');
                if (!editionCell) continue;
                
                const editionText = editionCell.textContent || '';
                const editionMatch = editionText.match(/Nº\s*(\d+)/);
                const editionNumber = editionMatch ? editionMatch[1] : '';
                
                // Extract edition type (Ordinária or Extraordinária)
                const typeCell = row.querySelector('td:nth-child(3)');
                const editionType = typeCell?.textContent?.trim() || '';
                const isExtra = editionType.toLowerCase().includes('extraordinária');
                
                // Extract edition ID from the link
                const linkElement = row.querySelector('a[href*="/edicao/"]') as HTMLAnchorElement;
                if (!linkElement) continue;
                
                const href = linkElement.getAttribute('href') || '';
                const idMatch = href.match(/\/edicao\/([A-Z0-9]+)/);
                if (!idMatch) continue;
                
                const editionId = idMatch[1];
                
                results.push({
                  dateStr,
                  editionNumber,
                  isExtra,
                  editionId,
                  editionType
                });
              } catch (error) {
                console.error('Error parsing row:', error);
              }
            }
            
            return results;
          });
          
          logger.debug(`Found ${editionsData.length} edition(s) for ${dateStr}`);
          
          // Process each edition
          for (const edition of editionsData) {
            try {
              // Parse date from DD/MM/YYYY format
              const [day, month, year] = edition.dateStr.split('/').map(Number);
              const gazetteDate = new Date(year, month - 1, day);
              gazetteDate.setHours(0, 0, 0, 0);
              
              // Navigate to the complete edition page to get the viewer URL
              const completeUrl = `${this.baseUrl}/edicao/${edition.editionId}/complete`;
              logger.debug(`Fetching complete edition page: ${completeUrl}`);
              
              await page.goto(completeUrl, { waitUntil: 'networkidle0', timeout: 30000 });
              await new Promise(resolve => setTimeout(resolve, 1000));
              this.requestCount++;
              
              // Extract the viewer URL from the page
              const viewerUrl = await page.evaluate(() => {
                // Look for iframe with viewer URL
                const iframe = document.querySelector('iframe[src*="viewer.html"]') as HTMLIFrameElement;
                if (iframe && iframe.src) {
                  return iframe.src;
                }
                
                // Look for links containing viewer.html
                const links = Array.from(document.querySelectorAll('a[href*="viewer.html"]')) as HTMLAnchorElement[];
                if (links.length > 0) {
                  return links[0].href;
                }
                
                // Look in the page content for viewer.html URLs
                const pageText = document.body.innerHTML;
                const match = pageText.match(/https?:\/\/[^"'\s]+viewer\.html[^"'\s]*/);
                if (match) {
                  return match[0];
                }
                
                return null;
              });
              
              if (!viewerUrl) {
                logger.warn(`Could not find viewer URL for edition ${edition.editionId}`);
                continue;
              }
              
              logger.debug(`Found viewer URL: ${viewerUrl}`);
              
              // Navigate to the viewer page
              await page.goto(viewerUrl, { waitUntil: 'networkidle0', timeout: 30000 });
              await new Promise(resolve => setTimeout(resolve, 2000));
              this.requestCount++;
              
              // Extract the actual PDF URL from the viewer
              const pdfUrl = await page.evaluate(() => {
                // Helper function to fully decode and extract the S3 URL
                const extractS3Url = (url: string): string | null => {
                  try {
                    // Decode the URL parameter (may be double-encoded)
                    let decoded = decodeURIComponent(url);
                    
                    // If it's a proxy URL, extract the actual URL from the 'url' parameter
                    if (decoded.includes('/pdf/proxy?url=') || decoded.includes('url=')) {
                      // Capture everything after 'url=' since it's typically the last parameter
                      // and the S3 URL contains encoded & characters as part of AWS signature
                      const urlMatch = decoded.match(/[?&]url=(.+)/);
                      if (urlMatch) {
                        // Decode again to get the final URL with all AWS signature parameters
                        decoded = decodeURIComponent(urlMatch[1]);
                      }
                    }
                    
                    // Check if we have a valid HTTP(S) URL
                    if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
                      return decoded;
                    }
                    
                    return null;
                  } catch (e) {
                    console.error('Error extracting S3 URL:', e);
                    return null;
                  }
                };
                
                // Try to get the PDF URL from the viewer's internal state
                const viewerApp = (window as any).PDFViewerApplication;
                if (viewerApp && viewerApp.url) {
                  const extracted = extractS3Url(viewerApp.url);
                  if (extracted) return extracted;
                }
                
                // Try to extract from the file parameter in the URL
                const urlParams = new URLSearchParams(window.location.search);
                const fileParam = urlParams.get('file');
                if (fileParam) {
                  const extracted = extractS3Url(fileParam);
                  if (extracted) return extracted;
                }
                
                // Try to get from the viewer's page content
                const pageContent = document.body.innerHTML;
                const s3Match = pageContent.match(/https:\/\/1dom-general\.s3[^"'\s]+\.pdf[^"'\s]*/);
                if (s3Match) {
                  return s3Match[0].replace(/&amp;/g, '&');
                }
                
                return null;
              });
              
              if (!pdfUrl) {
                logger.warn(`Could not extract PDF URL from viewer for edition ${edition.editionId}`);
                continue;
              }
              
              logger.debug(`Extracted PDF URL: ${pdfUrl}`);
              
              const gazette = await this.createGazette(gazetteDate, pdfUrl, {
                editionNumber: edition.editionNumber || undefined,
                isExtraEdition: edition.isExtra,
                power: 'executive_legislative',
                requiresClientRendering: false, // PDF URL is direct, no client rendering needed
              });
              
              if (gazette) {
                gazettes.push(gazette);
                logger.info(`Found gazette: ${pdfUrl} (Date: ${edition.dateStr}, Edition: ${edition.editionNumber}, Type: ${edition.editionType})`);
              }
            } catch (error) {
              logger.warn(`Failed to process edition data for ${edition.dateStr}: ${error}`);
            }
          }
        } catch (error) {
          logger.warn(`Error fetching date ${dateStr}: ${error}`);
        }
        
        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1);
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from 1DOM`);
      
    } catch (error) {
      logger.error(`Error crawling 1DOM: ${error}`);
      throw error;
    } finally { 
      // Clean up
      if (page) {
        try {
          await page.close();
        } catch (e) {
          logger.warn(`Error closing page: ${e}`);
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (e) {
          logger.warn(`Error closing browser: ${e}`);
        }
      }
    }

    return gazettes;
  }
}
