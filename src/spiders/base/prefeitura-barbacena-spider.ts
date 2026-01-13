import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeiturabarbacenaConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate, getCurrentTimestamp } from '../../utils/date-utils';

interface BarbacenaGazetteData {
  edicao: string;
  dataAtualizacao: string;
  data: string;
  edicaoExtra: string | null;
  descricao: string;
}

interface BarbacenaApiResponse {
  dados: BarbacenaGazetteData[];
}

interface GazetteLink {
  date: Date;
  downloadToken: string;
  edition: string;
  isExtra: boolean;
}

/**
 * PrefeiturabarbacenaSpider implementation
 * 
 * Crawls Barbacena's official gazette website.
 * 
 * Site structure:
 * - Main page: https://www1.barbacena.mg.gov.br/portal/diario-oficial
 * - Open Data API: https://www1.barbacena.mg.gov.br/portal/dados-abertos/diario-oficial/{YEAR}
 * - Download page: https://www1.barbacena.mg.gov.br/portal/download/diario-oficial/{TOKEN}/
 * - PDF redirect: The download page contains a meta-refresh to /uploads/{filename}.pdf
 * 
 * This spider:
 * 1. Fetches gazette metadata from the Open Data API for relevant years
 * 2. Parses the main page to extract download tokens
 * 3. Resolves download URLs to actual PDF links
 */
export class PrefeiturabarbacenaSpider extends BaseSpider {
  protected barbacenaConfig: PrefeiturabarbacenaConfig;
  private browser?: Fetcher;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.barbacenaConfig = spiderConfig.config as PrefeiturabarbacenaConfig;
    
    if (!this.barbacenaConfig.baseUrl) {
      throw new Error(`PrefeiturabarbacenaSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeiturabarbacenaSpider for ${spiderConfig.name} with URL: ${this.barbacenaConfig.baseUrl}`);
  }

  /**
   * Set the browser instance for web scraping
   */
  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.barbacenaConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Get the years we need to fetch
      const startYear = this.startDate.getUTCFullYear();
      const endYear = this.endDate.getUTCFullYear();
      
      // Collect all gazette data from the API for relevant years
      const allGazetteData: BarbacenaGazetteData[] = [];
      
      for (let year = startYear; year <= endYear; year++) {
        const apiUrl = `${this.barbacenaConfig.baseUrl}/portal/dados-abertos/diario-oficial/${year}`;
        logger.debug(`Fetching API data from: ${apiUrl}`);
        
        try {
          const response = await this.fetch(apiUrl);
          const data = JSON.parse(response) as BarbacenaApiResponse;
          
          if (data.dados && Array.isArray(data.dados)) {
            allGazetteData.push(...data.dados);
            logger.debug(`Found ${data.dados.length} gazettes for year ${year}`);
          }
        } catch (error) {
          logger.warn(`Failed to fetch API data for year ${year}: ${(error as Error).message}`);
        }
      }
      
      if (allGazetteData.length === 0) {
        logger.warn(`No gazette data found from API for ${this.spiderConfig.name}`);
        return gazettes;
      }
      
      logger.info(`Found ${allGazetteData.length} total gazette entries from API`);
      
      // Fetch the main page to get download tokens
      const mainPageUrl = `${this.barbacenaConfig.baseUrl}/portal/diario-oficial`;
      const mainPageHtml = await this.fetch(mainPageUrl);
      
      // Extract download tokens and edition mappings from the page
      const editionToToken = this.parseDownloadTokens(mainPageHtml);
      logger.debug(`Parsed ${Object.keys(editionToToken).length} download tokens from main page`);
      
      // Filter by date range and create gazettes
      const startDateStr = toISODate(this.startDate);
      const endDateStr = toISODate(this.endDate);
      
      for (const gazetteData of allGazetteData) {
        // Parse date from API format: "YYYY-MM-DD HH:MM:SS"
        const dateParts = gazetteData.data.split(' ')[0]; // Get just the date part
        const gazetteDate = new Date(dateParts + 'T00:00:00.000Z');
        const gazetteDateStr = toISODate(gazetteDate);
        
        // Check if within date range
        if (gazetteDateStr >= startDateStr && gazetteDateStr <= endDateStr) {
          const edition = gazetteData.edicao;
          const isExtra = gazetteData.edicaoExtra !== null;
          
          // Try to get download token for this edition
          const downloadToken = editionToToken[edition];
          
          if (!downloadToken) {
            logger.debug(`No download token found for edition ${edition}, trying to construct URL`);
            // If we don't have a token, we might need to fetch more pages
            // For now, skip this gazette
            continue;
          }
          
          // Resolve the actual PDF URL
          const downloadPageUrl = `${this.barbacenaConfig.baseUrl}/portal/download/diario-oficial/${downloadToken}/`;
          
          try {
            const pdfUrl = await this.resolvePdfUrl(downloadPageUrl);
            
            if (pdfUrl) {
              const gazette: Gazette = {
                date: gazetteDateStr,
                fileUrl: pdfUrl,
                territoryId: this.spiderConfig.territoryId,
                scrapedAt: getCurrentTimestamp(),
                editionNumber: edition,
                isExtraEdition: isExtra,
                power: 'executive',
                sourceText: `Diário Oficial de Barbacena - ${isExtra ? `Edição Extra ${edition}` : `Edição ${edition}`} - ${gazetteDateStr}`,
              };

              gazettes.push(gazette);
              logger.info(`Found gazette for ${gazetteDateStr}: ${pdfUrl}`);
            }
          } catch (error) {
            logger.warn(`Failed to resolve PDF URL for edition ${edition}: ${(error as Error).message}`);
          }
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Parse download tokens from the main page HTML
   * Maps edition numbers to download tokens
   */
  private parseDownloadTokens(html: string): Record<string, string> {
    const tokens: Record<string, string> = {};
    
    // Pattern to match edition and download token
    // Looking for patterns like: 
    // - href="/portal/diario-oficial/ver/{ID}" near "Edição nº {EDITION}"
    // - data-href="/portal/download/diario-oficial/{TOKEN}/"
    
    // First, find all edition blocks
    // Pattern: "Edição nº 458" ... data-href="/portal/download/diario-oficial/CB-zPw/"
    const blockPattern = /Edi[çc][ãa]o\s+n[º°]?\s*(\d+)[\s\S]*?data-href="\/portal\/download\/diario-oficial\/([^"\/]+)\/?"/gi;
    
    let match;
    while ((match = blockPattern.exec(html)) !== null) {
      const edition = match[1];
      const token = match[2];
      
      if (!tokens[edition]) {
        tokens[edition] = token;
      }
    }
    
    // Also try reverse pattern where token comes before edition
    const reversePattern = /data-href="\/portal\/download\/diario-oficial\/([^"\/]+)\/?"[\s\S]*?Edi[çc][ãa]o\s+n[º°]?\s*(\d+)/gi;
    
    while ((match = reversePattern.exec(html)) !== null) {
      const token = match[1];
      const edition = match[2];
      
      if (!tokens[edition]) {
        tokens[edition] = token;
      }
    }
    
    return tokens;
  }

  /**
   * Resolve the actual PDF URL from the download page
   * The download page contains a meta-refresh redirect to the actual PDF
   */
  private async resolvePdfUrl(downloadPageUrl: string): Promise<string | null> {
    try {
      const response = await this.fetch(downloadPageUrl);
      
      // Look for meta-refresh redirect
      // Pattern: <meta http-equiv="refresh" content="0; url=/uploads/atos_06-01_06093007.pdf">
      const metaRefreshPattern = /meta\s+http-equiv=["']refresh["']\s+content=["'][^"']*url=([^"'>\s]+)["']/i;
      const match = response.match(metaRefreshPattern);
      
      if (match && match[1]) {
        let pdfPath = match[1];
        
        // If relative URL, make it absolute
        if (pdfPath.startsWith('/')) {
          pdfPath = `${this.barbacenaConfig.baseUrl}${pdfPath}`;
        }
        
        return pdfPath;
      }
      
      // Also check for direct PDF links
      const pdfLinkPattern = /href=["']([^"']+\.pdf)["']/i;
      const pdfMatch = response.match(pdfLinkPattern);
      
      if (pdfMatch && pdfMatch[1]) {
        let pdfPath = pdfMatch[1];
        
        if (pdfPath.startsWith('/')) {
          pdfPath = `${this.barbacenaConfig.baseUrl}${pdfPath}`;
        }
        
        return pdfPath;
      }
      
      return null;
    } catch (error) {
      logger.warn(`Failed to resolve PDF URL from ${downloadPageUrl}: ${(error as Error).message}`);
      return null;
    }
  }
}

