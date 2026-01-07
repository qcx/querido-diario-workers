import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, GeosiapApiConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, fromISODate } from '../../utils/date-utils';

/**
 * GeosiapApiSpider - Hybrid spider for GeoSIAP platform
 * 
 * This spider uses a hybrid approach:
 * 1. Uses the public JSON API to list gazettes (no browser required)
 * 2. Uses browser (when available) to navigate and get the presigned S3 URL for each gazette
 * 
 * API endpoint:
 * GET /api/{prefix}/publicacao/bo_arquivos_public?inativos=false&dt_inicial=YYYY-MM-DD&dt_final=YYYY-MM-DD
 * 
 * The API returns gazette metadata. The download URL is a presigned S3 URL
 * that is only available via client-side JavaScript.
 * 
 * URL pattern: https://boletinsoficiais.geosiap.net/{prefix}/public/publicacoes
 * API pattern: https://boletinsoficiais.geosiap.net/api/{prefix}/publicacao/...
 */

interface GeosiapGazetteItem {
  id: number;
  titulo: string;
  resumo?: string;
  nome_arquivo: string;
  arquivo_nome: string;
  arquivo_extensao: string;
  dt_publicacao: string;
  discarded_at: string | null;
  isCollapsed?: boolean;
}

interface GeosiapApiResponse {
  data: GeosiapGazetteItem[];
}

export class GeosiapApiSpider extends BaseSpider {
  private geosiapConfig: GeosiapApiConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.geosiapConfig = spiderConfig.config as GeosiapApiConfig;

    if (!this.geosiapConfig.baseUrl) {
      throw new Error(`GeosiapApiSpider requires a baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing GeosiapApiSpider for ${spiderConfig.name} with URL: ${this.geosiapConfig.baseUrl}`, {
      hasBrowser: !!this.browser
    });
  }

  /**
   * Set browser instance (for queue consumer context)
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
    logger.debug('Browser set for GeosiapApiSpider', { hasBrowser: !!this.browser });
  }

  /**
   * Extract the city prefix from the baseUrl
   * e.g., https://boletinsoficiais.geosiap.net/pmjacarei/public/publicacoes -> pmjacarei
   */
  private extractPrefix(): string {
    // First try to get from config if provided
    if ((this.geosiapConfig as any).cityPrefix) {
      return (this.geosiapConfig as any).cityPrefix;
    }
    // Otherwise extract from URL
    const urlMatch = this.geosiapConfig.baseUrl.match(/geosiap\.net\/([^\/]+)/);
    if (!urlMatch) {
      throw new Error(`Could not extract prefix from URL: ${this.geosiapConfig.baseUrl}`);
    }
    return urlMatch[1];
  }

  /**
   * Build the API URL for fetching gazette list
   */
  private buildApiUrl(): string {
    const prefix = this.extractPrefix();
    const baseUrl = new URL(this.geosiapConfig.baseUrl);
    const startDate = toISODate(this.startDate);
    const endDate = toISODate(this.endDate);
    
    return `${baseUrl.protocol}//${baseUrl.host}/api/${prefix}/publicacao/bo_arquivos_public?inativos=false&dt_inicial=${startDate}&dt_final=${endDate}`;
  }

  /**
   * Get the S3 presigned URL for a gazette using browser navigation
   * This navigates to the page, clicks the download button, and captures the redirect
   */
  private async getPresignedUrlWithBrowser(gazetteId: number): Promise<string | null> {
    if (!this.browser) {
      logger.warn('No browser available for getting presigned URL', { gazetteId });
      return null;
    }

    const prefix = this.extractPrefix();
    const baseUrl = new URL(this.geosiapConfig.baseUrl);
    const pageUrl = `${baseUrl.protocol}//${baseUrl.host}/${prefix}/public/publicacoes`;
    
    let browserInstance = null;
    let page = null;

    try {
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();
      this.requestCount++;

      // Listen for network responses to capture the S3 URL
      let capturedS3Url: string | null = null;
      
      page.on('response', (response: any) => {
        const url = response.url();
        if (url.includes('geosiap.s3') && url.includes('.pdf')) {
          capturedS3Url = url;
          logger.debug('Captured S3 URL from response', { url: url.substring(0, 80) });
        }
      });

      // Also listen for new page/tab openings (PDF might open in new tab)
      const browser2 = await page.browser();
      browser2.on('targetcreated', async (target: any) => {
        const url = target.url();
        if (url && url.includes('geosiap.s3') && url.includes('.pdf')) {
          capturedS3Url = url;
          logger.debug('Captured S3 URL from new target', { url: url.substring(0, 80) });
        }
      });

      // Navigate to the publications page
      await page.goto(pageUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Find and click the download button for the specific gazette
      // GeoSIAP uses Angular Material with DevExtreme DataGrid
      // The structure is: table > row > cell > button (with cloud_download icon)
      const downloadClicked = await page.evaluate(() => {
        // Strategy 1: Look for buttons with cloud_download icon in the table
        const allButtons = document.querySelectorAll('button, [role="button"]');
        
        for (const button of allButtons) {
          // Check if this is a download button (contains cloud_download icon)
          const iconEl = button.querySelector('mat-icon, .material-icons, i');
          const iconText = iconEl?.textContent?.trim() || '';
          const buttonHtml = button.innerHTML || '';
          
          if (iconText === 'cloud_download' || buttonHtml.includes('cloud_download')) {
            // This is a download button
            (button as HTMLElement).click();
            return { clicked: true, method: 'icon' };
          }
        }
        
        // Strategy 2: Look for the first button in the table's detail rows
        // GeoSIAP shows 3 buttons per row: download (cloud), view (visibility), details (more_vert)
        const tableRows = document.querySelectorAll('[role="row"], .dx-row, tr');
        for (const row of tableRows) {
          const buttons = row.querySelectorAll('button, [role="button"]');
          if (buttons.length >= 1) {
            // First button is usually the download
            (buttons[0] as HTMLElement).click();
            return { clicked: true, method: 'first-button' };
          }
        }
        
        // Strategy 3: Find any clickable element that might trigger download
        const downloadLinks = document.querySelectorAll('a[download], a[href*=".pdf"]');
        if (downloadLinks.length > 0) {
          (downloadLinks[0] as HTMLElement).click();
          return { clicked: true, method: 'link' };
        }
        
        return { clicked: false, method: 'none', buttonCount: allButtons.length };
      });

      if (!downloadClicked.clicked) {
        logger.warn('Could not find download button for gazette', { 
          gazetteId, 
          pageUrl, 
          ...downloadClicked 
        });
        return null;
      }

      logger.debug('Download button clicked', { gazetteId, method: downloadClicked.method });

      // Wait for the S3 URL to be captured (network request interception)
      await new Promise(resolve => setTimeout(resolve, 5000));

      if (capturedS3Url) {
        logger.info('Captured S3 presigned URL', { 
          gazetteId, 
          method: downloadClicked.method,
          s3Url: capturedS3Url.substring(0, 80) + '...' 
        });
        return capturedS3Url;
      }

      logger.warn('No S3 URL captured after clicking download', { 
        gazetteId, 
        method: downloadClicked.method 
      });
      return null;
    } catch (error) {
      logger.error('Error getting presigned URL with browser', { gazetteId, error });
      return null;
    } finally {
      if (page) await page.close().catch(() => {});
      if (browserInstance) await browserInstance.close().catch(() => {});
    }
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.geosiapConfig.baseUrl} using API for ${this.spiderConfig.name}...`, {
      hasBrowser: !!this.browser
    });

    const gazettes: Gazette[] = [];

    try {
      const apiUrl = this.buildApiUrl();
      logger.debug(`Fetching gazette list from API: ${apiUrl}`);
      
      const response = await fetch(apiUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; GoodFellow/1.0)'
        }
      });
      
      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
      }
      
      this.requestCount++;
      const data = await response.json() as GeosiapApiResponse;
      
      if (!data.data || !Array.isArray(data.data)) {
        logger.warn(`Unexpected API response format from ${apiUrl}`);
        return gazettes;
      }

      logger.info(`Found ${data.data.length} gazette entries from API`);

      for (const item of data.data) {
        // Skip discarded items
        if (item.discarded_at) {
          continue;
        }

        // Parse the publication date
        const date = this.parsePublicationDate(item.dt_publicacao);
        if (!date) {
          logger.warn(`Could not parse date: ${item.dt_publicacao}`);
          continue;
        }

        // Check if date is in range
        if (!this.isInDateRange(date)) {
          continue;
        }

        // Extract edition number from title
        const editionNumber = this.extractEditionNumber(item.titulo);

        // Try to get the presigned S3 URL using browser
        let pdfUrl: string;
        let requiresClientRendering = false;

        if (this.browser) {
          const s3Url = await this.getPresignedUrlWithBrowser(item.id);
          if (s3Url) {
            pdfUrl = s3Url;
          } else {
            // Fallback to page URL if browser capture fails
            const prefix = this.extractPrefix();
            const baseUrl = new URL(this.geosiapConfig.baseUrl);
            pdfUrl = `${baseUrl.protocol}//${baseUrl.host}/${prefix}/public/publicacoes#gazette/${item.id}`;
            requiresClientRendering = true;
          }
        } else {
          // No browser available - use page URL and mark for client rendering
          const prefix = this.extractPrefix();
          const baseUrl = new URL(this.geosiapConfig.baseUrl);
          pdfUrl = `${baseUrl.protocol}//${baseUrl.host}/${prefix}/public/publicacoes#gazette/${item.id}`;
          requiresClientRendering = true;
          logger.warn(`No browser available, gazette will require client rendering`, { 
            gazetteId: item.id, 
            editionNumber 
          });
        }

        // Create gazette
        const gazette = await this.createGazette(date, pdfUrl, {
          editionNumber,
          power: 'executive_legislative',
          sourceText: item.titulo,
          requiresClientRendering
        });

        if (gazette) {
          gazettes.push(gazette);
        }
      }

      logger.info(`Found ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      return gazettes;
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, { error });
      return gazettes;
    }
  }

  /**
   * Parse the publication date from the API response
   * Format: "2025-12-30T00:00:00.000-03:00"
   */
  private parsePublicationDate(dateStr: string): Date | null {
    if (!dateStr) return null;

    try {
      // Parse ISO 8601 date string
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) {
        return null;
      }
      return date;
    } catch {
      return null;
    }
  }

  /**
   * Extract edition number from title
   * e.g., "Boletim Oficial n° 1693" -> "1693"
   */
  private extractEditionNumber(text: string): string | undefined {
    if (!text) return undefined;
    const match = text.match(/(?:n[°º]?\.?\s*|edi[çc][ãa]o\s*|ed\.?\s*)(\d+)/i);
    return match ? match[1] : undefined;
  }
}

