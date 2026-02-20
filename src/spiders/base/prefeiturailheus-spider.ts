import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraIlheusConfig } from '../../types';
import { logger } from '../../utils/logger';
import { getCurrentTimestamp } from '../../utils/date-utils';
import puppeteer from '@cloudflare/puppeteer';

/**
 * PrefeituraIlheusSpider implementation
 * 
 * Crawls the official gazette from Ilhéus, BA
 * Site: https://www.ilheus.ba.gov.br/diario-eletronico
 * 
 * The site uses a custom ASP.NET platform with AJAX (AjaxPro) to load data.
 * It requires client-side rendering to work properly.
 */
export class PrefeituraIlheusSpider extends BaseSpider {
  protected ilheusConfig: PrefeituraIlheusConfig;
  private browser?: Fetcher;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.ilheusConfig = spiderConfig.config as PrefeituraIlheusConfig;
    
    logger.info(`Initializing PrefeituraIlheusSpider for ${spiderConfig.name}`);
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    const baseUrl = 'https://www.ilheus.ba.gov.br';
    const diarioUrl = `${baseUrl}/diario-eletronico`;
    
    logger.info(`Crawling ${diarioUrl} for ${this.spiderConfig.name}...`);

    // If browser is available and requiresClientRendering is true, use Puppeteer
    if (this.browser && this.ilheusConfig.requiresClientRendering === true) {
      return this.crawlWithBrowser(baseUrl, diarioUrl);
    }

    // Fallback to API-based approach
    return await this.crawlWithApi(baseUrl);
  }

  /**
   * Crawl using Puppeteer browser (client-side rendering)
   */
  private async crawlWithBrowser(baseUrl: string, diarioUrl: string): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page = null;

    try {
      // Launch browser
      browserInstance = await puppeteer.launch(this.browser!);
      page = await browserInstance.newPage();
      
      // Navigate to the diario page
      logger.debug(`Navigating to: ${diarioUrl}`);
      await page.goto(diarioUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      
      // Wait for the page to load and JavaScript to execute
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Call the AjaxPro GetDiario function directly in the page context
      let hasMore = true;
      let pageNum = 0;
      const pageSize = 50;

      while (hasMore) {
        logger.info(`Fetching page ${pageNum} from AjaxPro API...`);
        
        // Execute fetch directly in browser to get raw AjaxPro response
        const apiResponse = await page.evaluate(async (pageNumber: number, size: number) => {
          try {
            const response = await fetch('/ajaxpro/diel_diel_lis,App_Web_1rviin0v.ashx', {
              method: 'POST',
              headers: {
                'Content-Type': 'text/plain; charset=UTF-8',
                'X-AjaxPro-Method': 'GetDiario',
              },
              body: JSON.stringify({
                Page: pageNumber,
                cdCaderno: -1,
                Size: size,
                dtDiario_menor: null,
                dtDiario_maior: null,
                dsPalavraChave: '',
                nuEdicao: -1,
                chkPesquisaExata: false
              }),
            });
            const text = await response.text();
            return { value: text };
          } catch (e: any) {
            return { error: e.message || 'Unknown error' };
          }
        }, pageNum, pageSize);

        if (apiResponse.error) {
          logger.warn(`AjaxPro error: ${apiResponse.error}`);
          hasMore = false;
          break;
        }

        // Parse the DataTable response
        const rows = this.parseAjaxProDataTable(apiResponse.value);
        
        if (!rows || rows.length === 0) {
          hasMore = false;
          break;
        }

        logger.debug(`Parsed ${rows.length} rows from API response`);

        let foundInRange = false;
        for (const row of rows) {
          const gazette = this.parseGazetteFromApiRow(row, baseUrl);
          
          if (gazette) {
            const dateObj = new Date(gazette.date);
            if (this.isInDateRange(dateObj)) {
              gazettes.push(gazette);
              foundInRange = true;
              logger.info(`Found gazette: ${gazette.date}`);
            }
          }
        }

        // Check if we need to fetch more pages
        const totalRows = rows[0]?.TOTAL_ROWS || 0;
        if ((pageNum + 1) * pageSize >= totalRows || !foundInRange) {
          hasMore = false;
        } else {
          pageNum++;
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from browser for ${this.spiderConfig.name}`);

    } catch (error) {
      logger.error(`Error crawling with browser:`, error as Error);
    } finally {
      // Clean up
      if (page) {
        try {
          await page.close();
        } catch (e) {
          // Ignore close errors
        }
      }
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch (e) {
          // Ignore close errors
        }
      }
    }

    return gazettes;
  }

  /**
   * Crawl using direct API calls (AjaxPro) - fallback when browser not available
   */
  private async crawlWithApi(baseUrl: string): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const apiUrl = `${baseUrl}/ajaxpro/diel_diel_lis,App_Web_1rviin0v.ashx`;
    
    try {
      let page = 0;
      let hasMore = true;
      const pageSize = 50;

      while (hasMore) {
        logger.info(`Fetching page ${page} from API...`);
        
        // Build the request body for AjaxPro
        // The API expects: Page, cdCaderno, Size, dtDiario_menor, dtDiario_maior, dsPalavraChave, nuEdicao, chkPesquisaExata
        const requestBody = JSON.stringify({
          Page: page,
          cdCaderno: -1,
          Size: pageSize,
          dtDiario_menor: null,
          dtDiario_maior: null,
          dsPalavraChave: '',
          nuEdicao: -1.0,
          chkPesquisaExata: false
        });

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain; charset=UTF-8',
            'X-AjaxPro-Method': 'GetDiario',
          },
          body: requestBody,
        });

        const text = await response.text();
        
        // Parse AjaxPro DataTable response
        const rows = this.parseAjaxProDataTable(text);
        
        if (!rows || rows.length === 0) {
          hasMore = false;
          continue;
        }

        let foundInRange = false;
        for (const row of rows) {
          const gazette = this.parseGazetteFromApiRow(row, baseUrl);
          
          if (gazette) {
            const dateObj = new Date(gazette.date);
            if (this.isInDateRange(dateObj)) {
              gazettes.push(gazette);
              foundInRange = true;
              logger.info(`Found gazette from API: ${gazette.date}`);
            }
          }
        }

        // Check if we need to fetch more pages
        const totalRows = rows[0]?.TOTAL_ROWS || 0;
        if ((page + 1) * pageSize >= totalRows || !foundInRange) {
          hasMore = false;
        } else {
          page++;
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from API for ${this.spiderConfig.name}`);
    } catch (error) {
      logger.error(`Error in API crawl:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Parse gazette from API response row
   */
  private parseGazetteFromApiRow(row: any, baseUrl: string): Gazette | null {
    try {
      const dtVisualizacao = row.DTVISUALIZACAO;
      if (!dtVisualizacao) {
        return null;
      }

      // Parse date from API response (already converted to ISO string)
      let date: string;
      if (typeof dtVisualizacao === 'string') {
        // Format: ISO string "YYYY-MM-DDTHH:mm:ss.sssZ"
        date = dtVisualizacao.split('T')[0];
      } else {
        return null;
      }

      // Build file URL using the NMARQUIVO (GUID format like {7A1DA1E6-378D-C2DA-5DBC-07A4EB7DEBAB})
      const nmArquivo = row.NMARQUIVO;
      const nmExtensao = row.NMEXTENSAOARQUIVO || '.pdf';
      
      if (!nmArquivo) {
        return null;
      }

      // The file URL format is: abrir_arquivo.aspx?cdLocal=12&arquivo={GUID}.pdf
      const fileUrl = `${baseUrl}/abrir_arquivo.aspx?cdLocal=12&arquivo=${nmArquivo}${nmExtensao}`;

      const editionNumber = row.NUEDICAO?.toString();
      
      // Clean HTML from description
      let description = row.DSDIARIO || row.NMCADERNO || '';
      description = description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (description.length > 200) {
        description = description.substring(0, 200) + '...';
      }

      return {
        date,
        fileUrl,
        territoryId: this.spiderConfig.territoryId,
        scrapedAt: getCurrentTimestamp(),
        isExtraEdition: false,
        power: 'executive_legislative',
        editionNumber,
        sourceText: description || `Diário Oficial ${date}`,
      };
    } catch (error) {
      logger.warn(`Error parsing API row:`, { error: (error as Error).message });
      return null;
    }
  }

  /**
   * Parse AjaxPro DataTable response
   * Format: new Ajax.Web.DataTable([columns], [rows]);/*
   */
  private parseAjaxProDataTable(text: string): any[] {
    try {
      // Handle both string (from API) and object (from browser evaluate)
      let responseText = text;
      if (typeof text === 'object') {
        responseText = JSON.stringify(text);
      }
      
      // Check for error
      if (responseText.includes('r.error')) {
        logger.warn('AjaxPro returned error:', responseText);
        return [];
      }

      // Remove the wrapper: "new Ajax.Web.DataTable(" at start and ");/*" at end
      const prefix = 'new Ajax.Web.DataTable(';
      const suffix = ');/*';
      
      if (!responseText.startsWith(prefix)) {
        logger.warn('Invalid AjaxPro response format - missing prefix');
        return [];
      }
      
      let content = responseText.substring(prefix.length);
      const suffixIndex = content.lastIndexOf(suffix);
      if (suffixIndex !== -1) {
        content = content.substring(0, suffixIndex);
      }
      
      // Now we have: [[columns]], [[rows]]
      // We need to find the split point between columns and rows
      // The columns array ends with ]], and rows start with [[
      const splitPattern = /\]\],\s*\[\[/;
      const splitMatch = content.match(splitPattern);
      
      if (!splitMatch || splitMatch.index === undefined) {
        logger.warn('Could not find split between columns and rows');
        return [];
      }
      
      const columnsStr = content.substring(0, splitMatch.index + 2); // Include the ]]
      let rowsStr = content.substring(splitMatch.index + splitMatch[0].length - 2); // Include the [[
      
      // Parse column definitions - these are valid JSON
      const columns: string[][] = JSON.parse(columnsStr);
      const columnNames = columns.map(col => col[0]);

      // Convert JavaScript Date objects to ISO strings for JSON parsing
      rowsStr = rowsStr
        .replace(/new Date\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/g, (_, year, month, day, hour, min, sec, ms) => {
          // JavaScript months are 0-indexed
          const date = new Date(parseInt(year), parseInt(month), parseInt(day), parseInt(hour), parseInt(min), parseInt(sec), parseInt(ms));
          return `"${date.toISOString()}"`;
        })
        .replace(/new Date\((\d+),(\d+),(\d+)\)/g, (_, year, month, day) => {
          const date = new Date(parseInt(year), parseInt(month), parseInt(day));
          return `"${date.toISOString()}"`;
        });

      const rowsData: any[][] = JSON.parse(rowsStr);

      // Convert to objects
      const rows = rowsData.map(row => {
        const obj: any = {};
        columnNames.forEach((name, index) => {
          obj[name] = row[index];
        });
        return obj;
      });

      return rows;
    } catch (error) {
      logger.warn('Error parsing AjaxPro DataTable:', { error: (error as Error).message });
      return [];
    }
  }
}
